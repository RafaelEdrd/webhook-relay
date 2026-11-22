import type { PgPool } from './db.ts';
import { queueStats } from './repository.ts';

/** Window applies to attempted deliveries; queue counts are instantaneous. */
export function validateWindow(hours: number): number {
  if (!Number.isInteger(hours) || hours < 1 || hours > 720) {
    throw new Error('Window must be an integer between 1 and 720 hours');
  }
  return hours;
}

export async function operationalMetrics(pool: PgPool, hours = 24) {
  validateWindow(hours);
  const queue = await queueStats(pool);
  const deliveries = await pool.query<{
    attempts: string;
    failures: string;
    successful: string;
    avg_duration_ms: string | null;
  }>(`SELECT COUNT(*) AS attempts,
    COUNT(*) FILTER (WHERE http_status IS NULL OR http_status < 200 OR http_status >= 300) AS failures,
    COUNT(*) FILTER (WHERE http_status BETWEEN 200 AND 299) AS successful,
    ROUND(AVG(duration_ms), 1) AS avg_duration_ms
    FROM deliveries WHERE attempted_at >= NOW() - ($1::integer * INTERVAL '1 hour')`, [hours]);
  const oldest = await pool.query<{ ready_age_seconds: string | null }>(
    `SELECT EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) AS ready_age_seconds
     FROM events WHERE status='queued' AND next_attempt_at <= NOW()`);
  const stats = deliveries.rows[0];
  return {
    recorded_at: new Date().toISOString(),
    window_hours: hours,
    queue,
    attempts: Number(stats.attempts),
    successful_attempts: Number(stats.successful),
    failed_attempts: Number(stats.failures),
    avg_delivery_duration_ms: stats.avg_duration_ms === null ? null : Number(stats.avg_duration_ms),
    oldest_ready_event_seconds: oldest.rows[0]?.ready_age_seconds == null
      ? null : Math.max(0, Math.round(Number(oldest.rows[0].ready_age_seconds))),
  };
}
