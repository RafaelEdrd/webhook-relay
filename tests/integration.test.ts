import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { MAX_ATTEMPTS } from '../src/retry.ts';
import { previewRetention, pruneDeliveryHistory } from '../src/retention.ts';
import { operationalMetrics } from '../src/observability.ts';
import { enqueue, claimOne, finalize, reapExpired, replayDead, queueStats } from '../src/repository.ts';

const url = process.env.TEST_DATABASE_URL;

async function testDb() {
  const { openPool } = await import('../src/db.ts');
  const pool = openPool(url!);
  await pool.query(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  await pool.query('TRUNCATE deliveries, events CASCADE');
  return pool;
}

const sample = { id: 'event-001', eventType: 'sample', bodyHash: 'a'.repeat(64),
  payload: { type: 'sample', data: { value: 7 } } };

test('durable enqueue, duplicate detection and delivery transition', { skip: !url }, async () => {
  const pool = await testDb();
  try {
    assert.equal(await enqueue(pool, sample), 'created');
    assert.equal(await enqueue(pool, sample), 'duplicate');
    assert.equal(await enqueue(pool, { ...sample, bodyHash: 'b'.repeat(64) }), 'conflict');
    const claimed = await claimOne(pool);
    assert.equal(claimed?.attempts, 1);
    assert.equal(await finalize(pool, claimed!,
      { delivered: true, httpStatus: 200, errorKind: null, retryDelay: null }), true);
    const state = await pool.query('SELECT status FROM events WHERE id=$1', [sample.id]);
    assert.equal(state.rows[0].status, 'delivered');
    assert.equal(await claimOne(pool), null);
    assert.deepEqual(await queueStats(pool), { delivered: 1 });
  } finally {
    await pool.end();
  }
});

test('old lease cannot finalize after the record is claimed by another worker', { skip: !url }, async () => {
  const pool = await testDb();
  try {
    await enqueue(pool, sample);
    const older = (await claimOne(pool))!;
    await pool.query(`UPDATE events SET leased_until=NOW()-INTERVAL '1 second' WHERE id=$1`, [older.id]);
    const newer = (await claimOne(pool))!;
    assert.equal(newer.attempts, older.attempts + 1);
    assert.notEqual(newer.lease_token, older.lease_token);
    const delivery = { delivered: true, httpStatus: 200, errorKind: null, retryDelay: null };
    assert.equal(await finalize(pool, older, delivery), false);
    assert.equal(await finalize(pool, newer, delivery), true);
    const count = await pool.query('SELECT COUNT(*)::integer AS n FROM deliveries');
    assert.equal(count.rows[0].n, 1);
  } finally {
    await pool.end();
  }
});

test('expired final attempt is dead-lettered and replay preserves audit chain', { skip: !url }, async () => {
  const pool = await testDb();
  try {
    await enqueue(pool, sample);
    await pool.query(`UPDATE events SET status='inflight', attempts=$1,
      leased_until=NOW()-INTERVAL '1 second' WHERE id=$2`, [MAX_ATTEMPTS, sample.id]);
    assert.equal(await reapExpired(pool), 1);
    assert.equal(await claimOne(pool), null);
    assert.equal(await replayDead(pool, sample.id, 'event-001-replay'), true);
    assert.equal(await replayDead(pool, sample.id, 'event-001-replay'), false);
    const record = (await claimOne(pool))!;
    assert.equal(record.id, 'event-001-replay');
    assert.equal(record.attempts, 1);
    const parent = await pool.query('SELECT replay_of FROM events WHERE id=$1', [record.id]);
    assert.equal(parent.rows[0].replay_of, sample.id);
  } finally {
    await pool.end();
  }
});


test('operational metrics report outcomes and measured duration', { skip: !url }, async () => {
  const pool = await testDb();
  try {
    await enqueue(pool, sample);
    const claimed = (await claimOne(pool))!;
    await finalize(pool, claimed, { delivered: true, httpStatus: 202,
      errorKind: null, retryDelay: null, durationMs: 15 });
    const summary = await operationalMetrics(pool, 24);
    assert.deepEqual(summary.queue, { delivered: 1 });
    assert.equal(summary.attempts, 1);
    assert.equal(summary.successful_attempts, 1);
    assert.equal(summary.avg_delivery_duration_ms, 15);
    assert.equal(summary.oldest_ready_event_seconds, null);
  } finally { await pool.end(); }
});


test('retention removes old terminal attempts but never event IDs', { skip: !url }, async () => {
  const pool = await testDb();
  try {
    await enqueue(pool, sample);
    const claimed = (await claimOne(pool))!;
    await finalize(pool, claimed, { delivered: true, httpStatus: 204,
      errorKind: null, retryDelay: null, durationMs: 4 });
    await pool.query("UPDATE deliveries SET attempted_at=NOW()-INTERVAL '100 days'");
    assert.equal(await previewRetention(pool, 90), 1);
    assert.equal(await pruneDeliveryHistory(pool, 90), 1);
    assert.equal(await previewRetention(pool, 90), 0);
    assert.equal(await enqueue(pool, sample), 'duplicate');
    assert.deepEqual(await queueStats(pool), { delivered: 1 });
  } finally { await pool.end(); }
});
