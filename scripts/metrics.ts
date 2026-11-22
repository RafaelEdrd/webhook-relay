import { loadConfig } from '../src/config.ts';
import { openPool } from '../src/db.ts';
import { operationalMetrics, validateWindow } from '../src/observability.ts';

const hours = validateWindow(Number(process.argv[2] ?? 24));
const pool = openPool(loadConfig().databaseUrl);
try {
  console.log(JSON.stringify(await operationalMetrics(pool, hours), null, 2));
} finally {
  await pool.end();
}
