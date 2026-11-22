import { loadConfig } from '../src/config.ts';
import { openPool } from '../src/db.ts';
import { previewRetention, pruneDeliveryHistory, retentionDays } from '../src/retention.ts';

const args = process.argv.slice(2);
if (args.length < 1 || args.length > 2 || !/^\d+$/.test(args[0] ?? '') ||
    (args[1] !== undefined && args[1] !== '--apply')) {
  throw new Error('Usage: npm run retention -- <days:90..3650> [--apply]');
}
const days = retentionDays(Number(args[0]));
const apply = args[1] === '--apply';
const pool = openPool(loadConfig().databaseUrl);
try {
  const eligible = await previewRetention(pool, days);
  if (!apply) {
    console.log(JSON.stringify({ action: 'retention_dry_run', days, eligible }));
  } else {
    // Deliberately bounded: rerun a manual maintenance task to process more history.
    const deleted = await pruneDeliveryHistory(pool, days);
    console.log(JSON.stringify({ action: 'retention_applied', days, eligible,
      deleted, event_ids_preserved: true }));
  }
} finally {
  await pool.end();
}
