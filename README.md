# InfraSight observability platform

InfraSight is a lightweight, provider-agnostic observability platform and transparent proxy router designed to monitor LLM/RAG/Agent workflows. It works with **any OpenAI-compatible API** (DeepInfra, OpenAI, OpenRouter, Ollama, and more). It features live request logging, PII masking, thread-level conversation replay, nested agent execution traces, and detailed LLM-as-a-Judge evaluations.


---

## High-Level Workflow

```mermaid
graph TD
    classDef default fill:#1e1e2f,stroke:#333,stroke-width:1px,color:#fff;
    classDef client fill:#2d1b4e,stroke:#6c5ce7,stroke-width:2px,color:#fff;
    classDef proxy fill:#1a365d,stroke:#3182ce,stroke-width:2px,color:#fff;
    classDef llm fill:#22543d,stroke:#38a169,stroke-width:2px,color:#fff;
    classDef dashboard fill:#742a2a,stroke:#e53e3e,stroke-width:2px,color:#fff;

    subgraph Client [Client Application]
        App[Application / SDK Client]:::client
    end

    subgraph InfraSight [InfraSight Proxy Server]
        Router[Proxy Router / Express]:::proxy
        Guard[Active Guardrails<br/>PII Masking & Keyword Block]:::proxy
        HITL[HITL Interceptor<br/>Approval Checkpoint]:::proxy
        DB[Database Gateway<br/>SQLite / Postgres]:::proxy
        Queue[Background Evaluator Queue<br/>NLP & LLM-as-a-Judge]:::proxy
        Alerts[Alerting Engine<br/>Slack & Discord Webhooks]:::proxy
    end

    subgraph Operator [Operator Control Panel]
        WebUI[React Web Dashboard]:::dashboard
    end

    subgraph Provider [Upstream LLM Provider]
        LLM[Upstream API<br/>DeepInfra / OpenAI / Ollama]:::llm
    end

    App -->|1. LLM Chat Request| Router
    Router -->|2. Filter Input| Guard
    Guard -->|If Violates Policy| App
    Guard -->|Passed| HITL
    
    HITL -->|3. Pause & Review if over limit| WebUI
    WebUI -->|Approve / Reject| HITL
    
    HITL -->|4. Forward Request| LLM
    LLM -->|5. Return Response| Router
    
    Router -->|6. Log Telemetry Data| DB
    Router -->|7. Queue Evaluator Job| Queue
    Router -->|8. Return Response| App
    
    Queue -->|Asynchronous Evaluation| Queue
    Queue -->|Threshold Violation| Alerts
```

---

## Getting Started

### 1. Prerequisites
- **Node.js** (v18 or higher)
- **Python** (v3.9 or higher)

### 2. Configure Environment Variables
Copy the example environment file and add your credentials:
```bash
cp .env.example .env
```
Open the `.env` file and configure your provider:
```ini
# Option A: DeepInfra (default — no extra config needed)
DEEPINFRA_API_KEY="your-deepinfra-api-key"

# Option B: Any OpenAI-compatible provider
UPSTREAM_PROVIDER=openai          # Provider name (used in DB and UI)
UPSTREAM_API_BASE=https://api.openai.com/v1  # Base URL
UPSTREAM_API_KEY=sk-...           # API key
```

> **Supported Providers**: Any API that follows the OpenAI chat completions format works out of the box. This includes OpenAI, DeepInfra, OpenRouter, Together AI, Groq, Fireworks, local Ollama, and vLLM instances.

### 3. Run the Observability Web App
To run the server and client concurrently from the project root:
```bash
# Install Node.js dependencies
npm install

# Run backend (port 3000) and frontend (port 5173) concurrently
npm run dev
```

Alternatively, you can run them individually:
*   **Run Backend Server**: `npm run dev:server` (running on http://localhost:3000)
*   **Run Frontend Client**: `npm run dev:client` (running on http://localhost:5173)

---

## Advanced Configuration

InfraSight supports additional environment variables for production deployments, privacy control, and security.

### 1. Dashboard Security (Basic Auth)
If you deploy InfraSight publicly or on a shared server, you can secure the dashboard (logs, metrics, configurations, and deletions) behind standard HTTP Basic Authentication. Upstream LLM proxy routes (`/api/proxy`) and health checks remain unsecured so your applications can connect as normal.

Enable it in `.env`:
```ini
DASHBOARD_AUTH_ENABLED=true
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=your_strong_password
```

> `DASHBOARD_PASSWORD` is mandatory when auth is enabled. The server refuses to
> start without it rather than falling back to a default password. Credentials
> are compared in constant time.

When auth is **disabled**, anyone who can reach the port can read logged prompts
and repoint the upstream provider, so the server logs a warning at startup. Keep
it bound to localhost, or enable auth, before exposing it.

### 2. Privacy Mode (Payload Logging Toggle)
By default, InfraSight logs the full text content of prompts and responses (`input_messages`, `output_message`, `raw_request`, and `raw_response`) to the database. If you require strict privacy compliance (e.g. GDPR, HIPAA) or want to prevent logging sensitive text, you can disable payload logging in `.env`:
```ini
LOG_PAYLOADS=false
```
When set to `false`, text payloads are not logged to the database and are replaced with a `[Payload logging disabled]` placeholder. Standard telemetry like latencies, costs, models, error messages, and token counts are still recorded.

### 3. PII Masking
Stored payloads are scrubbed of emails, phone numbers, US SSNs, Luhn-valid card
numbers, and provider API keys before they reach the database. This is **on by
default**:
```ini
MASK_PII=true          # set to false to store payloads verbatim
```

Masking applies to what is *stored*. To rewrite messages before they are sent to
the upstream model, enable in-transit redaction as well:
```ini
ACTIVE_PII_REDACTION=true
```
Both handle plain-string and multimodal (content-parts) messages.

### 4. Token Accounting
For streaming requests InfraSight adds `stream_options: { include_usage: true }`,
so providers emit a final usage frame and token counts are exact rather than
estimated. If your provider rejects that field, turn it off:
```ini
STREAM_USAGE_INJECTION=false
```

When a provider still returns no `usage` block, a character-count fallback
(approx. 4 characters per token) estimates prompt and completion tokens so cost
and usage reporting stay populated.

### 5. Mock Mode
Without a usable API key, the proxy can answer with simulated completions — handy
for demos and UI work, dangerous if it happens unnoticed in production.
```ini
MOCK_MODE=true    # always mock
MOCK_MODE=false   # never mock; missing keys surface as a clear error
# unset           # mock automatically in development only
```
When `NODE_ENV=production` and no key is configured, requests fail with a
`missing_api_key` configuration error instead of returning fabricated data.

### 6. Network Hardening
The upstream base URL and alert webhooks are operator-settable at runtime, so
they are validated before use: non-HTTP schemes and cloud instance-metadata
endpoints are always rejected, and webhooks additionally require HTTPS and a
public host. Local providers (Ollama, vLLM, Docker service names) keep working.
```ini
BLOCK_PRIVATE_UPSTREAM=true   # also reject loopback/private upstream targets
API_RATE_LIMIT=600            # per-IP requests/min for the dashboard API (0 = off)
PROXY_RATE_LIMIT=0            # per-IP requests/min for /api/proxy (0 = off)
TRUST_PROXY=1                 # read client IPs from X-Forwarded-For
```

Clearing the database is irreversible, so `DELETE /api/logs` requires an explicit
`?confirm=true`.

---

### 7. Background Evaluation Recovery
The LLM-as-a-Judge queue lives in memory, so a restart would otherwise drop
anything still pending. On startup InfraSight asks the database which recent
successful requests have no evaluation yet and re-queues them:
```ini
EVALUATION_RECOVERY_LIMIT=100   # 0 disables recovery
EVALUATION_RECOVERY_HOURS=24
```

---

## Running the Test Suite

The backend ships tests covering PII masking, URL validation, proxy helpers
(SSE parsing, guardrails, token estimation), authentication, rate limiting,
evaluator queue concurrency and backlog recovery, analytics aggregation, and
adapter parity between the SQLite and PostgreSQL backends:

```bash
npm test
```

To parse every server-side file without running it:

```bash
npm run lint
```

Both run in CI on every push and pull request, alongside a PostgreSQL service
that boots the server against Postgres and a job that builds and runs the
Docker image.

A handful of tests exercise the PostgreSQL adapter directly and skip unless a
database is available:

```bash
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/infrasight_test npm test
```

---

## Python Integration Guide (Using `uv`)

We use **`uv`** — a fast Python package installer and resolver written in Rust by Astral. It serves as a drop-in replacement for standard `pip` and `virtualenv` tools, installing packages up to 100x faster.

### 1. Install `uv`
If you do not have `uv` installed, install it standalone or via `pip`:

*   **Windows (PowerShell)**:
    ```powershell
    irm https://astral.sh/uv/install.ps1 | iex
    ```
*   **macOS / Linux**:
    ```bash
    curl -LsSf https://astral.sh/uv/install.sh | sh
    ```
*   **Via pip**:
    ```bash
    pip install uv
    ```

### Windows PATH Troubleshooting (if 'uv' is not recognized)
If you get an error saying `'uv' is not recognized as an internal or external command`, it means the terminal session has not loaded the updated environment path registry yet.

*   **Option A: Restart terminal (easiest)**: Close your terminal (or VS Code) and open a new one to load the path variables globally.
*   **Option B: Run using absolute path**:
    *   **CMD**: `"%USERPROFILE%\.local\bin\uv" run --with openai tests/test_integration.py`
    *   **PowerShell**: `& "$HOME\.local\bin\uv" run --with openai tests/test_integration.py`
*   **Option C: Add to PATH in the current session**:
    *   **CMD**: `set PATH=%PATH%;%USERPROFILE%\.local\bin`
    *   **PowerShell**: `$env:Path = [System.Environment]::GetEnvironmentVariable("Path","User") + ";" + [System.Environment]::GetEnvironmentVariable("Path","Machine")`
*   **Option D: Force global registration in Registry (PowerShell)**:
    ```powershell
    [System.Environment]::SetEnvironmentVariable("Path", [System.Environment]::GetEnvironmentVariable("Path", "User") + ";$HOME\.local\bin", "User")
    ```

### 2. Run Python Integrations

We provide several modular, function-based test and demo scripts inside the `tests/` folder:
1.  **Comprehensive Unified Runner (`tests/run_all.py`)**: Runs all SDK, Guardrail, and Human-in-the-loop tests in a unified suite.
2.  **Zero-Dependency SDK Demo (`tests/test_sdk.py`)**: Uses the zero-dependency `infrasight.py` client to communicate with the proxy.
3.  **Wrapper SDK Demo (`tests/test_integration.py`)**: Wraps the official `openai` SDK, tracking conversation histories and nested agent traces.
4.  **Active Proxy Guardrails Demo (`tests/test_guardrails.py`)**: Showcases keyword blocking, active PII redaction, and background safety evaluations.
5.  **Interactive HITL Checkpoints (`tests/test_hitl.py`)**: Demonstrates transactional approvals with programmatically simulated approvals.
6.  **Stress Testing (`tests/test_stress.py`)**: Performs high-concurrency request load testing.

You can run these Python integration demos in two different ways using `uv`.

#### Option A: Zero-Setup Execution (Recommended)
You can run Python scripts directly without creating a local virtual environment manually. `uv` handles compiling, caching, and running inside a temporary environment:
```bash
# Run the complete unified test suite
uv run --with openai tests/run_all.py

# Run the wrapper SDK demo (automatically installs 'openai' in a temp environment)
uv run --with openai tests/test_integration.py

# Run the zero-dependency SDK demo (requires no packages)
uv run tests/test_sdk.py
```

#### Option B: Virtual Environment Workflow
If you prefer a persistent local virtual environment for development:

1.  **Create a Virtual Environment**:
    ```bash
    uv venv
    ```
2.  **Activate the Virtual Environment**:
    *   **Windows (PowerShell)**: `.venv\Scripts\Activate.ps1`
    *   **Windows (CMD)**: `.venv\Scripts\activate.bat`
    *   **macOS / Linux**: `source .venv/bin/activate`
3.  **Install Required Packages**:
    Use `uv pip` instead of `pip` for lightning-fast installation:
    ```bash
    uv pip install openai
    ```
4.  **Run the Integration Scripts**:
    ```bash
    # Run the comprehensive test runner
    python -m tests.run_all

    # Run individual test modules
    python -m tests.test_integration
    python -m tests.test_sdk
    ```

### 3. Quick Reference for `uv` Package Commands

*   **List Installed Packages**:
    ```bash
    uv pip list
    ```
*   **Install from requirements.txt**:
    ```bash
    uv pip install -r requirements.txt
    ```
*   **Compile a requirements file** (resolves conflicts and pins exact versions):
    ```bash
    uv pip compile pyproject.toml -o requirements.txt
    ```
*   **Synchronize packages** (removes unsolicited packages, installs missing ones to match a requirements file):
    ```bash
    uv pip sync requirements.txt
    ```

---

## Docker Deployment (Alternative)

If you prefer using Docker to run the entire stack (React frontend + Node server + SQLite database) in an isolated container:

### 1. Start Docker Container
Make sure Docker is installed on your machine and run:
```bash
docker compose up -d --build
```
This builds the production image, serves the app on port `3000`, and creates a persistent Docker volume named `infrasight_data` for the SQLite database.

The container runs as the unprivileged `node` user and exposes a `HEALTHCHECK`
against `/api/health`.

> **Upgrading from an image built before this change:** the existing
> `infrasight_data` volume is owned by root and the `node` user cannot write to
> it. The server will say so explicitly on startup. Fix it once with:
> ```bash
> docker compose run --rm --user root infrasight chown -R node:node /app/data
> ```

Because the image sets `NODE_ENV=production`, starting it without an API key
reports a configuration error rather than serving mock data. To run the
dashboard demo without a provider, set `MOCK_MODE=true`.

### 2. Access the Dashboard
Open your browser at [http://localhost:3000](http://localhost:3000) to view the UI.

### 3. Send Requests to the Docker Proxy
To route chat completions through the Dockerized proxy:

*   **Endpoint URL**: `http://localhost:3000/api/proxy/v1`

*   **cURL Example**:
    ```bash
    curl http://localhost:3000/api/proxy/v1/chat/completions \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $UPSTREAM_API_KEY" \
      -d '{
        "model": "meta-llama/Llama-3.3-70B-Instruct",
        "messages": [{"role": "user", "content": "Hello from Docker!"}]
      }'
    ```

*   **Python SDK Example**:
    ```python
    from openai import OpenAI
    import os

    client = OpenAI(
        base_url="http://localhost:3000/api/proxy/v1",
        api_key=os.environ.get("UPSTREAM_API_KEY") or os.environ.get("DEEPINFRA_API_KEY")
    )
    ```

---

## Author

- **Suhas Goravale Siddaramu**



