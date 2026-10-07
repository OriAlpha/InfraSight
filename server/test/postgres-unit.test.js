'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');

const originalQuery = Pool.prototype.query;
const originalEnd = Pool.prototype.end;

const executedQueries = [];

beforeEachPg();

function beforeEachPg() {
  executedQueries.length = 0;
  Pool.prototype.end = async () => {};
  Pool.prototype.query = async (sql, params) => {
    executedQueries.push({ sql, params });

    const rawSql = typeof sql === 'string' ? sql : (sql?.text || '');
    const sqlStr = rawSql.replace(/\s+/g, ' ');

    // Conversation child stats
    if (sqlStr.includes('FROM requests WHERE conversation_id = $1')) {
      return {
        rows: [{
          total_messages: 2,
          total_tokens: 100,
          total_cost: 0.001,
          first_message_at: '2026-10-07T00:00:00Z',
          last_message_at: '2026-10-07T01:00:00Z',
        }],
        rowCount: 1,
      };
    }

    // 1. Settings
    if (sqlStr.includes('FROM settings WHERE key = $1')) {
      return { rows: [{ value: 'pg-test-val' }], rowCount: 1 };
    }
    if (sqlStr.includes('INSERT INTO settings')) {
      return { rows: [], rowCount: 1 };
    }

    // 2. Models
    if (sqlStr.includes('FROM models WHERE id = $1')) {
      return { rows: [{ id: 'pg-model-1', name: 'PG Model 1', input_cost_per_million: 1.0, output_cost_per_million: 2.0 }], rowCount: 1 };
    }
    if (sqlStr.includes('FROM models ORDER BY')) {
      return { rows: [{ id: 'pg-model-1', name: 'PG Model 1', input_cost_per_million: 1.0, output_cost_per_million: 2.0 }], rowCount: 1 };
    }
    if (sqlStr.includes('UPDATE models SET') || sqlStr.includes('INSERT INTO models')) {
      return { rows: [], rowCount: 1 };
    }

    // 3. Prompts
    if (sqlStr.includes('FROM prompts WHERE name = $1')) {
      return { rows: [{ id: 1, name: 'prompt-1', version: 1, system_prompt: 'Be helpful', user_template: 'Hi {{name}}', variables: '["name"]' }], rowCount: 1 };
    }
    if (sqlStr.includes('INSERT INTO prompts')) {
      return { rows: [{ id: 2, name: 'prompt-1', version: 2 }], rowCount: 1 };
    }
    if (sqlStr.includes('DELETE FROM prompts')) {
      return { rows: [], rowCount: 1 };
    }

    // 4. Analytics Overview
    if (sqlStr.includes('totalrequests')) {
      return {
        rows: [{
          totalrequests: 10,
          totalcost: 0.05,
          avglatency: 120,
          errorcount: 1,
          totaltokens: 500,
          totalprompttokens: 200,
          totalcompletiontokens: 300,
        }],
        rowCount: 1,
      };
    }

    // 5. Cost Over Time, Token Usage, Model Usage, Error Stats, User Stats
    if (sqlStr.includes('GROUP BY') && sqlStr.includes('date')) {
      return {
        rows: [{
          date: '2026-10-07',
          model: 'pg-model-1',
          cost: 0.05,
          promptTokens: 200,
          completionTokens: 300,
          totalTokens: 500,
          errorCount: 1,
          totalCount: 10,
          errorRate: 10,
        }],
        rowCount: 1,
      };
    }
    if (sqlStr.includes('GROUP BY model')) {
      return {
        rows: [{
          model: 'pg-model-1',
          requests: 10,
          cost: 0.05,
          tokens: 500,
          avgLatency: 120,
        }],
        rowCount: 1,
      };
    }
    if (sqlStr.includes('GROUP BY user_id')) {
      return {
        rows: [{
          userId: 'pg-user-1',
          requests: 10,
          cost: 0.05,
          tokens: 500,
        }],
        rowCount: 1,
      };
    }

    // 6. Conversations
    if (sqlStr.includes('FROM conversations c')) {
      return {
        rows: [{
          id: 'pg-conv-1',
          title: 'Test Conversation',
          total_messages: 2,
          total_tokens: 100,
          total_cost: 0.001,
          first_message_at: '2026-10-07T00:00:00Z',
          last_message_at: '2026-10-07T01:00:00Z',
        }],
        rowCount: 1,
      };
    }
    if (sqlStr.includes('FROM conversations WHERE id = $1')) {
      return {
        rows: [{ id: 'pg-conv-1', title: 'Test Conversation' }],
        rowCount: 1,
      };
    }

    // 7. Traces
    if (sqlStr.includes('COUNT(DISTINCT trace_id)')) {
      return { rows: [{ total: '1' }], rowCount: 1 };
    }
    if (sqlStr.includes('GROUP BY trace_id')) {
      return {
        rows: [{
          trace_id: 'pg-trace-1',
          first_span_at: '2026-10-07T00:00:00Z',
          last_span_at: '2026-10-07T01:00:00Z',
          total_spans: 2,
          total_latency_ms: 150,
          total_cost: 0.002,
          total_tokens: 80,
          name: 'PG Trace Root',
          model: 'pg-model-1',
        }],
        rowCount: 1,
      };
    }
    if (sqlStr.includes('FROM requests WHERE trace_id = $1')) {
      return {
        rows: [
          {
            id: 'span-1',
            span_id: 'span-1',
            trace_id: 'pg-trace-1',
            parent_span_id: 'root',
            span_type: 'agent',
            status: 'success',
            created_at: '2026-10-07T00:00:00Z',
          },
          {
            id: 'span-2',
            span_id: 'span-2',
            trace_id: 'pg-trace-1',
            parent_span_id: 'span-1',
            span_type: 'tool',
            status: 'success',
            created_at: '2026-10-07T00:01:00Z',
          },
        ],
        rowCount: 2,
      };
    }

    // 8. Requests Queries
    if (sqlStr.includes('SELECT COUNT(*) AS total FROM requests')) {
      return { rows: [{ total: '1' }], rowCount: 1 };
    }
    if (sqlStr.includes('FROM requests WHERE id = $1')) {
      return {
        rows: [{
          id: 'pg-req-1',
          model: 'pg-model-1',
          provider: 'deepinfra',
          input_messages: JSON.stringify([{ role: 'user', content: 'hello' }]),
          output_message: JSON.stringify({ role: 'assistant', content: 'hi' }),
          status: 'success',
          total_tokens: 10,
          estimated_cost: 0.0001,
          latency_ms: 50,
        }],
        rowCount: 1,
      };
    }
    if (sqlStr.includes('SELECT * FROM requests') || sqlStr.includes('SELECT r.* FROM requests')) {
      return {
        rows: [{
          id: 'pg-req-1',
          model: 'pg-model-1',
          provider: 'deepinfra',
          input_messages: JSON.stringify([{ role: 'user', content: 'hello' }]),
          output_message: JSON.stringify({ role: 'assistant', content: 'hi' }),
          status: 'success',
          total_tokens: 10,
          estimated_cost: 0.0001,
          latency_ms: 50,
        }],
        rowCount: 1,
      };
    }

    // Default fallback response
    return { rows: [], rowCount: 0 };
  };
}

test.after(() => {
  Pool.prototype.query = originalQuery;
  Pool.prototype.end = originalEnd;
});

// Set DATABASE_URL so postgres adapter uses our mocked pool
process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/testdb';
const pg = require('../db/postgres');

test('postgres adapter: runMigrations executes ALTER and schema DDL', async () => {
  await pg.runMigrations();
  assert.ok(executedQueries.length > 0);
});

test('postgres adapter: insertRequest and getRequestById round-trip', async () => {
  await pg.insertRequest({
    id: 'pg-req-1',
    conversation_id: 'pg-conv-1',
    model: 'pg-model-1',
    provider: 'deepinfra',
    input_messages: [{ role: 'user', content: 'hello' }],
    output_message: { role: 'assistant', content: 'hi' },
    prompt_tokens: 4,
    completion_tokens: 6,
    total_tokens: 10,
    estimated_cost: 0.0001,
    latency_ms: 50,
    status: 'success',
  });

  const row = await pg.getRequestById('pg-req-1');
  assert.ok(row);
  assert.equal(row.id, 'pg-req-1');
  assert.equal(row.model, 'pg-model-1');
});

test('postgres adapter: getRequests pagination, filtering, and sorting', async () => {
  const res = await pg.getRequests({
    page: 1,
    limit: 10,
    model: 'pg-model-1',
    status: 'success',
    search: 'hello',
    startDate: '2026-10-01',
    endDate: '2026-10-08',
  });

  assert.ok(res);
  assert.equal(res.total, 1);
  assert.equal(res.data.length, 1);
});

test('postgres adapter: analytics aggregations (overview, cost, tokens, models, errors, users)', async () => {
  const range = { startDate: '2026-10-01', endDate: '2026-10-08' };

  const overview = await pg.getAnalyticsOverview(range);
  assert.ok(overview);
  assert.equal(overview.totalRequests, 10);
  assert.equal(overview.errorRate, 10);

  const cost = await pg.getCostOverTime(range);
  assert.ok(cost.data);

  const tokens = await pg.getTokenUsage(range);
  assert.ok(tokens.data);

  const models = await pg.getModelUsage(range);
  assert.ok(models.data);

  const errors = await pg.getErrorStats(range);
  assert.ok(errors.data);

  const users = await pg.getUserStats(range);
  assert.ok(users.data);
});

test('postgres adapter: conversations, traces, and agent metrics', async () => {
  const convs = await pg.getConversations({ search: 'conv' });
  assert.ok(convs.data);

  const convDetail = await pg.getConversation('pg-conv-1');
  assert.ok(convDetail);

  const traces = await pg.getTraces({});
  assert.ok(traces.data);

  const spans = await pg.getTraceSpans('pg-trace-1');
  assert.ok(spans);

  await pg.calculateAgentMetrics('pg-trace-1');
});

test('postgres adapter: model pricing, prompts CRUD, feedback, and settings', async () => {
  // Models
  const models = await pg.getModels();
  assert.ok(models.length >= 1);
  await pg.insertModel({ id: 'm2', name: 'M2', input_cost_per_million: 1, output_cost_per_million: 2 });
  await pg.updateModelPricing('m2', { input_cost_per_million: 3, output_cost_per_million: 6 });
  await pg.recalculateCosts();

  // Prompts
  await pg.insertPrompt({ name: 'prompt-1', system_prompt: 'sys', user_template: 'usr', variables: ['name'] });
  const p = await pg.getPromptByName('prompt-1');
  assert.ok(p);
  const hist = await pg.getPromptHistory('prompt-1');
  assert.ok(hist.length >= 1);
  await pg.deletePromptByName('prompt-1');

  // Feedback & Evaluation
  await pg.updateFeedback('pg-req-1', { score: 1, comment: 'good' });
  await pg.updateEvaluation('pg-req-1', { score: 4.5, category: 'helpfulness', safety: { status: 'safe' } });

  // Settings
  await pg.setSetting('pg_key', 'pg_val');
  const val = await pg.getSetting('pg_key');
  assert.equal(val, 'pg-test-val');

  // Maintenance & Spans
  await pg.updateTags('pg-req-1', ['pg-tag']);
  await pg.updateStatus('pg-req-1', 'success');
  await pg.getSubsequentSpans('pg-trace-1', '2026-10-07T00:00:00Z');
  await pg.deleteRequest('pg-req-1');
  await pg.clearAllLogs();

  // closeDb
  await pg.closeDb();
});
