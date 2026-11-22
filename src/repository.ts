import type { PgPool } from './db.ts';
import { MAX_ATTEMPTS } from './retry.ts';

/** A lease token fences off previous attempts after a worker crash or lease expiry. */
export interface EventRecord extends Record<string, unknown> {
  id: string;
  event_type: string;
  payload: { type: string; data: Record<string, unknown> };
  attempts: number;
  lease_token: string;
}

export async function enqueue(
  pool: PgPool,
  event: { id: string; eventType: string; payload: object; bodyHash: string },
): Promise<'created' | 'duplicate' | 'conflict'> {
  const inserted = await pool.query(
    `INSERT INTO events (id, event_type, payload, body_hash)
     VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING RETURNING id`,
    [event.id, event.eventType, JSON.stringify(event.payload), event.bodyHash],
  );
  if (inserted.rowCount === 1) return 'created';
  const existing = await pool.query<{ body_hash: string }>('SELECT body_hash FROM events WHERE id=$1', [event.id]);
  return existing.rows[0]?.body_hash === event.bodyHash ? 'duplicate' : 'conflict';
}

/** One DB statement claims one event; concurrent workers skip locked rows. */
export async function claimOne(pool: PgPool): Promise<EventRecord | null> {
  const result = await pool.query<EventRecord>(`
    WITH candidate AS (
      SELECT id FROM events
      WHERE ((status='queued' AND next_attempt_at<=NOW())
         OR (status='inflight' AND leased_until<NOW())) AND attempts < $1
      ORDER BY next_attempt_at, created_at
      FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE events SET status='inflight', lease_token=gen_random_uuid(),
      leased_until=NOW()+INTERVAL '45 seconds', attempts=events.attempts+1,
      updated_at=NOW()
    FROM candidate
    WHERE events.id=candidate.id
    RETURNING events.id, events.event_type, events.payload, events.attempts, events.lease_token
  `, [MAX_ATTEMPTS]);
  return result.rows[0] ?? null;
}

export interface DeliveryResult {
  delivered: boolean;
  httpStatus: number | null;
  errorKind: string | null;
  retryDelay: number | null;
  durationMs?: number | null;
}

/** Finalization only succeeds for a *live* lease still owned by the same attempt. */
export async function finalize(pool: PgPool, record: Pick<EventRecord, 'id' | 'attempts' | 'lease_token'>,
  result: DeliveryResult): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const nextStatus = result.delivered ? 'delivered' : result.retryDelay === null ? 'dead' : 'queued';
    const saved = await client.query(`
      UPDATE events SET status=$4, lease_token=NULL, leased_until=NULL,
        next_attempt_at=CASE WHEN $5::integer IS NULL THEN next_attempt_at
                        ELSE NOW()+($5::integer*INTERVAL '1 second') END,
        last_error_kind=$6, updated_at=NOW()
      WHERE id=$1 AND attempts=$2 AND lease_token=$3::uuid
        AND status='inflight' AND leased_until>NOW()
      RETURNING id
    `, [record.id, record.attempts, record.lease_token,
        nextStatus, result.retryDelay, result.errorKind]);
    if (saved.rowCount !== 1) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query(`INSERT INTO deliveries (event_id,attempt,http_status,error_kind,duration_ms)
      VALUES ($1,$2,$3,$4,$5)`,
    [record.id, record.attempts, result.httpStatus, result.errorKind, result.durationMs ?? null]);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Expired last attempts are dead-lettered, not left stuck in inflight forever. */
export async function reapExpired(pool: PgPool): Promise<number> {
  const done = await pool.query(`UPDATE events SET status='dead', lease_token=NULL,
    leased_until=NULL, last_error_kind='LEASE_EXPIRED', updated_at=NOW()
    WHERE status='inflight' AND leased_until<NOW() AND attempts >= $1`, [MAX_ATTEMPTS]);
  return done.rowCount ?? 0;
}

/** Replays use a fresh event ID so delivery attempts stay immutable and auditable. */
export async function replayDead(pool: PgPool, originalId: string, newId: string): Promise<boolean> {
  if (!/^[a-zA-Z0-9._:-]{1,80}$/.test(newId) || originalId === newId) {
    throw new Error('A distinct, valid new event ID is required');
  }
  const result = await pool.query(`INSERT INTO events
    (id,event_type,payload,body_hash,replay_of)
    SELECT $2,event_type,payload,body_hash,id FROM events
    WHERE id=$1 AND status='dead'
    ON CONFLICT (id) DO NOTHING RETURNING id`, [originalId, newId]);
  return result.rowCount === 1;
}

export async function queueStats(pool: PgPool): Promise<Record<string, number>> {
  const result = await pool.query<{ status: string; total: string }>(
    'SELECT status,COUNT(*) AS total FROM events GROUP BY status ORDER BY status');
  return Object.fromEntries(result.rows.map((row) => [row.status, Number(row.total)]));
}
