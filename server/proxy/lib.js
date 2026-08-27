/**
 * Pure helpers for the proxy router.
 *
 * Kept free of Express and network access so they can be unit-tested directly.
 *
 * @module proxy/lib
 */
'use strict';

const { maskString } = require('../utils/pii');

/** Characters per token used by the estimation fallback. */
const CHARS_PER_TOKEN = 4;

/**
 * Extracts the plain text of a chat message's content.
 *
 * Handles both the plain-string form and the multimodal content-parts array
 * (`[{ type: 'text', text: '…' }, { type: 'image_url', … }]`). Non-text parts
 * contribute nothing.
 *
 * @param {*} content - A message's `content` field
 * @returns {string} The concatenated text
 */
function extractText(content) {
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && typeof part.text === 'string') return part.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  return '';
}

/**
 * Rewrites every text segment of a message's content through `fn`, preserving
 * the original shape (string stays a string, parts array stays a parts array).
 *
 * @param {*} content - A message's `content` field
 * @param {(text: string) => string} fn - Transform applied to each text segment
 * @returns {*} The rewritten content
 */
function mapText(content, fn) {
  if (typeof content === 'string') return fn(content);

  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return fn(part);
      if (part && typeof part === 'object' && typeof part.text === 'string') {
        return { ...part, text: fn(part.text) };
      }
      return part;
    });
  }

  return content;
}

/**
 * Applies input guardrails to a message list.
 *
 * Returns a decision rather than writing to a response, so the caller owns the
 * HTTP behaviour.
 *
 * @param {Array<Object>} messages
 * @param {Object} opts
 * @param {string[]} opts.bannedKeywords - Lower-cased keywords to block on
 * @param {boolean} [opts.activePiiRedaction=false] - Rewrite PII before forwarding
 * @returns {{ blocked: boolean, keyword: string|null, messages: Array<Object> }}
 */
function applyGuardrails(messages, opts) {
  const { bannedKeywords = [], activePiiRedaction = false } = opts || {};

  if (!Array.isArray(messages)) {
    return { blocked: false, keyword: null, messages };
  }

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    const text = extractText(msg.content).toLowerCase();
    if (!text) continue;

    for (const keyword of bannedKeywords) {
      if (keyword && text.includes(keyword)) {
        return { blocked: true, keyword, messages };
      }
    }
  }

  if (!activePiiRedaction) {
    return { blocked: false, keyword: null, messages };
  }

  const redacted = messages.map((msg) => {
    if (!msg || typeof msg !== 'object' || msg.content == null) return msg;
    return { ...msg, content: mapText(msg.content, maskString) };
  });

  return { blocked: false, keyword: null, messages: redacted };
}

/**
 * Parses accumulated SSE `data:` payloads into the final assistant message,
 * usage block, and finish reason.
 *
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

      // The usage-bearing chunk carries an empty `choices` array.
      if (parsed.usage) {
        usage = {
          prompt_tokens: parsed.usage.prompt_tokens || 0,
          completion_tokens: parsed.usage.completion_tokens || 0,
          total_tokens: parsed.usage.total_tokens || 0,
        };
      }
    } catch {
      // Ignore keep-alive comments and partial frames.
    }
  }

  return { content, usage, finishReason };
}

/**
 * Character-count token estimate, used when a provider omits `usage`.
 *
 * @param {Array<Object>} messages - Request messages
 * @param {string} outputText - Assistant response text
 * @returns {{ promptTokens: number, completionTokens: number, totalTokens: number }}
 */
function estimateTokens(messages, outputText) {
  let promptChars = 0;
  if (Array.isArray(messages)) {
    for (const m of messages) {
      if (!m || typeof m !== 'object') continue;
      promptChars += extractText(m.content).length;
      promptChars += (m.role || '').length;
    }
  }

  const promptTokens = Math.max(1, Math.ceil(promptChars / CHARS_PER_TOKEN));
  const completionTokens = Math.max(1, Math.ceil((outputText || '').length / CHARS_PER_TOKEN));

  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}

/**
 * Builds the full upstream URL for a proxied path.
 *
 * @param {string} targetPath - Path captured after the /api/proxy mount
 * @param {{ providerName: string, upstreamBaseUrl: string }} cfg
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

/**
 * Asks the upstream to emit a final usage chunk on streaming responses, so
 * token counts come from the provider instead of the character heuristic.
 *
 * Leaves an explicit caller-supplied `stream_options` untouched.
 *
 * @param {Object} requestBody
 * @returns {Object} The request body to forward
 */
function withUsageStreamOptions(requestBody) {
  if (!requestBody || requestBody.stream !== true) return requestBody;
  if (requestBody.stream_options !== undefined) return requestBody;

  return { ...requestBody, stream_options: { include_usage: true } };
}

module.exports = {
  CHARS_PER_TOKEN,
  extractText,
  mapText,
  applyGuardrails,
  parseSSEChunks,
  estimateTokens,
  getTargetUrl,
  withUsageStreamOptions,
};
