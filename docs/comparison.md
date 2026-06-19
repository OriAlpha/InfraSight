# InfraSight (InfraSight) vs. Commercial LLM Observability Platforms

This report outlines how **InfraSight** compares to commercial and open-source LLM observability tools currently available online (such as **LangSmith**, **LangFuse**, **Helicone**, and **Arize Phoenix**). 

---

## 1. Key Differentiators of InfraSight

InfraSight was designed to solve specific challenges that commercial, cloud-based LLM monitors often neglect or charge premiums for:

### 🔒 1. Active In-Transit PII Redaction
* **The Online Problem**: Most online observability tools (like Helicone or LangSmith) log data *after* it has already left your system, or run masking only on their cloud databases. If you send sensitive user data (emails, API keys, phone numbers), it still transits to the upstream LLM providers (e.g. OpenAI or DeepInfra).
* **The InfraSight Solution**: When `ACTIVE_PII_REDACTION=true` is set, InfraSight's proxy actively intercepts and redacts user inputs **before** forwarding them to the upstream LLM provider. Sensitive PII never leaves your servers, preventing third-party compliance breaches.

### 🏠 2. Self-Contained, Zero-SaaS Footprint (SQLite-Based)
* **The Online Problem**: Almost all online tools require you to create an account, provision cloud databases, and stream your application's prompts, completions, and logs to a third-party server. This exposes your company to supply-chain risks and data privacy concerns.
* **The InfraSight Solution**: InfraSight is fully self-hosted, lightweight, and uses a local **SQLite** database. Zero data is shared externally. You run the frontend (Vite React) and backend (Express) locally or via a single-container Docker stack.

### 🤝 3. Native Human-in-the-Loop (HITL) Interceptor
* **The Online Problem**: Standard observability platforms track logs passively. If an autonomous agent needs user approval to make a financial transfer, delete a resource, or send an email, developers must build a custom checkpoint UI, database states, and polling systems from scratch.
* **The InfraSight Solution**: InfraSight provides built-in transactional approval routing. Spans can be created with a status of `awaiting_approval`. The server proxy pauses execution, and the React dashboard lets operators review, approve, or reject transactions in real-time. Once decided, the proxy resumes the pipeline immediately.

### 🤖 4. Local Hybrid Evaluation Engine (NLP + LLM-as-a-Judge)
* **The Online Problem**: Automated evaluation in enterprise tools is either computationally heavy (requiring complex Kubernetes clusters) or expensive (relying entirely on external API calls to grade outputs).
* **The InfraSight Solution**: InfraSight uses a hybrid pipeline:
  * **Local NLP Evaluator**: Computes strict string metrics (Exact Match, BLEU, ROUGE-1/2/L, Recall/Precision/MRR) locally on your server with zero external network overhead.
  * **Asynchronous Safety/Quality Judge**: Leverages a queue-driven LLM-as-a-Judge to evaluate safety ratings and detailed task-specific criteria asynchronously, keeping your user-facing API paths fast.

---

## 2. Side-by-Side Comparison

| Feature | InfraSight (InfraSight) | LangSmith (OpenAI) | LangFuse (OSS / Cloud) | Helicone (Proxy SaaS) | Arize Phoenix (OSS) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Hosting Model** | Local / Self-Hosted | SaaS Only | SaaS or Self-Hosted | SaaS or Self-Hosted | Local / Notebooks |
| **Data Storage** | SQLite (Single file) | Proprietary Cloud | PostgreSQL | ClickHouse / PG | In-Memory / Local DB |
| **Active PII Redaction** | **Yes** (In-transit before LLM) | No (Database masking only) | No (Client-side manual) | Yes (Premium/Regex) | No |
| **Human-in-the-Loop** | **Yes** (Native proxy routing) | No | No | No | No |
| **Agent Trace Spans** | Yes (OpenTelemetry-like) | Yes (LangChain-native) | Yes (OpenTelemetry) | Yes | Yes (LlamaIndex-native) |
| **Evaluation Metrics** | Local NLP + LLM Judge | SaaS LLM Judge | LLM Judge / Manual | Custom Webhooks | Local Python Evaluators |
| **Docker Footprint** | Extremely Light (<150MB) | N/A | Large (Multi-service) | Large (Multi-service) | Light |
| **Cost** | **100% Free / Open Source** | Tiered/Usage-based | Tiered/Usage-based | Tiered/Usage-based | Free / Enterprise SaaS |

---

## 3. Integration Complexity

Online tools often require installing heavy, vendor-specific SDK wrapper libraries (e.g. `langsmith` or `langfuse` packages) that bind your application code to their proprietary APIs. 

InfraSight uses a transparent **Proxy Router**. Because the proxy conforms exactly to the official OpenAI chat completions schema, you don't need to rewrite your client code. You only swap the `base_url`:

```python
# Transitioning to InfraSight is as simple as swapping the URL
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/api/proxy/v1",  # Redirect to local proxy
    api_key="your-api-key"
)
```

---

## 4. Conclusion: When to Choose InfraSight

InfraSight is ideal for:
1. **Security-Sensitive Environments**: Healthcare, finance, or corporate applications where data compliance prohibits exporting prompt strings to external cloud providers.
2. **Local Development & Prototyping**: Setting up sandboxes, playgrounds, and comparative benchmarks without configuring API tokens or cloud database services.
3. **HITL Workflows**: Agentic applications that require manual human checkpoints to validate operations before execution.
