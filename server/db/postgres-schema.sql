-- InfraSight Database Schema for PostgreSQL

-- Group related requests into conversations
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT,
    total_messages INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    total_cost DOUBLE PRECISION DEFAULT 0,
    first_message_at TEXT,
    last_message_at TEXT,
    created_at TEXT DEFAULT TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')
);

-- Core log table for all API requests
CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
    model TEXT NOT NULL,
    provider TEXT DEFAULT 'deepinfra',
    input_messages TEXT NOT NULL,       -- JSON array of {role, content}
    output_message TEXT,                -- JSON {role, content}
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    estimated_cost DOUBLE PRECISION DEFAULT 0,
    latency_ms INTEGER DEFAULT 0,
    status TEXT DEFAULT 'success',      -- success, error, streaming
    error_message TEXT,
    temperature DOUBLE PRECISION,
    max_tokens INTEGER,
    top_p DOUBLE PRECISION,
    frequency_penalty DOUBLE PRECISION,
    presence_penalty DOUBLE PRECISION,
    user_id TEXT,
    metadata TEXT,                      -- JSON
    tags TEXT,                          -- JSON array
    stream INTEGER DEFAULT 0,
    raw_request TEXT,                   -- JSON
    raw_response TEXT,                  -- JSON
    feedback TEXT,                      -- JSON {score: 1|-1, comment: string}
    evaluation TEXT,                    -- JSON {score: number, reasoning: string, category: string}
    trace_id TEXT,                      -- UUID/string for trace tracking
    span_id TEXT,                       -- UUID/string for span identification
    parent_span_id TEXT,                -- Parent span ID for tracing hierarchies
    span_name TEXT,                     -- Human-readable name for span
    span_type TEXT,                     -- 'llm', 'tool', 'chain', 'agent', etc.
    created_at TEXT DEFAULT TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')
);

-- Model registry with pricing information
CREATE TABLE IF NOT EXISTS models (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    display_name TEXT,
    provider TEXT DEFAULT 'deepinfra',
    input_cost_per_million DOUBLE PRECISION DEFAULT 0,  -- cost per 1M input tokens
    output_cost_per_million DOUBLE PRECISION DEFAULT 0,  -- cost per 1M output tokens
    context_window INTEGER,
    created_at TEXT DEFAULT TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')
);

-- Prompt templates and version history
CREATE TABLE IF NOT EXISTS prompts (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    version INTEGER NOT NULL,
    system_prompt TEXT,
    user_template TEXT,
    variables TEXT,                     -- JSON array of variable names (e.g., ["name"])
    created_at TEXT DEFAULT TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS'),
    UNIQUE(name, version)
);

-- Pre-aggregated daily statistics for fast dashboard queries
CREATE TABLE IF NOT EXISTS daily_stats (
    date TEXT NOT NULL,
    model TEXT,
    total_requests INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    total_prompt_tokens INTEGER DEFAULT 0,
    total_completion_tokens INTEGER DEFAULT 0,
    total_cost DOUBLE PRECISION DEFAULT 0,
    avg_latency_ms DOUBLE PRECISION DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    PRIMARY KEY (date, model)
);

-- Dynamic configuration settings stored as key-value pairs
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_requests_created_at ON requests(created_at);
CREATE INDEX IF NOT EXISTS idx_requests_model ON requests(model);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_conversation_id ON requests(conversation_id);
CREATE INDEX IF NOT EXISTS idx_requests_user_id ON requests(user_id);
CREATE INDEX IF NOT EXISTS idx_requests_trace_id ON requests(trace_id);
CREATE INDEX IF NOT EXISTS idx_requests_span_id ON requests(span_id);
