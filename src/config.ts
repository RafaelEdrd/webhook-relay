import { safeDestination } from './retry.ts';

export interface Config {
  port: number;
  databaseUrl: string;
  inboundSecret: string;
  outboundSecret: string;
  destination: URL;
  workerPollMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const inboundSecret = env.INBOUND_WEBHOOK_SECRET ?? '';
  const outboundSecret = env.OUTBOUND_WEBHOOK_SECRET ?? '';
  if (inboundSecret.length < 32 || outboundSecret.length < 32 || inboundSecret === outboundSecret) {
    throw new Error('Configure two distinct webhook secrets of at least 32 characters');
  }
  const databaseUrl = env.DATABASE_URL ?? '';
  if (!databaseUrl.startsWith('postgres://') && !databaseUrl.startsWith('postgresql://')) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL');
  }
  const port = Number(env.PORT ?? 8082);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const destination = safeDestination(env.WEBHOOK_DESTINATION ?? '', env.NODE_ENV === 'production');
  return { port, databaseUrl, inboundSecret, outboundSecret, destination, workerPollMs: 1500 };
}
