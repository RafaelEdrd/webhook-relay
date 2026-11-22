-- Upgrade a v0.1 schema to the current version. Back up before applying.
-- Run once during a maintenance window after stopping the v0.1 worker.
ALTER TABLE events ADD COLUMN lease_token UUID;
ALTER TABLE events ADD COLUMN replay_of VARCHAR(80) REFERENCES events(id);
UPDATE events SET status='queued', leased_until=NULL, next_attempt_at=NOW(), lease_token=NULL
WHERE status='inflight' AND attempts < 6;
UPDATE events SET status='dead', leased_until=NULL, last_error_kind='MIGRATION_EXPIRED_LEASE'
WHERE status='inflight' AND attempts >= 6;
