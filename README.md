# Webhook Relay

A PostgreSQL-backed webhook delivery service built with Node.js, TypeScript and Fastify.

Webhook Relay receives authenticated events, persists them before acknowledgement and delivers them asynchronously to a configured downstream endpoint.

The project focuses on delivery reliability, idempotency, concurrency control and operational traceability without introducing a general-purpose message broker.

> Status: v1.1.0-rc.1 — Release candidate. Production readiness has not been established.

## Architecture

```text
Webhook Producer
       |
       | HMAC-SHA256
       v
Fastify Receiver
       |
       | Validate and persist
       v
PostgreSQL Event Queue
       |
       | Lease-based claiming
       v
Delivery Worker
       |
       | Signed HTTP POST
       v
Configured Destination
```

The receiver and delivery worker run as separate processes.

Incoming events are acknowledged after successful persistence, without waiting for downstream delivery.

## Technology

- Node.js >= 22.16.0
- TypeScript
- Fastify 5
- PostgreSQL
- Node.js built-in test runner
- GitHub Actions

## Key Features

### Durable event ingestion

Accepted events are stored in PostgreSQL before the receiver responds.

### Persistent idempotency

Event IDs are unique in the database.

Submitting the same event ID and identical body returns a duplicate response. Reusing an ID with different content returns HTTP 409.

### HMAC authentication

Inbound and outbound messages use HMAC-SHA256 signatures covering:

- Unix timestamp
- Event ID
- Raw request body

The signature verification window is five minutes.

### Concurrent workers

Workers claim events using PostgreSQL row locking with `FOR UPDATE SKIP LOCKED`.

Lease tokens, attempt counters and lease-validity checks prevent outdated workers from finalizing records after losing ownership.

### Retry handling

Failed deliveries use exponential backoff with jitter, with a maximum of six delivery attempts.

Events that exhaust their attempts transition to the `dead` state.

### Auditable replay

Dead events can be replayed through an explicit CLI operation.

Each replay receives a new event ID and preserves a reference to its original event.

### Operational visibility

CLI tools expose queue statistics, delivery attempts, failure counts, average delivery duration and the age of the oldest ready event.

### Controlled retention

Delivery-attempt history can be pruned in bounded batches.

Event IDs and replay relationships are preserved.

## Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/RafaelEdrd/webhook-relay.git
cd webhook-relay
npm ci
```

Configure the environment variables using `.env.example` as a reference.

Required variables:

| Variable | Purpose |
| --- | --- |
| DATABASE_URL | PostgreSQL connection string |
| INBOUND_WEBHOOK_SECRET | Secret used to verify incoming requests |
| OUTBOUND_WEBHOOK_SECRET | Secret used to sign outgoing requests |
| WEBHOOK_DESTINATION | Fixed downstream delivery URL |
| PORT | Receiver port, default 8082 |
| NODE_ENV | Runtime environment |

The inbound and outbound secrets must be distinct and contain at least 32 characters.

Environment variables must be exported by the shell or process manager. The application does not automatically load `.env` files.

## Database

For a new, dedicated PostgreSQL database:

```bash
npm run migrate
```

The migration command applies `db/schema.sql`.

Existing installations require an explicit migration procedure using the SQL scripts in `db/migrations/`.

Back up the database and stop workers before performing schema upgrades.

## Running

Start the HTTP receiver:

```bash
npm start
```

Start the delivery worker in a separate process:

```bash
npm run worker
```

The receiver binds to `127.0.0.1` by default.

For the local demonstration, the repository also includes:

```bash
node --experimental-strip-types scripts/demo-receiver.ts
```

And an example event producer:

```bash
node --experimental-strip-types scripts/send-demo.ts
```

Both require the appropriate exported environment variables.

## HTTP API

### GET /health

Checks database connectivity.

Successful response:

```json
{
  "status": "ok"
}
```

Returns HTTP 503 when the database check fails.

### POST /events

Receives an authenticated JSON event.

Example payload:

```json
{
  "type": "ticket.created",
  "data": {
    "ticket_id": "TKT-1001",
    "queue": "support"
  }
}
```

Required headers:

- Content-Type: application/json
- X-Event-Id
- X-Event-Timestamp
- X-Event-Signature

Response behavior:

| HTTP status | Meaning |
| --- | --- |
| 202 | Event created |
| 200 | Duplicate event accepted |
| 400 | Invalid JSON or payload |
| 401 | Invalid signature |
| 409 | Event ID conflict |
| 415 | JSON body required |

The request body limit is 256 KiB.

The signature must be calculated from the original raw JSON bytes.

## Operational Commands

Check queue statistics:

```bash
npm run status
```

Retrieve operational metrics for the previous 24 hours:

```bash
npm run metrics
```

Retrieve metrics for a specific window:

```bash
npm run metrics -- 48
```

Replay a dead event:

```bash
npm run replay -- original-event-id new-event-id
```

Preview delivery-history retention:

```bash
npm run retention -- 90
```

Apply one bounded retention batch:

```bash
npm run retention -- 90 --apply
```

Retention applies only to eligible terminal delivery attempts, not event identities.

## Testing

Static TypeScript validation:

```bash
npm run typecheck
```

Automated tests:

```bash
npm test
```

PostgreSQL integration tests require `TEST_DATABASE_URL`.

Use a dedicated, disposable test database. The integration suite truncates the `events` and `deliveries` tables and must never run against production data.

When the variable is absent, the PostgreSQL integration tests are skipped.

The GitHub Actions workflow provisions a PostgreSQL 16 service and executes type checking and automated tests.

## Security Considerations

The implementation includes:

- HMAC-SHA256 request authentication
- Timestamp freshness validation
- Constant-time signature comparison
- Request-size limits
- Separate inbound and outbound secrets
- Fixed destination configuration
- HTTPS-only outbound destinations in production
- Rejection of URL credentials and selected internal hostnames
- No unauthenticated administrative replay endpoint

Application-level destination validation does not replace network-level egress controls.

Production deployments require additional infrastructure protections, including destination/IP restrictions, secret management, TLS termination and monitoring.

## Delivery Semantics

Webhook Relay uses **at-least-once delivery**.

A downstream service may receive the same event more than once, particularly when a worker crashes or loses its lease after performing an external HTTP request.

Consumers must therefore implement their own idempotency strategy.

The system does not guarantee exactly-once execution of downstream side effects.

## Current Limitations

- Single configured delivery destination
- No built-in graphical administration interface
- No automatic loading of `.env` files
- Manual replay through CLI
- Manual, bounded retention maintenance
- No general-purpose task queue abstraction
- No established production-readiness certification

## Engineering Decisions

Architectural tradeoffs, lease fencing, replay lineage and retention boundaries are documented in [docs/decisions.md](docs/decisions.md).

Release history is available in [CHANGELOG.md](CHANGELOG.md).

## License

No open-source license has been assigned. All rights are reserved unless a license is added.
