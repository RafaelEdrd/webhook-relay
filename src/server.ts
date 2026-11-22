import { loadConfig } from './config.ts';
import { openPool } from './db.ts';
import { buildApp } from './receiver.ts';

const config = loadConfig();
const pool = openPool(config.databaseUrl);
const app = buildApp(pool, config.inboundSecret);

await app.listen({ host: '127.0.0.1', port: config.port });

process.on('SIGTERM', async () => { await app.close(); await pool.end(); });
process.on('SIGINT', async () => { await app.close(); await pool.end(); });
