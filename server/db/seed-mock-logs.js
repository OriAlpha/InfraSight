/**
 * Seeds the database with mock requests and conversations over the last 30 days.
 * This makes the dashboard look alive and allows complete testing of all charts/filters.
 */
'use strict';

const { v4: uuidv4 } = require('uuid');
const { insertRequest, getDb, runMigrations } = require('./index');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const MODELS = [
  { id: 'meta-llama/Meta-Llama-3.1-8B-Instruct', inCost: 0.06, outCost: 0.06 },
  { id: 'meta-llama/Meta-Llama-3.1-70B-Instruct', inCost: 0.35, outCost: 0.40 },
  { id: 'meta-llama/Llama-3.3-70B-Instruct', inCost: 0.35, outCost: 0.40 },
  { id: 'deepseek-ai/DeepSeek-V3', inCost: 0.49, outCost: 0.89 },
  { id: 'google/gemma-2-27b-it', inCost: 0.27, outCost: 0.27 },
  { id: 'Qwen/Qwen2.5-72B-Instruct', inCost: 0.35, outCost: 0.40 }
];

const MOCK_INPUTS = [
  [{ role: 'user', content: 'How do I implement binary search in JavaScript?' }],
  [{ role: 'user', content: 'What is the capital of France and its total population?' }],
  [{ role: 'user', content: 'Explain quantum computing in simple terms for a 10 year old.' }],
  [{ role: 'system', content: 'You are a helpful assistant.' }, { role: 'user', content: 'Write a python script to parse logs.' }],
  [{ role: 'user', content: 'Suggest 5 names for a new coffee shop near the beach.' }],
  [{ role: 'user', content: 'What are the main differences between SQL and NoSQL databases?' }],
  [{ role: 'user', content: 'Write a short poem about coding at 2 AM.' }]
];

const MOCK_OUTPUTS = [
  { role: 'assistant', content: 'Here is how you implement binary search in JavaScript:\n\n```js\nfunction binarySearch(arr, target) {\n  let left = 0;\n  let right = arr.length - 1;\n  while (left <= right) {\n    const mid = Math.floor((left + right) / 2);\n    if (arr[mid] === target) return mid;\n    if (arr[mid] < target) left = mid + 1;\n    else right = mid - 1;\n  }\n  return -1;\n}\n```' },
  { role: 'assistant', content: 'The capital of France is Paris. As of 2026, the estimated population of the city of Paris is approximately 2.1 million people, with the surrounding metropolitan area having over 12 million residents.' },
  { role: 'assistant', content: 'Imagine your computer uses tiny light switches that can only be "on" or "off" (1 or 0). Quantum computers use special "magic switches" that can be both "on" AND "off" at the exact same time! This lets them try thousands of answers all at once, making them super fast at solving tricky puzzles.' },
  { role: 'assistant', content: 'Certainly! Here is a simple Python script using regex to parse log lines:\n\n```python\nimport re\n\nlog_pattern = re.compile(r"(\\d{4}-\\d{2}-\\d{2}) (\\w+) (.*)")\nwith open("app.log") as f:\n    for line in f:\n        match = log_pattern.match(line)\n        if match:\n            date, level, msg = match.groups()\n            print(f"{date} [{level}]: {msg}")\n```' },
  { role: 'assistant', content: 'Here are 5 coastal-inspired coffee shop names:\n1. Coastal Roast\n2. The Salty Mug\n3. Wave & Grind\n4. Ocean Brews\n5. Beachside Beans' },
  { role: 'assistant', content: 'SQL databases are relational, table-based, and have strict schemas (great for transactions). NoSQL databases are non-relational, document/key-value based, schema-less, and scale horizontally (great for unstructured, rapid development data).' },
  { role: 'assistant', content: 'The screen glows bright, the world is still,\nWhile loops run against my will.\nA cup of coffee, cold and black,\nSearching for a bug in a stack trace track.' }
];

const ERROR_MESSAGES = [
  'Authorization failed: Invalid API Key',
  'DeepInfra API is currently overloaded. Please try again later.',
  'Rate limit exceeded (429 Too Many Requests)',
  'Network error: connection timed out'
];

/**
 * Generates mock evaluations and feedbacks.
 */
function mockEvaluationAndFeedback(isSuccess) {
  if (!isSuccess) return { evaluation: null, feedback: null };
  if (Math.random() > 0.85) return { evaluation: null, feedback: null }; // 15% have no evaluation/feedback

  const rating = Math.random() < 0.05 ? 1 : (Math.random() < 0.08 ? 2 : (Math.random() < 0.12 ? 3 : (Math.random() < 0.35 ? 4 : 5)));
  const task_success = rating >= 4;

  const feedback = {
    rating,
    comment: rating <= 3 ? 'The response was slow or slightly inaccurate.' : 'Perfect answer, very clear!',
    task_success,
    expected_answer: 'Here is the expected reference answer matching ground truth.'
  };

  const score = rating + (Math.random() * 0.4 - 0.2);
  const evaluation = {
    score: Math.max(1.0, Math.min(5.0, Math.round(score * 10) / 10)),
    reasoning: 'Evaluated response alignment with ground truth guidelines and accuracy.',
    category: 'helpfulness',
    exact_match: Math.random() < 0.15 ? 1 : 0,
    f1_score: 0.65 + Math.random() * 0.33,
    bleu: 0.4 + Math.random() * 0.55,
    rouge_1: 0.55 + Math.random() * 0.4,
    rouge_2: 0.45 + Math.random() * 0.45,
    rouge_l: 0.5 + Math.random() * 0.45,
  };

  // Add RAG metrics
  const isRAG = Math.random() < 0.6;
  if (isRAG) {
    evaluation.faithfulness = Math.round((3.8 + Math.random() * 1.2) * 10) / 10;
    evaluation.answer_relevancy = Math.round((4.0 + Math.random() * 1.0) * 10) / 10;
    evaluation.context_precision = Math.round((3.9 + Math.random() * 1.1) * 10) / 10;
    evaluation.context_recall = Math.round((4.1 + Math.random() * 0.9) * 10) / 10;
    evaluation.context_relevance = Math.round((3.8 + Math.random() * 1.2) * 10) / 10;
    evaluation.hallucination_rate = Math.round((Math.random() * 0.18) * 100) / 100;
    evaluation.recall_at_k = Math.round((0.6 + Math.random() * 0.4) * 100) / 100;
    evaluation.precision_at_k = Math.round((0.5 + Math.random() * 0.5) * 100) / 100;
    evaluation.mrr = Math.round((0.7 + Math.random() * 0.3) * 100) / 100;
  }

  // Add Agent metrics
  const isAgent = Math.random() < 0.3;
  if (isAgent) {
    evaluation.tool_success_rate = Math.random() < 0.9 ? 1.0 : 0.66;
    evaluation.tool_selection_accuracy = Math.random() < 0.93 ? 1.0 : 0.75;
    evaluation.planning_accuracy = Math.random() < 0.9 ? 1.0 : 0.8;
    evaluation.iteration_count = Math.floor(Math.random() * 4) + 2;
    evaluation.goal_completion_rate = Math.random() < 0.93 ? 1.0 : 0.0;
  }

  return {
    evaluation: JSON.stringify(evaluation),
    feedback: JSON.stringify(feedback)
  };
}

function generateConversation(convId, startTime) {
  const db = getDb();
  db.prepare('INSERT INTO conversations (id, created_at) VALUES (?, ?)').run(convId, new Date(startTime).toISOString());

  const modelObj = MODELS[Math.floor(Math.random() * MODELS.length)];
  const userId = `user_${Math.floor(Math.random() * 20) + 1}`;
  const numTurns = Math.floor(Math.random() * 4) + 2; // 2 to 5 turns

  let currentTimestamp = new Date(startTime);

  for (let i = 0; i < numTurns; i++) {
    const isError = Math.random() < 0.03; // 3% error rate in conversations
    const model = modelObj.id;
    const promptTokens = Math.floor(Math.random() * 200) + 50 + (i * 100);
    const completionTokens = isError ? 0 : Math.floor(Math.random() * 300) + 80;
    const totalTokens = promptTokens + completionTokens;
    const latency = isError ? Math.floor(Math.random() * 500) + 100 : Math.floor(Math.random() * 2000) + 500;
    
    // cost in dollars
    const inputCost = (promptTokens / 1_000_000) * modelObj.inCost;
    const outputCost = (completionTokens / 1_000_000) * modelObj.outCost;
    const estimatedCost = isError ? 0 : Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;

    const inputMsgIndex = Math.floor(Math.random() * MOCK_INPUTS.length);
    let messages = MOCK_INPUTS[inputMsgIndex];
    if (i > 0) {
      // Append past history context mock
      messages = [
        { role: 'user', content: 'Previous request' },
        { role: 'assistant', content: 'Previous response' },
        { role: 'user', content: 'Follow up question' }
      ];
    }

    const { evaluation, feedback } = mockEvaluationAndFeedback(!isError);

    insertRequest({
      id: uuidv4(),
      conversation_id: convId,
      model: model,
      provider: 'deepinfra',
      input_messages: messages,
      output_message: isError ? null : MOCK_OUTPUTS[inputMsgIndex],
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      estimated_cost: estimatedCost,
      latency_ms: latency,
      status: isError ? 'error' : 'success',
      error_message: isError ? ERROR_MESSAGES[Math.floor(Math.random() * ERROR_MESSAGES.length)] : null,
      temperature: 0.7,
      max_tokens: 1024,
      top_p: 0.9,
      user_id: userId,
      metadata: { environment: Math.random() < 0.8 ? 'production' : 'staging' },
      tags: JSON.stringify(['chat', 'support', model.split('/')[1]]),
      stream: Math.random() < 0.5,
      raw_request: { model, messages, stream: Math.random() < 0.5, temperature: 0.7 },
      raw_response: isError ? { error: 'mock_error' } : { choices: [{ message: MOCK_OUTPUTS[inputMsgIndex] }] },
      feedback,
      evaluation,
      created_at: currentTimestamp.toISOString()
    });

    // Advance timestamp by 15-45 seconds for next turn
    currentTimestamp.setSeconds(currentTimestamp.getSeconds() + Math.floor(Math.random() * 30) + 15);
  }
}

function generateTraceRun(traceId, startTime) {
  const modelObj = MODELS[Math.floor(Math.random() * MODELS.length)];
  const userId = `user_${Math.floor(Math.random() * 20) + 1}`;
  const baseTime = new Date(startTime);

  const spanIds = {
    root: `span_${uuidv4().slice(0,8)}`,
    intent: `span_${uuidv4().slice(0,8)}`,
    tool: `span_${uuidv4().slice(0,8)}`,
    chain: `span_${uuidv4().slice(0,8)}`,
    llm: `span_${uuidv4().slice(0,8)}`
  };

  const agentEval = {
    score: 4.8,
    reasoning: 'Completed multi-span retrieval and generation successfully.',
    category: 'helpfulness',
    tool_success_rate: 1.0,
    tool_selection_accuracy: 1.0,
    planning_accuracy: 1.0,
    iteration_count: 5,
    goal_completion_rate: 1.0,
    faithfulness: 4.9,
    answer_relevancy: 4.8,
    context_precision: 4.7,
    context_recall: 5.0,
    context_relevance: 4.8,
    hallucination_rate: 0.0,
    recall_at_k: 1.0,
    precision_at_k: 1.0,
    mrr: 1.0
  };

  // 1. Root Agent Span
  insertRequest({
    id: uuidv4(),
    model: modelObj.id,
    input_messages: [{ role: 'user', content: 'I need to check my order status for #98721 and see if there are any updates.' }],
    output_message: { role: 'assistant', content: 'I checked your order #98721 in our database. It has shipped and is currently in transit, expected to arrive by Monday, June 15th.' },
    prompt_tokens: 450,
    completion_tokens: 120,
    total_tokens: 570,
    estimated_cost: (570 / 1_000_000) * modelObj.inCost,
    latency_ms: 2450,
    status: 'success',
    user_id: userId,
    trace_id: traceId,
    span_id: spanIds.root,
    parent_span_id: null,
    span_name: 'Order Lookup Agent',
    span_type: 'agent',
    evaluation: JSON.stringify(agentEval),
    feedback: JSON.stringify({ rating: 5, task_success: true, comment: 'Quick response and detailed status.' }),
    created_at: baseTime.toISOString()
  });

  // Advance time
  baseTime.setMilliseconds(baseTime.getMilliseconds() + 200);

  // 2. Intent Classifier LLM Span
  insertRequest({
    id: uuidv4(),
    model: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    input_messages: [{ role: 'system', content: 'Classify intent of user support query.' }, { role: 'user', content: 'I need to check my order status for #98721 and see if there are any updates.' }],
    output_message: { role: 'assistant', content: '{"intent": "check_order_status", "order_id": "98721"}' },
    prompt_tokens: 150,
    completion_tokens: 25,
    total_tokens: 175,
    estimated_cost: (175 / 1_000_000) * 0.06,
    latency_ms: 450,
    status: 'success',
    user_id: userId,
    trace_id: traceId,
    span_id: spanIds.intent,
    parent_span_id: spanIds.root,
    span_name: 'Intent Classifier',
    span_type: 'llm',
    created_at: baseTime.toISOString()
  });

  baseTime.setMilliseconds(baseTime.getMilliseconds() + 500);

  // 3. Database Lookup Tool Span
  insertRequest({
    id: uuidv4(),
    model: 'database-query',
    input_messages: { action: 'select', table: 'orders', id: '98721' },
    output_message: { status: 'shipped', tracking_num: 'TRK9981881', carrier: 'FedEx', est_delivery: '2026-06-15' },
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    estimated_cost: 0,
    latency_ms: 120,
    status: 'success',
    user_id: userId,
    trace_id: traceId,
    span_id: spanIds.tool,
    parent_span_id: spanIds.root,
    span_name: 'Fetch Order Details DB Tool',
    span_type: 'tool',
    created_at: baseTime.toISOString()
  });

  baseTime.setMilliseconds(baseTime.getMilliseconds() + 200);

  // 4. Formulate Answer Chain Span
  insertRequest({
    id: uuidv4(),
    model: modelObj.id,
    input_messages: { context: 'shipped, FedEx, delivery 2026-06-15' },
    output_message: { status: 'complete' },
    prompt_tokens: 200,
    completion_tokens: 80,
    total_tokens: 280,
    estimated_cost: (280 / 1_000_000) * modelObj.inCost,
    latency_ms: 1500,
    status: 'success',
    user_id: userId,
    trace_id: traceId,
    span_id: spanIds.chain,
    parent_span_id: spanIds.root,
    span_name: 'Response Chain',
    span_type: 'chain',
    created_at: baseTime.toISOString()
  });

  baseTime.setMilliseconds(baseTime.getMilliseconds() + 100);

  // 5. Final LLM Generation (under Chain)
  insertRequest({
    id: uuidv4(),
    model: modelObj.id,
    input_messages: [{ role: 'system', content: 'Generate conversational friendly response based on database status.' }, { role: 'user', content: 'Status: shipped, FedEx, Delivery: June 15th' }],
    output_message: { role: 'assistant', content: 'I checked your order #98721 in our database. It has shipped and is currently in transit, expected to arrive by Monday, June 15th.' },
    prompt_tokens: 200,
    completion_tokens: 80,
    total_tokens: 280,
    estimated_cost: (280 / 1_000_000) * modelObj.inCost,
    latency_ms: 1300,
    status: 'success',
    user_id: userId,
    trace_id: traceId,
    span_id: spanIds.llm,
    parent_span_id: spanIds.chain,
    span_name: 'Generate Response LLM',
    span_type: 'llm',
    created_at: baseTime.toISOString()
  });
}

function seed() {
  console.log('[seed-mock-logs] Seeding mock observability data for the last 30 days...');
  
  // Ensure tables are migrated
  try {
    runMigrations();
  } catch (err) {
    console.warn('[seed-mock-logs] Migration warn:', err.message);
  }

  const db = getDb();
  // Clear existing logs
  db.prepare('DELETE FROM requests').run();
  db.prepare('DELETE FROM conversations').run();
  
  const now = new Date();

  // Seed 5 traces inside the last 7 days
  for (let i = 0; i < 5; i++) {
    const traceDate = new Date();
    traceDate.setDate(now.getDate() - i);
    traceDate.setHours(10 + i, 15, 30);
    generateTraceRun(`trace_session_${i + 1}`, traceDate);
  }

  // Generate logs over 30 days
  for (let day = 0; day < 30; day++) {
    const dayDate = new Date();
    dayDate.setDate(now.getDate() - day);
    
    // Requests volume varies by day of the week (weekend dip)
    const dayOfWeek = dayDate.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const baseVolume = isWeekend ? 10 : 35;
    const dailyRequestsCount = baseVolume + Math.floor(Math.random() * 20);

    console.log(`[seed-mock-logs] Generating ${dailyRequestsCount} requests for day -${day} (${dayDate.toDateString()})...`);

    for (let r = 0; r < dailyRequestsCount; r++) {
      // Set random hour for request
      const reqDate = new Date(dayDate);
      reqDate.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60), Math.floor(Math.random() * 60));

      const isConversation = Math.random() < 0.35; // 35% are part of multi-turn conversation
      if (isConversation) {
        generateConversation(`conv_${uuidv4().slice(0,8)}`, reqDate);
        // Conversations generate 2-5 requests, skip ahead slightly
        r += 2;
      } else {
        // Single turn call
        const modelObj = MODELS[Math.floor(Math.random() * MODELS.length)];
        const model = modelObj.id;
        const isError = Math.random() < 0.04; // 4% error rate
        
        const promptTokens = Math.floor(Math.random() * 150) + 30;
        const completionTokens = isError ? 0 : Math.floor(Math.random() * 250) + 50;
        const totalTokens = promptTokens + completionTokens;
        const latency = isError ? Math.floor(Math.random() * 400) + 100 : Math.floor(Math.random() * 1800) + 300;

        const inputCost = (promptTokens / 1_000_000) * modelObj.inCost;
        const outputCost = (completionTokens / 1_000_000) * modelObj.outCost;
        const estimatedCost = isError ? 0 : Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;

        const inputMsgIndex = Math.floor(Math.random() * MOCK_INPUTS.length);
        const userId = `user_${Math.floor(Math.random() * 25) + 1}`;

        const { evaluation, feedback } = mockEvaluationAndFeedback(!isError);

        insertRequest({
          id: uuidv4(),
          conversation_id: null,
          model: model,
          provider: 'deepinfra',
          input_messages: MOCK_INPUTS[inputMsgIndex],
          output_message: isError ? null : MOCK_OUTPUTS[inputMsgIndex],
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
          estimated_cost: estimatedCost,
          latency_ms: latency,
          status: isError ? 'error' : 'success',
          error_message: isError ? ERROR_MESSAGES[Math.floor(Math.random() * ERROR_MESSAGES.length)] : null,
          temperature: 0.8,
          max_tokens: 512,
          top_p: 0.95,
          user_id: userId,
          metadata: { app: 'test-suite', version: '1.2.0' },
          tags: JSON.stringify(['single-completion', model.split('/')[1]]),
          stream: Math.random() < 0.2,
          raw_request: { model, messages: MOCK_INPUTS[inputMsgIndex], temperature: 0.8 },
          raw_response: isError ? { error: 'mock_error' } : { choices: [{ message: MOCK_OUTPUTS[inputMsgIndex] }] },
          feedback,
          evaluation,
          created_at: reqDate.toISOString()
        });
      }
    }
  }

  console.log('[seed-mock-logs] Mock seeding complete.');
}

if (require.main === module) {
  seed();
}

module.exports = {
  seed,
};
