/**
 * Database initialization and helper module for InfraSight.
 * Uses better-sqlite3 for synchronous SQLite access.
 *
 * @module db/index
 */
'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

/** @type {import('better-sqlite3').Database | null} */
let db = null;

const DEFAULT_DB_PATH = path.resolve(__dirname, '..', 'data', 'infrasight.db');

/**
 * Returns the database instance, initializing it if necessary.
 * @returns {import('better-sqlite3').Database}
 */
function getDb() {
  if (db) return db;

  const dbPath = process.env.DB_PATH || DEFAULT_DB_PATH;
  const dbDir = path.dirname(dbPath);

  // Auto-create the data directory if it doesn't exist
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  return db;
}

/**
 * Runs the schema.sql migration to create all tables and indexes.
 */
function runMigrations() {
  const database = getDb();

  // Safely add new columns to existing databases if they are missing (before running schema.sql which builds indexes on them)
  const columns = ['feedback', 'evaluation', 'trace_id', 'span_id', 'parent_span_id', 'span_name', 'span_type'];
  for (const col of columns) {
    try {
      database.prepare(`ALTER TABLE requests ADD COLUMN ${col} TEXT`).run();
    } catch (err) {
      // Ignore error if table doesn't exist yet or column already exists
    }
  }

  const schemaPath = path.resolve(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  database.exec(schema);

  try {
    database.prepare('CREATE INDEX IF NOT EXISTS idx_requests_trace_id ON requests(trace_id)').run();
    database.prepare('CREATE INDEX IF NOT EXISTS idx_requests_span_id ON requests(span_id)').run();
  } catch (err) {
    // Ignore if exists
  }
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

/**
 * Inserts a new request log into the database.
 * Also updates the associated conversation if conversation_id is set.
 * @param {Object} data - The request data
 * @returns {Object} The inserted row
 */
function insertRequest(data) {
  const database = getDb();

  const stmt = database.prepare(`
    INSERT INTO requests (
      id, conversation_id, model, provider,
      input_messages, output_message,
      prompt_tokens, completion_tokens, total_tokens, estimated_cost,
      latency_ms, status, error_message,
      temperature, max_tokens, top_p, frequency_penalty, presence_penalty,
      user_id, metadata, tags, stream,
      raw_request, raw_response, trace_id, span_id, parent_span_id, span_name, span_type, created_at
    ) VALUES (
      @id, @conversation_id, @model, @provider,
      @input_messages, @output_message,
      @prompt_tokens, @completion_tokens, @total_tokens, @estimated_cost,
      @latency_ms, @status, @error_message,
      @temperature, @max_tokens, @top_p, @frequency_penalty, @presence_penalty,
      @user_id, @metadata, @tags, @stream,
      @raw_request, @raw_response, @trace_id, @span_id, @parent_span_id, @span_name, @span_type, @created_at
    )
  `);

  const row = {
    id: data.id,
    conversation_id: data.conversation_id || null,
    model: data.model,
    provider: data.provider || 'deepinfra',
    input_messages: typeof data.input_messages === 'string' ? data.input_messages : JSON.stringify(data.input_messages),
    output_message: data.output_message ? (typeof data.output_message === 'string' ? data.output_message : JSON.stringify(data.output_message)) : null,
    prompt_tokens: data.prompt_tokens || 0,
    completion_tokens: data.completion_tokens || 0,
    total_tokens: data.total_tokens || 0,
    estimated_cost: data.estimated_cost || 0,
    latency_ms: data.latency_ms || 0,
    status: data.status || 'success',
    error_message: data.error_message || null,
    temperature: data.temperature != null ? data.temperature : null,
    max_tokens: data.max_tokens != null ? data.max_tokens : null,
    top_p: data.top_p != null ? data.top_p : null,
    frequency_penalty: data.frequency_penalty != null ? data.frequency_penalty : null,
    presence_penalty: data.presence_penalty != null ? data.presence_penalty : null,
    user_id: data.user_id || null,
    metadata: data.metadata ? (typeof data.metadata === 'string' ? data.metadata : JSON.stringify(data.metadata)) : null,
    tags: data.tags ? (typeof data.tags === 'string' ? data.tags : JSON.stringify(data.tags)) : null,
    stream: data.stream ? 1 : 0,
    raw_request: data.raw_request ? (typeof data.raw_request === 'string' ? data.raw_request : JSON.stringify(data.raw_request)) : null,
    raw_response: data.raw_response ? (typeof data.raw_response === 'string' ? data.raw_response : JSON.stringify(data.raw_response)) : null,
    trace_id: data.trace_id || null,
    span_id: data.span_id || null,
    parent_span_id: data.parent_span_id || null,
    span_name: data.span_name || null,
    span_type: data.span_type || null,
    created_at: data.created_at || new Date().toISOString(),
  };

  // Ensure the conversation row exists to satisfy SQLite foreign key constraints before inserting request
  if (row.conversation_id) {
    const upsertConv = database.prepare(`
      INSERT INTO conversations (id, created_at)
      VALUES (@id, datetime('now'))
      ON CONFLICT(id) DO NOTHING
    `);
    upsertConv.run({ id: row.conversation_id });
  }

  stmt.run(row);

  // Update conversation stats if linked
  if (row.conversation_id) {
    _updateConversationStats(row.conversation_id);
  }

  // Calculate agent trace metrics if linked to a trace
  if (row.trace_id) {
    try {
      calculateAgentMetrics(row.trace_id);
    } catch (err) {
      console.error('[db] Error calculating agent metrics:', err.message);
    }
  }

  return row;
}

/**
 * Updates conversation aggregate stats from its child requests.
 * @param {string} conversationId
 * @private
 */
function _updateConversationStats(conversationId) {
  const database = getDb();

  // Ensure the conversation row exists
  const upsertConv = database.prepare(`
    INSERT INTO conversations (id, created_at)
    VALUES (@id, datetime('now'))
    ON CONFLICT(id) DO NOTHING
  `);
  upsertConv.run({ id: conversationId });

  const stats = database.prepare(`
    SELECT
      COUNT(*) AS total_messages,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      COALESCE(SUM(estimated_cost), 0) AS total_cost,
      MIN(created_at) AS first_message_at,
      MAX(created_at) AS last_message_at
    FROM requests
    WHERE conversation_id = ?
  `).get(conversationId);

  database.prepare(`
    UPDATE conversations
    SET total_messages = @total_messages,
        total_tokens = @total_tokens,
        total_cost = @total_cost,
        first_message_at = @first_message_at,
        last_message_at = @last_message_at
    WHERE id = @id
  `).run({
    id: conversationId,
    total_messages: stats.total_messages,
    total_tokens: stats.total_tokens,
    total_cost: stats.total_cost,
    first_message_at: stats.first_message_at,
    last_message_at: stats.last_message_at,
  });
}

/**
 * Retrieves a paginated, filterable list of request logs.
 * @param {Object} filters
 * @param {number} [filters.page=1]
 * @param {number} [filters.limit=50]
 * @param {string} [filters.model]
 * @param {string} [filters.status]
 * @param {string} [filters.startDate]
 * @param {string} [filters.endDate]
 * @param {string} [filters.search]
 * @param {string} [filters.sortBy='created_at']
 * @param {string} [filters.sortOrder='DESC']
 * @param {string} [filters.userId]
 * @param {number} [filters.minCost]
 * @param {number} [filters.maxCost]
 * @returns {{ data: Object[], total: number, page: number, limit: number, totalPages: number }}
 */
function getRequests(filters = {}) {
  const database = getDb();

  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(filters.limit, 10) || 50));
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = {};

  if (filters.model) {
    conditions.push('r.model = @model');
    params.model = filters.model;
  }
  if (filters.status) {
    conditions.push('r.status = @status');
    params.status = filters.status;
  }
  if (filters.startDate) {
    conditions.push('r.created_at >= @startDate');
    params.startDate = filters.startDate;
  }
  if (filters.endDate) {
    conditions.push('r.created_at <= @endDate');
    params.endDate = filters.endDate;
  }
  if (filters.userId) {
    conditions.push('r.user_id = @userId');
    params.userId = filters.userId;
  }
  if (filters.minCost != null) {
    conditions.push('r.estimated_cost >= @minCost');
    params.minCost = parseFloat(filters.minCost);
  }
  if (filters.maxCost != null) {
    conditions.push('r.estimated_cost <= @maxCost');
    params.maxCost = parseFloat(filters.maxCost);
  }
  if (filters.search) {
    conditions.push("(r.input_messages LIKE @search OR r.output_message LIKE @search OR r.model LIKE @search)");
    params.search = `%${filters.search}%`;
  }
  if (filters.feedback) {
    if (filters.feedback === 'positive') {
      conditions.push("json_extract(r.feedback, '$.score') = 1");
    } else if (filters.feedback === 'negative') {
      conditions.push("json_extract(r.feedback, '$.score') = -1");
    }
  }
  if (filters.minEval != null) {
    conditions.push("CAST(json_extract(r.evaluation, '$.score') AS REAL) >= @minEval");
    params.minEval = parseFloat(filters.minEval);
  }
  if (filters.maxEval != null) {
    conditions.push("CAST(json_extract(r.evaluation, '$.score') AS REAL) <= @maxEval");
    params.maxEval = parseFloat(filters.maxEval);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Whitelist allowed sort columns
  const SORT_COLUMNS = ['created_at', 'model', 'total_tokens', 'estimated_cost', 'latency_ms', 'status'];
  const sortBy = SORT_COLUMNS.includes(filters.sortBy) ? filters.sortBy : 'created_at';
  const sortOrder = String(filters.sortOrder || '').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const countRow = database.prepare(`SELECT COUNT(*) AS total FROM requests r ${whereClause}`).get(params);
  const total = countRow.total;

  const data = database.prepare(`
    SELECT r.* FROM requests r
    ${whereClause}
    ORDER BY r.${sortBy} ${sortOrder}
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit, offset });

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Gets a single request by ID.
 * @param {string} id
 * @returns {Object|undefined}
 */
function getRequestById(id) {
  const database = getDb();
  return database.prepare('SELECT * FROM requests WHERE id = ?').get(id);
}

/**
 * Deletes a request by ID.
 * @param {string} id
 * @returns {{ changes: number }}
 */
function deleteRequest(id) {
  const database = getDb();
  const info = database.prepare('DELETE FROM requests WHERE id = ?').run(id);
  return { changes: info.changes };
}

// ---------------------------------------------------------------------------
// Analytics helpers
// ---------------------------------------------------------------------------

/**
 * Computes the start date for the "previous" comparison period.
 * @param {string} startDate - ISO date string
 * @param {string} endDate - ISO date string
 * @returns {{ prevStart: string, prevEnd: string }}
 * @private
 */
function _previousPeriod(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1); // 1ms before current start
  const prevStart = new Date(prevEnd.getTime() - diffMs);
  return {
    prevStart: prevStart.toISOString(),
    prevEnd: prevEnd.toISOString(),
  };
}

/**
 * Returns default date range (last 7 days) if not provided.
 * @param {string} [startDate]
 * @param {string} [endDate]
 * @returns {{ startDate: string, endDate: string }}
 */
function _defaultDateRange(startDate, endDate) {
  if (!endDate) {
    endDate = new Date().toISOString();
  }
  if (!startDate) {
    const d = new Date(endDate);
    d.setDate(d.getDate() - 7);
    startDate = d.toISOString();
  }
  return { startDate, endDate };
}

/**
 * KPI overview with change vs previous period.
 * @param {Object} dateRange
 * @param {string} [dateRange.startDate]
 * @param {string} [dateRange.endDate]
 * @returns {Object}
 */
function getAnalyticsOverview(dateRange = {}) {
  const database = getDb();
  const { startDate, endDate } = _defaultDateRange(dateRange.startDate, dateRange.endDate);

  const currentSql = `
    SELECT
      COUNT(*) AS totalRequests,
      COALESCE(SUM(estimated_cost), 0) AS totalCost,
      COALESCE(AVG(latency_ms), 0) AS avgLatency,
      COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) AS errorCount,
      COALESCE(SUM(total_tokens), 0) AS totalTokens,
      COALESCE(SUM(prompt_tokens), 0) AS totalPromptTokens,
      COALESCE(SUM(completion_tokens), 0) AS totalCompletionTokens
    FROM requests
    WHERE created_at >= @startDate AND created_at <= @endDate
  `;

  const current = database.prepare(currentSql).get({ startDate, endDate });

  // Previous period for change calculation
  const { prevStart, prevEnd } = _previousPeriod(startDate, endDate);
  const previous = database.prepare(currentSql.replace(/@startDate/g, '@prevStart').replace(/@endDate/g, '@prevEnd'))
    .get({ prevStart: prevStart, prevEnd: prevEnd });

  const errorRate = current.totalRequests > 0 ? (current.errorCount / current.totalRequests) * 100 : 0;

  /**
   * Computes percentage change between two values.
   * @param {number} curr
   * @param {number} prev
   * @returns {number}
   */
  const pctChange = (curr, prev) => {
    if (prev === 0) return curr > 0 ? 100 : 0;
    return ((curr - prev) / prev) * 100;
  };

  return {
    totalRequests: current.totalRequests,
    totalCost: current.totalCost,
    avgLatency: Math.round(current.avgLatency),
    errorRate: Math.round(errorRate * 100) / 100,
    totalTokens: current.totalTokens,
    totalPromptTokens: current.totalPromptTokens,
    totalCompletionTokens: current.totalCompletionTokens,
    requestsChange: Math.round(pctChange(current.totalRequests, previous.totalRequests) * 100) / 100,
    costChange: Math.round(pctChange(current.totalCost, previous.totalCost) * 100) / 100,
  };
}

/**
 * Cost over time grouped by model.
 * @param {Object} dateRange
 * @param {string} [dateRange.startDate]
 * @param {string} [dateRange.endDate]
 * @param {string} [dateRange.granularity='daily'] - 'hourly' or 'daily'
 * @returns {{ data: Array<{ date: string, model: string, cost: number }> }}
 */
function getCostOverTime(dateRange = {}) {
  const database = getDb();
  const { startDate, endDate } = _defaultDateRange(dateRange.startDate, dateRange.endDate);
  const granularity = dateRange.granularity === 'hourly' ? 'hourly' : 'daily';

  const dateExpr = granularity === 'hourly'
    ? "strftime('%Y-%m-%dT%H:00:00', created_at)"
    : "date(created_at)";

  const data = database.prepare(`
    SELECT
      ${dateExpr} AS date,
      model,
      COALESCE(SUM(estimated_cost), 0) AS cost
    FROM requests
    WHERE created_at >= @startDate AND created_at <= @endDate
    GROUP BY date, model
    ORDER BY date ASC
  `).all({ startDate, endDate });

  return { data };
}

/**
 * Token usage over time.
 * @param {Object} dateRange
 * @returns {{ data: Array<{ date: string, promptTokens: number, completionTokens: number, totalTokens: number }> }}
 */
function getTokenUsage(dateRange = {}) {
  const database = getDb();
  const { startDate, endDate } = _defaultDateRange(dateRange.startDate, dateRange.endDate);

  const data = database.prepare(`
    SELECT
      date(created_at) AS date,
      COALESCE(SUM(prompt_tokens), 0) AS promptTokens,
      COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) AS completionTokens,
      COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
      COALESCE(SUM(total_tokens), 0) AS totalTokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens
    FROM requests
    WHERE created_at >= @startDate AND created_at <= @endDate
    GROUP BY date(created_at)
    ORDER BY date ASC
  `).all({ startDate, endDate });

  return { data };
}

/**
 * Model usage breakdown.
 * @param {Object} dateRange
 * @returns {{ data: Array<{ model: string, requests: number, cost: number, tokens: number, avgLatency: number }> }}
 */
function getModelUsage(dateRange = {}) {
  const database = getDb();
  const { startDate, endDate } = _defaultDateRange(dateRange.startDate, dateRange.endDate);

  const data = database.prepare(`
    SELECT
      model,
      COUNT(*) AS requests,
      COUNT(*) AS request_count,
      COALESCE(SUM(estimated_cost), 0) AS cost,
      COALESCE(SUM(estimated_cost), 0) AS total_cost,
      COALESCE(SUM(total_tokens), 0) AS tokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      COALESCE(ROUND(AVG(latency_ms)), 0) AS avgLatency,
      COALESCE(ROUND(AVG(latency_ms)), 0) AS avg_latency
    FROM requests
    WHERE created_at >= @startDate AND created_at <= @endDate
    GROUP BY model
    ORDER BY requests DESC
  `).all({ startDate, endDate });

  return { data };
}

/**
 * Latency percentiles over time (p50, p95, p99, avg).
 * SQLite doesn't have native percentile functions, so we compute them per day in JS.
 * @param {Object} dateRange
 * @returns {{ data: Array<{ date: string, p50: number, p95: number, p99: number, avg: number }> }}
 */
function getLatencyStats(dateRange = {}) {
  const database = getDb();
  const { startDate, endDate } = _defaultDateRange(dateRange.startDate, dateRange.endDate);

  const rows = database.prepare(`
    SELECT date(created_at) AS date, latency_ms
    FROM requests
    WHERE created_at >= @startDate AND created_at <= @endDate
      AND status != 'error'
    ORDER BY date, latency_ms ASC
  `).all({ startDate, endDate });

  // Group by date
  /** @type {Map<string, number[]>} */
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.date)) groups.set(row.date, []);
    groups.get(row.date).push(row.latency_ms);
  }

  /**
   * @param {number[]} arr - Sorted latency values
   * @param {number} p - Percentile (0-100)
   * @returns {number}
   */
  const percentile = (arr, p) => {
    if (arr.length === 0) return 0;
    const idx = Math.ceil((p / 100) * arr.length) - 1;
    return arr[Math.max(0, idx)];
  };

  const data = [];
  for (const [date, latencies] of groups) {
    const sum = latencies.reduce((a, b) => a + b, 0);
    data.push({
      date,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      avg: Math.round(sum / latencies.length),
    });
  }

  return { data };
}

/**
 * Error trends over time plus top error messages.
 * @param {Object} dateRange
 * @returns {{ data: Array<{ date: string, errorCount: number, totalCount: number, errorRate: number }>, topErrors: Array<{ error_message: string, count: number }> }}
 */
function getErrorStats(dateRange = {}) {
  const database = getDb();
  const { startDate, endDate } = _defaultDateRange(dateRange.startDate, dateRange.endDate);

  const data = database.prepare(`
    SELECT
      date(created_at) AS date,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errorCount,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
      COUNT(*) AS totalCount,
      ROUND(CAST(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) * 100, 2) AS errorRate,
      ROUND(CAST(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) * 100, 2) AS error_rate
    FROM requests
    WHERE created_at >= @startDate AND created_at <= @endDate
    GROUP BY date(created_at)
    ORDER BY date ASC
  `).all({ startDate, endDate });

  const topErrors = database.prepare(`
    SELECT
      error_message,
      COUNT(*) AS count
    FROM requests
    WHERE created_at >= @startDate AND created_at <= @endDate
      AND status = 'error'
      AND error_message IS NOT NULL
    GROUP BY error_message
    ORDER BY count DESC
    LIMIT 10
  `).all({ startDate, endDate });

  return { data, topErrors };
}

// ---------------------------------------------------------------------------
// Conversation helpers
// ---------------------------------------------------------------------------

/**
 * Retrieves paginated list of conversations.
 * @param {Object} filters
 * @param {number} [filters.page=1]
 * @param {number} [filters.limit=50]
 * @param {string} [filters.search]
 * @returns {{ data: Object[], total: number, page: number, limit: number }}
 */
function getConversations(filters = {}) {
  const database = getDb();

  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(filters.limit, 10) || 50));
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = {};

  if (filters.search) {
    conditions.push('(c.title LIKE @search OR c.id LIKE @search)');
    params.search = `%${filters.search}%`;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = database.prepare(`SELECT COUNT(*) AS total FROM conversations c ${whereClause}`).get(params).total;

  const data = database.prepare(`
    SELECT c.* FROM conversations c
    ${whereClause}
    ORDER BY c.last_message_at DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit, offset });

  return { data, total, page, limit };
}

/**
 * Gets a conversation by ID with all its request messages ordered chronologically.
 * @param {string} id
 * @returns {{ conversation: Object|undefined, messages: Object[] }}
 */
function getConversation(id) {
  const database = getDb();
  const conversation = database.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  const messages = database.prepare(
    'SELECT * FROM requests WHERE conversation_id = ? ORDER BY created_at ASC'
  ).all(id);

  return { conversation, messages };
}

// ---------------------------------------------------------------------------
// Model helpers
// ---------------------------------------------------------------------------

/**
 * Returns all registered models.
 * @returns {Object[]}
 */
function getModels() {
  const database = getDb();
  return database.prepare('SELECT * FROM models ORDER BY name ASC').all();
}

/**
 * Updates pricing for a model.
 * @param {string} id - The model ID (e.g. 'meta-llama/Meta-Llama-3.1-8B-Instruct')
 * @param {Object} pricing
 * @param {number} [pricing.input_cost_per_million]
 * @param {number} [pricing.output_cost_per_million]
 * @returns {{ changes: number }}
 */
function updateModelPricing(id, pricing) {
  const database = getDb();

  const fields = [];
  const params = { id };

  if (pricing.input_cost_per_million != null) {
    fields.push('input_cost_per_million = @input_cost_per_million');
    params.input_cost_per_million = pricing.input_cost_per_million;
  }
  if (pricing.output_cost_per_million != null) {
    fields.push('output_cost_per_million = @output_cost_per_million');
    params.output_cost_per_million = pricing.output_cost_per_million;
  }

  if (fields.length === 0) {
    return { changes: 0 };
  }

  const info = database.prepare(`UPDATE models SET ${fields.join(', ')} WHERE id = @id`).run(params);
  return { changes: info.changes };
}

/**
 * Recalculates all historical request costs based on the current models pricing tables.
 * Also syncs conversation total costs.
 * @returns {{ changes: number }}
 */
function recalculateCosts() {
  const database = getDb();
  
  // Recalculate cost for each request matching a model registry
  const info = database.prepare(`
    UPDATE requests
    SET estimated_cost = ROUND(
      (prompt_tokens * (SELECT input_cost_per_million FROM models WHERE models.id = requests.model) / 1000000.0) +
      (completion_tokens * (SELECT output_cost_per_million FROM models WHERE models.id = requests.model) / 1000000.0),
      6
    )
    WHERE model IN (SELECT id FROM models)
  `).run();

  // Recalculate conversation costs based on requests
  try {
    database.prepare(`
      UPDATE conversations
      SET total_cost = COALESCE((
        SELECT SUM(estimated_cost)
        FROM requests
        WHERE requests.conversation_id = conversations.id
      ), 0)
    `).run();
  } catch (err) {
    console.error('[db] Error updating conversation costs during recalculation:', err.message);
  }

  return { changes: info.changes };
}

/**
 * Inserts a new model.
 * @param {Object} model
 * @param {string} model.id
 * @param {string} model.name
 * @param {string} [model.display_name]
 * @param {string} [model.provider]
 * @param {number} [model.input_cost_per_million]
 * @param {number} [model.output_cost_per_million]
 * @param {number} [model.context_window]
 * @returns {{ changes: number }}
 */
function insertModel(model) {
  const database = getDb();
  const info = database.prepare(`
    INSERT INTO models (id, name, display_name, provider, input_cost_per_million, output_cost_per_million, context_window)
    VALUES (@id, @name, @display_name, @provider, @input_cost_per_million, @output_cost_per_million, @context_window)
  `).run({
    id: model.id,
    name: model.name || model.id,
    display_name: model.display_name || null,
    provider: model.provider || 'deepinfra',
    input_cost_per_million: model.input_cost_per_million || 0,
    output_cost_per_million: model.output_cost_per_million || 0,
    context_window: model.context_window || null,
  });
  return { changes: info.changes };
}

/**
 * Upserts daily aggregate statistics for a given date and model.
 * @param {string} date - ISO date string (YYYY-MM-DD)
 * @param {string} model
 * @param {Object} data
 * @param {number} [data.total_requests]
 * @param {number} [data.total_tokens]
 * @param {number} [data.total_prompt_tokens]
 * @param {number} [data.total_completion_tokens]
 * @param {number} [data.total_cost]
 * @param {number} [data.avg_latency_ms]
 * @param {number} [data.error_count]
 * @returns {{ changes: number }}
 */
function updateDailyStats(date, model, data) {
  const database = getDb();

  const info = database.prepare(`
    INSERT INTO daily_stats (
      date, model,
      total_requests, total_tokens, total_prompt_tokens, total_completion_tokens,
      total_cost, avg_latency_ms, error_count
    ) VALUES (
      @date, @model,
      @total_requests, @total_tokens, @total_prompt_tokens, @total_completion_tokens,
      @total_cost, @avg_latency_ms, @error_count
    )
    ON CONFLICT(date, model) DO UPDATE SET
      total_requests = @total_requests,
      total_tokens = @total_tokens,
      total_prompt_tokens = @total_prompt_tokens,
      total_completion_tokens = @total_completion_tokens,
      total_cost = @total_cost,
      avg_latency_ms = @avg_latency_ms,
      error_count = @error_count
  `).run({
    date,
    model,
    total_requests: data.total_requests || 0,
    total_tokens: data.total_tokens || 0,
    total_prompt_tokens: data.total_prompt_tokens || 0,
    total_completion_tokens: data.total_completion_tokens || 0,
    total_cost: data.total_cost || 0,
    avg_latency_ms: data.avg_latency_ms || 0,
    error_count: data.error_count || 0,
  });

  return { changes: info.changes };
}

/**
 * Returns user-level usage breakdown within a date range.
 * @param {Object} dateRange
 * @returns {{ data: Array<{ userId: string, requests: number, cost: number, tokens: number }> }}
 */
function getUserStats(dateRange = {}) {
  const database = getDb();
  const { startDate, endDate } = _defaultDateRange(dateRange.startDate, dateRange.endDate);

  const data = database.prepare(`
    SELECT
      COALESCE(user_id, 'anonymous') AS userId,
      COUNT(*) AS requests,
      COALESCE(SUM(estimated_cost), 0) AS cost,
      COALESCE(SUM(total_tokens), 0) AS tokens
    FROM requests
    WHERE created_at >= @startDate AND created_at <= @endDate
    GROUP BY user_id
    ORDER BY cost DESC
  `).all({ startDate, endDate });

  return { data };
}

// ---------------------------------------------------------------------------
// Prompt helpers
// ---------------------------------------------------------------------------

/**
 * Retrieves a list of unique prompt names with their latest version.
 * @returns {Object[]} Unique prompts
 */
function getPrompts() {
  const database = getDb();
  return database.prepare(`
    SELECT p1.* 
    FROM prompts p1
    INNER JOIN (
      SELECT name, MAX(version) AS max_version
      FROM prompts
      GROUP BY name
    ) p2 ON p1.name = p2.name AND p1.version = p2.max_version
    ORDER BY p1.name ASC
  `).all();
}

/**
 * Retrieves the latest version of a prompt template by name.
 * @param {string} name - Prompt template name
 * @returns {Object|null} The prompt template
 */
function getPromptByName(name) {
  const database = getDb();
  return database.prepare(`
    SELECT * FROM prompts
    WHERE name = ?
    ORDER BY version DESC
    LIMIT 1
  `).get(name) || null;
}

/**
 * Retrieves the version history of a prompt template by name.
 * @param {string} name - Prompt template name
 * @returns {Object[]} Array of prompt template versions
 */
function getPromptHistory(name) {
  const database = getDb();
  return database.prepare(`
    SELECT * FROM prompts
    WHERE name = ?
    ORDER BY version DESC
  `).all(name);
}

/**
 * Inserts a new prompt version. Auto-increments the version number.
 * @param {Object} data
 * @param {string} data.name
 * @param {string} data.system_prompt
 * @param {string} data.user_template
 * @param {string[]|string} data.variables
 * @returns {Object} The created prompt template
 */
function insertPrompt(data) {
  const database = getDb();
  
  // Find current latest version to increment it
  const latest = getPromptByName(data.name);
  const nextVersion = latest ? latest.version + 1 : 1;

  const variablesJson = Array.isArray(data.variables) 
    ? JSON.stringify(data.variables) 
    : (data.variables || '[]');

  const stmt = database.prepare(`
    INSERT INTO prompts (name, version, system_prompt, user_template, variables)
    VALUES (?, ?, ?, ?, ?)
  `);

  const info = stmt.run(data.name, nextVersion, data.system_prompt || '', data.user_template || '', variablesJson);
  
  return {
    id: info.lastInsertRowid,
    name: data.name,
    version: nextVersion,
    system_prompt: data.system_prompt,
    user_template: data.user_template,
    variables: variablesJson
  };
}

/**
 * Deletes all versions of a prompt template by name.
 * @param {string} name - Prompt template name
 * @returns {boolean} Success
 */
function deletePromptByName(name) {
  const database = getDb();
  const info = database.prepare('DELETE FROM prompts WHERE name = ?').run(name);
  return info.changes > 0;
}


// ---------------------------------------------------------------------------
// Feedback & Evaluation helpers
// ---------------------------------------------------------------------------

/**
 * Updates the human feedback fields on a request.
 * @param {string} id - Request UUID
 * @param {Object} feedback - Feedback object { score, rating, comment, task_success, expected_answer }
 * @returns {boolean} Success
 */
function updateFeedback(id, feedback) {
  const database = getDb();
  const feedbackJson = feedback ? JSON.stringify(feedback) : null;
  const info = database.prepare('UPDATE requests SET feedback = ? WHERE id = ?').run(feedbackJson, id);

  // Recalculate NLP metrics if expected_answer is present
  if (feedback && feedback.expected_answer) {
    const request = database.prepare('SELECT output_message, evaluation FROM requests WHERE id = ?').get(id);
    if (request && request.output_message) {
      try {
        const outMsg = JSON.parse(request.output_message);
        const generatedText = outMsg.content || '';
        if (generatedText) {
          const { calculateAllNLP } = require('../utils/nlp-eval');
          const nlpMetrics = calculateAllNLP(generatedText, feedback.expected_answer);

          let evalObj = {};
          try {
            evalObj = request.evaluation ? JSON.parse(request.evaluation) : {};
          } catch (e) {
            evalObj = {};
          }

          Object.assign(evalObj, nlpMetrics);
          database.prepare('UPDATE requests SET evaluation = ? WHERE id = ?').run(JSON.stringify(evalObj), id);
        }
      } catch (err) {
        console.error('[db] Error updating NLP metrics:', err.message);
      }
    }
  }

  return info.changes > 0;
}

/**
 * Updates the AI evaluation fields on a request.
 * @param {string} id - Request UUID
 * @param {Object} evaluation - Evaluation object { score, reasoning, category }
 * @returns {boolean} Success
 */
function updateEvaluation(id, evaluation) {
  const database = getDb();
  const evalJson = evaluation ? JSON.stringify(evaluation) : null;
  const info = database.prepare('UPDATE requests SET evaluation = ? WHERE id = ?').run(evalJson, id);
  return info.changes > 0;
}

/**
 * Automatically calculates agentic metrics for a trace and updates the root trace request log.
 * @param {string} traceId
 */
function calculateAgentMetrics(traceId) {
  if (!traceId) return;
  const database = getDb();
  const spans = database.prepare('SELECT id, span_id, parent_span_id, span_type, status FROM requests WHERE trace_id = ?').all(traceId);
  if (spans.length === 0) return;

  // Identify root span (usually where parent_span_id is 'root' or null or span_type is 'agent')
  const rootSpan = spans.find(s => s.parent_span_id === 'root' || !s.parent_span_id || s.span_type === 'agent') || spans[0];
  if (!rootSpan) return;

  const toolSpans = spans.filter(s => s.span_type === 'tool');
  const totalTools = toolSpans.length;
  const successfulTools = toolSpans.filter(s => s.status === 'success').length;
  const toolSuccessRate = totalTools > 0 ? successfulTools / totalTools : 1.0;

  const iterationCount = spans.length;

  // Goal completion: check if the root span or any span succeeded and no error occurred in the trace
  const goalCompletion = rootSpan.status === 'success' ? 1.0 : 0.0;

  // Planning accuracy: success rate of tools, or 1.0 if all spans succeeded
  const planningAccuracy = totalTools > 0 ? toolSuccessRate : (spans.every(s => s.status === 'success') ? 1.0 : 0.5);
  const toolSelectionAccuracy = totalTools > 0 ? toolSuccessRate : 1.0;

  // Retrieve existing evaluation of root span
  const rootRequest = database.prepare('SELECT evaluation FROM requests WHERE id = ?').get(rootSpan.id);
  let evalObj = {};
  try {
    evalObj = rootRequest.evaluation ? JSON.parse(rootRequest.evaluation) : {};
  } catch (e) {
    evalObj = {};
  }

  evalObj.tool_success_rate = toolSuccessRate;
  evalObj.iteration_count = iterationCount;
  evalObj.goal_completion_rate = goalCompletion;
  evalObj.planning_accuracy = planningAccuracy;
  evalObj.tool_selection_accuracy = toolSelectionAccuracy;

  database.prepare('UPDATE requests SET evaluation = ? WHERE id = ?').run(JSON.stringify(evalObj), rootSpan.id);
}

/**
 * Aggregates evaluation analytics metrics over a time range.
 * @param {Object} dateRange
 * @returns {Object}
 */
function getEvaluationAnalytics(dateRange = {}) {
  const database = getDb();
  const { startDate, endDate } = _defaultDateRange(dateRange.startDate, dateRange.endDate);

  const requests = database.prepare(`
    SELECT 
      id, status, latency_ms, prompt_tokens, completion_tokens, total_tokens, estimated_cost,
      feedback, evaluation, created_at, span_type, parent_span_id, trace_id
    FROM requests
    WHERE created_at >= @startDate AND created_at <= @endDate
  `).all({ startDate, endDate });

  const totalRequests = requests.length;
  const failedRequests = requests.filter(r => r.status === 'error').length;
  const errorRate = totalRequests > 0 ? (failedRequests / totalRequests) * 100 : 0;

  let throughputMin = 0;
  if (totalRequests > 0) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const durationMs = Math.max(1000, end.getTime() - start.getTime());
    const durationMin = durationMs / 60000;
    throughputMin = totalRequests / durationMin;
  }

  let totalLatency = 0;
  let totalCost = 0;
  let totalTokens = 0;
  for (const r of requests) {
    totalLatency += r.latency_ms || 0;
    totalCost += r.estimated_cost || 0;
    totalTokens += r.total_tokens || 0;
  }
  const avgLatency = totalRequests > 0 ? totalLatency / totalRequests : 0;

  let totalRatings = 0;
  let ratingCount = 0;
  let taskSuccessCount = 0;
  let feedbackCount = 0;

  let ragCount = 0;
  let sumFaithfulness = 0;
  let sumAnswerRelevancy = 0;
  let sumContextPrecision = 0;
  let sumContextRecall = 0;
  let sumContextRelevance = 0;
  let sumRecallAtK = 0;
  let sumPrecisionAtK = 0;
  let sumMRR = 0;

  let nlpCount = 0;
  let sumExactMatch = 0;
  let sumF1Score = 0;
  let sumRouge1 = 0;
  let sumRouge2 = 0;
  let sumRougeL = 0;
  let sumBleu = 0;

  let sumHallucinationRate = 0;
  let hallucinationCount = 0;

  let agentCount = 0;
  let sumToolSuccessRate = 0;
  let sumToolSelectionAccuracy = 0;
  let sumPlanningAccuracy = 0;
  let sumIterationCount = 0;
  let sumGoalCompletionRate = 0;

  for (const r of requests) {
    if (r.feedback) {
      try {
        const f = JSON.parse(r.feedback);
        if (f) {
          feedbackCount++;
          if (f.rating != null) {
            totalRatings += Number(f.rating);
            ratingCount++;
          }
          if (f.task_success === true) {
            taskSuccessCount++;
          }
        }
      } catch (e) {}
    }

    if (r.evaluation) {
      try {
        const ev = JSON.parse(r.evaluation);
        if (ev) {
          const hasRAG = ev.faithfulness != null || ev.answer_relevancy != null || ev.context_precision != null || ev.context_recall != null || ev.recall_at_k != null;
          if (hasRAG) {
            ragCount++;
            if (ev.faithfulness != null) sumFaithfulness += Number(ev.faithfulness);
            if (ev.answer_relevancy != null) sumAnswerRelevancy += Number(ev.answer_relevancy);
            if (ev.context_precision != null) sumContextPrecision += Number(ev.context_precision);
            if (ev.context_recall != null) sumContextRecall += Number(ev.context_recall);
            if (ev.context_relevance != null) sumContextRelevance += Number(ev.context_relevance);
            if (ev.recall_at_k != null) sumRecallAtK += Number(ev.recall_at_k);
            if (ev.precision_at_k != null) sumPrecisionAtK += Number(ev.precision_at_k);
            if (ev.mrr != null) sumMRR += Number(ev.mrr);
          }

          const hasNLP = ev.exact_match != null || ev.f1_score != null || ev.bleu != null;
          if (hasNLP) {
            nlpCount++;
            if (ev.exact_match != null) sumExactMatch += Number(ev.exact_match);
            if (ev.f1_score != null) sumF1Score += Number(ev.f1_score);
            if (ev.rouge_1 != null) sumRouge1 += Number(ev.rouge_1);
            if (ev.rouge_2 != null) sumRouge2 += Number(ev.rouge_2);
            if (ev.rouge_l != null) sumRougeL += Number(ev.rouge_l);
            if (ev.bleu != null) sumBleu += Number(ev.bleu);
          }

          if (ev.hallucination_rate != null) {
            sumHallucinationRate += Number(ev.hallucination_rate);
            hallucinationCount++;
          }

          const hasAgent = ev.iteration_count != null || ev.tool_success_rate != null;
          if (hasAgent) {
            agentCount++;
            if (ev.tool_success_rate != null) sumToolSuccessRate += Number(ev.tool_success_rate);
            if (ev.tool_selection_accuracy != null) sumToolSelectionAccuracy += Number(ev.tool_selection_accuracy);
            if (ev.planning_accuracy != null) sumPlanningAccuracy += Number(ev.planning_accuracy);
            if (ev.iteration_count != null) sumIterationCount += Number(ev.iteration_count);
            if (ev.goal_completion_rate != null) sumGoalCompletionRate += Number(ev.goal_completion_rate);
          }
        }
      } catch (e) {}
    }
  }

  return {
    production: {
      totalRequests,
      failedRequests,
      errorRate: Math.round(errorRate * 100) / 100,
      throughput: Math.round(throughputMin * 100) / 100,
      avgLatency: Math.round(avgLatency),
      totalCost: Math.round(totalCost * 10000) / 10000,
      totalTokens,
    },
    userFeedback: {
      avgRating: ratingCount > 0 ? Math.round((totalRatings / ratingCount) * 10) / 10 : 0.0,
      ratingCount,
      taskSuccessRate: feedbackCount > 0 ? Math.round((taskSuccessCount / feedbackCount) * 100) : 0,
      accuracy: nlpCount > 0 ? Math.round((sumExactMatch / nlpCount) * 100) : 0,
    },
    rag: {
      faithfulness: ragCount > 0 && sumFaithfulness ? Math.round((sumFaithfulness / ragCount) * 10) / 10 : 0.0,
      answerRelevancy: ragCount > 0 && sumAnswerRelevancy ? Math.round((sumAnswerRelevancy / ragCount) * 10) / 10 : 0.0,
      contextPrecision: ragCount > 0 && sumContextPrecision ? Math.round((sumContextPrecision / ragCount) * 10) / 10 : 0.0,
      contextRecall: ragCount > 0 && sumContextRecall ? Math.round((sumContextRecall / ragCount) * 10) / 10 : 0.0,
      contextRelevance: ragCount > 0 && sumContextRelevance ? Math.round((sumContextRelevance / ragCount) * 10) / 10 : 0.0,
      recallAtK: ragCount > 0 && sumRecallAtK ? Math.round((sumRecallAtK / ragCount) * 100) / 100 : 0.0,
      precisionAtK: ragCount > 0 && sumPrecisionAtK ? Math.round((sumPrecisionAtK / ragCount) * 100) / 100 : 0.0,
      mrr: ragCount > 0 && sumMRR ? Math.round((sumMRR / ragCount) * 100) / 100 : 0.0,
    },
    nlp: {
      exactMatch: nlpCount > 0 ? Math.round((sumExactMatch / nlpCount) * 100) / 100 : 0.0,
      f1Score: nlpCount > 0 ? Math.round((sumF1Score / nlpCount) * 100) / 100 : 0.0,
      rouge1: nlpCount > 0 ? Math.round((sumRouge1 / nlpCount) * 100) / 100 : 0.0,
      rouge2: nlpCount > 0 ? Math.round((sumRouge2 / nlpCount) * 100) / 100 : 0.0,
      rougeL: nlpCount > 0 ? Math.round((sumRougeL / nlpCount) * 100) / 100 : 0.0,
      bleu: nlpCount > 0 ? Math.round((sumBleu / nlpCount) * 100) / 100 : 0.0,
    },
    hallucination: {
      hallucinationRate: hallucinationCount > 0 ? Math.round((sumHallucinationRate / hallucinationCount) * 100) / 100 : 0.0,
      faithfulness: ragCount > 0 && sumFaithfulness ? Math.round((sumFaithfulness / ragCount) * 10) / 10 : 0.0,
    },
    agent: {
      toolSuccessRate: agentCount > 0 ? Math.round((sumToolSuccessRate / agentCount) * 100) / 100 : 0.0,
      toolSelectionAccuracy: agentCount > 0 ? Math.round((sumToolSelectionAccuracy / agentCount) * 100) / 100 : 0.0,
      planningAccuracy: agentCount > 0 ? Math.round((sumPlanningAccuracy / agentCount) * 100) / 100 : 0.0,
      avgIterations: agentCount > 0 ? Math.round((sumIterationCount / agentCount) * 10) / 10 : 0.0,
      goalCompletionRate: agentCount > 0 ? Math.round((sumGoalCompletionRate / agentCount) * 100) / 100 : 0.0,
    }
  };
}

/**
 * Retrieves a configuration setting value.
 * @param {string} key
 * @returns {string|null}
 */
function getSetting(key) {
  const database = getDb();
  try {
    const row = database.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  } catch (err) {
    console.error('[db/sqlite] Error getting setting:', err.message);
    return null;
  }
}

/**
 * Saves or updates a configuration setting.
 * @param {string} key
 * @param {string} value
 * @returns {boolean} Success
 */
function setSetting(key, value) {
  const database = getDb();
  try {
    database.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
    return true;
  } catch (err) {
    console.error('[db/sqlite] Error setting setting:', err.message);
    return false;
  }
}

/**
 * Gets paginated trace sessions.
 */
async function getTraces(filters = {}) {
  const database = getDb();
  
  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(filters.limit, 10) || 20));
  const offset = (page - 1) * limit;
  
  const startDate = filters.startDate;
  const endDate = filters.endDate;
  
  const conditions = ['trace_id IS NOT NULL', "trace_id != ''"];
  const params = {};
  
  if (startDate) {
    conditions.push('created_at >= @startDate');
    params.startDate = startDate;
  }
  if (endDate) {
    conditions.push('created_at <= @endDate');
    params.endDate = endDate;
  }
  
  const whereClause = `WHERE ${conditions.join(' AND ')}`;
  
  const countRow = database.prepare(`
    SELECT COUNT(DISTINCT trace_id) AS total 
    FROM requests 
    ${whereClause}
  `).get(params);
  const total = countRow.total;
  
  const traces = database.prepare(`
    SELECT
      trace_id,
      MIN(created_at) AS first_span_at,
      MAX(created_at) AS last_span_at,
      COUNT(*) AS total_spans,
      SUM(latency_ms) AS total_latency_ms,
      SUM(estimated_cost) AS total_cost,
      SUM(total_tokens) AS total_tokens,
      COALESCE(
        (SELECT span_name FROM requests WHERE trace_id = r.trace_id AND (parent_span_id IS NULL OR parent_span_id = '' OR parent_span_id = 'root') LIMIT 1),
        (SELECT span_name FROM requests WHERE trace_id = r.trace_id ORDER BY created_at ASC LIMIT 1),
        'Trace Session'
      ) AS name,
      COALESCE(
        (SELECT model FROM requests WHERE trace_id = r.trace_id AND (parent_span_id IS NULL OR parent_span_id = '' OR parent_span_id = 'root') LIMIT 1),
        (SELECT model FROM requests WHERE trace_id = r.trace_id ORDER BY created_at ASC LIMIT 1),
        'unknown'
      ) AS model
    FROM requests r
    ${whereClause}
    GROUP BY trace_id
    ORDER BY last_span_at DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit, offset });

  return {
    data: traces,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  };
}

/**
 * Gets spans for a trace.
 */
async function getTraceSpans(traceId) {
  const database = getDb();
  return database.prepare(`
    SELECT * FROM requests 
    WHERE trace_id = ? 
    ORDER BY created_at ASC
  `).all(traceId);
}

/**
 * Gets tool spans for a trace.
 */
async function getToolSpansForTrace(traceId) {
  const database = getDb();
  return database.prepare(`
    SELECT output_message, raw_response FROM requests 
    WHERE trace_id = ? AND span_type = 'tool'
  `).all(traceId);
}

async function getRequestBySpanId(spanId) {
  const database = getDb();
  return database.prepare('SELECT * FROM requests WHERE span_id = ?').get(spanId) || null;
}

async function clearAllLogs() {
  const database = getDb();
  database.transaction(() => {
    database.prepare('DELETE FROM requests').run();
    database.prepare('DELETE FROM conversations').run();
    database.prepare('DELETE FROM daily_stats').run();
  })();
}

async function updateTags(id, tags) {
  const database = getDb();
  const tagsJson = Array.isArray(tags) ? JSON.stringify(tags) : tags;
  database.prepare('UPDATE requests SET tags = ? WHERE id = ?').run(tagsJson, id);
}

async function updateStatus(id, status) {
  const database = getDb();
  database.prepare('UPDATE requests SET status = ? WHERE id = ?').run(status, id);
}

async function getSubsequentSpans(traceId, createdAt) {
  const database = getDb();
  return database.prepare('SELECT * FROM requests WHERE trace_id = ? AND created_at > ?').all(traceId, createdAt);
}

module.exports = {
  getDb,
  runMigrations,
  // Requests
  insertRequest,
  getRequests,
  getRequestById,
  deleteRequest,
  // Analytics
  getAnalyticsOverview,
  getCostOverTime,
  getTokenUsage,
  getModelUsage,
  getLatencyStats,
  getErrorStats,
  getUserStats,
  // Conversations
  getConversations,
  getConversation,
  // Models
  getModels,
  updateModelPricing,
  insertModel,
  recalculateCosts,
  // Daily stats
  updateDailyStats,
  // Prompts
  getPrompts,
  getPromptByName,
  getPromptHistory,
  insertPrompt,
  deletePromptByName,
  // Feedback & Evals
  updateFeedback,
  updateEvaluation,
  calculateAgentMetrics,
  getEvaluationAnalytics,
  // Settings
  getSetting,
  setSetting,
  // Traces
  getTraces,
  getTraceSpans,
  getToolSpansForTrace,
  // Logs helpers
  getRequestBySpanId,
  clearAllLogs,
  updateTags,
  updateStatus,
  getSubsequentSpans,
};
