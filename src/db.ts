import pg from 'pg';

import type { Pool as PgPool, PoolClient as PgClient } from 'pg';
export type { PgPool, PgClient };

export function openPool(connectionString: string): PgPool {
  return new pg.Pool({ connectionString, max: 8, idleTimeoutMillis: 10000, connectionTimeoutMillis: 4000 });
}
