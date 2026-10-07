'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'infrasight-analytics-prompts-')), 'test.db');
process.env.DB_PATH = DB_FILE;
delete process.env.DATABASE_URL;

const db = require('../db');

const NOW = Date.now();
const iso = (msOffset = 0) => new Date(NOW + msOffset).toISOString();

test.before(async () => {
  await db.runMigrations();
});

test.after(async () => {
  await db.closeDb();
  fs.rmSync(path.dirname(DB_FILE), { recursive: true, force: true });
});

test('conversations: _updateConversationStats, getConversations, and getConversation', async () => {
  const convId = 'conv-test-100';

  // 1. Insert first request belonging to conversation
  await db.insertRequest({
    id: 'req-conv-1',
    conversation_id: convId,
    model: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    provider: 'deepinfra',
    input_messages: [{ role: 'user', content: 'What is photosynthesis?' }],
    output_message: { role: 'assistant', content: 'Process by which green plants make food.' },
    prompt_tokens: 10,
    completion_tokens: 15,
    total_tokens: 25,
    estimated_cost: 0.0005,
    latency_ms: 120,
    status: 'success',
    created_at: iso(-5000),
  });

  // 2. Insert second request in same conversation
  await db.insertRequest({
    id: 'req-conv-2',
    conversation_id: convId,
    model: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    provider: 'deepinfra',
    input_messages: [{ role: 'user', content: 'Can you explain the light reaction?' }],
    output_message: { role: 'assistant', content: 'Light reactions happen in thylakoids.' },
    prompt_tokens: 20,
    completion_tokens: 25,
    total_tokens: 45,
    estimated_cost: 0.0010,
    latency_ms: 150,
    status: 'success',
    created_at: iso(-1000),
  });

  // Test getConversations with pagination & search
  const convList = await db.getConversations({ search: 'photosynthesis', page: 1, limit: 10 });
  assert.equal(convList.total >= 1, true);
  const foundConv = convList.data.find(c => c.id === convId);
  assert.ok(foundConv);
  assert.equal(foundConv.total_messages, 2);
  assert.equal(foundConv.total_tokens, 70);
  assert.equal(foundConv.title.includes('photosynthesis'), true);

  // Test getConversation detail
  const detail = await db.getConversation(convId);
  assert.ok(detail.conversation);
  assert.equal(detail.messages.length, 2);
  assert.equal(detail.messages[0].id, 'req-conv-1');
  assert.equal(detail.messages[1].id, 'req-conv-2');
});

test('analytics: overview, cost over time, token usage, model usage, error stats, user stats', async () => {
  const range = {
    startDate: iso(-60 * 60 * 1000), // 1 hour ago
    endDate: iso(60 * 1000),         // 1 minute ahead
  };

  // Insert successful request with user_id
  await db.insertRequest({
    id: 'req-stat-1',
    model: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    provider: 'deepinfra',
    user_id: 'alice',
    input_messages: [{ role: 'user', content: 'Hello Alice' }],
    output_message: { role: 'assistant', content: 'Hi Alice' },
    prompt_tokens: 50,
    completion_tokens: 50,
    total_tokens: 100,
    estimated_cost: 0.002,
    latency_ms: 200,
    status: 'success',
    created_at: iso(-30 * 1000),
  });

  // Insert failed request with error_message
  await db.insertRequest({
    id: 'req-stat-err',
    model: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    provider: 'deepinfra',
    user_id: 'bob',
    input_messages: [{ role: 'user', content: 'Faulty prompt' }],
    status: 'error',
    error_message: 'Upstream rate limit 429',
    prompt_tokens: 10,
    completion_tokens: 0,
    total_tokens: 10,
    estimated_cost: 0.0001,
    latency_ms: 50,
    created_at: iso(-10 * 1000),
  });

  // 1. Overview
  const overview = await db.getAnalyticsOverview(range);
  assert.equal(overview.totalRequests >= 2, true);
  assert.equal(overview.totalCost > 0, true);
  assert.equal(overview.errorRate > 0, true);
  assert.equal(overview.totalTokens >= 110, true);

  // 2. Cost Over Time (daily and hourly)
  const costDaily = await db.getCostOverTime({ ...range, granularity: 'daily' });
  assert.ok(Array.isArray(costDaily.data));
  assert.equal(costDaily.data.length >= 1, true);

  const costHourly = await db.getCostOverTime({ ...range, granularity: 'hourly' });
  assert.ok(Array.isArray(costHourly.data));

  // 3. Token Usage
  const tokenUsage = await db.getTokenUsage(range);
  assert.ok(Array.isArray(tokenUsage.data));
  assert.equal(tokenUsage.data.length >= 1, true);
  assert.equal(tokenUsage.data[0].totalTokens >= 110, true);

  // 4. Model Usage
  const modelUsage = await db.getModelUsage(range);
  assert.ok(Array.isArray(modelUsage.data));
  const llamaUsage = modelUsage.data.find(m => m.model === 'meta-llama/Meta-Llama-3.1-8B-Instruct');
  assert.ok(llamaUsage);
  assert.equal(llamaUsage.requests >= 2, true);

  // 5. Error Stats
  const errorStats = await db.getErrorStats(range);
  assert.ok(Array.isArray(errorStats.data));
  assert.ok(Array.isArray(errorStats.topErrors));
  const rateLimitErr = errorStats.topErrors.find(e => e.error_message === 'Upstream rate limit 429');
  assert.ok(rateLimitErr);
  assert.equal(rateLimitErr.count >= 1, true);

  // 6. User Stats
  const userStats = await db.getUserStats(range);
  assert.ok(Array.isArray(userStats.data));
  const aliceStat = userStats.data.find(u => u.userId === 'alice');
  assert.ok(aliceStat);
  assert.equal(aliceStat.requests >= 1, true);
});

test('models: insertModel, getModels, updateModelPricing, and recalculateCosts', async () => {
  const modelId = 'custom/test-model-v1';

  // 1. Insert new model
  const inserted = await db.insertModel({
    id: modelId,
    name: 'Custom Test Model',
    provider: 'deepinfra',
    input_cost_per_million: 1.0,
    output_cost_per_million: 2.0,
    context_window: 8192,
  });
  assert.equal(inserted.changes, 1);

  // 2. getModels
  const models = await db.getModels();
  assert.ok(models.some(m => m.id === modelId));

  // 3. Insert request under this model
  await db.insertRequest({
    id: 'req-model-recalc',
    model: modelId,
    provider: 'deepinfra',
    input_messages: [{ role: 'user', content: 'test cost calc' }],
    prompt_tokens: 1_000_000,
    completion_tokens: 1_000_000,
    total_tokens: 2_000_000,
    estimated_cost: 0,
    status: 'success',
  });

  // 4. Update pricing
  const updateRes = await db.updateModelPricing(modelId, {
    input_cost_per_million: 2.5,
    output_cost_per_million: 5.0,
  });
  assert.equal(updateRes.changes, 1);

  // 5. Recalculate costs
  const recalcRes = await db.recalculateCosts();
  assert.equal(recalcRes.changes >= 1, true);

  const updatedReq = await db.getRequestById('req-model-recalc');
  // 1M prompt @ 2.5 + 1M completion @ 5.0 = $7.50
  assert.equal(Math.round(updatedReq.estimated_cost * 10) / 10, 7.5);
});

test('prompts: insertPrompt, versioning, getPromptByName, getPromptHistory, deletePromptByName', async () => {
  const promptName = 'customer-support-reply';

  // 1. Insert version 1
  const v1 = await db.insertPrompt({
    name: promptName,
    system_prompt: 'You are helpful support agent.',
    user_template: 'Customer issue: {{issue}}',
    variables: ['issue'],
  });
  assert.equal(v1.version, 1);

  // 2. Insert version 2
  const v2 = await db.insertPrompt({
    name: promptName,
    system_prompt: 'You are an empathetic, concise support specialist.',
    user_template: 'Customer issue: {{issue}} - Priority: {{priority}}',
    variables: ['issue', 'priority'],
  });
  assert.equal(v2.version, 2);

  // 3. getPromptByName retrieves the latest (v2)
  const latest = await db.getPromptByName(promptName);
  assert.ok(latest);
  assert.equal(latest.version, 2);
  assert.match(latest.system_prompt, /empathetic/);

  // 4. getPromptHistory returns both versions
  const history = await db.getPromptHistory(promptName);
  assert.equal(history.length, 2);
  assert.equal(history[0].version, 2);
  assert.equal(history[1].version, 1);

  // 5. getPrompts returns list of distinct prompts
  const allPrompts = await db.getPrompts();
  assert.ok(allPrompts.some(p => p.name === promptName && p.version === 2));

  // 6. deletePromptByName removes all versions
  const deleted = await db.deletePromptByName(promptName);
  assert.equal(deleted, true);

  const afterDelete = await db.getPromptByName(promptName);
  assert.equal(afterDelete, null);
});

test('feedback: updateFeedback recalculates NLP metrics when expected_answer is provided', async () => {
  const reqId = 'req-feedback-nlp';
  await db.insertRequest({
    id: reqId,
    model: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    provider: 'deepinfra',
    input_messages: [{ role: 'user', content: 'What is 2+2?' }],
    output_message: { role: 'assistant', content: '4' },
    status: 'success',
  });

  const success = await db.updateFeedback(reqId, {
    score: 5,
    rating: 'positive',
    comment: 'Perfect',
    expected_answer: '4',
  });
  assert.equal(success, true);

  const updated = await db.getRequestById(reqId);
  assert.ok(updated.evaluation);
  const evalData = typeof updated.evaluation === 'string' ? JSON.parse(updated.evaluation) : updated.evaluation;
  assert.equal(evalData.exact_match, 1);
  assert.equal(evalData.f1_score, 1);
});

test('maintenance: updateTags, updateStatus, deleteRequest, clearAllLogs', async () => {
  const reqId = 'req-maintenance';
  await db.insertRequest({
    id: reqId,
    model: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    provider: 'deepinfra',
    input_messages: [{ role: 'user', content: 'status test' }],
    output_message: { role: 'assistant', content: 'ok' },
    status: 'pending',
  });

  // updateTags
  await db.updateTags(reqId, ['test-tag', 'staging']);
  let fetched = await db.getRequestById(reqId);
  const tags = typeof fetched.tags === 'string' ? JSON.parse(fetched.tags) : fetched.tags;
  assert.deepEqual(tags, ['test-tag', 'staging']);

  // updateStatus
  await db.updateStatus(reqId, 'success');
  fetched = await db.getRequestById(reqId);
  assert.equal(fetched.status, 'success');

  // getSubsequentSpans
  const subsequent = await db.getSubsequentSpans('some-trace-id', '2020-01-01');
  assert.ok(Array.isArray(subsequent));

  // deleteRequest
  const delOk = await db.deleteRequest(reqId);
  assert.equal(delOk.changes, 1);
  assert.equal(await db.getRequestById(reqId), undefined);

  // clearAllLogs
  await db.insertRequest({
    id: 'temp-req',
    model: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    provider: 'deepinfra',
    input_messages: [{ role: 'user', content: 'tmp' }],
    status: 'success',
  });
  await db.clearAllLogs();
  const logsAfter = await db.getRequests({});
  assert.equal(logsAfter.total, 0);
});

test('settings and traces: getSetting, setSetting, getTraces, and calculateAgentMetrics', async () => {
  // 1. Settings
  assert.equal(await db.getSetting('NON_EXISTENT_KEY'), null);
  const setOk = await db.setSetting('TEST_SETTING_KEY', 'custom-value');
  assert.equal(setOk, true);
  assert.equal(await db.getSetting('TEST_SETTING_KEY'), 'custom-value');

  // 2. Traces and Agent Metrics
  const traceId = 'trace-agent-999';
  await db.insertRequest({
    id: 'span-root',
    trace_id: traceId,
    span_id: 'span-root',
    parent_span_id: 'root',
    span_type: 'agent',
    span_name: 'Agent Coordinator',
    model: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    provider: 'deepinfra',
    input_messages: [{ role: 'user', content: 'Run agent search' }],
    status: 'success',
  });

  await db.insertRequest({
    id: 'span-tool-call',
    trace_id: traceId,
    span_id: 'span-tool-call',
    parent_span_id: 'span-root',
    span_type: 'tool',
    span_name: 'Search Web',
    model: 'tool-caller',
    provider: 'internal',
    input_messages: [{ role: 'user', content: 'query' }],
    status: 'success',
  });

  // Calculate agent metrics
  await db.calculateAgentMetrics(traceId);
  const rootSpan = await db.getRequestById('span-root');
  assert.ok(rootSpan.evaluation);
  const agentEval = typeof rootSpan.evaluation === 'string' ? JSON.parse(rootSpan.evaluation) : rootSpan.evaluation;
  assert.equal(agentEval.tool_success_rate, 1.0);
  assert.equal(agentEval.goal_completion_rate, 1.0);

  // getTraces
  const traces = await db.getTraces({});
  assert.equal(traces.total >= 1, true);
  const foundTrace = traces.data.find(t => t.trace_id === traceId);
  assert.ok(foundTrace);
  assert.equal(foundTrace.total_spans, 2);
  assert.equal(foundTrace.name, 'Agent Coordinator');
});
