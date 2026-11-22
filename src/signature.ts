import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

export const MAX_SKEW_SECONDS = 300;
const ID_PATTERN = /^[a-zA-Z0-9._:-]{1,80}$/;

export function digest(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

export function sign(secret: string, timestamp: number, id: string, body: Buffer): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${id}.`)
    .update(body)
    .digest('hex');
}

export function verifySignature(
  secret: string,
  timestampText: string | undefined,
  id: string | undefined,
  signature: string | undefined,
  body: Buffer,
  now = Math.floor(Date.now() / 1000),
): boolean {
  if (!timestampText || !/^[0-9]{10}$/.test(timestampText) || !id || !ID_PATTERN.test(id)) {
    return false;
  }
  if (!signature || !/^[a-fA-F0-9]{64}$/.test(signature)) return false;
  const timestamp = Number(timestampText);
  if (Math.abs(now - timestamp) > MAX_SKEW_SECONDS) return false;
  const expected = Buffer.from(sign(secret, timestamp, id, body), 'hex');
  const received = Buffer.from(signature, 'hex');
  return received.length === expected.length && timingSafeEqual(expected, received);
}
