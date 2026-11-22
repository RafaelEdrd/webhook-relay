import assert from 'node:assert/strict';
import test from 'node:test';
import { retentionDays } from '../src/retention.ts';
import { validateWindow } from '../src/observability.ts';
import { digest, sign, verifySignature } from '../src/signature.ts';
import { isDelivered, MAX_ATTEMPTS, nextDelaySeconds, safeDestination } from '../src/retry.ts';

const secret = 'test-only-strong-secret-that-will-not-be-used';
const body = Buffer.from('{"type":"test","data":{}}');
const now = 1_750_000_000;

test('accepts an unmodified signed event inside the replay window', () => {
  const signature = sign(secret, now, 'event-012', body);
  assert.equal(verifySignature(secret, String(now), 'event-012', signature, body, now), true);
});

test('rejects tampering, invalid IDs, stale timestamps and invalid HMAC', () => {
  const signature = sign(secret, now, 'event-012', body);
  assert.equal(verifySignature(secret, String(now), 'event-012', signature, Buffer.from('tampered'), now), false);
  assert.equal(verifySignature(secret, String(now), '../bad', signature, body, now), false);
  assert.equal(verifySignature(secret, String(now - 301), 'event-012', signature, body, now), false);
  assert.equal(verifySignature(secret, String(now), 'event-012', 'bad', body, now), false);
  assert.equal(verifySignature(secret, undefined, 'event-012', signature, body, now), false);
  assert.equal(digest(body).length, 64);
});

test('retry policy is bounded and jitters predictably when supplied a value', () => {
  assert.equal(MAX_ATTEMPTS, 6);
  assert.equal(nextDelaySeconds(1, 0.5), 30);
  assert.equal(nextDelaySeconds(2, 0.5), 60);
  assert.equal(nextDelaySeconds(10, 0.5), 3600);
  assert.throws(() => nextDelaySeconds(0));
});

test('HTTP success classification is limited to 2xx', () => {
  assert.equal(isDelivered(204), true);
  assert.equal(isDelivered(300), false);
  assert.equal(isDelivered(503), false);
});

test('HTTPS destination only, except explicit development loopback', () => {
  assert.equal(safeDestination('https://example.org/webhooks', true).hostname, 'example.org');
  assert.equal(safeDestination('http://127.0.0.1:8080/hook', false).hostname, '127.0.0.1');
  assert.throws(() => safeDestination('http://127.0.0.1/hook', true));
  assert.throws(() => safeDestination('http://10.0.0.5/hook', false));
  assert.throws(() => safeDestination('https://127.0.0.1/hook', true));
  assert.throws(() => safeDestination('https://service.internal/hook', true));
  assert.throws(() => safeDestination('https://user:pass@example.org/hook', true));
});


test('monitoring window validation rejects unbounded or fractional scans', () => {
  assert.equal(validateWindow(24), 24);
  for (const hours of [0, -1, 721, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => validateWindow(hours));
  }
});


test('retention prevents aggressive deletion of delivery history', () => {
  assert.equal(retentionDays(90), 90);
  for (const value of [0, 89, 3651, 90.1, Number.NaN]) {
    assert.throws(() => retentionDays(value));
  }
});
