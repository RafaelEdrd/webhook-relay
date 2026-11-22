# Engineering decisions

- **Ingest and deliver separately.** A healthy receiver should acknowledge a durably queued event without waiting for downstream latency.
- **HMAC covers timestamp, ID and raw body.** If a sender already has a different signature protocol, adapt the verifier to that documented format rather than silently accepting alternate signatures.
- **Persist idempotency keys.** Redis in-memory dedupe would lose the record on restart. PostgreSQL unique IDs persist with events.
- **Lease and requeue.** `FOR UPDATE SKIP LOCKED` supports concurrent workers. A worker crash can release a timed-out lease; downstream side effects therefore remain at least once.
- **Minimal outbound surface.** No user-defined URL registration. A deployment has one trusted destination, and prod rejects non-HTTPS schemes. Enforce IP allowlists/destination checks in network infrastructure before exposing this beyond a controlled environment.
- **No general task queue abstraction.** The event state model covers this project without framework scaffolding.

## v1: lease fencing and immutable replay chain

A time-based lease alone cannot prevent an old worker from committing after a new worker takes over. Every claim now stores a random UUID token. Finalization checks that token **and** the attempt number **and** lease validity in one transaction; delivery history is recorded only after the guarded update succeeds. The last expired attempt transitions to dead, rather than remaining stuck indefinitely.

Replay is an explicit CLI operation requiring database credentials. It creates a new event ID and `replay_of` reference; the old event and its attempts are immutable. This makes repeated manual interventions inspectable. We intentionally avoid an unauthenticated HTTP administration endpoint.

## v1.1 RC1: boundaries

Operational statistics distinguish attempt outcomes from unique event delivery. Terminal attempt retention is bounded and opt-in; deleting event records would break idempotency, so IDs and replay relationships remain. A database upgrade is explicit to avoid unnoticed production schema changes.
