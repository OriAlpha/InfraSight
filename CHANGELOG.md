# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Comprehensive Backend & Utility Test Coverage Suite (`npm run test:coverage`)**:
  Expanded backend and utility test suite to 153 passing tests (>81% overall line coverage, 90%+ across core modules):
  - LLM-as-a-Judge scoring engine (`evaluator-scoring.test.js`): Domain-specific 5-metric mapping across 10 task types, penalty calculations (unsolicited choices, constraint violations, verbosity), weighted scoring, custom criteria, and error boundary handling.
  - Express API Route Integration (`api-routes.test.js`): Full endpoint verification covering `/api/logs`, `/api/models`, `/api/prompts`, `/api/traces`, `/api/evaluations`, and `/api/settings`.
  - SQLite Analytics & Prompts (`analytics-and-prompts.test.js`): Overview aggregates, cost analysis, token consumption, model distribution, error breakdowns, and prompt template CRUD.
  - Offline PostgreSQL Unit Parity (`postgres-unit.test.js`): Query builders, schema migrations, and metric reducers verified in isolation without requiring an external PostgreSQL instance.
  - Proxy Integration & Guardrails (`proxy-integration.test.js`): Non-streaming and streaming SSE proxy requests, keyword blocking with HTTP 400, and missing API key handling.
  - Client Utilities (`client-utils.test.js`): Date formatting, template variable extraction, and latency breakdown computation.
  - Alert triggers and dynamic settings caching (`alerts.test.js`, `config.test.js`).
  - Added `npm run test:coverage` script and enabled coverage in CI workflow.
- **Interactive Latency Flow Timeline & Stage Breakdown**: Added visual pipeline timeline
  (`LatencyFlow.jsx`) and calculation module (`latencyBreakdown.js`) displaying detailed stage-by-stage
  breakdowns across client transit, proxy guardrails, TTFT (Time to First Token), stream decoding rate,
  and background evaluations.
- **Multi-Agent Trace Hierarchy & Aggregated Metrics**: Automated calculation of agent execution
  metrics (`tool_success_rate`, `planning_accuracy`, `goal_completion_rate`) rolled up across child spans
  in hierarchical traces.
- **Raw Request & Response Auto-Synthesis**: Automatic synthesis of OpenAI-compatible schemas in
  `insertRequest` when raw payload representations are omitted.
- **High-Resolution Vector Architecture**: Crisp vector architecture SVG (`assets/architecture.svg`)
  embedded into workflow documentation.
- **Dynamic Vite Port Detection**: `client/vite.config.js` dynamically loads `PORT` from root `.env`
  to configure Vite reverse proxy targets seamlessly.
- Unit test suite (`npm test`) covering PII masking, URL validation, proxy helpers, auth, rate limiting, and queue concurrency.
- `stream_options: { include_usage: true }` is added to streaming requests so token counts come from the provider rather than the character heuristic. Disable with `STREAM_USAGE_INJECTION=false`.
- Explicit `MOCK_MODE`. Previously a missing API key silently produced fabricated completions with a 30% synthetic error rate — including in production, where a missing key is now reported as a configuration error instead.
- `/api/health` reports database reachability and returns 503 when the database is unreachable.
- Composite index on `(trace_id, span_type)` for the per-insert agent-metric rollup.
- Background evaluations survive a restart. The in-memory queue is rebuilt at startup from requests that are logged but unscored, so nothing pending when the process stopped is silently dropped (`EVALUATION_RECOVERY_LIMIT`, `EVALUATION_RECOVERY_HOURS`).
- A React error boundary per route: one page throwing during render no longer blanks the whole dashboard.
- Route-level code splitting. The initial bundle drops from 243 kB to 79 kB gzipped, with the charting library loaded only by the pages that draw charts.
- `POST /api/models` validates pricing and context window the same way `PUT /api/models/:id` does, so a model cannot be registered with negative rates that the update route would reject.

### Changed
- Analytics no longer load a whole date range into memory. Latency percentiles
  are computed in SQL (window functions on SQLite, `PERCENTILE_DISC` on
  PostgreSQL), and the evaluation endpoint takes its totals from one aggregate
  query while reading back only the rows that carry feedback or evaluation JSON.
  A wide window was previously an out-of-memory risk.
- The shared metric reduction moved into `db/eval-metrics.js`; both adapters
  had their own copy, and the PostgreSQL adapter shed ~145 lines of it.
- Evaluation cost totals round to 1e-6 instead of 1e-4. Any window totalling
  under $0.00005 previously reported $0 while the overview endpoint showed the
  real figure.
- 401 and 429 responses surface an actionable message in the dashboard instead
  of an opaque error.
- CI runs unit tests with experimental coverage, verifies syntax across all files under `server/`,
  runs a PostgreSQL service, builds the Docker image, and tests container health.

### Fixed
- **Clean CI Database Test Determinism**: Seeded isolated test fixtures for feedback rating and
  model filtering tests (`feedback-and-models.test.js`) to eliminate flaky runs against empty CI databases.
- **Vite Proxy Default Port Fallback**: Fixed default backend port fallback in `client/vite.config.js`
  to `3000` (matching server default) instead of `9000`.
- **Documentation & Prerequisite Parity**: Fixed Node.js minimum requirement in `README.md` to
  `Node.js (v20 or higher)` to match package engines and CI workflows; documented `npm run test:coverage`
  and updated test guidelines in `CONTRIBUTING.md` and PR template.
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
  ` ` sat before `+`, where there is no word boundary.
- Credit-card masking now requires a Luhn checksum, so order ids and other long
  digit runs are no longer redacted as cards.
- Graceful shutdown on `SIGTERM`/`SIGINT`: stop accepting connections, drain
  in-flight evaluations, checkpoint the SQLite WAL, and close the database.

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
- The Docker image now runs as the unprivileged `node` user and declares a
  `HEALTHCHECK`. Upgrading an existing deployment needs a one-off
  `chown -R node:node /app/data` on the `infrasight_data` volume; the server
  reports this explicitly if the directory is not writable. The README notes the
  `MSYS_NO_PATHCONV=1` prefix Git Bash on Windows needs for that command.
- `docker-compose.yml` no longer forces `MASK_PII=false`, which silently
  defeated PII masking in the deployment mode the README recommends. It also
  passes through the new hardening settings.

### Removed
- `updateDailyStats()` — exported by both adapters and called by nothing. The
  `daily_stats` table it targeted is left in place; the analytics endpoints
  aggregate directly in SQL, so no rollup is needed.

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
