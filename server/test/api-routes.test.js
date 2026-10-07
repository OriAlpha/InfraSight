'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'infrasight-api-routes-')), 'test.db');
process.env.DB_PATH = DB_FILE;
delete process.env.DATABASE_URL;

const db = require('../db');
const logsRouter = require('../api/logs');
const analyticsRouter = require('../api/analytics');
const conversationsRouter = require('../api/conversations');
const modelsRouter = require('../api/models');
const promptsRouter = require('../api/prompts');
const tracesRouter = require('../api/traces');
const settingsRouter = require('../api/settings');

let server;
let baseUrl;
let originalFetch;

test.before(async () => {
  await db.runMigrations();

  const app = express();
  app.use(express.json());

  app.use('/api/logs', logsRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/conversations', conversationsRouter);
  app.use('/api/models', modelsRouter);
  app.use('/api/prompts', promptsRouter);
  app.use('/api/traces', tracesRouter);
  app.use('/api/settings', settingsRouter);

  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (typeof url === 'string' && url.includes('deepinfra.com')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Playground test response output' } }],
          usage: { prompt_tokens: 10, completion_tokens: 15, total_tokens: 25 },
        }),
      };
    }
    return originalFetch(url, options);
  };

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
  }
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await db.closeDb();
  fs.rmSync(path.dirname(DB_FILE), { recursive: true, force: true });
});

test('API /api/logs: CRUD, feedback, and tags', async () => {
  const reqId = 'log-route-test-1';
  await db.insertRequest({
    id: reqId,
    model: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    provider: 'deepinfra',
    input_messages: [{ role: 'user', content: 'What is Express.js?' }],
    output_message: { role: 'assistant', content: 'A minimal Node.js web framework.' },
    status: 'success',
    prompt_tokens: 15,
    completion_tokens: 20,
    total_tokens: 35,
    estimated_cost: 0.0002,
    latency_ms: 80,
  });

  // 1. GET /api/logs
  const listRes = await fetch(`${baseUrl}/api/logs?page=1&limit=10`);
  assert.equal(listRes.status, 200);
  const listData = await listRes.json();
  assert.equal(listData.total >= 1, true);

  // 2. GET /api/logs/:id
  const getRes = await fetch(`${baseUrl}/api/logs/${reqId}`);
  assert.equal(getRes.status, 200);
  const itemData = await getRes.json();
  assert.equal(itemData.id, reqId);

  // 3. PATCH /api/logs/:id/feedback
  const fbRes = await fetch(`${baseUrl}/api/logs/${reqId}/feedback`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ score: 5, comment: 'Great answer' }),
  });
  assert.equal(fbRes.status, 200);

  // 4. PATCH /api/logs/:id/tags
  const tagRes = await fetch(`${baseUrl}/api/logs/${reqId}/tags`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags: ['web', 'backend'] }),
  });
  assert.equal(tagRes.status, 200);

  // 5. PATCH /api/logs/:id/status
  const statusRes = await fetch(`${baseUrl}/api/logs/${reqId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'success' }),
  });
  assert.equal(statusRes.status, 200);

  // 6. GET /api/logs/export/csv
  const csvRes = await fetch(`${baseUrl}/api/logs/export/csv`);
  assert.equal(csvRes.status, 200);
  const csvText = await csvRes.text();
  assert.match(csvText, /model,provider,status/);

  // 7. GET /api/logs/export/finetuning
  const ftRes = await fetch(`${baseUrl}/api/logs/export/finetuning`);
  assert.equal(ftRes.status, 200);
  const ftText = await ftRes.text();
  assert.ok(ftText.length > 0);

  // 8. POST /api/logs/import
  const importRes = await fetch(`${baseUrl}/api/logs/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      logs: [{
        id: 'imported-log-1',
        model: 'meta-llama/imported',
        input_messages: [{ role: 'user', content: 'test import' }],
        output_message: { role: 'assistant', content: 'done' },
      }],
    }),
  });
  assert.equal(importRes.status, 200);
  const importData = await importRes.json();
  assert.equal(importData.importedCount, 1);

  // 9. DELETE /api/logs without confirmation is rejected
  const delNoConfirm = await fetch(`${baseUrl}/api/logs`, { method: 'DELETE' });
  assert.equal(delNoConfirm.status, 400);

  // 10. DELETE /api/logs?confirm=true clears all
  const delAllRes = await fetch(`${baseUrl}/api/logs?confirm=true`, { method: 'DELETE' });
  assert.equal(delAllRes.status, 200);

  // 11. DELETE /api/logs/:id
  await db.insertRequest({
    id: 'single-del-test',
    model: 'meta-llama/test',
    input_messages: [{ role: 'user', content: 'hi' }],
    status: 'success',
  });
  const delRes = await fetch(`${baseUrl}/api/logs/single-del-test`, { method: 'DELETE' });
  assert.equal(delRes.status, 200);

  const getAfterDel = await fetch(`${baseUrl}/api/logs/single-del-test`);
  assert.equal(getAfterDel.status, 404);
});

test('API /api/analytics: overview, cost, models, errors', async () => {
  await db.insertRequest({
    id: 'analytics-route-1',
    model: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    provider: 'deepinfra',
    input_messages: [{ role: 'user', content: 'Hi' }],
    status: 'success',
    prompt_tokens: 5,
    completion_tokens: 5,
    total_tokens: 10,
    estimated_cost: 0.0001,
    latency_ms: 50,
  });

  const resOverview = await fetch(`${baseUrl}/api/analytics/overview`);
  assert.equal(resOverview.status, 200);
  const overview = await resOverview.json();
  assert.equal(typeof overview.totalRequests, 'number');

  const resCost = await fetch(`${baseUrl}/api/analytics/cost`);
  assert.equal(resCost.status, 200);

  const resModels = await fetch(`${baseUrl}/api/analytics/models`);
  assert.equal(resModels.status, 200);

  const resErrors = await fetch(`${baseUrl}/api/analytics/errors`);
  assert.equal(resErrors.status, 200);

  const resTokens = await fetch(`${baseUrl}/api/analytics/tokens`);
  assert.equal(resTokens.status, 200);

  const resLatency = await fetch(`${baseUrl}/api/analytics/latency`);
  assert.equal(resLatency.status, 200);

  const resUsers = await fetch(`${baseUrl}/api/analytics/users`);
  assert.equal(resUsers.status, 200);

  const resEvals = await fetch(`${baseUrl}/api/analytics/evals`);
  assert.equal(resEvals.status, 200);
});

test('API /api/conversations: list and detail', async () => {
  const convId = 'conv-route-10';
  await db.insertRequest({
    id: 'req-conv-route-1',
    conversation_id: convId,
    model: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    provider: 'deepinfra',
    input_messages: [{ role: 'user', content: 'Chat step 1' }],
    output_message: { role: 'assistant', content: 'Response step 1' },
    status: 'success',
  });

  const listRes = await fetch(`${baseUrl}/api/conversations`);
  assert.equal(listRes.status, 200);
  const list = await listRes.json();
  assert.equal(list.total >= 1, true);

  const detailRes = await fetch(`${baseUrl}/api/conversations/${convId}`);
  assert.equal(detailRes.status, 200);
  const detail = await detailRes.json();
  assert.equal(detail.conversation.id, convId);
  assert.equal(detail.messages.length >= 1, true);
});

test('API /api/models: get, create, patch pricing, recalculate', async () => {
  const modelId = 'test/route-model';

  // POST /api/models
  const createRes = await fetch(`${baseUrl}/api/models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: modelId,
      name: 'Route Test Model',
      input_cost_per_million: 2.0,
      output_cost_per_million: 4.0,
    }),
  });
  assert.equal(createRes.status, 200);

  // GET /api/models
  const listRes = await fetch(`${baseUrl}/api/models`);
  assert.equal(listRes.status, 200);
  const models = await listRes.json();
  assert.ok(models.data.some(m => m.id === modelId));

  // PUT /api/models/:id
  const putRes = await fetch(`${baseUrl}/api/models/${encodeURIComponent(modelId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input_cost_per_million: 2.5,
      output_cost_per_million: 5.0,
    }),
  });
  assert.equal(putRes.status, 200);

  // POST /api/models/recalculate
  const recalcRes = await fetch(`${baseUrl}/api/models/recalculate`, { method: 'POST' });
  assert.equal(recalcRes.status, 200);
});

test('API /api/prompts: CRUD and version history', async () => {
  const name = 'test-route-prompt';

  // POST /api/prompts
  const createRes = await fetch(`${baseUrl}/api/prompts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      system_prompt: 'You are concise.',
      user_template: 'Tell me about {{topic}}',
      variables: ['topic'],
    }),
  });
  assert.equal(createRes.status, 201);

  // GET /api/prompts/:name
  const getRes = await fetch(`${baseUrl}/api/prompts/${name}`);
  assert.equal(getRes.status, 200);
  const prompt = await getRes.json();
  assert.equal(prompt.name, name);
  assert.equal(prompt.version, 1);

  // GET /api/prompts/:name/history
  const histRes = await fetch(`${baseUrl}/api/prompts/${name}/history`);
  assert.equal(histRes.status, 200);
  const history = await histRes.json();
  assert.equal(history.data.length, 1);

  // DELETE /api/prompts/:name
  const delRes = await fetch(`${baseUrl}/api/prompts/${name}`, { method: 'DELETE' });
  assert.equal(delRes.status, 200);

  // POST /api/prompts/playground
  process.env.DEEPINFRA_API_KEY = 'mock-deepinfra-key';
  const playRes = await fetch(`${baseUrl}/api/prompts/playground`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
      system_prompt: 'Be a poet about {{topic}}',
      user_template: 'Write one line for {{name}}',
      variables: { topic: 'nature', name: 'forest' },
    }),
  });
  assert.equal(playRes.status, 200);
  const playData = await playRes.json();
  assert.equal(playData.success, true);
  assert.equal(playData.output, 'Playground test response output');
});

test('API /api/traces: list and spans by traceId', async () => {
  const traceId = 'trace-route-99';
  await db.insertRequest({
    id: 'span-route-root',
    trace_id: traceId,
    span_id: 'span-route-root',
    parent_span_id: 'root',
    span_type: 'agent',
    span_name: 'Root Trace Task',
    model: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    provider: 'deepinfra',
    input_messages: [{ role: 'user', content: 'test trace' }],
    status: 'success',
  });

  const listRes = await fetch(`${baseUrl}/api/traces`);
  assert.equal(listRes.status, 200);
  const list = await listRes.json();
  assert.equal(list.total >= 1, true);

  const detailRes = await fetch(`${baseUrl}/api/traces/${traceId}`);
  assert.equal(detailRes.status, 200);
  const detail = await detailRes.json();
  assert.equal(detail.traceId, traceId);
  assert.equal(detail.rootSpans.length >= 1, true);
});

test('API /api/settings: get and update settings', async () => {
  // GET /api/settings
  const getRes = await fetch(`${baseUrl}/api/settings`);
  assert.equal(getRes.status, 200);
  const settings = await getRes.json();
  assert.ok(typeof settings === 'object');

  // PUT /api/settings
  const putRes = await fetch(`${baseUrl}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ALERT_LATENCY_THRESHOLD_MS: '3000',
      MOCK_MODE: 'false',
    }),
  });
  assert.equal(putRes.status, 200);
});
