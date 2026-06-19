/**
 * Database helper module for PostgreSQL backend.
 * Uses pg pool for async access.
 *
 * @module db/postgres
 */
'use strict';

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

/** @type {import('pg').Pool | null} */
let pool = null;

/**
 * Returns the pool instance, initializing it if necessary.
 * @returns {import('pg').Pool}
 */
function getDb() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required for PostgreSQL mode.');
  }

  pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  return pool;
}

/**
 * Runs the postgres-schema.sql migration to create all tables and indexes.
 */
async function runMigrations() {
  const dbPool = getDb();
  
  // Safely add missing columns to requests table if migrating from an older schema
  const columns = ['feedback', 'evaluation', 'trace_id', 'span_id', 'parent_span_id', 'span_name', 'span_type'];
  for (const col of columns) {
    try {
      await dbPool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS ${col} TEXT`);
    } catch (err) {
      // Ignore error
    }
  }

  const schemaPath = path.resolve(__dirname, 'postgres-schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  await dbPool.query(schema);
}

// Helper to calculate default date ranges
function _defaultDateRange(startDate, endDate) {
  if (!endDate) {
    endDate = new Date().toISOString().replace('T', ' ').substring(0, 19);
  }
  if (!startDate) {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    startDate = d.toISOString().replace('T', ' ').substring(0, 19);
  }
  return { startDate, endDate };
}

// Helper to compute previous period
function _previousPeriod(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - diffMs);
  return {
    prevStart: prevStart.toISOString().replace('T', ' ').substring(0, 19),
    prevEnd: prevEnd.toISOString().replace('T', ' ').substring(0, 19),
  };
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

async function insertRequest(data) {
  const client = getDb();

  if (data.conversation_id) {
    await client.query(`
      INSERT INTO conversations (id, created_at)
      VALUES ($1, TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS'))
      ON CONFLICT(id) DO NOTHING
    `, [data.conversation_id]);
  }

  const query = `
    INSERT INTO requests (
      id, conversation_id, model, provider,
      input_messages, output_message,
      prompt_tokens, completion_tokens, total_tokens, estimated_cost,
      latency_ms, status, error_message,
      temperature, max_tokens, top_p, frequency_penalty, presence_penalty,
      user_id, metadata, tags, stream,
      raw_request, raw_response, trace_id, span_id, parent_span_id, span_name, span_type, created_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, $17, $18,
      $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30
    )
  `;

  const input_messages = typeof data.input_messages === 'string' ? data.input_messages : JSON.stringify(data.input_messages || []);
  const output_message = data.output_message ? (typeof data.output_message === 'string' ? data.output_message : JSON.stringify(data.output_message)) : null;
  const metadata = data.metadata ? (typeof data.metadata === 'string' ? data.metadata : JSON.stringify(data.metadata)) : null;
  const tags = data.tags ? (typeof data.tags === 'string' ? data.tags : JSON.stringify(data.tags)) : null;
  const raw_request = data.raw_request ? (typeof data.raw_request === 'string' ? data.raw_request : JSON.stringify(data.raw_request)) : null;
  const raw_response = data.raw_response ? (typeof data.raw_response === 'string' ? data.raw_response : JSON.stringify(data.raw_response)) : null;

  const values = [
    data.id,
    data.conversation_id || null,
    data.model,
    data.provider || 'deepinfra',
    input_messages,
    output_message,
    data.prompt_tokens || 0,
    data.completion_tokens || 0,
    data.total_tokens || 0,
    data.estimated_cost || 0,
    data.latency_ms || 0,
    data.status || 'success',
    data.error_message || null,
    data.temperature != null ? parseFloat(data.temperature) : null,
    data.max_tokens != null ? parseInt(data.max_tokens, 10) : null,
    data.top_p != null ? parseFloat(data.top_p) : null,
    data.frequency_penalty != null ? parseFloat(data.frequency_penalty) : null,
    data.presence_penalty != null ? parseFloat(data.presence_penalty) : null,
    data.user_id || null,
    metadata,
    tags,
    data.stream ? 1 : 0,
    raw_request,
    raw_response,
    data.trace_id || null,
    data.span_id || null,
    data.parent_span_id || null,
    data.span_name || null,
    data.span_type || null,
    data.created_at || new Date().toISOString().replace('T', ' ').substring(0, 19)
  ];

  await client.query(query, values);

  if (data.conversation_id) {
    await _updateConversationStats(data.conversation_id);
  }

  if (data.trace_id) {
    try {
      await calculateAgentMetrics(data.trace_id);
    } catch (err) {
      console.error('[db/postgres] Error calculating agent metrics:', err.message);
    }
  }

  return data;
}

async function _updateConversationStats(conversationId) {
  const client = getDb();

  // Ensure conversation exists
  await client.query(`
    INSERT INTO conversations (id, created_at)
    VALUES ($1, TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS'))
    ON CONFLICT(id) DO NOTHING
  `, [conversationId]);

  const statsRes = await client.query(`
    SELECT
      COUNT(*)::int AS total_messages,
      COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
      COALESCE(SUM(estimated_cost), 0)::double precision AS total_cost,
      MIN(created_at) AS first_message_at,
      MAX(created_at) AS last_message_at
    FROM requests
    WHERE conversation_id = $1
  `, [conversationId]);

  const stats = statsRes.rows[0];

  await client.query(`
    UPDATE conversations
    SET total_messages = $2,
        total_tokens = $3,
        total_cost = $4,
        first_message_at = $5,
        last_message_at = $6
    WHERE id = $1
  `, [
    conversationId,
    stats.total_messages,
    stats.total_tokens,
    stats.total_cost,
    stats.first_message_at,
    stats.last_message_at
  ]);
}

async function getRequests(filters = {}) {
  const client = getDb();

  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(filters.limit, 10) || 50));
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];

  let paramIdx = 1;

  if (filters.model) {
    conditions.push(`r.model = $${paramIdx++}`);
    params.push(filters.model);
  }
  if (filters.status) {
    conditions.push(`r.status = $${paramIdx++}`);
    params.push(filters.status);
  }
  if (filters.startDate) {
    conditions.push(`r.created_at >= $${paramIdx++}`);
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    conditions.push(`r.created_at <= $${paramIdx++}`);
    params.push(filters.endDate);
  }
  if (filters.userId) {
    conditions.push(`r.user_id = $${paramIdx++}`);
    params.push(filters.userId);
  }
  if (filters.minCost != null) {
    conditions.push(`r.estimated_cost >= $${paramIdx++}`);
    params.push(parseFloat(filters.minCost));
  }
  if (filters.maxCost != null) {
    conditions.push(`r.estimated_cost <= $${paramIdx++}`);
    params.push(parseFloat(filters.maxCost));
  }
  if (filters.search) {
    conditions.push(`(r.input_messages ILIKE $${paramIdx} OR r.output_message ILIKE $${paramIdx} OR r.model ILIKE $${paramIdx})`);
    params.push(`%${filters.search}%`);
    paramIdx++;
  }
  if (filters.feedback) {
    if (filters.feedback === 'positive') {
      conditions.push("(r.feedback::json->>'score')::int = 1");
    } else if (filters.feedback === 'negative') {
      conditions.push("(r.feedback::json->>'score')::int = -1");
    }
  }
  if (filters.minEval != null) {
    conditions.push(`CAST(r.evaluation::json->>'score' AS DOUBLE PRECISION) >= $${paramIdx++}`);
    params.push(parseFloat(filters.minEval));
  }
  if (filters.maxEval != null) {
    conditions.push(`CAST(r.evaluation::json->>'score' AS DOUBLE PRECISION) <= $${paramIdx++}`);
    params.push(parseFloat(filters.maxEval));
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const SORT_COLUMNS = ['created_at', 'model', 'total_tokens', 'estimated_cost', 'latency_ms', 'status'];
  const sortBy = SORT_COLUMNS.includes(filters.sortBy) ? filters.sortBy : 'created_at';
  const sortOrder = String(filters.sortOrder || '').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const countRes = await client.query(`SELECT COUNT(*) AS total FROM requests r ${whereClause}`, params);
  const total = parseInt(countRes.rows[0].total, 10);

  const limitParamIdx = paramIdx++;
  const offsetParamIdx = paramIdx++;
  const selectQuery = `
    SELECT r.* FROM requests r
    ${whereClause}
    ORDER BY r.${sortBy} ${sortOrder}
    LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
  `;

  const dataRes = await client.query(selectQuery, [...params, limit, offset]);

  return {
    data: dataRes.rows,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

async function getRequestById(id) {
  const client = getDb();
  const res = await client.query('SELECT * FROM requests WHERE id = $1', [id]);
  return res.rows[0];
}

async function deleteRequest(id) {
  const client = getDb();
  const res = await client.query('DELETE FROM requests WHERE id = $1', [id]);
  return { changes: res.rowCount };
}

// ---------------------------------------------------------------------------
// Analytics helpers
// ---------------------------------------------------------------------------

async function getAnalyticsOverview(dateRange = {}) {
  const client = getDb();
  const { startDate, endDate } = _defaultDateRange(dateRange.startDate, dateRange.endDate);

  const currentSql = `
    SELECT
      COUNT(*)::int AS totalrequests,
      COALESCE(SUM(estimated_cost), 0)::double precision AS totalcost,
      COALESCE(AVG(latency_ms), 0)::double precision AS avglatency,
      COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0)::int AS errorcount,
      COALESCE(SUM(total_tokens), 0)::int AS totaltokens,
      COALESCE(SUM(prompt_tokens), 0)::int AS totalprompttokens,
      COALESCE(SUM(completion_tokens), 0)::int AS totalcompletiontokens
    FROM requests
    WHERE created_at >= $1 AND created_at <= $2
  `;

  const currentRes = await client.query(currentSql, [startDate, endDate]);
  const current = currentRes.rows[0];

  const { prevStart, prevEnd } = _previousPeriod(startDate, endDate);
  const prevRes = await client.query(currentSql, [prevStart, prevEnd]);
  const previous = prevRes.rows[0];

  const errorRate = current.totalrequests > 0 ? (current.errorcount / current.totalrequests) * 100 : 0;

  const pctChange = (curr, prev) => {
    if (prev === 0) return curr > 0 ? 100 : 0;
    return ((curr - prev) / prev) * 100;
  };

  return {
    totalRequests: current.totalrequests,
    totalCost: current.totalcost,
    avgLatency: Math.round(current.avglatency),
    errorRate: Math.round(errorRate * 100) / 100,
    totalTokens: current.totaltokens,
    totalPromptTokens: current.totalprompttokens,
    totalCompletionTokens: current.totalcompletiontokens,
    requestsChange: Math.round(pctChange(current.totalrequests, previous.totalrequests) * 100) / 100,
    costChange: Math.round(pctChange(current.totalcost, previous.totalcost) * 100) / 100,
  };
}

async function getCostOverTime(dateRange = {}) {
  const client = getDb();
  const { startDate, endDate } = _defaultDateRange(dateRange.startDate, dateRange.endDate);
  const granularity = dateRange.granularity === 'hourly' ? 'hourly' : 'daily';

  const dateExpr = granularity === 'hourly'
    ? "SUBSTRING(created_at FROM 1 FOR 13) || ':00:00'"
    : "SUBSTRING(created_at FROM 1 FOR 10)";

  const res = await client.query(`
    SELECT
      ${dateExpr} AS date,
      model,
      COALESCE(SUM(estimated_cost), 0)::double precision AS cost
    FROM requests
    WHERE created_at >= $1 AND created_at <= $2
    GROUP BY date, model
    ORDER BY date ASC
  `, [startDate, endDate]);

  return { data: res.rows };
}

async function getTokenUsage(dateRange = {}) {
  const client = getDb();
  const { startDate, endDate } = _defaultDateRange(dateRange.startDate, dateRange.endDate);

  const res = await client.query(`
    SELECT
      SUBSTRING(created_at FROM 1 FOR 10) AS date,
      COALESCE(SUM(prompt_tokens), 0)::int AS prompttokens,
      COALESCE(SUM(prompt_tokens), 0)::int AS prompt_tokens,
      COALESCE(SUM(completion_tokens), 0)::int AS completiontokens,
      COALESCE(SUM(completion_tokens), 0)::int AS completion_tokens,
      COALESCE(SUM(total_tokens), 0)::int AS totaltokens,
      COALESCE(SUM(total_tokens), 0)::int AS total_tokens
    FROM requests
    WHERE created_at >= $1 AND created_at <= $2
    GROUP BY SUBSTRING(created_at FROM 1 FOR 10)
    ORDER BY date ASC
  `, [startDate, endDate]);

  return { data: res.rows };
}

async function getModelUsage(dateRange = {}) {
  const client = getDb();
  const { startDate, endDate } = _defaultDateRange(dateRange.startDate, dateRange.endDate);

  const res = await client.query(`
    SELECT
      model,
      COUNT(*)::int AS requests,
      COUNT(*)::int AS request_count,
      COALESCE(SUM(estimated_cost), 0)::double precision AS cost,
      COALESCE(SUM(estimated_cost), 0)::double precision AS total_cost,
      COALESCE(SUM(total_tokens), 0)::int AS tokens,
      COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
      COALESCE(ROUND(AVG(latency_ms)), 0)::int AS avglatency,
      COALESCE(ROUND(AVG(latency_ms)), 0)::int AS avg_latency
    FROM requests
    WHERE created_at >= $1 AND created_at <= $2
    GROUP BY model
    ORDER BY requests DESC
  `, [startDate, endDate]);

  return { data: res.rows };
}

async function getLatencyStats(dateRange = {}) {
  const client = getDb();
  const { startDate, endDate } = _defaultDateRange(dateRange.startDate, dateRange.endDate);

  const res = await client.query(`
    SELECT SUBSTRING(created_at FROM 1 FOR 10) AS date, latency_ms
    FROM requests
    WHERE created_at >= $1 AND created_at <= $2
      AND status != 'error'
    ORDER BY date, latency_ms ASC
  `, [startDate, endDate]);

  const groups = new Map();
  for (const row of res.rows) {
    if (!groups.has(row.date)) groups.set(row.date, []);
    groups.get(row.date).push(row.latency_ms);
  }

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

async function getErrorStats(dateRange = {}) {
  const client = getDb();
  const { startDate, endDate } = _defaultDateRange(dateRange.startDate, dateRange.endDate);

  const dataRes = await client.query(`
    SELECT
      SUBSTRING(created_at FROM 1 FOR 10) AS date,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::int AS errorcount,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::int AS error_count,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::int AS errors,
      COUNT(*)::int AS totalcount,
      ROUND(CAST(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) * 100, 2)::double precision AS errorrate,
      ROUND(CAST(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) * 100, 2)::double precision AS error_rate
    FROM requests
    WHERE created_at >= $1 AND created_at <= $2
    GROUP BY SUBSTRING(created_at FROM 1 FOR 10)
    ORDER BY date ASC
  `, [startDate, endDate]);

  const topErrorsRes = await client.query(`
    SELECT
      error_message,
      COUNT(*)::int AS count
    FROM requests
    WHERE created_at >= $1 AND created_at <= $2
      AND status = 'error'
      AND error_message IS NOT NULL
    GROUP BY error_message
    ORDER BY count DESC
    LIMIT 10
  `, [startDate, endDate]);

  return { data: dataRes.rows, topErrors: topErrorsRes.rows };
}

// ---------------------------------------------------------------------------
// Conversation helpers
// ---------------------------------------------------------------------------

async function getConversations(filters = {}) {
  const client = getDb();

  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(filters.limit, 10) || 50));
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];
  let paramIdx = 1;

  if (filters.search) {
    conditions.push(`(c.title ILIKE $${paramIdx} OR c.id ILIKE $${paramIdx})`);
    params.push(`%${filters.search}%`);
    paramIdx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRes = await client.query(`SELECT COUNT(*) AS total FROM conversations c ${whereClause}`, params);
  const total = parseInt(countRes.rows[0].total, 10);

  const limitIdx = paramIdx++;
  const offsetIdx = paramIdx++;
  const dataRes = await client.query(`
    SELECT c.* FROM conversations c
    ${whereClause}
    ORDER BY c.last_message_at DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `, [...params, limit, offset]);

  return { data: dataRes.rows, total, page, limit };
}

async function getConversation(id) {
  const client = getDb();
  const convRes = await client.query('SELECT * FROM conversations WHERE id = $1', [id]);
  const msgsRes = await client.query('SELECT * FROM requests WHERE conversation_id = $1 ORDER BY created_at ASC', [id]);

  return { conversation: convRes.rows[0], messages: msgsRes.rows };
}

// ---------------------------------------------------------------------------
// Model helpers
// ---------------------------------------------------------------------------

async function getModels() {
  const client = getDb();
  const res = await client.query('SELECT * FROM models ORDER BY name ASC');
  return res.rows;
}

async function updateModelPricing(id, pricing) {
  const client = getDb();

  const fields = [];
  const params = [id];
  let paramIdx = 2;

  if (pricing.input_cost_per_million != null) {
    fields.push(`input_cost_per_million = $${paramIdx++}`);
    params.push(parseFloat(pricing.input_cost_per_million));
  }
  if (pricing.output_cost_per_million != null) {
    fields.push(`output_cost_per_million = $${paramIdx++}`);
    params.push(parseFloat(pricing.output_cost_per_million));
  }

  if (fields.length === 0) {
    return { changes: 0 };
  }

  const res = await client.query(`UPDATE models SET ${fields.join(', ')} WHERE id = $1`, params);
  return { changes: res.rowCount };
}

async function recalculateCosts() {
  const client = getDb();
  
  const res = await client.query(`
    UPDATE requests
    SET estimated_cost = ROUND(
      (prompt_tokens * (SELECT input_cost_per_million FROM models WHERE models.id = requests.model) / 1000000.0) +
      (completion_tokens * (SELECT output_cost_per_million FROM models WHERE models.id = requests.model) / 1000000.0),
      6
    )
    WHERE model IN (SELECT id FROM models)
  `);

  try {
    await client.query(`
      UPDATE conversations
      SET total_cost = COALESCE((
        SELECT SUM(estimated_cost)
        FROM requests
        WHERE requests.conversation_id = conversations.id
      ), 0)
    `);
  } catch (err) {
    console.error('[db/postgres] Error updating conversation costs during recalculation:', err.message);
  }

  return { changes: res.rowCount };
}

async function insertModel(model) {
  const client = getDb();
  const res = await client.query(`
    INSERT INTO models (id, name, display_name, provider, input_cost_per_million, output_cost_per_million, context_window)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [
    model.id,
    model.name || model.id,
    model.display_name || null,
    model.provider || 'deepinfra',
    model.input_cost_per_million || 0,
    model.output_cost_per_million || 0,
    model.context_window || null
  ]);
  return { changes: res.rowCount };
}

async function updateDailyStats(date, model, data) {
  const client = getDb();

  const res = await client.query(`
    INSERT INTO daily_stats (
      date, model,
      total_requests, total_tokens, total_prompt_tokens, total_completion_tokens,
      total_cost, avg_latency_ms, error_count
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9
    )
    ON CONFLICT(date, model) DO UPDATE SET
      total_requests = EXCLUDED.total_requests,
      total_tokens = EXCLUDED.total_tokens,
      total_prompt_tokens = EXCLUDED.total_prompt_tokens,
      total_completion_tokens = EXCLUDED.total_completion_tokens,
      total_cost = EXCLUDED.total_cost,
      avg_latency_ms = EXCLUDED.avg_latency_ms,
      error_count = EXCLUDED.error_count
  `, [
    date,
    model,
    data.total_requests || 0,
    data.total_tokens || 0,
    data.total_prompt_tokens || 0,
    data.total_completion_tokens || 0,
    data.total_cost || 0,
    data.avg_latency_ms || 0,
    data.error_count || 0
  ]);

  return { changes: res.rowCount };
}

async function getUserStats(dateRange = {}) {
  const client = getDb();
  const { startDate, endDate } = _defaultDateRange(dateRange.startDate, dateRange.endDate);

  const res = await client.query(`
    SELECT
      COALESCE(user_id, 'anonymous') AS userId,
      COUNT(*)::int AS requests,
      COALESCE(SUM(estimated_cost), 0)::double precision AS cost,
      COALESCE(SUM(total_tokens), 0)::int AS tokens
    FROM requests
    WHERE created_at >= $1 AND created_at <= $2
    GROUP BY user_id
    ORDER BY cost DESC
  `, [startDate, endDate]);

  return { data: res.rows };
}

// ---------------------------------------------------------------------------
// Prompt helpers
// ---------------------------------------------------------------------------

async function getPrompts() {
  const client = getDb();
  const res = await client.query(`
    SELECT p1.* 
    FROM prompts p1
    INNER JOIN (
      SELECT name, MAX(version) AS max_version
      FROM prompts
      GROUP BY name
    ) p2 ON p1.name = p2.name AND p1.version = p2.max_version
    ORDER BY p1.name ASC
  `);
  return res.rows;
}

async function getPromptByName(name) {
  const client = getDb();
  const res = await client.query(`
    SELECT * FROM prompts
    WHERE name = $1
    ORDER BY version DESC
    LIMIT 1
  `, [name]);
  return res.rows[0] || null;
}

async function getPromptHistory(name) {
  const client = getDb();
  const res = await client.query(`
    SELECT * FROM prompts
    WHERE name = $1
    ORDER BY version DESC
  `, [name]);
  return res.rows;
}

async function insertPrompt(data) {
  const client = getDb();
  
  const latest = await getPromptByName(data.name);
  const nextVersion = latest ? latest.version + 1 : 1;

  const variablesJson = Array.isArray(data.variables) 
    ? JSON.stringify(data.variables) 
    : (data.variables || '[]');

  const res = await client.query(`
    INSERT INTO prompts (name, version, system_prompt, user_template, variables)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `, [data.name, nextVersion, data.system_prompt || '', data.user_template || '', variablesJson]);
  
  return {
    id: res.rows[0].id,
    name: data.name,
    version: nextVersion,
    system_prompt: data.system_prompt,
    user_template: data.user_template,
    variables: variablesJson
  };
}

async function deletePromptByName(name) {
  const client = getDb();
  const res = await client.query('DELETE FROM prompts WHERE name = $1', [name]);
  return res.rowCount > 0;
}

// ---------------------------------------------------------------------------
// Feedback & Evaluation helpers
// ---------------------------------------------------------------------------

async function updateFeedback(id, feedback) {
  const client = getDb();
  const feedbackJson = feedback ? JSON.stringify(feedback) : null;
  const res = await client.query('UPDATE requests SET feedback = $1 WHERE id = $2', [feedbackJson, id]);

  if (feedback && feedback.expected_answer) {
    const reqRes = await client.query('SELECT output_message, evaluation FROM requests WHERE id = $1', [id]);
    const request = reqRes.rows[0];
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
          await client.query('UPDATE requests SET evaluation = $1 WHERE id = $2', [JSON.stringify(evalObj), id]);
        }
      } catch (err) {
        console.error('[db/postgres] Error updating NLP metrics:', err.message);
      }
    }
  }

  return res.rowCount > 0;
}

async function updateEvaluation(id, evaluation) {
  const client = getDb();
  const evalJson = evaluation ? JSON.stringify(evaluation) : null;
  const res = await client.query('UPDATE requests SET evaluation = $1 WHERE id = $2', [evalJson, id]);
  return res.rowCount > 0;
}

async function calculateAgentMetrics(traceId) {
  if (!traceId) return;
  const client = getDb();
  const res = await client.query('SELECT id, span_id, parent_span_id, span_type, status FROM requests WHERE trace_id = $1', [traceId]);
  const spans = res.rows;
  if (spans.length === 0) return;

  const rootSpan = spans.find(s => s.parent_span_id === 'root' || !s.parent_span_id || s.span_type === 'agent') || spans[0];
  if (!rootSpan) return;

  const toolSpans = spans.filter(s => s.span_type === 'tool');
  const totalTools = toolSpans.length;
  const successfulTools = toolSpans.filter(s => s.status === 'success').length;
  const toolSuccessRate = totalTools > 0 ? successfulTools / totalTools : 1.0;

  const iterationCount = spans.length;
  const goalCompletion = rootSpan.status === 'success' ? 1.0 : 0.0;
  const planningAccuracy = totalTools > 0 ? toolSuccessRate : (spans.every(s => s.status === 'success') ? 1.0 : 0.5);
  const toolSelectionAccuracy = totalTools > 0 ? toolSuccessRate : 1.0;

  const rootReqRes = await client.query('SELECT evaluation FROM requests WHERE id = $1', [rootSpan.id]);
  const rootRequest = rootReqRes.rows[0];
  let evalObj = {};
  try {
    evalObj = rootRequest && rootRequest.evaluation ? JSON.parse(rootRequest.evaluation) : {};
  } catch (e) {
    evalObj = {};
  }

  evalObj.tool_success_rate = toolSuccessRate;
  evalObj.iteration_count = iterationCount;
  evalObj.goal_completion_rate = goalCompletion;
  evalObj.planning_accuracy = planningAccuracy;
  evalObj.tool_selection_accuracy = toolSelectionAccuracy;

  await client.query('UPDATE requests SET evaluation = $1 WHERE id = $2', [JSON.stringify(evalObj), rootSpan.id]);
}

async function getEvaluationAnalytics(dateRange = {}) {
  const client = getDb();
  const { startDate, endDate } = _defaultDateRange(dateRange.startDate, dateRange.endDate);

  const res = await client.query(`
    SELECT 
      id, status, latency_ms, prompt_tokens, completion_tokens, total_tokens, estimated_cost,
      feedback, evaluation, created_at, span_type, parent_span_id, trace_id
    FROM requests
    WHERE created_at >= $1 AND created_at <= $2
  `, [startDate, endDate]);

  const requests = res.rows;

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

async function getSetting(key) {
  const client = getDb();
  try {
    const res = await client.query('SELECT value FROM settings WHERE key = $1', [key]);
    return res.rows[0] ? res.rows[0].value : null;
  } catch (err) {
    console.error('[db/postgres] Error getting setting:', err.message);
    return null;
  }
}

async function setSetting(key, value) {
  const client = getDb();
  try {
    await client.query(`
      INSERT INTO settings (key, value)
      VALUES ($1, $2)
      ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value
    `, [key, value]);
    return true;
  } catch (err) {
    console.error('[db/postgres] Error setting setting:', err.message);
    return false;
  }
}

async function getTraces(filters = {}) {
  const client = getDb();
  
  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(filters.limit, 10) || 20));
  const offset = (page - 1) * limit;
  
  const startDate = filters.startDate;
  const endDate = filters.endDate;
  
  const conditions = ['trace_id IS NOT NULL', "trace_id != ''"];
  const params = [];
  let paramIdx = 1;
  
  if (startDate) {
    conditions.push(`created_at >= $${paramIdx++}`);
    params.push(startDate);
  }
  if (endDate) {
    conditions.push(`created_at <= $${paramIdx++}`);
    params.push(endDate);
  }
  
  const whereClause = `WHERE ${conditions.join(' AND ')}`;
  
  const countRes = await client.query(`
    SELECT COUNT(DISTINCT trace_id) AS total 
    FROM requests 
    ${whereClause}
  `, params);
  const total = parseInt(countRes.rows[0].total, 10);
  
  const limitIdx = paramIdx++;
  const offsetIdx = paramIdx++;
  
  const queryStr = `
    SELECT
      trace_id,
      MIN(created_at) AS first_span_at,
      MAX(created_at) AS last_span_at,
      COUNT(*)::int AS total_spans,
      SUM(latency_ms)::int AS total_latency_ms,
      SUM(estimated_cost)::double precision AS total_cost,
      SUM(total_tokens)::int AS total_tokens,
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
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;
  
  const res = await client.query(queryStr, [...params, limit, offset]);
  
  return {
    data: res.rows,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  };
}

async function getTraceSpans(traceId) {
  const client = getDb();
  const res = await client.query(`
    SELECT * FROM requests 
    WHERE trace_id = $1 
    ORDER BY created_at ASC
  `, [traceId]);
  return res.rows;
}

async function getToolSpansForTrace(traceId) {
  const client = getDb();
  const res = await client.query(`
    SELECT output_message, raw_response FROM requests 
    WHERE trace_id = $1 AND span_type = 'tool'
  `, [traceId]);
  return res.rows;
}

async function getRequestBySpanId(spanId) {
  const client = getDb();
  const res = await client.query('SELECT * FROM requests WHERE span_id = $1', [spanId]);
  return res.rows[0] || null;
}

async function clearAllLogs() {
  const client = getDb();
  await client.query('BEGIN');
  try {
    await client.query('DELETE FROM requests');
    await client.query('DELETE FROM conversations');
    await client.query('DELETE FROM daily_stats');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function updateTags(id, tags) {
  const client = getDb();
  const tagsJson = Array.isArray(tags) ? JSON.stringify(tags) : tags;
  await client.query('UPDATE requests SET tags = $1 WHERE id = $2', [tagsJson, id]);
}

async function updateStatus(id, status) {
  const client = getDb();
  await client.query('UPDATE requests SET status = $1 WHERE id = $2', [status, id]);
}

async function getSubsequentSpans(traceId, createdAt) {
  const client = getDb();
  const res = await client.query('SELECT * FROM requests WHERE trace_id = $1 AND created_at > $2', [traceId, createdAt]);
  return res.rows;
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
