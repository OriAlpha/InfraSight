'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'infrasight-eval-scoring-')), 'test.db');
process.env.DB_PATH = DB_FILE;
delete process.env.DATABASE_URL;
process.env.UPSTREAM_API_KEY = 'mock-upstream-key';
process.env.MOCK_MODE = 'false';

const db = require('../db');
const { clearCache } = require('../utils/config');
const { queueEvaluation, drainEvaluations, getQueueStats } = require('../services/evaluator');

let fetchMockHandler = null;
const originalFetch = globalThis.fetch;

beforeEachMock();

function beforeEachMock() {
  globalThis.fetch = async (url, options) => {
    if (fetchMockHandler) {
      return fetchMockHandler(url, options);
    }
    throw new Error('Unhandled fetch call in test');
  };
}

let counter = 0;
function insert(row) {
  return db.insertRequest({
    id: `eval-${++counter}`,
    model: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    provider: 'deepinfra',
    input_messages: [{ role: 'user', content: 'What is the capital of France?' }],
    output_message: { role: 'assistant', content: 'The capital of France is Paris.' },
    status: 'success',
    ...row,
  });
}

test.before(async () => {
  await db.runMigrations();
  clearCache();
});

test.after(async () => {
  globalThis.fetch = originalFetch;
  await drainEvaluations(3000);
  await db.closeDb();
  fs.rmSync(path.dirname(DB_FILE), { recursive: true, force: true });
});

test('evaluator handles standard tool_call response and saves task metrics', async () => {
  const reqId = 'eval-standard-tool';
  await insert({ id: reqId });

  fetchMockHandler = async (url, opts) => {
    assert.match(url, /chat\/completions/);
    const body = JSON.parse(opts.body);
    assert.equal(body.tools[0].type, 'function');

    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    name: 'submit_evaluation',
                    arguments: JSON.stringify({
                      score: 4.8,
                      category: 'relevance',
                      reasoning: 'Direct and factually accurate.',
                      task_type: 'question_answering',
                      task_metrics: ['factual_accuracy', 'completeness'],
                      factual_accuracy: 5.0,
                      completeness: 4.6,
                      safety_status: 'safe',
                      safety_reasoning: 'No security issues detected.',
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
    };
  };

  queueEvaluation(reqId);
  const drained = await drainEvaluations(3000);
  assert.equal(drained, true);

  const saved = await db.getRequestById(reqId);
  assert.ok(saved);
  const evalData = typeof saved.evaluation === 'string' ? JSON.parse(saved.evaluation) : saved.evaluation;
  assert.equal(evalData.score, 4.8);
  assert.equal(evalData.category, 'relevance');
  assert.equal(evalData.task_type, 'question_answering');
  assert.equal(evalData.factual_accuracy, 5.0);
  assert.equal(evalData.completeness, 4.6);
  assert.equal(evalData.safety.status, 'safe');
});

test('evaluator handles markdown json code-block fallback response', async () => {
  const reqId = 'eval-md-fallback';
  await insert({ id: reqId });

  fetchMockHandler = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content: `\`\`\`json
{
  "score": 4.2,
  "category": "helpfulness",
  "reasoning": "Well written response.",
  "task_type": "summarization",
  "task_metrics": ["conciseness", "coherence"],
  "conciseness": 4.5,
  "coherence": 4.0,
  "safety_status": "safe",
  "safety_reasoning": "Benign"
}
\`\`\``,
          },
        },
      ],
    }),
  });

  queueEvaluation(reqId);
  await drainEvaluations(3000);

  const saved = await db.getRequestById(reqId);
  const evalData = typeof saved.evaluation === 'string' ? JSON.parse(saved.evaluation) : saved.evaluation;
  assert.equal(evalData.score, 4.2);
  assert.equal(evalData.task_type, 'summarization');
  assert.equal(evalData.conciseness, 4.5);
  assert.equal(evalData.coherence, 4.0);
});

test('evaluator handles <function=...> tag fallback response', async () => {
  const reqId = 'eval-func-tag-fallback';
  await insert({ id: reqId });

  fetchMockHandler = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content: `<function=submit_evaluation>
{
  "score": 3.5,
  "category": "clarity",
  "reasoning": "Acceptable explanation.",
  "task_type": "general",
  "task_metrics": ["instruction_following"],
  "instruction_following": 3.5,
  "safety_status": "flagged",
  "safety_reasoning": "Borderline tone"
}
</function>`,
          },
        },
      ],
    }),
  });

  queueEvaluation(reqId);
  await drainEvaluations(3000);

  const saved = await db.getRequestById(reqId);
  const evalData = typeof saved.evaluation === 'string' ? JSON.parse(saved.evaluation) : saved.evaluation;
  assert.equal(evalData.score, 3.5);
  assert.equal(evalData.category, 'clarity');
  assert.equal(evalData.safety.status, 'flagged');
});

test('evaluator incorporates RAG context and ground-truth NLP metrics', async () => {
  const reqId = 'eval-rag-and-nlp';
  await insert({
    id: reqId,
    metadata: {
      context: 'France is a country in Europe. Paris is its capital.',
      expected_answer: 'Paris is the capital of France.',
      retrieved_ids: ['doc-1', 'doc-2', 'doc-3'],
      relevant_ids: ['doc-2', 'doc-4'],
    },
  });

  fetchMockHandler = async (url, opts) => {
    const body = JSON.parse(opts.body);
    const userPrompt = body.messages[1].content;
    assert.match(userPrompt, /Retrieved Context Documents/);
    assert.match(userPrompt, /Expected Ground Truth Answer/);

    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    name: 'submit_evaluation',
                    arguments: JSON.stringify({
                      score: 4.9,
                      category: 'relevance',
                      reasoning: 'Grounded and matches expected answer.',
                      task_type: 'question_answering',
                      task_metrics: ['factual_accuracy'],
                      factual_accuracy: 5.0,
                      applicable_metrics: ['faithfulness', 'context_precision', 'ground_truth_alignment'],
                      faithfulness: 4.9,
                      context_precision: 4.8,
                      safety_status: 'safe',
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
    };
  };

  queueEvaluation(reqId);
  await drainEvaluations(3000);

  const saved = await db.getRequestById(reqId);
  const evalData = typeof saved.evaluation === 'string' ? JSON.parse(saved.evaluation) : saved.evaluation;
  assert.equal(evalData.score, 4.9);
  assert.equal(evalData.faithfulness, 4.9);
  assert.equal(evalData.context_precision, 4.8);
  // NLP metrics calculated because ground_truth_alignment was applicable
  assert.equal(typeof evalData.exact_match, 'number');
  assert.equal(typeof evalData.f1_score, 'number');
  // Retrieval metrics calculated
  assert.equal(typeof evalData.recall_at_k, 'number');
  assert.equal(typeof evalData.precision_at_k, 'number');
});

test('evaluator extracts context from sibling tool spans when metadata context is missing', async () => {
  const traceId = 'trace-tool-ctx-123';
  const toolSpanId = 'span-tool-1';
  const reqId = 'eval-trace-ctx';

  // Sibling tool span
  await db.insertRequest({
    id: toolSpanId,
    trace_id: traceId,
    span_id: toolSpanId,
    span_type: 'tool',
    model: 'tool-caller',
    provider: 'internal',
    input_messages: [{ role: 'user', content: 'run tool' }],
    status: 'success',
    output_message: JSON.stringify({ content: 'Sibling tool output context data' }),
  });

  // LLM request under the same trace
  await insert({
    id: reqId,
    trace_id: traceId,
    span_id: 'span-llm-1',
    span_type: 'llm',
  });

  let capturedPrompt = '';
  fetchMockHandler = async (url, opts) => {
    const body = JSON.parse(opts.body);
    capturedPrompt = body.messages[1].content;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    name: 'submit_evaluation',
                    arguments: JSON.stringify({
                      score: 4.0,
                      category: 'relevance',
                      reasoning: 'Found context from tool span.',
                      task_type: 'general',
                      task_metrics: [],
                      safety_status: 'safe',
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
    };
  };

  queueEvaluation(reqId);
  await drainEvaluations(3000);

  assert.match(capturedPrompt, /Sibling tool output context data/);
});

test('evaluator handles API failure (status 500) and saves local metrics if ground truth exists', async () => {
  const reqId = 'eval-api-fail';
  await insert({
    id: reqId,
    metadata: {
      expected_answer: 'The capital of France is Paris.',
    },
  });

  fetchMockHandler = async () => ({
    ok: false,
    status: 500,
    statusText: 'Internal Server Error',
  });

  queueEvaluation(reqId);
  await drainEvaluations(3000);

  const saved = await db.getRequestById(reqId);
  const evalData = typeof saved.evaluation === 'string' ? JSON.parse(saved.evaluation) : saved.evaluation;
  assert.equal(evalData.score, 0);
  assert.match(evalData.reasoning, /API evaluation failed/);
  assert.equal(typeof evalData.exact_match, 'number');
});

test('evaluator handles malformed JSON fallback and stores error evaluation on parse exception', async () => {
  const reqId = 'eval-bad-json';
  await insert({
    id: reqId,
    metadata: {
      expected_answer: 'Expected something',
    },
  });

  fetchMockHandler = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content: 'This is definitely not json at all.',
          },
        },
      ],
    }),
  });

  queueEvaluation(reqId);
  await drainEvaluations(3000);

  const saved = await db.getRequestById(reqId);
  const evalData = typeof saved.evaluation === 'string' ? JSON.parse(saved.evaluation) : saved.evaluation;
  assert.equal(evalData.score, 0);
  assert.match(evalData.reasoning, /Failed to parse LLM evaluation/);
});

test('evaluator ignores out-of-range scores gracefully', async () => {
  const reqId = 'eval-out-of-range';
  await insert({ id: reqId });

  fetchMockHandler = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: {
                  name: 'submit_evaluation',
                  arguments: JSON.stringify({
                    score: 9.9, // out of 1.0 - 5.0 range
                    category: 'helpfulness',
                    reasoning: 'Too high',
                    task_type: 'general',
                    task_metrics: [],
                    safety_status: 'safe',
                  }),
                },
              },
            ],
          },
        },
      ],
    }),
  });

  queueEvaluation(reqId);
  await drainEvaluations(3000);

  const saved = await db.getRequestById(reqId);
  // No evaluation saved because score was invalid
  assert.equal(saved.evaluation, null);
});

test('evaluator records error record when fetch throws unexpected network exception', async () => {
  const reqId = 'eval-network-err';
  await insert({ id: reqId });

  fetchMockHandler = async () => {
    throw new Error('ECONNREFUSED connect');
  };

  queueEvaluation(reqId);
  await drainEvaluations(3000);

  const saved = await db.getRequestById(reqId);
  const evalData = typeof saved.evaluation === 'string' ? JSON.parse(saved.evaluation) : saved.evaluation;
  assert.equal(evalData.score, 0);
  assert.equal(evalData.category, 'error');
  assert.match(evalData.reasoning, /ECONNREFUSED/);
});

test('getQueueStats returns current depth and worker count', () => {
  const stats = getQueueStats();
  assert.equal(typeof stats.pending, 'number');
  assert.equal(typeof stats.active, 'number');
});
