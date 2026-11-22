# Changelog

## 1.1.0 RC1 — 2026-11-22

- Delivery attempt duration persisted and operator metrics.
- Manual bounded retention of old terminal attempts, preserving event deduplication IDs.
- SQL upgrade for existing installations.

## 1.0.0-rc.1 — 2026-11-22

- Lease UUID fencing and guarded state transitions.
- Automatic cleanup of expired final leases.
- Explicit replay with immutable lineage and queue statistics.
- Additional PostgreSQL integration tests.

Release candidate: do not claim production readiness until the repository CI and external database builds pass.
