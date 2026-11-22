-- Upgrade v1.0 RC1 -> v1.1. Back up, stop workers, execute once.
ALTER TABLE deliveries ADD COLUMN duration_ms INTEGER
  CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 60000);
