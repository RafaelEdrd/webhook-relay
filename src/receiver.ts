import Fastify from 'fastify';
import type { PgPool } from './db.ts';
import { digest, verifySignature } from './signature.ts';
import { enqueue } from './repository.ts';

export function buildApp(pool: PgPool, inboundSecret: string) {
  const app = Fastify({ logger: { redact: ['req.headers.authorization', 'req.headers.x-event-signature'] },
                        bodyLimit: 256 * 1024, trustProxy: false });

  // The HMAC must use the bytes actually received, not re-serialized JSON.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  app.get('/health', async (_request, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  app.post('/events', async (request, reply) => {
    if (!Buffer.isBuffer(request.body)) return reply.code(415).send({ error: 'JSON body required' });
    const raw = request.body;
    const id = request.headers['x-event-id'];
    const timestamp = request.headers['x-event-timestamp'];
    const signature = request.headers['x-event-signature'];
    if (typeof id !== 'string' || typeof timestamp !== 'string' || typeof signature !== 'string' ||
        !verifySignature(inboundSecret, timestamp, id, signature, raw)) {
      return reply.code(401).send({ error: 'Invalid event signature' });
    }
    let payload: unknown;
    try { payload = JSON.parse(raw.toString('utf8')); }
    catch { return reply.code(400).send({ error: 'Invalid JSON' }); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        typeof (payload as Record<string, unknown>).type !== 'string' ||
        (payload as { type: string }).type.length > 80 ||
        !(payload as { type: string }).type ||
        !((payload as Record<string, unknown>).data) ||
        typeof ((payload as Record<string, unknown>).data) !== 'object' ||
        Array.isArray((payload as Record<string, unknown>).data)) {
      return reply.code(400).send({ error: 'Expected {type, data} object' });
    }
    const item = payload as { type: string; data: Record<string, unknown> };
    const outcome = await enqueue(pool, { id, eventType: item.type, payload: item, bodyHash: digest(raw) });
    if (outcome === 'conflict') return reply.code(409).send({ error: 'Event ID reused with different content' });
    return reply.code(outcome === 'created' ? 202 : 200).send({ event_id: id, status: outcome });
  });
  return app;
}
