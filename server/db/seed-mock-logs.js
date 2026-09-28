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

const SINGLE_REQUEST_TEMPLATES = [
  {
    user: 'How do I implement binary search in JavaScript?',
    assistant: 'Here is how you implement binary search in JavaScript:\n\n```js\nfunction binarySearch(arr, target) {\n  let left = 0;\n  let right = arr.length - 1;\n  while (left <= right) {\n    const mid = Math.floor((left + right) / 2);\n    if (arr[mid] === target) return mid;\n    if (arr[mid] < target) left = mid + 1;\n    else right = mid - 1;\n  }\n  return -1;\n}\n```',
    taskType: 'code_generation',
    groundTruth: 'Binary search splits the sorted array in halves with left and right pointers until target is found.'
  },
  {
    user: 'What is the capital of France and its total population?',
    assistant: 'The capital of France is Paris. As of 2026, the estimated population of the city of Paris is approximately 2.1 million people, with the surrounding metropolitan area having over 12 million residents.',
    taskType: 'question_answering',
    groundTruth: 'The capital of France is Paris, with a municipal population of ~2.1 million and metropolitan population exceeding 12 million.'
  },
  {
    user: 'Explain quantum computing in simple terms for a 10 year old.',
    assistant: 'Imagine your computer uses tiny light switches that can only be "on" or "off" (1 or 0). Quantum computers use special "magic switches" that can be both "on" AND "off" at the exact same time! This lets them try thousands of answers all at once, making them super fast at solving tricky puzzles.',
    taskType: 'creative_writing',
    groundTruth: 'Quantum computers use qubits in superposition to evaluate multiple states simultaneously.'
  },
  {
    user: 'Write a python script using regex to parse log lines.',
    assistant: 'Certainly! Here is a simple Python script using regex to parse log lines:\n\n```python\nimport re\n\nlog_pattern = re.compile(r"(\\d{4}-\\d{2}-\\d{2}) (\\w+) (.*)")\nwith open("app.log") as f:\n    for line in f:\n        match = log_pattern.match(line)\n        if match:\n            date, level, msg = match.groups()\n            print(f"{date} [{level}]: {msg}")\n```',
    taskType: 'code_generation',
    groundTruth: 'Python script with regex pattern matching date, level, and message fields from log files.'
  },
  {
    user: 'Suggest 5 names for a new coffee shop near the beach.',
    assistant: 'Here are 5 coastal-inspired coffee shop names:\n1. Coastal Roast\n2. The Salty Mug\n3. Wave & Grind\n4. Ocean Brews\n5. Beachside Beans',
    taskType: 'creative_writing',
    groundTruth: 'Coastal coffee shop name suggestions including coastal or nautical themes.'
  },
  {
    user: 'What are the main differences between SQL and NoSQL databases?',
    assistant: 'SQL databases are relational, table-based, and have strict schemas (great for transactions). NoSQL databases are non-relational, document/key-value based, schema-less, and scale horizontally (great for unstructured, rapid development data).',
    taskType: 'question_answering',
    groundTruth: 'SQL is relational with schemas and ACID transactions; NoSQL is flexible, document/key-value, and distributed.'
  },
  {
    user: 'Summarize the core architectural benefits of microservices compared to monolithic designs.',
    assistant: 'Key microservices advantages:\n1. Independent Scalability: Scale only high-traffic components.\n2. Tech Stack Flexibility: Use optimal languages per service.\n3. Fault Isolation: Single service outages do not crash the entire platform.',
    taskType: 'summarization',
    groundTruth: 'Microservices offer independent scalability, tech agility, and fault tolerance over monoliths.'
  },
  {
    user: 'Translate this customer notification into French: "Your order has shipped and will arrive on Monday."',
    assistant: 'Votre commande a été expédiée et sera livrée lundi.',
    taskType: 'translation',
    groundTruth: 'Votre commande a été expédiée et sera livrée lundi.'
  },
  {
    user: 'Paraphrase this technical warning into customer-friendly language: "504 Gateway Timeout: Upstream socket connection terminated unexpectedly."',
    assistant: 'We are experiencing a temporary delay reaching our server. Please wait a moment and try your request again.',
    taskType: 'paraphrase',
    groundTruth: 'Friendly notification explaining upstream server timeout.'
  },
  {
    user: 'Extract the order ID, customer name, and total amount from: "Order #98721 placed by Alice Johnson for $142.50."',
    assistant: '{\n  "order_id": "98721",\n  "customer_name": "Alice Johnson",\n  "total_amount": 142.50\n}',
    taskType: 'extraction',
    groundTruth: 'JSON object containing order ID 98721, customer Alice Johnson, and total 142.50.'
  }
];

const REALISTIC_CONVERSATION_THREADS = [
  {
    topic: 'algorithm-optimization',
    tags: ['algorithms', 'javascript', 'coding'],
    turns: [
      {
        user: 'How do I implement binary search in JavaScript?',
        assistant: 'Here is how you implement binary search in JavaScript:\n\n```js\nfunction binarySearch(arr, target) {\n  let left = 0;\n  let right = arr.length - 1;\n  while (left <= right) {\n    const mid = Math.floor((left + right) / 2);\n    if (arr[mid] === target) return mid;\n    if (arr[mid] < target) left = mid + 1;\n    else right = mid - 1;\n  }\n  return -1;\n}\n```',
        taskType: 'code_generation',
        groundTruth: 'Binary search splits the sorted array in halves with left and right pointers until target is found.'
      },
      {
        user: 'How can I modify this to return the insertion index if the target is not present?',
        assistant: 'To return the index where target would be inserted in sorted order, simply return `left` instead of `-1` when the loop exits:\n\n```js\nfunction searchInsertIndex(arr, target) {\n  let left = 0;\n  let right = arr.length - 1;\n  while (left <= right) {\n    const mid = Math.floor((left + right) / 2);\n    if (arr[mid] === target) return mid;\n    if (arr[mid] < target) left = mid + 1;\n    else right = mid - 1;\n  }\n  return left; // Target insertion point\n}\n```',
        taskType: 'code_generation',
        groundTruth: 'Return left pointer after loop to find sorted insertion index.'
      },
      {
        user: 'What is the time and space complexity of both approaches?',
        assistant: 'Both implementations share the exact same complexity profile:\n- Time Complexity: O(log n) because the search interval is divided by two on every iteration.\n- Space Complexity: O(1) iterative space complexity since only 3 numeric pointer variables (left, right, mid) are stored.',
        taskType: 'question_answering',
        groundTruth: 'O(log n) time complexity and O(1) auxiliary space complexity.'
      }
    ]
  },
  {
    topic: 'order-support',
    tags: ['support', 'customer-service', 'orders'],
    turns: [
      {
        user: 'Hi, I need to check the delivery status for order #98721.',
        assistant: 'I checked your order #98721 in our records. It was dispatched via FedEx on June 12th and is currently in transit with an estimated delivery date of Monday, June 15th.',
        taskType: 'question_answering',
        groundTruth: 'Order #98721 is in transit via FedEx, expected delivery June 15th.'
      },
      {
        user: 'Can I update the delivery address to my office before it arrives?',
        assistant: 'Because the package has already left our distribution center with FedEx, address updates cannot be processed through our portal directly. However, you can manage the delivery via FedEx Delivery Manager using tracking number TRK9981881 to hold for pickup or redirect.',
        taskType: 'conversation',
        groundTruth: 'Redirect or hold available via FedEx Delivery Manager with tracking TRK9981881.'
      },
      {
        user: 'Understood, thank you! Will someone need to sign for the delivery?',
        assistant: 'Standard residential delivery for order #98721 does not require a physical signature unless you specifically request signature confirmation in FedEx Delivery Manager.',
        taskType: 'question_answering',
        groundTruth: 'No signature required for standard residential delivery on order #98721.'
      }
    ]
  },
  {
    topic: 'database-architecture',
    tags: ['database', 'architecture', 'sql-nosql'],
    turns: [
      {
        user: 'What are the main differences between SQL and NoSQL databases?',
        assistant: 'SQL databases are relational, table-based, and enforce strict predefined schemas with ACID transaction guarantees (ideal for financial records and complex relational queries). NoSQL databases are document or key-value based, schema-less, and scale horizontally (ideal for unstructured events and high-velocity logs).',
        taskType: 'question_answering',
        groundTruth: 'SQL is relational with schemas and ACID transactions; NoSQL is flexible, document/key-value, and distributed.'
      },
      {
        user: 'If we are ingesting 20,000 JSON telemetry events per second, which is more appropriate?',
        assistant: 'For 20,000 JSON events/sec, a distributed NoSQL store (such as Cassandra, ScyllaDB) or a columnar time-series database (such as ClickHouse or TimescaleDB) is far more appropriate. A traditional monolithic SQL database would experience severe write locking and WAL contention at that ingest rate.',
        taskType: 'question_answering',
        groundTruth: 'Columnar or distributed NoSQL databases scale better for 20k events/sec telemetry ingest.'
      },
      {
        user: 'Could we use PostgreSQL partitioned tables with the TimescaleDB extension?',
        assistant: 'Yes, TimescaleDB on PostgreSQL is an excellent choice. It creates automated chunk hypertables by timestamp, provides native columnar compression (saving ~90% storage), and lets you query your data using standard SQL without managing a completely separate database system.',
        taskType: 'question_answering',
        groundTruth: 'TimescaleDB hypertables on PostgreSQL allow high throughput and SQL compatibility.'
      }
    ]
  },
  {
    topic: 'python-devops',
    tags: ['python', 'devops', 'regex'],
    turns: [
      {
        user: 'Write a python script using regex to parse web server access log lines.',
        assistant: 'Here is a simple Python script using regex to parse log lines:\n\n```python\nimport re\n\nLOG_PATTERN = re.compile(r"(?P<ip>[\\d\\.]+) - - \\[(?P<date>.*?)\\] \\\"(?P<method>\\w+) (?P<path>.*?) HTTP/.*\\\" (?P<status>\\d+) (?P<bytes>\\d+)")\n\ndef parse_line(line):\n    m = log_PATTERN.match(line)\n    return m.groupdict() if m else None\n```',
        taskType: 'code_generation',
        groundTruth: 'Python script with regex pattern matching IP, timestamp, method, path, status, and bytes.'
      },
      {
        user: 'How can I count the top 5 most frequently requested URL paths from that output?',
        assistant: 'You can use Python\'s standard `collections.Counter`:\n\n```python\nfrom collections import Counter\n\ndef get_top_endpoints(log_lines, top_n=5):\n    counts = Counter()\n    for line in log_lines:\n        parsed = parse_line(line)\n        if parsed:\n            counts[parsed["path"]] += 1\n    return counts.most_common(top_n)\n```',
        taskType: 'code_generation',
        groundTruth: 'Use collections.Counter to track parsed path occurrences and call most_common(5).'
      }
    ]
  },
  {
    topic: 'french-localization',
    tags: ['translation', 'localization', 'french'],
    turns: [
      {
        user: 'Translate this customer notification into French: "Your order has shipped and will arrive on Monday."',
        assistant: 'Votre commande a été expédiée et sera livrée lundi.',
        taskType: 'translation',
        groundTruth: 'Votre commande a été expédiée et sera livrée lundi.'
      },
      {
        user: 'Make it sound slightly more formal and polite for enterprise clients.',
        assistant: 'Nous avons le plaisir de vous informer que votre commande a été expédiée. La livraison est prévue pour ce lundi.',
        taskType: 'paraphrase',
        groundTruth: 'Formal French business phrasing for order shipment notification.'
      }
    ]
  },
  {
    topic: 'microservices-design',
    tags: ['architecture', 'microservices', 'systems'],
    turns: [
      {
        user: 'Summarize the core architectural benefits of microservices compared to monolithic designs.',
        assistant: 'Key microservices advantages:\n1. Independent Scalability: Scale only high-traffic components.\n2. Tech Stack Flexibility: Use optimal languages per service.\n3. Fault Isolation: Single service outages do not crash the entire platform.',
        taskType: 'summarization',
        groundTruth: 'Microservices offer independent scalability, tech agility, and fault tolerance over monoliths.'
      },
      {
        user: 'What are the main operational challenges when adopting this model?',
        assistant: 'The main operational challenges are:\n1. Distributed Observability: Tracing requests across dozens of network boundaries requires unified tracing (like OpenTelemetry / InfraSight).\n2. Network Overhead: Inter-service communication adds latency and potential network failure points.\n3. Eventual Consistency: Maintaining cross-service transactional integrity requires distributed sagas instead of ACID transactions.',
        taskType: 'summarization',
        groundTruth: 'Challenges include distributed tracing complexity, network latency, and eventual consistency.'
      }
    ]
  }
];

const ERROR_MESSAGES = [
  'Authorization failed: Invalid API Key',
  'DeepInfra API is currently overloaded. Please try again later.',
  'Rate limit exceeded (429 Too Many Requests)',
  'Network error: connection timed out'
];

/**
 * Generates mock evaluations and feedbacks with complete coverage of all metric types.
 */
function mockEvaluationAndFeedback(isSuccess, taskType = 'general', groundTruth = '') {
  if (!isSuccess) return { evaluation: null, feedback: null };
  // Keep 5% unscored so user can experiment with manual rating, while 95% show complete evaluations
  if (Math.random() > 0.95) return { evaluation: null, feedback: null };

  const rating = Math.random() < 0.05 ? 2 : (Math.random() < 0.1 ? 3 : (Math.random() < 0.4 ? 4 : 5));
  const task_success = rating >= 4;

  const feedback = {
    rating,
    comment: rating <= 3 ? 'Acceptable response, but could be more concise.' : 'Highly accurate answer matching expected output perfectly.',
    task_success,
    expected_answer: groundTruth || 'Expected reference answer matching domain guidelines.'
  };

  const score = Math.max(1.0, Math.min(5.0, Math.round((rating + (Math.random() * 0.4 - 0.2)) * 10) / 10));

  const taskMetricMap = {
    summarization:     ['conciseness', 'information_retention', 'coherence', 'instruction_following', 'completeness'],
    paraphrase:        ['semantic_preservation', 'lexical_diversity', 'fluency', 'instruction_following', 'coherence'],
    translation:       ['semantic_preservation', 'fluency', 'instruction_following', 'coherence', 'completeness'],
    question_answering:['completeness', 'coherence', 'instruction_following', 'fluency', 'information_retention'],
    code_generation:   ['code_correctness', 'completeness', 'instruction_following', 'readability', 'code_efficiency'],
    creative_writing:  ['creativity', 'fluency', 'coherence', 'instruction_following', 'lexical_diversity'],
    extraction:        ['completeness', 'instruction_following', 'information_retention', 'coherence', 'conciseness'],
    conversation:      ['coherence', 'fluency', 'instruction_following', 'completeness', 'conversational_flow'],
    general:           ['coherence', 'instruction_following', 'completeness', 'fluency', 'conciseness']
  };

  const taskMetrics = taskMetricMap[taskType] || taskMetricMap.general;

  const evaluation = {
    score,
    reasoning: `AI Judge assessed response for ${taskType.replace(/_/g, ' ')}. Instructions were followed rigorously with high factual precision and clarity.`,
    category: score >= 4.5 ? 'helpfulness' : (score >= 4.0 ? 'clarity' : 'relevance'),
    task_type: taskType,
    task_metrics: taskMetrics,
    safety: {
      status: 'safe',
      reasoning: 'Input query and model response strictly adhere to safety and content policy guidelines.'
    },
    exact_match: Math.random() < 0.25 ? 1 : 0,
    f1_score: Math.round((0.75 + Math.random() * 0.22) * 100) / 100,
    bleu: Math.round((0.55 + Math.random() * 0.40) * 100) / 100,
    rouge_1: Math.round((0.70 + Math.random() * 0.25) * 100) / 100,
    rouge_2: Math.round((0.60 + Math.random() * 0.30) * 100) / 100,
    rouge_l: Math.round((0.65 + Math.random() * 0.30) * 100) / 100,
  };

  // Add individual task metric scores (1.0 to 5.0)
  for (const m of taskMetrics) {
    evaluation[m] = Math.max(1.0, Math.min(5.0, Math.round((score + (Math.random() * 0.6 - 0.3)) * 10) / 10));
  }

  // RAG metrics for QA, summarization, conversation and extraction
  if (taskType === 'question_answering' || taskType === 'summarization' || taskType === 'extraction' || taskType === 'conversation') {
    evaluation.faithfulness = Math.round((4.0 + Math.random() * 1.0) * 10) / 10;
    evaluation.answer_relevancy = Math.round((4.2 + Math.random() * 0.8) * 10) / 10;
    evaluation.context_precision = Math.round((3.9 + Math.random() * 1.1) * 10) / 10;
    evaluation.context_recall = Math.round((4.1 + Math.random() * 0.9) * 10) / 10;
    evaluation.context_relevance = Math.round((4.0 + Math.random() * 1.0) * 10) / 10;
    evaluation.hallucination_rate = Math.round((Math.random() * 0.08) * 100) / 100;
    evaluation.recall_at_k = Math.round((0.85 + Math.random() * 0.15) * 100) / 100;
    evaluation.precision_at_k = Math.round((0.80 + Math.random() * 0.20) * 100) / 100;
    evaluation.mrr = Math.round((0.90 + Math.random() * 0.10) * 100) / 100;
  }

  // Agent metrics for code generation and multi-step tasks
  if (taskType === 'code_generation') {
    evaluation.tool_success_rate = 1.0;
    evaluation.tool_selection_accuracy = 1.0;
    evaluation.planning_accuracy = Math.round((0.85 + Math.random() * 0.15) * 100) / 100;
    evaluation.iteration_count = Math.floor(Math.random() * 3) + 2;
    evaluation.goal_completion_rate = 1.0;
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
  const thread = REALISTIC_CONVERSATION_THREADS[Math.floor(Math.random() * REALISTIC_CONVERSATION_THREADS.length)];

  let currentTimestamp = new Date(startTime);
  const history = [];

  for (let i = 0; i < thread.turns.length; i++) {
    const turn = thread.turns[i];
    const isError = Math.random() < 0.02; // 2% error rate in conversations
    const model = modelObj.id;

    const messages = [...history, { role: 'user', content: turn.user }];
    const outputMessage = isError ? null : { role: 'assistant', content: turn.assistant };

    // Record for subsequent turns in this conversation
    history.push({ role: 'user', content: turn.user });
    if (!isError) {
      history.push({ role: 'assistant', content: turn.assistant });
    }

    const promptTokens = Math.floor(Math.random() * 100) + 80 + (i * 120);
    const completionTokens = isError ? 0 : Math.floor(Math.random() * 150) + 60;
    const totalTokens = promptTokens + completionTokens;
    const latency = isError ? Math.floor(Math.random() * 400) + 100 : Math.floor(Math.random() * 1400) + 400;

    const inputCost = (promptTokens / 1_000_000) * modelObj.inCost;
    const outputCost = (completionTokens / 1_000_000) * modelObj.outCost;
    const estimatedCost = isError ? 0 : Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;

    const { evaluation, feedback } = mockEvaluationAndFeedback(!isError, turn.taskType, turn.groundTruth);

    insertRequest({
      id: uuidv4(),
      conversation_id: convId,
      model: model,
      provider: 'deepinfra',
      input_messages: messages,
      output_message: outputMessage,
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
      metadata: { environment: Math.random() < 0.8 ? 'production' : 'staging', topic: thread.topic },
      tags: JSON.stringify(['chat', ...thread.tags, model.split('/')[1]]),
      stream: Math.random() < 0.5,
      raw_request: { model, messages, stream: Math.random() < 0.5, temperature: 0.7 },
      raw_response: isError ? { error: 'mock_error' } : { choices: [{ message: outputMessage }] },
      feedback,
      evaluation,
      created_at: currentTimestamp.toISOString()
    });

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

        const template = SINGLE_REQUEST_TEMPLATES[Math.floor(Math.random() * SINGLE_REQUEST_TEMPLATES.length)];
        const userId = `user_${Math.floor(Math.random() * 25) + 1}`;

        const { evaluation, feedback } = mockEvaluationAndFeedback(!isError, template.taskType, template.groundTruth);

        const inputMessages = [{ role: 'user', content: template.user }];
        const outputMessage = isError ? null : { role: 'assistant', content: template.assistant };

        insertRequest({
          id: uuidv4(),
          conversation_id: null,
          model: model,
          provider: 'deepinfra',
          input_messages: inputMessages,
          output_message: outputMessage,
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
          tags: JSON.stringify(['single-completion', template.taskType, model.split('/')[1]]),
          stream: Math.random() < 0.2,
          raw_request: { model, messages: inputMessages, temperature: 0.8 },
          raw_response: isError ? { error: 'mock_error' } : { choices: [{ message: outputMessage }] },
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
