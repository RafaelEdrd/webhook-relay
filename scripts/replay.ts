import { loadConfig } from '../src/config.ts';
import { openPool } from '../src/db.ts';
import { replayDead } from '../src/repository.ts';

const [originalId, newId] = process.argv.slice(2);
if (!originalId || !newId) {
  console.error('Usage: npm run replay -- <dead-event-id> <new-event-id>');
  process.exitCode = 2;
} else {
  const pool = openPool(loadConfig().databaseUrl);
  try {
    const created = await replayDead(pool, originalId, newId);
    if (!created) {
      console.error('No dead event found or the new ID is already in use');
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify({ event: 'replay_created', original_id: originalId, event_id: newId }));
    }
  } finally {
    await pool.end();
  }
}
