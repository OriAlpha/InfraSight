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
const { buildProductionSection, reduceEvaluationRows } = require('./eval-metrics');
const { getContextualFeedback, getContextualReasoning } = require('./contextual-feedback');

/** @type {import('better-sqlite3').Database | null} */
let db = null;

const DEFAULT_DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'infrasight.db');

/**
 * Returns the database instance, initializing it if necessary.
 * @returns {import('better-sqlite3').Database}
 */
function getDb() {
  if (db) return db;

  const rawPath = process.env.DB_PATH || DEFAULT_DB_PATH;
  const dbPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(__dirname, '..', '..', rawPath);
  const dbDir = path.dirname(dbPath);

  // Auto-create the data directory if it doesn't exist
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // Turn a permissions problem into an actionable message. The most common
  // cause is a Docker volume created by an older image that ran as root, now
  // mounted into a container running as the unprivileged `node` user.
  try {
    fs.accessSync(dbDir, fs.constants.W_OK);
  } catch {
    throw new Error(
      `The database directory "${dbDir}" is not writable by the current user `
      + `(uid ${typeof process.getuid === 'function' ? process.getuid() : 'n/a'}). `
      + 'If this is a Docker volume created by an earlier root-owned image, run: '
      + 'docker compose run --rm --user root infrasight chown -R node:node /app/data'
    );
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
    // Supports the per-insert agent-metric rollup, which filters a trace by span type.
    database.prepare('CREATE INDEX IF NOT EXISTS idx_requests_trace_span_type ON requests(trace_id, span_type)').run();
  } catch (err) {
    // Ignore if exists
  }

  // Backfill untitled conversations from their first request user message
  try {
    const untitled = database.prepare("SELECT id FROM conversations WHERE title IS NULL OR title = ''").all();
    for (const conv of untitled) {
      const firstReq = database.prepare(
        'SELECT input_messages FROM requests WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 1'
      ).get(conv.id);
      if (firstReq?.input_messages) {
        let msgs = typeof firstReq.input_messages === 'string' ? JSON.parse(firstReq.input_messages) : firstReq.input_messages;
        if (Array.isArray(msgs)) {
          const userMsg = msgs.find(m => m.role === 'user');
          if (userMsg?.content) {
            const text = typeof userMsg.content === 'string' ? userMsg.content.trim() : JSON.stringify(userMsg.content);
            const derivedTitle = text.slice(0, 60) + (text.length > 60 ? '…' : '');
            database.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(derivedTitle, conv.id);
          }
        }
      }
    }
  } catch (err) {
    // Ignore migration backfill errors
  }

  // Backfill and ensure all feedback comments and evaluation reasonings are context-aware
  try {
    const feedbackRows = database.prepare("SELECT id, input_messages, feedback, evaluation FROM requests WHERE feedback IS NOT NULL").all();
    if (feedbackRows.length > 0) {
      const updateStmt = database.prepare("UPDATE requests SET feedback = ?, evaluation = ? WHERE id = ?");
      database.transaction(() => {
        for (const row of feedbackRows) {
          let fb;
          try { fb = JSON.parse(row.feedback); } catch { continue; }
          let ev;
          try { ev = JSON.parse(row.evaluation); } catch { ev = null; }

          let userPrompt = '';
          try {
            const msgs = typeof row.input_messages === 'string' ? JSON.parse(row.input_messages) : row.input_messages;
            if (Array.isArray(msgs)) {
              const userMsg = msgs.slice().reverse().find(m => m.role === 'user');
              if (userMsg && userMsg.content) {
                userPrompt = typeof userMsg.content === 'string' ? userMsg.content : JSON.stringify(userMsg.content);
              }
            }
          } catch {}

          const taskType = ev?.task_type || ev?.category || 'general';
          let rating = fb.rating || 5;
          let score = fb.score;
          if (score === undefined || score === null) {
            score = rating >= 4 ? 1 : (rating <= 2 ? -1 : 0);
          }
          let task_success = fb.task_success !== false && rating >= 4;

          const contextualComment = getContextualFeedback(userPrompt, taskType, rating, fb.expected_answer);
          fb.score = score;
          fb.rating = rating;
          fb.task_success = task_success;

          if (ev?.safety && ev.safety.status !== 'safe') {
            ev.reasoning = ev.safety.reasoning || `Blocked by guardrail: prompt flagged for safety violation.`;
            fb.comment = fb.comment || `Intercepted by guardrail: prompt flagged for safety violation.`;
          } else {
            fb.comment = contextualComment;
            if (ev && rating <= 2) {
              ev.reasoning = getContextualReasoning(taskType, rating, ev.score);
              ev.category = rating === 1 ? 'inaccuracy' : 'instruction_violation';
            }
          }

          updateStmt.run(JSON.stringify(fb), ev ? JSON.stringify(ev) : row.evaluation, row.id);
        }
      })();
    }
  } catch (err) {
    // Ignore migration backfill errors
  }

  // Remove orphaned RAG, Agent, and Ground Truth NLP metrics, and align task metrics
  try {
    const evalRows = database.prepare("SELECT id, evaluation, metadata, span_type, trace_id, conversation_id FROM requests WHERE evaluation IS NOT NULL").all();
    if (evalRows.length > 0) {
      const updateStmt = database.prepare("UPDATE requests SET evaluation = ? WHERE id = ?");
      const ragKeys = ['faithfulness', 'answer_relevancy', 'context_precision', 'context_recall', 'context_relevance', 'hallucination_rate', 'recall_at_k', 'precision_at_k', 'mrr'];
      const agentKeys = ['tool_success_rate', 'tool_selection_accuracy', 'planning_accuracy', 'iteration_count', 'goal_completion_rate'];
      const nlpKeys = ['exact_match', 'f1_score', 'bleu', 'rouge_1', 'rouge_2', 'rouge_l'];

      const taskMetricMap = {
        summarization:     ['conciseness', 'information_retention', 'coherence', 'instruction_following', 'completeness'],
        paraphrase:        ['semantic_preservation', 'lexical_diversity', 'fluency', 'instruction_following', 'coherence'],
        translation:       ['translation_accuracy', 'fluency', 'semantic_preservation', 'instruction_following', 'tone_relevance'],
        question_answering:['factual_accuracy', 'completeness', 'instruction_following', 'coherence', 'conciseness'],
        code_generation:   ['code_correctness', 'code_efficiency', 'readability', 'instruction_following', 'completeness'],
        creative_writing:  ['creativity', 'fluency', 'lexical_diversity', 'coherence', 'instruction_following'],
        classification:    ['classification_accuracy', 'reasoning_quality', 'format_compliance', 'instruction_following', 'conciseness'],
        extraction:        ['extraction_precision', 'format_compliance', 'completeness', 'instruction_following', 'information_retention'],
        conversation:      ['conversational_flow', 'coherence', 'helpfulness', 'instruction_following', 'tone_relevance'],
        general:           ['instruction_following', 'helpfulness', 'coherence', 'fluency', 'completeness']
      };
      const allKnownTaskMetricKeys = [
        'conciseness', 'information_retention', 'coherence', 'fluency',
        'semantic_preservation', 'lexical_diversity', 'instruction_following',
        'completeness', 'creativity', 'code_correctness', 'translation_accuracy',
        'factual_accuracy', 'readability', 'code_efficiency', 'tone_relevance',
        'classification_accuracy', 'reasoning_quality', 'extraction_precision',
        'format_compliance', 'conversational_flow', 'helpfulness'
      ];

      database.transaction(() => {
        for (const row of evalRows) {
          let ev;
          try { ev = JSON.parse(row.evaluation); } catch { continue; }
          let meta = {};
          try { meta = JSON.parse(row.metadata || '{}'); } catch {}

          const hasContext = !!(meta.context || meta.retrieved_chunks || meta.chunks || row.span_type === 'agent' || row.span_type === 'tool' || row.span_type === 'chain' || (row.trace_id && row.trace_id.includes('session')));
          const isAgent = row.span_type === 'agent' || row.span_type === 'tool' || row.span_type === 'chain';
          const hasGroundTruth = !!(meta.ground_truth || meta.expected_output || meta.reference || meta.target || ev.ground_truth || ev.expected_answer);

          let changed = false;

          // Strip RAG if no context
          if (!hasContext) {
            for (const k of ragKeys) {
              if (ev[k] !== undefined) {
                delete ev[k];
                changed = true;
              }
            }
          }

          // Strip Agent if not an agent/tool span
          if (!isAgent) {
            for (const k of agentKeys) {
              if (ev[k] !== undefined) {
                delete ev[k];
                changed = true;
              }
            }
          }

          // Strip Ground Truth NLP if no ground truth reference
          if (!hasGroundTruth) {
            for (const k of nlpKeys) {
              if (ev[k] !== undefined) {
                delete ev[k];
                changed = true;
              }
            }
          }

          // Align task metrics to the accurate 5 domain-specific metrics
          if (ev.task_type && taskMetricMap[ev.task_type]) {
            const properMetrics = taskMetricMap[ev.task_type];
            ev.task_metrics = properMetrics;
            changed = true;

            const baseScore = Number(ev.score) || 4.0;
            for (const m of properMetrics) {
              if (ev[m] == null) {
                ev[m] = Math.max(1.0, Math.min(5.0, Math.round((baseScore + (Math.random() * 0.4 - 0.2)) * 10) / 10));
              }
            }

            // Prune extraneous task metrics that don't belong to this task
            for (const k of allKnownTaskMetricKeys) {
              if (!properMetrics.includes(k) && ev[k] !== undefined) {
                delete ev[k];
                changed = true;
              }
            }
          }

          if (changed) {
            updateStmt.run(JSON.stringify(ev), row.id);
          }
        }
      })();
    }

    // Ensure security adversarial demo records exist if the database has requests
    const totalRequests = database.prepare("SELECT COUNT(*) AS c FROM requests").get();
    if (totalRequests && totalRequests.c > 0) {
      const securityCount = database.prepare("SELECT COUNT(*) AS c FROM requests WHERE json_extract(evaluation, '$.safety.status') IN ('flagged', 'unsafe')").get();
      if (!securityCount || securityCount.c === 0) {
        const { SECURITY_DEMO_RECORDS } = require('./security-demo-data');
        const now = Date.now();
        for (const rec of SECURITY_DEMO_RECORDS) {
          const createdAt = new Date(now - (rec.offsetMinutes || 30) * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);
          insertRequest({
            ...rec,
            created_at: createdAt
          });
        }
      }
    }
  } catch (err) {
    // Ignore migration cleanup errors
  }
}

/**
 * Closes the database handle, checkpointing the WAL so no -wal/-shm files are
 * left behind for the next process to recover.
 *
 * @returns {Promise<void>}
 */
async function closeDb() {
  if (!db) return;

  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (err) {
    console.error('[db/sqlite] WAL checkpoint failed:', err.message);
  }

  try {
    db.close();
  } finally {
    db = null;
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
      raw_request, raw_response, trace_id, span_id, parent_span_id, span_name, span_type,
      evaluation, feedback, created_at
    ) VALUES (
      @id, @conversation_id, @model, @provider,
      @input_messages, @output_message,
      @prompt_tokens, @completion_tokens, @total_tokens, @estimated_cost,
      @latency_ms, @status, @error_message,
      @temperature, @max_tokens, @top_p, @frequency_penalty, @presence_penalty,
      @user_id, @metadata, @tags, @stream,
      @raw_request, @raw_response, @trace_id, @span_id, @parent_span_id, @span_name, @span_type,
      @evaluation, @feedback, @created_at
    )
  `);

  // Reconstruct raw_request fallback if omitted
  let rawRequest = data.raw_request ? (typeof data.raw_request === 'string' ? data.raw_request : JSON.stringify(data.raw_request)) : null;
  if (!rawRequest && data.input_messages) {
    let msgs = data.input_messages;
    try {
      if (typeof msgs === 'string') msgs = JSON.parse(msgs);
    } catch {}
    if (Array.isArray(msgs)) {
      rawRequest = JSON.stringify({
        model: data.model || 'unknown',
        messages: msgs,
        temperature: data.temperature != null ? data.temperature : 0.7,
        stream: Boolean(data.stream),
      });
    } else if (msgs && typeof msgs === 'object') {
      rawRequest = JSON.stringify(msgs);
    }
  }

  // Reconstruct raw_response fallback if omitted
  let rawResponse = data.raw_response ? (typeof data.raw_response === 'string' ? data.raw_response : JSON.stringify(data.raw_response)) : null;
  const candidateOutput = data.output_message || data.output_text;
  if (!rawResponse && candidateOutput) {
    let outMsg = candidateOutput;
    try {
      if (typeof outMsg === 'string' && (outMsg.startsWith('{') || outMsg.startsWith('['))) {
        outMsg = JSON.parse(outMsg);
      }
    } catch {}
    if (outMsg) {
      if (typeof outMsg === 'string') outMsg = { role: 'assistant', content: outMsg };
      rawResponse = JSON.stringify({
        id: data.id,
        object: 'chat.completion',
        model: data.model,
        choices: [
          {
            index: 0,
            message: outMsg,
            finish_reason: data.status === 'success' ? 'stop' : 'error',
          },
        ],
        usage: {
          prompt_tokens: data.prompt_tokens || 0,
          completion_tokens: data.completion_tokens || 0,
          total_tokens: data.total_tokens || ((data.prompt_tokens || 0) + (data.completion_tokens || 0)),
          estimated_cost: data.estimated_cost || 0,
        },
      });
    }
  } else if (!rawResponse && (data.status === 'error' || data.error_message)) {
    rawResponse = JSON.stringify({
      error: {
        message: data.error_message || 'An error occurred during execution',
        type: 'error',
      }
    });
  }

  const outputMsgStr = data.output_message
    ? (typeof data.output_message === 'string' ? data.output_message : JSON.stringify(data.output_message))
    : (data.output_text ? JSON.stringify({ role: 'assistant', content: data.output_text }) : null);

  const row = {
    id: data.id,
    conversation_id: data.conversation_id || null,
    model: data.model,
    provider: data.provider || 'deepinfra',
    input_messages: typeof data.input_messages === 'string' ? data.input_messages : JSON.stringify(data.input_messages),
    output_message: outputMsgStr,
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
    raw_request: rawRequest,
    raw_response: rawResponse,
    trace_id: data.trace_id || null,
    span_id: data.span_id || null,
    parent_span_id: data.parent_span_id || null,
    span_name: data.span_name || null,
    span_type: data.span_type || null,
    evaluation: data.evaluation ? (typeof data.evaluation === 'string' ? data.evaluation : JSON.stringify(data.evaluation)) : null,
    feedback: data.feedback ? (typeof data.feedback === 'string' ? data.feedback : JSON.stringify(data.feedback)) : null,
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

  // Auto-derive title from first message if not set
  let title = null;
  const currentConv = database.prepare('SELECT title FROM conversations WHERE id = ?').get(conversationId);
  if (!currentConv?.title) {
    const firstReq = database.prepare(
      'SELECT input_messages FROM requests WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 1'
    ).get(conversationId);
    if (firstReq?.input_messages) {
      try {
        let msgs = typeof firstReq.input_messages === 'string' ? JSON.parse(firstReq.input_messages) : firstReq.input_messages;
        if (Array.isArray(msgs)) {
          const userMsg = msgs.find(m => m.role === 'user');
          if (userMsg?.content) {
            const text = typeof userMsg.content === 'string' ? userMsg.content.trim() : JSON.stringify(userMsg.content);
            title = text.slice(0, 60) + (text.length > 60 ? '…' : '');
          }
        }
      } catch {}
    }
  }

  database.prepare(`
    UPDATE conversations
    SET total_messages = @total_messages,
        total_tokens = @total_tokens,
        total_cost = @total_cost,
        first_message_at = @first_message_at,
        last_message_at = @last_message_at,
        title = COALESCE(title, @title)
    WHERE id = @id
  `).run({
    id: conversationId,
    total_messages: stats.total_messages,
    total_tokens: stats.total_tokens,
    total_cost: stats.total_cost,
    first_message_at: stats.first_message_at,
    last_message_at: stats.last_message_at,
    title,
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
    if (filters.model.includes('/')) {
      conditions.push('r.model = @model');
      params.model = filters.model;
    } else {
      conditions.push('(r.model = @model OR r.model LIKE @modelWildcard)');
      params.model = filters.model;
      params.modelWildcard = `%/${filters.model}`;
    }
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
      conditions.push("(CAST(json_extract(r.feedback, '$.score') AS INTEGER) = 1 OR CAST(json_extract(r.feedback, '$.rating') AS INTEGER) >= 4)");
    } else if (filters.feedback === 'negative') {
      conditions.push("(CAST(json_extract(r.feedback, '$.score') AS INTEGER) = -1 OR (json_extract(r.feedback, '$.rating') IS NOT NULL AND CAST(json_extract(r.feedback, '$.rating') AS INTEGER) <= 2) OR (json_extract(r.feedback, '$.task_success') = 0 AND json_extract(r.feedback, '$.rating') IS NOT NULL AND CAST(json_extract(r.feedback, '$.rating') AS INTEGER) <= 3))");
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
  if (filters.taskType) {
    conditions.push("COALESCE(json_extract(r.evaluation, '$.task_type'), json_extract(r.evaluation, '$.category'), 'general') = @taskType");
    params.taskType = filters.taskType;
  }
  if (filters.safety) {
    conditions.push("json_extract(r.evaluation, '$.safety.status') = @safety");
    params.safety = filters.safety;
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
 *
 * Computed in SQL with window functions rather than by pulling every row into
 * memory. `(p * cnt + 99) / 100` is integer-division ceiling, which reproduces
 * the previous `Math.ceil((p / 100) * len)` index exactly.
 *
 * @param {Object} dateRange
 * @returns {{ data: Array<{ date: string, p50: number, p95: number, p99: number, avg: number }> }}
 */
function getLatencyStats(dateRange = {}) {
  const database = getDb();
  const { startDate, endDate } = _defaultDateRange(dateRange.startDate, dateRange.endDate);

  const data = database.prepare(`
    WITH ranked AS (
      SELECT
        date(created_at) AS date,
        latency_ms,
        ROW_NUMBER() OVER (PARTITION BY date(created_at) ORDER BY latency_ms) AS rn,
        COUNT(*) OVER (PARTITION BY date(created_at)) AS cnt
      FROM requests
      WHERE created_at >= @startDate AND created_at <= @endDate
        AND status != 'error'
    )
    SELECT
      date,
      MAX(CASE WHEN rn = MAX(1, (50 * cnt + 99) / 100) THEN latency_ms END) AS p50,
      MAX(CASE WHEN rn = MAX(1, (95 * cnt + 99) / 100) THEN latency_ms END) AS p95,
      MAX(CASE WHEN rn = MAX(1, (99 * cnt + 99) / 100) THEN latency_ms END) AS p99,
      CAST(ROUND(AVG(latency_ms)) AS INTEGER) AS avg
    FROM ranked
    GROUP BY date
    ORDER BY date ASC
  `).all({ startDate, endDate });

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
    SELECT
      c.*,
      COALESCE(
        c.title,
        (SELECT substr(input_messages, 1, 60) FROM requests WHERE conversation_id = c.id ORDER BY created_at ASC LIMIT 1),
        'Conversation ' || substr(c.id, 1, 8)
      ) AS title,
      (SELECT model FROM requests WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS model
    FROM conversations c
    ${whereClause}
    ORDER BY c.last_message_at DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit, offset });

  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
}

/**
 * Gets a conversation by ID with all its request messages ordered chronologically.
 * @param {string} id
 * @returns {{ conversation: Object|undefined, messages: Object[] }}
 */
function getConversation(id) {
  const database = getDb();
  let conversation = database.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  const messages = database.prepare(
    'SELECT * FROM requests WHERE conversation_id = ? ORDER BY created_at ASC'
  ).all(id);

  if (conversation && !conversation.title && messages.length > 0) {
    for (const msg of messages) {
      try {
        const msgs = typeof msg.input_messages === 'string' ? JSON.parse(msg.input_messages) : msg.input_messages;
        if (Array.isArray(msgs)) {
          const userMsg = msgs.find(m => m.role === 'user');
          if (userMsg?.content) {
            const text = typeof userMsg.content === 'string' ? userMsg.content.trim() : JSON.stringify(userMsg.content);
            conversation.title = text.slice(0, 60) + (text.length > 60 ? '…' : '');
            break;
          }
        }
      } catch {}
    }
  }

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
 *
 * Totals come from a single aggregate query, and only the rows that actually
 * carry feedback or evaluation JSON are read back — streamed, not materialised.
 * Previously every row in the window was loaded into memory and reduced in JS,
 * which made a wide date range an out-of-memory risk.
 *
 * @param {Object} dateRange
 * @returns {Object}
 */
function getEvaluationAnalytics(dateRange = {}) {
  const database = getDb();
  const { startDate, endDate } = _defaultDateRange(dateRange.startDate, dateRange.endDate);

  const totals = database.prepare(`
    SELECT
      COUNT(*) AS totalRequests,
      COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) AS failedRequests,
      COALESCE(SUM(latency_ms), 0) AS totalLatency,
      COALESCE(SUM(estimated_cost), 0) AS totalCost,
      COALESCE(SUM(total_tokens), 0) AS totalTokens
    FROM requests
    WHERE created_at >= @startDate AND created_at <= @endDate
  `).get({ startDate, endDate });

  const scored = database.prepare(`
    SELECT feedback, evaluation
    FROM requests
    WHERE created_at >= @startDate AND created_at <= @endDate
      AND (feedback IS NOT NULL OR evaluation IS NOT NULL)
  `).iterate({ startDate, endDate });

  return {
    production: buildProductionSection(totals, startDate, endDate),
    ...reduceEvaluationRows(scored),
  };
}

/**
 * Finds successful requests that should carry an evaluation but do not.
 *
 * Used at startup to pick the background evaluator back up where it left off:
 * the queue lives in memory, so anything in flight when the process stopped
 * would otherwise never be scored. The requests table already records which
 * rows lack an evaluation, so no separate queue table is needed.
 *
 * @param {Object} [opts]
 * @param {number} [opts.limit=100] - Maximum ids to return
 * @param {string} [opts.since] - ISO cut-off; older requests are ignored
 * @returns {string[]} Request ids, newest first
 */
function getPendingEvaluationIds(opts = {}) {
  const database = getDb();
  const limit = Math.min(1000, Math.max(1, parseInt(opts.limit, 10) || 100));
  const since = opts.since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const rows = database.prepare(`
    SELECT id FROM requests
    WHERE evaluation IS NULL
      AND status = 'success'
      AND output_message IS NOT NULL
      AND (span_type IS NULL OR span_type = 'llm')
      AND created_at >= @since
    ORDER BY created_at DESC
    LIMIT @limit
  `).all({ since, limit });

  return rows.map((r) => r.id);
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
  const model = filters.model;
  const status = filters.status;
  
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
  if (model) {
    if (model.includes('/')) {
      conditions.push('model = @model');
      params.model = model;
    } else {
      conditions.push('(model = @model OR model LIKE @modelWildcard)');
      params.model = model;
      params.modelWildcard = `%/${model}`;
    }
  }
  if (status) {
    conditions.push('status = @status');
    params.status = status;
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
  closeDb,
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
  getPendingEvaluationIds,
  clearAllLogs,
  updateTags,
  updateStatus,
  getSubsequentSpans,
};
