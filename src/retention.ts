import type { PgPool } from './db.ts';

/** Preserve event IDs indefinitely to prevent accepting an old idempotency key again. */
export function retentionDays(value: number): number {
  if (!Number.isInteger(value) || value < 90 || value > 3650) {
    throw new Error('Delivery history retention must be an integer between 90 and 3650 days');
  }
  return value;
}

export async function previewRetention(pool: PgPool, days: number): Promise<number> {
  retentionDays(days);
  const count = await pool.query<{ total: string }>(`SELECT COUNT(*) AS total FROM deliveries d
    JOIN events e ON e.id = d.event_id
    WHERE e.status IN ('delivered','dead')
      AND d.attempted_at < NOW() - ($1::integer * INTERVAL '1 day')`, [days]);
  return Number(count.rows[0]?.total ?? 0);
}

/** Delete only terminal attempts. Events and replay chains remain untouched. */
export async function pruneDeliveryHistory(pool: PgPool, days: number, limit = 500): Promise<number> {
  retentionDays(days);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error('Batch size must be an integer between 1 and 500');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`WITH expired AS (
        SELECT d.id FROM deliveries d
        JOIN events e ON e.id = d.event_id
        WHERE e.status IN ('delivered','dead')
          AND d.attempted_at < NOW() - ($1::integer * INTERVAL '1 day')
        ORDER BY d.id FOR UPDATE OF d SKIP LOCKED LIMIT $2
      ) DELETE FROM deliveries WHERE id IN (SELECT id FROM expired)`, [days, limit]);
    await client.query('COMMIT');
    return result.rowCount ?? 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
