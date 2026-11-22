import { sign } from '../src/signature.ts';

const secret = process.env.INBOUND_WEBHOOK_SECRET ?? '';
if (secret.length < 32) throw new Error('Configure INBOUND_WEBHOOK_SECRET');
const id = `sample-${Date.now()}`;
const timestamp = Math.floor(Date.now() / 1000);
const body = Buffer.from(JSON.stringify({ type: 'demo.ticket.created',
  data: { ticket_id: 'TKT-1001', queue: 'support' } }));
const response = await fetch('http://127.0.0.1:8082/events', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Event-Id': id,
    'X-Event-Timestamp': String(timestamp),
    'X-Event-Signature': sign(secret, timestamp, id, body) }, body,
});
console.log(response.status, await response.text());
