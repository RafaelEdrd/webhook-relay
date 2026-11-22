import { readFile } from 'node:fs/promises';

import { openPool } from '../src/db.ts';

const databaseUrl = process.env.DATABASE_URL ?? '';
if (!databaseUrl.startsWith('postgres://') && !databaseUrl.startsWith('postgresql://')) {
  throw new Error('DATABASE_URL must be set to a PostgreSQL connection URL');
}
const pool = openPool(databaseUrl);
try {
  const sql = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  await pool.query(sql);
  console.log('Schema applied.');
} finally {
  await pool.end();
}
