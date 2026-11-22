CREATE TABLE IF NOT EXISTS events (
  id VARCHAR(80) PRIMARY KEY,
  event_type VARCHAR(80) NOT NULL,
  payload JSONB NOT NULL,
  body_hash CHAR(64) NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','inflight','delivered','dead')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  leased_until TIMESTAMPTZ,
  lease_token UUID,
  replay_of VARCHAR(80) REFERENCES events(id),
  last_error_kind VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_ready ON events(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS deliveries (
  id BIGSERIAL PRIMARY KEY,
  event_id VARCHAR(80) NOT NULL REFERENCES events(id),
  attempt INTEGER NOT NULL CHECK(attempt > 0),
  http_status INTEGER,
  error_kind VARCHAR(50),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 60000),
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, attempt)
);
