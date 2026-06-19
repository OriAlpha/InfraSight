# InfraSight observability platform

InfraSight is a lightweight, provider-agnostic observability platform and transparent proxy router designed to monitor LLM/RAG/Agent workflows. It works with **any OpenAI-compatible API** (DeepInfra, OpenAI, OpenRouter, Ollama, and more). It features live request logging, PII masking, thread-level conversation replay, nested agent execution traces, and detailed LLM-as-a-Judge evaluations.


---

## Documentation

Detailed documentation is available in the `docs/` folder:
- [Architecture & Implementation Design](docs/architecture.md) - Deep dive into proxy routing, observability database schema, security features, and agent traces.
- [Differentiation Report](docs/comparison.md) - A comparative analysis showing how InfraSight differentiates from other LLM observability tools.

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

### 2. Privacy Mode (Payload Logging Toggle)
By default, InfraSight logs the full text content of prompts and responses (`input_messages`, `output_message`, `raw_request`, and `raw_response`) to the database. If you require strict privacy compliance (e.g. GDPR, HIPAA) or want to prevent logging sensitive text, you can disable payload logging in `.env`:
```ini
LOG_PAYLOADS=false
```
When set to `false`, text payloads are not logged to the database and are replaced with a `[Payload logging disabled]` placeholder. Standard telemetry like latencies, costs, models, error messages, and token counts are still recorded.

### 3. Token Estimation Fallback
Some upstream API providers (especially in streaming modes) do not return the `usage` block containing token counts. InfraSight has a built-in character-count fallback heuristic (approx. 4 characters per token) to automatically estimate and log prompt and completion tokens when the upstream provider fails to return them.

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

