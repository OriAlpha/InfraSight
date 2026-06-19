/**
 * Transparent proxy router for OpenAI-compatible API providers.
 * Captures request/response data and logs to the database.
 *
 * The upstream provider is configurable via dynamic database settings:
 *   UPSTREAM_API_BASE  – Base URL (default: https://api.deepinfra.com)
 *   UPSTREAM_PROVIDER   – Provider name for DB records (default: deepinfra)
 *   UPSTREAM_API_KEY    – API key (falls back to DEEPINFRA_API_KEY)
 *
 * Mount at: /api/proxy
 *
 * @module proxy/index
 */
'use strict';

const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const { insertRequest, updateEvaluation } = require('../db');
const { queueEvaluation } = require('../services/evaluator');
const { maskPii, maskString } = require('../utils/pii');
const { getConfig } = require('../utils/config');
const { sendWebhookAlert } = require('../utils/alerts');

const router = Router();

/**
 * Retrieves the consolidated dynamic proxy config for the request.
 * @returns {Promise<Object>}
 */
async function getProxyConfig() {
  const upstreamBase = await getConfig('UPSTREAM_API_BASE');
  const deepinfraBase = process.env.DEEPINFRA_BASE_URL;
  const upstreamBaseUrl = upstreamBase || deepinfraBase || 'https://api.deepinfra.com';

  const providerName = (await getConfig('UPSTREAM_PROVIDER')) || 'deepinfra';
  const providerDisplay = providerName.charAt(0).toUpperCase() + providerName.slice(1);

  const logPayloadsSetting = await getConfig('LOG_PAYLOADS');
  const logPayloads = logPayloadsSetting !== 'false';

  const maskPiiSetting = await getConfig('MASK_PII');
  const maskPiiEnabled = maskPiiSetting !== 'false';

  const activePiiRedactionSetting = await getConfig('ACTIVE_PII_REDACTION');
  const activePiiRedaction = activePiiRedactionSetting === 'true';

  const bannedKeywordsSetting = await getConfig('BANNED_KEYWORDS');
  const bannedKeywordsStr = bannedKeywordsSetting || 'exploit,jailbreak,bypass,malware';

  const upstreamKey = await getConfig('UPSTREAM_API_KEY');
  const apiKey = upstreamKey || process.env.DEEPINFRA_API_KEY;

  return {
    upstreamBaseUrl,
    providerName,
    providerDisplay,
    logPayloads,
    maskPiiEnabled,
    activePiiRedaction,
    bannedKeywordsStr,
    apiKey,
  };
}

/**
 * Safely masks or disables payload inputs based on configuration.
 * @param {any} data - Raw request/response data
 * @param {string} type - 'input', 'output', or 'raw'
 * @param {Object} cfg - Proxy config
 * @returns {any} Masked data or placeholder
 */
function getLogPayload(data, type, cfg) {
  if (!cfg.logPayloads) {
    if (type === 'input') {
      return [{ role: 'system', content: '[Payload logging disabled]' }];
    }
    if (type === 'output') {
      return { role: 'assistant', content: '[Payload logging disabled]' };
    }
    return { info: 'Payload logging disabled' };
  }
  return cfg.maskPiiEnabled ? maskPii(data) : data;
}

/**
 * Builds the full upstream URL for a given proxy path.
 * @param {string} targetPath
 * @param {Object} cfg - Proxy config
 * @returns {string} Fully-qualified upstream URL
 */
function getTargetUrl(targetPath, cfg) {
  if (cfg.providerName === 'deepinfra') {
    return `${cfg.upstreamBaseUrl}/${targetPath}`;
  }
  let normalizedPath = targetPath;
  if (normalizedPath.startsWith('v1/openai/')) {
    normalizedPath = normalizedPath.slice('v1/openai/'.length);
  } else if (normalizedPath.startsWith('v1/')) {
    if (cfg.upstreamBaseUrl.replace(/\/+$/, '').endsWith('/v1')) {
      normalizedPath = normalizedPath.slice('v1/'.length);
    }
  }
  return `${cfg.upstreamBaseUrl.replace(/\/+$/, '')}/${normalizedPath}`;
}

let modelsCache = null;
let modelsCacheTime = 0;

/**
 * In-memory models lookup cache.
 */
async function getCachedModel(modelId) {
  const now = Date.now();
  if (!modelsCache || now - modelsCacheTime > 30000) {
    try {
      const modelsList = await require('../db').getModels();
      modelsCache = modelsList || [];
      modelsCacheTime = now;
    } catch (err) {
      console.error('[proxy] Error fetching models for cost estimation:', err.message);
      return null;
    }
  }
  return modelsCache.find(m => m.id === modelId) || null;
}

/**
 * Estimates the cost of a request based on model pricing in the database.
 * @param {string} model - Model ID
 * @param {number} promptTokens
 * @param {number} completionTokens
 * @returns {Promise<number>} Estimated cost in dollars
 */
async function estimateCost(model, promptTokens, completionTokens) {
  try {
    const modelRow = await getCachedModel(model);
    if (!modelRow) return 0;

    const inputCost = (promptTokens / 1_000_000) * modelRow.input_cost_per_million;
    const outputCost = (completionTokens / 1_000_000) * modelRow.output_cost_per_million;
    return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
  } catch {
    return 0;
  }
}

/**
 * Builds the authorization header value for proxied requests.
 * @param {import('express').Request} req
 * @param {Object} cfg - Proxy config
 * @returns {string|undefined}
 */
function getAuthHeader(req, cfg) {
  if (req.headers.authorization) {
    return req.headers.authorization;
  }
  if (cfg.apiKey) {
    return `Bearer ${cfg.apiKey}`;
  }
  return undefined;
}

/**
 * Parses accumulated SSE chunks to extract the final assistant message and usage data.
 * @param {string[]} chunks
 * @returns {{ content: string, usage: { prompt_tokens: number, completion_tokens: number, total_tokens: number } | null, finishReason: string|null }}
 */
function parseSSEChunks(chunks) {
  let content = '';
  let usage = null;
  let finishReason = null;

  for (const chunk of chunks) {
    if (chunk === '[DONE]') continue;

    try {
      const parsed = JSON.parse(chunk);

      if (parsed.choices && parsed.choices.length > 0) {
        const choice = parsed.choices[0];
        if (choice.delta && choice.delta.content) {
          content += choice.delta.content;
        }
        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }
      }

      if (parsed.usage) {
        usage = {
          prompt_tokens: parsed.usage.prompt_tokens || 0,
          completion_tokens: parsed.usage.completion_tokens || 0,
          total_tokens: parsed.usage.total_tokens || 0,
        };
      }
    } catch {
      // Skip
    }
  }

  return { content, usage, finishReason };
}

/**
 * Simulates a mock request with 70% success and 30% failure rate when API key is missing.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {Object} requestBody
 * @param {Object} cfg
 */
async function handleMockRequest(req, res, requestBody, cfg) {
  const requestId = uuidv4();
  const startTime = Date.now();
  const isStreaming = requestBody.stream === true;
  const model = requestBody.model || 'meta-llama/Meta-Llama-3.1-8B-Instruct';
  const traceId = requestBody.trace_id || req.headers['x-trace-id'] || null;
  const spanId = requestBody.span_id || req.headers['x-span-id'] || null;
  const parentSpanId = requestBody.parent_span_id || req.headers['x-parent-span-id'] || null;
  const spanName = requestBody.span_name || req.headers['x-span-name'] || (traceId ? `${cfg.providerDisplay} - ${model}` : null);
  const spanType = requestBody.span_type || req.headers['x-span-type'] || (traceId ? 'llm' : null);
  const spanStatus = req.headers['x-span-status'] || requestBody.span_status || null;

  const isTool = spanType === 'tool' || spanType === 'chain' || model.includes('db') || model.includes('service') || model.includes('custom');
  let isSuccess = isTool ? true : (Math.random() < 0.7);

  if (req.headers['x-simulate-error'] === 'true' || model.includes('non-existent') || requestBody.temperature > 2.0) {
    isSuccess = false;
  } else if (req.headers['x-simulate-success'] === 'true') {
    isSuccess = true;
  }

  const latencyMs = Math.floor(Math.random() * 250) + 80;

  if (isSuccess) {
    const promptTokens = Math.floor(Math.random() * 40) + 15;
    const completionTokens = Math.floor(Math.random() * 80) + 20;
    const totalTokens = promptTokens + completionTokens;
    const mockContent = `This is a mock successful completion from the InfraSight proxy for model ${model}. (No real API key was configured for provider "${cfg.providerName}").`;

    const responseBody = {
      id: `chatcmpl-${uuidv4().substring(0, 8)}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: mockContent,
          },
          finish_reason: 'stop',
        }
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
      }
    };

    if (isStreaming) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const chunkId = `chatcmpl-${uuidv4().substring(0, 8)}`;
      const chunk = {
        id: chunkId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: mockContent },
            finish_reason: null
          }
        ]
      };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);

      const finalChunk = {
        id: chunkId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop'
          }
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
        }
      };
      res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.status(200).json(responseBody);
    }

    try {
      const cost = await estimateCost(model, promptTokens, completionTokens);
      await insertRequest({
        id: requestId,
        conversation_id: requestBody.conversation_id || req.headers['x-conversation-id'] || null,
        model,
        provider: cfg.providerName,
        input_messages: getLogPayload(requestBody.messages || [], 'input', cfg),
        output_message: getLogPayload({ role: 'assistant', content: mockContent }, 'output', cfg),
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        estimated_cost: cost,
        latency_ms: latencyMs,
        status: spanStatus || 'success',
        error_message: null,
        temperature: requestBody.temperature,
        max_tokens: requestBody.max_tokens,
        top_p: requestBody.top_p,
        frequency_penalty: requestBody.frequency_penalty,
        presence_penalty: requestBody.presence_penalty,
        user_id: requestBody.user || req.headers['x-user-id'] || null,
        metadata: requestBody.metadata || null,
        tags: null,
        stream: isStreaming,
        raw_request: getLogPayload(requestBody, 'raw', cfg),
        raw_response: getLogPayload(responseBody, 'raw', cfg),
        trace_id: traceId,
        span_id: spanId,
        parent_span_id: parentSpanId,
        span_name: spanName,
        span_type: spanType,
      });

      // Background alert dispatch
      sendWebhookAlert({
        id: requestId,
        model,
        latency_ms: latencyMs,
        status: spanStatus || 'success',
        error_message: null
      }).catch(err => console.error('[proxy] Alert dispatch error:', err.message));

      let taskType = 'general';
      let taskMetrics = ['coherence', 'instruction_following', 'completeness', 'fluency', 'conciseness'];
      const text = JSON.stringify(requestBody.messages || {}).toLowerCase();
      
      const evalObj = {
        score: parseFloat((Math.random() * 1.2 + 3.8).toFixed(1)),
        reasoning: 'The model outputs are clear, correct, and address the user intent directly.',
        category: 'helpfulness',
      };

      if (text.includes('summarize') || text.includes('summary')) {
        taskType = 'summarization';
        taskMetrics = ['conciseness', 'information_retention', 'coherence', 'instruction_following', 'completeness'];
        evalObj.conciseness = parseFloat((Math.random() * 1 + 4).toFixed(1));
        evalObj.information_retention = parseFloat((Math.random() * 1 + 4).toFixed(1));
        evalObj.coherence = parseFloat((Math.random() * 1 + 4).toFixed(1));
        evalObj.instruction_following = parseFloat((Math.random() * 1 + 4).toFixed(1));
        evalObj.completeness = parseFloat((Math.random() * 1 + 4).toFixed(1));
      } else if (text.includes('paraphrase') || text.includes('rephrase') || text.includes('reword') || text.includes('rewrite')) {
        taskType = 'paraphrase';
        taskMetrics = ['semantic_preservation', 'lexical_diversity', 'fluency', 'instruction_following', 'coherence'];
        evalObj.semantic_preservation = parseFloat((Math.random() * 1 + 4).toFixed(1));
        evalObj.lexical_diversity = parseFloat((Math.random() * 1 + 4).toFixed(1));
        evalObj.fluency = parseFloat((Math.random() * 1 + 4).toFixed(1));
        evalObj.instruction_following = parseFloat((Math.random() * 1 + 4).toFixed(1));
        evalObj.coherence = parseFloat((Math.random() * 1 + 4).toFixed(1));
      } else if (text.includes('code') || text.includes('function') || text.includes('javascript') || text.includes('python')) {
        taskType = 'code_generation';
        taskMetrics = ['code_correctness', 'completeness', 'instruction_following', 'readability', 'code_efficiency'];
        evalObj.code_correctness = parseFloat((Math.random() * 1 + 4).toFixed(1));
        evalObj.completeness = parseFloat((Math.random() * 1 + 4).toFixed(1));
        evalObj.instruction_following = parseFloat((Math.random() * 1 + 4).toFixed(1));
        evalObj.readability = parseFloat((Math.random() * 1 + 4).toFixed(1));
        evalObj.code_efficiency = parseFloat((Math.random() * 1 + 4).toFixed(1));
      } else if (spanType === 'tool') {
        taskType = 'general';
        taskMetrics = ['coherence', 'instruction_following', 'completeness', 'fluency', 'conciseness'];
        evalObj.score = 5.0;
        evalObj.reasoning = 'Tool execution completed successfully with expected outputs.';
        evalObj.coherence = 5.0;
        evalObj.instruction_following = 5.0;
        evalObj.completeness = 5.0;
        evalObj.fluency = 5.0;
        evalObj.conciseness = 5.0;
      } else {
        evalObj.coherence = parseFloat((Math.random() * 1 + 4).toFixed(1));
        evalObj.instruction_following = parseFloat((Math.random() * 1 + 4).toFixed(1));
        evalObj.completeness = parseFloat((Math.random() * 1 + 4).toFixed(1));
        evalObj.fluency = parseFloat((Math.random() * 1 + 4).toFixed(1));
        evalObj.conciseness = parseFloat((Math.random() * 1 + 4).toFixed(1));
      }

      evalObj.task_type = taskType;
      evalObj.task_metrics = taskMetrics;

      await updateEvaluation(requestId, evalObj);
    } catch (logError) {
      console.error('[proxy] Error logging mock success:', logError.message);
    }

  } else {
    let errorCode = 'mock_api_error';
    let errorMessage = req.headers['x-error-message'] || `Simulated request failure: No valid API key was provided for provider "${cfg.providerName}", and the proxy randomly failed this request to simulate error handling (30% error rate).`;
    let errorType = 'invalid_request_error';

    if (req.headers['x-error-message']) {
      errorCode = 'tool_execution_failed';
    } else if (model.includes('non-existent')) {
      errorCode = 'model_not_found';
      errorMessage = `Model "${model}" not found or access denied. Please check model name or subscription status.`;
    } else if (requestBody.temperature > 2.0) {
      errorCode = 'invalid_parameter';
      errorMessage = `Invalid parameter: temperature must be between 0.0 and 2.0 (got ${requestBody.temperature}).`;
    }

    const errorBody = {
      error: {
        message: errorMessage,
        type: errorType,
        param: null,
        code: errorCode,
      }
    };

    res.status(400).json(errorBody);

    try {
      await insertRequest({
        id: requestId,
        conversation_id: requestBody.conversation_id || req.headers['x-conversation-id'] || null,
        model,
        provider: cfg.providerName,
        input_messages: getLogPayload(requestBody.messages || [], 'input', cfg),
        output_message: null,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        estimated_cost: 0,
        latency_ms: latencyMs,
        status: spanStatus || 'error',
        error_message: errorMessage,
        temperature: requestBody.temperature,
        max_tokens: requestBody.max_tokens,
        top_p: requestBody.top_p,
        frequency_penalty: requestBody.frequency_penalty,
        presence_penalty: requestBody.presence_penalty,
        user_id: requestBody.user || req.headers['x-user-id'] || null,
        stream: isStreaming,
        raw_request: getLogPayload(requestBody, 'raw', cfg),
        raw_response: getLogPayload(errorBody, 'raw', cfg),
        trace_id: traceId,
        span_id: spanId,
        parent_span_id: parentSpanId,
        span_name: spanName,
        span_type: spanType,
      });

      // Background alert dispatch
      sendWebhookAlert({
        id: requestId,
        model,
        latency_ms: latencyMs,
        status: spanStatus || 'error',
        error_message: errorMessage
      }).catch(err => console.error('[proxy] Alert dispatch error:', err.message));
    } catch (logError) {
      console.error('[proxy] Error logging mock failure:', logError.message);
    }
  }
}

/**
 * Handles non-streaming proxy requests.
 */
async function handleNonStreamingRequest(req, res, targetUrl, requestBody, cfg) {
  const requestId = uuidv4();
  const startTime = Date.now();
  const spanStatus = req.headers['x-span-status'] || requestBody.span_status || null;

  try {
    const headers = {
      'Content-Type': 'application/json',
    };
    const auth = getAuthHeader(req, cfg);
    if (auth) headers['Authorization'] = auth;

    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(120000),
    });

    const latencyMs = Date.now() - startTime;
    const responseBody = await response.json();

    res.status(response.status).json(responseBody);

    try {
      const usage = responseBody.usage || {};
      let promptTokens = usage.prompt_tokens || 0;
      let completionTokens = usage.completion_tokens || 0;

      const outputMessage = responseBody.choices && responseBody.choices.length > 0
        ? responseBody.choices[0].message
        : null;

      if (promptTokens === 0 && completionTokens === 0) {
        let promptChars = 0;
        if (Array.isArray(requestBody.messages)) {
          requestBody.messages.forEach(m => {
            promptChars += (m.content || '').length;
            promptChars += (m.role || '').length;
          });
        }
        promptTokens = Math.max(1, Math.ceil(promptChars / 4));
        const outputText = outputMessage ? (typeof outputMessage === 'string' ? outputMessage : outputMessage.content || '') : '';
        completionTokens = Math.max(1, Math.ceil(outputText.length / 4));
      }

      const totalTokens = usage.total_tokens || promptTokens + completionTokens;
      const model = requestBody.model || responseBody.model || 'unknown';

      const traceId = requestBody.trace_id || req.headers['x-trace-id'] || null;
      const spanId = requestBody.span_id || req.headers['x-span-id'] || null;
      const parentSpanId = requestBody.parent_span_id || req.headers['x-parent-span-id'] || null;
      const spanName = requestBody.span_name || req.headers['x-span-name'] || (traceId ? `${cfg.providerDisplay} - ${model}` : null);
      const spanType = requestBody.span_type || req.headers['x-span-type'] || (traceId ? 'llm' : null);

      const computedCost = responseBody.usage && responseBody.usage.estimated_cost != null
        ? responseBody.usage.estimated_cost
        : await estimateCost(model, promptTokens, completionTokens);

      const finalStatus = spanStatus || (response.ok ? 'success' : 'error');
      const finalErrorMsg = response.ok ? null : (responseBody.error?.message || JSON.stringify(responseBody.error) || `HTTP ${response.status}`);

      await insertRequest({
        id: requestId,
        conversation_id: requestBody.conversation_id || req.headers['x-conversation-id'] || null,
        model,
        provider: cfg.providerName,
        input_messages: getLogPayload(requestBody.messages || [], 'input', cfg),
        output_message: outputMessage ? getLogPayload(outputMessage, 'output', cfg) : null,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        estimated_cost: computedCost,
        latency_ms: latencyMs,
        status: finalStatus,
        error_message: finalErrorMsg,
        temperature: requestBody.temperature,
        max_tokens: requestBody.max_tokens,
        top_p: requestBody.top_p,
        frequency_penalty: requestBody.frequency_penalty,
        presence_penalty: requestBody.presence_penalty,
        user_id: requestBody.user || req.headers['x-user-id'] || null,
        metadata: requestBody.metadata || null,
        tags: null,
        stream: false,
        raw_request: getLogPayload(requestBody, 'raw', cfg),
        raw_response: getLogPayload(responseBody, 'raw', cfg),
        trace_id: traceId,
        span_id: spanId,
        parent_span_id: parentSpanId,
        span_name: spanName,
        span_type: spanType,
      });

      // Background alert dispatch
      sendWebhookAlert({
        id: requestId,
        model,
        latency_ms: latencyMs,
        status: finalStatus,
        error_message: finalErrorMsg
      }).catch(err => console.error('[proxy] Alert dispatch error:', err.message));

      queueEvaluation(requestId);
    } catch (logError) {
      console.error('[proxy] Error logging request:', logError.message);
    }
  } catch (err) {
    const latencyMs = Date.now() - startTime;

    try {
      const model = requestBody.model || 'unknown';
      const traceId = requestBody.trace_id || req.headers['x-trace-id'] || null;
      const spanId = requestBody.span_id || req.headers['x-span-id'] || null;
      const parentSpanId = requestBody.parent_span_id || req.headers['x-parent-span-id'] || null;
      const spanName = requestBody.span_name || req.headers['x-span-name'] || (traceId ? `${cfg.providerDisplay} - ${model}` : null);
      const spanType = requestBody.span_type || req.headers['x-span-type'] || (traceId ? 'llm' : null);

      await insertRequest({
        id: requestId,
        conversation_id: requestBody.conversation_id || req.headers['x-conversation-id'] || null,
        model,
        provider: cfg.providerName,
        input_messages: getLogPayload(requestBody.messages || [], 'input', cfg),
        output_message: null,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        estimated_cost: 0,
        latency_ms: latencyMs,
        status: spanStatus || 'error',
        error_message: err.message,
        temperature: requestBody.temperature,
        max_tokens: requestBody.max_tokens,
        top_p: requestBody.top_p,
        frequency_penalty: requestBody.frequency_penalty,
        presence_penalty: requestBody.presence_penalty,
        user_id: requestBody.user || req.headers['x-user-id'] || null,
        stream: false,
        raw_request: getLogPayload(requestBody, 'raw', cfg),
        raw_response: null,
        trace_id: traceId,
        span_id: spanId,
        parent_span_id: parentSpanId,
        span_name: spanName,
        span_type: spanType,
      });

      // Background alert dispatch
      sendWebhookAlert({
        id: requestId,
        model,
        latency_ms: latencyMs,
        status: spanStatus || 'error',
        error_message: err.message
      }).catch(err => console.error('[proxy] Alert dispatch error:', err.message));
    } catch (logError) {
      console.error('[proxy] Error logging failed request:', logError.message);
    }

    if (!res.headersSent) {
      res.status(502).json({ error: { message: 'Proxy error: ' + err.message } });
    }
  }
}

/**
 * Handles streaming proxy requests (SSE).
 */
async function handleStreamingRequest(req, res, targetUrl, requestBody, cfg) {
  const requestId = uuidv4();
  const startTime = Date.now();
  const spanStatus = req.headers['x-span-status'] || requestBody.span_status || null;

  try {
    const headers = {
      'Content-Type': 'application/json',
    };
    const auth = getAuthHeader(req, cfg);
    if (auth) headers['Authorization'] = auth;

    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      const latencyMs = Date.now() - startTime;
      let errorBody;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = { error: { message: `HTTP ${response.status}` } };
      }

      res.status(response.status).json(errorBody);

      try {
        const model = requestBody.model || 'unknown';
        const traceId = requestBody.trace_id || req.headers['x-trace-id'] || null;
        const spanId = requestBody.span_id || req.headers['x-span-id'] || null;
        const parentSpanId = requestBody.parent_span_id || req.headers['x-parent-span-id'] || null;
        const spanName = requestBody.span_name || req.headers['x-span-name'] || (traceId ? `${cfg.providerDisplay} - ${model}` : null);
        const spanType = requestBody.span_type || req.headers['x-span-type'] || (traceId ? 'llm' : null);

        const errorMsg = errorBody.error?.message || `HTTP ${response.status}`;

        await insertRequest({
          id: requestId,
          conversation_id: requestBody.conversation_id || req.headers['x-conversation-id'] || null,
          model,
          provider: cfg.providerName,
          input_messages: getLogPayload(requestBody.messages || [], 'input', cfg),
          output_message: null,
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          estimated_cost: 0,
          latency_ms: latencyMs,
          status: 'error',
          error_message: errorMsg,
          temperature: requestBody.temperature,
          max_tokens: requestBody.max_tokens,
          top_p: requestBody.top_p,
          frequency_penalty: requestBody.frequency_penalty,
          presence_penalty: requestBody.presence_penalty,
          user_id: requestBody.user || req.headers['x-user-id'] || null,
          stream: true,
          raw_request: getLogPayload(requestBody, 'raw', cfg),
          raw_response: getLogPayload(errorBody, 'raw', cfg),
          trace_id: traceId,
          span_id: spanId,
          parent_span_id: parentSpanId,
          span_name: spanName,
          span_type: spanType,
        });

        // Background alert dispatch
        sendWebhookAlert({
          id: requestId,
          model,
          latency_ms: latencyMs,
          status: 'error',
          error_message: errorMsg
        }).catch(err => console.error('[proxy] Alert dispatch error:', err.message));
      } catch (logError) {
        console.error('[proxy] Error logging failed stream request:', logError.message);
      }
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Request-Id', requestId);
    res.flushHeaders();

    const sseChunks = [];
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        res.write(text);
        buffer += text;

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            sseChunks.push(data);
          }
        }
      }

      if (buffer.trim().startsWith('data: ')) {
        sseChunks.push(buffer.trim().slice(6));
      }
    } catch (streamErr) {
      console.error('[proxy] Stream read error:', streamErr.message);
    }

    res.end();

    const latencyMs = Date.now() - startTime;

    try {
      const { content, usage, finishReason } = parseSSEChunks(sseChunks);
      const model = requestBody.model || 'unknown';
      let promptTokens = usage ? usage.prompt_tokens : 0;
      let completionTokens = usage ? usage.completion_tokens : 0;

      if (!usage) {
        let promptChars = 0;
        if (Array.isArray(requestBody.messages)) {
          requestBody.messages.forEach(m => {
            promptChars += (m.content || '').length;
            promptChars += (m.role || '').length;
          });
        }
        promptTokens = Math.max(1, Math.ceil(promptChars / 4));
        completionTokens = Math.max(1, Math.ceil((content || '').length / 4));
      }

      const totalTokens = usage ? usage.total_tokens : promptTokens + completionTokens;

      const traceId = requestBody.trace_id || req.headers['x-trace-id'] || null;
      const spanId = requestBody.span_id || req.headers['x-span-id'] || null;
      const parentSpanId = requestBody.parent_span_id || req.headers['x-parent-span-id'] || null;
      const spanName = requestBody.span_name || req.headers['x-span-name'] || (traceId ? `${cfg.providerDisplay} - ${model}` : null);
      const spanType = requestBody.span_type || req.headers['x-span-type'] || (traceId ? 'llm' : null);

      const cost = await estimateCost(model, promptTokens, completionTokens);

      const finalStatus = spanStatus || 'success';

      await insertRequest({
        id: requestId,
        conversation_id: requestBody.conversation_id || req.headers['x-conversation-id'] || null,
        model,
        provider: cfg.providerName,
        input_messages: getLogPayload(requestBody.messages || [], 'input', cfg),
        output_message: content ? getLogPayload({ role: 'assistant', content }, 'output', cfg) : null,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        estimated_cost: cost,
        latency_ms: latencyMs,
        status: finalStatus,
        error_message: null,
        temperature: requestBody.temperature,
        max_tokens: requestBody.max_tokens,
        top_p: requestBody.top_p,
        frequency_penalty: requestBody.frequency_penalty,
        presence_penalty: requestBody.presence_penalty,
        user_id: requestBody.user || req.headers['x-user-id'] || null,
        metadata: requestBody.metadata || null,
        tags: null,
        stream: true,
        raw_request: getLogPayload(requestBody, 'raw', cfg),
        raw_response: getLogPayload({ finish_reason: finishReason, usage, content_length: content.length }, 'raw', cfg),
        trace_id: traceId,
        span_id: spanId,
        parent_span_id: parentSpanId,
        span_name: spanName,
        span_type: spanType,
      });

      // Background alert dispatch
      sendWebhookAlert({
        id: requestId,
        model,
        latency_ms: latencyMs,
        status: finalStatus,
        error_message: null
      }).catch(err => console.error('[proxy] Alert dispatch error:', err.message));

      queueEvaluation(requestId);
    } catch (logError) {
      console.error('[proxy] Error logging streaming request:', logError.message);
    }
  } catch (err) {
    const latencyMs = Date.now() - startTime;

    try {
      const model = requestBody.model || 'unknown';
      const traceId = requestBody.trace_id || req.headers['x-trace-id'] || null;
      const spanId = requestBody.span_id || req.headers['x-span-id'] || null;
      const parentSpanId = requestBody.parent_span_id || req.headers['x-parent-span-id'] || null;
      const spanName = requestBody.span_name || req.headers['x-span-name'] || (traceId ? `${cfg.providerDisplay} - ${model}` : null);
      const spanType = requestBody.span_type || req.headers['x-span-type'] || (traceId ? 'llm' : null);

      await insertRequest({
        id: requestId,
        conversation_id: requestBody.conversation_id || req.headers['x-conversation-id'] || null,
        model,
        provider: cfg.providerName,
        input_messages: getLogPayload(requestBody.messages || [], 'input', cfg),
        output_message: null,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        estimated_cost: 0,
        latency_ms: latencyMs,
        status: spanStatus || 'error',
        error_message: err.message,
        temperature: requestBody.temperature,
        max_tokens: requestBody.max_tokens,
        top_p: requestBody.top_p,
        frequency_penalty: requestBody.frequency_penalty,
        presence_penalty: requestBody.presence_penalty,
        user_id: requestBody.user || req.headers['x-user-id'] || null,
        stream: true,
        raw_request: getLogPayload(requestBody, 'raw', cfg),
        raw_response: null,
        trace_id: traceId,
        span_id: spanId,
        parent_span_id: parentSpanId,
        span_name: spanName,
        span_type: spanType,
      });

      // Background alert dispatch
      sendWebhookAlert({
        id: requestId,
        model,
        latency_ms: latencyMs,
        status: spanStatus || 'error',
        error_message: err.message
      }).catch(err => console.error('[proxy] Alert dispatch error:', err.message));
    } catch (logError) {
      console.error('[proxy] Error logging failed stream request:', logError.message);
    }

    if (!res.headersSent) {
      res.status(502).json({ error: { message: 'Proxy error: ' + err.message } });
    } else {
      res.end();
    }
  }
}

/**
 * Evaluates active input guardrails (PII redaction and keyword blocking).
 * Returns true if the request was blocked, sending a response automatically.
 * Otherwise, modifies the requestBody in place (e.g., redacting PII) and returns false.
 */
function runInputGuardrails(req, res, requestBody, cfg) {
  if (!requestBody || !Array.isArray(requestBody.messages)) {
    return false;
  }

  const bannedKeywords = cfg.bannedKeywordsStr.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);

  for (const msg of requestBody.messages) {
    const content = (msg.content || '').toLowerCase();
    for (const keyword of bannedKeywords) {
      if (content.includes(keyword)) {
        res.status(400).json({
          error: {
            message: `Request blocked by InfraSight Guardrails: Banned content detected (keyword: "${keyword}").`,
            type: 'guardrails_validation_error',
            code: 'content_blocked'
          }
        });
        return true;
      }
    }
  }

  if (cfg.activePiiRedaction) {
    requestBody.messages = requestBody.messages.map(msg => {
      if (typeof msg.content === 'string') {
        return {
          ...msg,
          content: maskString(msg.content)
        };
      }
      return msg;
    });
  }

  return false;
}

// ---------------------------------------------------------------------------
// Catch-all proxy route
// ---------------------------------------------------------------------------

router.all('/*', async (req, res) => {
  const cfg = await getProxyConfig();
  const targetPath = req.params[0] || '';
  const targetUrl = getTargetUrl(targetPath, cfg);

  if (req.method !== 'POST' || !req.body || typeof req.body !== 'object') {
    try {
      const headers = {};
      const auth = getAuthHeader(req, cfg);
      if (auth) headers['Authorization'] = auth;
      if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];

      const fetchOptions = {
        method: req.method,
        headers,
      };

      if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
        fetchOptions.body = JSON.stringify(req.body);
      }

      const response = await fetch(targetUrl, fetchOptions);
      const contentType = response.headers.get('content-type') || '';

      res.status(response.status);
      if (contentType) res.setHeader('Content-Type', contentType);

      if (contentType.includes('application/json')) {
        const body = await response.json();
        res.json(body);
      } else {
        const buffer = Buffer.from(await response.arrayBuffer());
        res.send(buffer);
      }
    } catch (err) {
      console.error('[proxy] Pass-through error:', err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: { message: 'Proxy error: ' + err.message } });
      }
    }
    return;
  }

  const requestBody = req.body;

  if (runInputGuardrails(req, res, requestBody, cfg)) {
    return;
  }

  const isStreaming = requestBody.stream === true;
  const isMockMode = !cfg.apiKey || cfg.apiKey.includes('invalid-or-missing-key') || cfg.apiKey.includes('placeholder');

  if (isMockMode) {
    await handleMockRequest(req, res, requestBody, cfg);
  } else if (isStreaming) {
    await handleStreamingRequest(req, res, targetUrl, requestBody, cfg);
  } else {
    await handleNonStreamingRequest(req, res, targetUrl, requestBody, cfg);
  }
});

module.exports = router;
