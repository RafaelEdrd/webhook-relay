import { loadConfig } from '../src/config.ts';
import { openPool } from '../src/db.ts';
import { queueStats } from '../src/repository.ts';

const config = loadConfig();
const pool = openPool(config.databaseUrl);
try {
  console.log(JSON.stringify({ event: 'queue_status', counts: await queueStats(pool) }));
} finally {
  await pool.end();
}
