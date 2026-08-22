# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- **PII masking now actually runs.** `maskPii()` silently returned unmasked data
  unless the `MASK_PII` environment variable was literally `"true"`, so masking
  enabled from the dashboard had no effect. The check is gone and masking is
  driven by the resolved configuration. Masking is on by default; set
  `MASK_PII=false` to store payloads verbatim.
- **Dashboard auth no longer falls back to `admin`/`admin`.** Enabling
  `DASHBOARD_AUTH_ENABLED` without `DASHBOARD_PASSWORD` now refuses to start.
  Credentials are compared in constant time.
- **Operator-supplied URLs are validated.** The upstream base URL and alert
  webhooks are settable at runtime from an optionally unauthenticated dashboard.
  Non-HTTP schemes and cloud instance-metadata endpoints are rejected; webhooks
  additionally require HTTPS and a public host. Local providers (Ollama, vLLM,
  Docker service names) still work — set `BLOCK_PRIVATE_UPSTREAM=true` to
  disallow them.
- **Guardrails no longer bypassed by multimodal messages.** Content sent as a
  parts array (`[{ type: 'text', … }]`) stringified to `""`, so banned keywords
  passed through unchecked and active PII redaction skipped the message.
- **Dashboard Basic credentials are no longer forwarded upstream.**
- Added security response headers (CSP, `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`) and a per-IP rate limiter
  (`API_RATE_LIMIT`, `PROXY_RATE_LIMIT`).
- `DELETE /api/logs` now requires `?confirm=true`.

### Fixed
- **PostgreSQL mode could not start.** `seedModels()` called the synchronous
  better-sqlite3 API on a `pg.Pool`, so startup always failed with
  `DATABASE_URL` set. Seeding now goes through the shared adapter API.
- Seeding no longer deletes the models table on every boot, so pricing edited in
  the dashboard and custom models survive a restart.
- The background evaluator could exceed `EVALUATION_CONCURRENCY`: the worker
  count was incremented after an `await`, so overlapping dispatches all passed
  the limit check. The queue is now a dedicated bounded-concurrency module.
- Streaming and non-streaming proxy requests abort their upstream call when the
  client disconnects, instead of reading the rest of the response into nothing.
- Phone-number masking never matched an international country code: the leading
  `` sat before `+`, where there is no word boundary.
- Credit-card masking now requires a Luhn checksum, so order ids and other long
  digit runs are no longer redacted as cards.
- Graceful shutdown on `SIGTERM`/`SIGINT`: stop accepting connections, drain
  in-flight evaluations, checkpoint the SQLite WAL, and close the database.

### Added
- Unit test suite (`npm test`) covering PII masking, URL validation, proxy
  helpers, auth, rate limiting, and queue concurrency.
- `stream_options: { include_usage: true }` is added to streaming requests so
  token counts come from the provider rather than the character heuristic.
  Disable with `STREAM_USAGE_INJECTION=false`.
- Explicit `MOCK_MODE`. Previously a missing API key silently produced fabricated
  completions with a 30% synthetic error rate — including in production, where a
  missing key is now reported as a configuration error instead.
- `/api/health` reports database reachability and returns 503 when the database
  is unreachable.
- Composite index on `(trace_id, span_type)` for the per-insert agent-metric rollup.

### Changed
- CI runs the unit tests and parses every file under `server/`, replacing a
  hand-maintained `node --check` list that had drifted out of date.

## [1.0.0] - 2026-06-19

### Added
- Initial release of InfraSight.
- Provider-agnostic LLM proxy routing supporting any OpenAI-compatible API.
- Real-time logging of prompts, completions, tokens, latency, cost, and HTTP status codes.
- Privacy mode to easily toggle prompt/response text payload logging.
- Advanced Guardrails: keyword blocking and regex/PII masking for request payloads.
- Hierarchical Agent Trace system for tracking nested agent execution flows.
- Human-in-the-loop (HITL) manual review and approval checkpoints.
- Custom SQLite-backed local storage with automatic table schemas and migration checks.
- Zero-dependency Python client examples.
- Docker and Docker Compose setup for instant deployment of server, client, and DB.
