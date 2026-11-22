import { loadConfig } from './config.ts';
import { openPool } from './db.ts';
import { claimOne, finalize, reapExpired } from './repository.ts';
import { isDelivered, MAX_ATTEMPTS, nextDelaySeconds } from './retry.ts';
import { sign } from './signature.ts';

const config = loadConfig();
const pool = openPool(config.databaseUrl);
let stopping = false;

async function deliverOne() {
  const record = await claimOne(pool);
  if (!record) return false;
  const body = Buffer.from(JSON.stringify(record.payload));
  const timestamp = Math.floor(Date.now() / 1000);
  let httpStatus: number | null = null;
  let errorKind: string | null = null;
  let delivered = false;
  const started = performance.now();
  try {
    const response = await fetch(config.destination, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Event-Id': record.id,
        'X-Event-Timestamp': String(timestamp),
        'X-Event-Signature': sign(config.outboundSecret, timestamp, record.id, body),
      },
      body,
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    });
    httpStatus = response.status;
    delivered = isDelivered(response.status);
    if (!delivered) errorKind = `HTTP_${response.status}`;
    await response.body?.cancel();
  } catch {
    errorKind = 'NETWORK_OR_TIMEOUT';
  }
  const finalized = await finalize(pool, record, {
    delivered, httpStatus, errorKind,
    retryDelay: delivered || record.attempts >= MAX_ATTEMPTS ? null : nextDelaySeconds(record.attempts),
    durationMs: Math.min(60000, Math.round(performance.now() - started)),
  });
  process.stdout.write(JSON.stringify({ event_id: record.id, attempt: record.attempts,
    status: !finalized ? 'stale_lease' : delivered ? 'delivered' : record.attempts >= MAX_ATTEMPTS ? 'dead' : 'retry',
    error: errorKind }) + '\n');
  return true;
}

async function main() {
  while (!stopping) {
    try {
      await reapExpired(pool);
      const worked = await deliverOne();
      if (!worked) await new Promise(resolve => setTimeout(resolve, config.workerPollMs));
    } catch (error) {
      console.error(JSON.stringify({ kind: 'worker_failure', message: error instanceof Error ? error.name : 'unknown' }));
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  await pool.end();
}

process.once('SIGINT', () => { stopping = true; });
process.once('SIGTERM', () => { stopping = true; });
await main();
