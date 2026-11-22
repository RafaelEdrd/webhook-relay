// Local-only example consumer. It does not store the event body.
import { createServer } from 'node:http';
import { verifySignature } from '../src/signature.ts';

const secret = process.env.OUTBOUND_WEBHOOK_SECRET ?? '';
if (secret.length < 32) throw new Error('Configure OUTBOUND_WEBHOOK_SECRET');

const server = createServer(async (request, response) => {
  if (request.url !== '/hook' || request.method !== 'POST') {
    response.writeHead(404).end();
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 256 * 1024) {
      response.writeHead(413).end();
      request.destroy();
      return;
    }
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks);
  const id = request.headers['x-event-id'];
  const ts = request.headers['x-event-timestamp'];
  const sig = request.headers['x-event-signature'];
  if (!verifySignature(secret,
      typeof ts === 'string' ? ts : undefined,
      typeof id === 'string' ? id : undefined,
      typeof sig === 'string' ? sig : undefined, raw)) {
    response.writeHead(401).end();
    return;
  }
  let item: { type: string };
  try { item = JSON.parse(raw.toString('utf8')) as { type: string }; }
  catch { response.writeHead(400).end(); return; }
  console.log(JSON.stringify({ accepted_id: id, event_type: item.type }));
  response.writeHead(204).end();
});

server.listen(9090, '127.0.0.1', () => console.log('Demo receiver on http://127.0.0.1:9090/hook'));
