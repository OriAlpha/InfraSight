/**
 * Prompt Registry & Playground API router.
 *
 * Mount at: /api/prompts
 *
 * @module api/prompts
 */
'use strict';

const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const { getPrompts, getPromptByName, getPromptHistory, insertPrompt, getDb, insertRequest } = require('../db');
const { queueEvaluation } = require('../services/evaluator');

const router = Router();
const DEEPINFRA_COMPLETIONS_URL = 'https://api.deepinfra.com/v1/openai/chat/completions';

/**
 * Helper to render prompt templates by replacing {{variable}} placeholders.
 * @param {string} template - The template string
 * @param {Object} variables - Key-value dictionary of variables
 * @returns {string} The rendered template
 */
function renderTemplate(template, variables = {}) {
  if (!template) return '';
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    return variables[key] !== undefined ? String(variables[key]) : match;
  });
}

/**
 * Helper to estimate cost for playground runs based on model registry.
 */
async function estimatePlaygroundCost(model, promptTokens, completionTokens) {
  try {
    const db = getDb();
    const isPostgres = process.env.DATABASE_URL && (
      process.env.DATABASE_URL.startsWith('postgres://') ||
      process.env.DATABASE_URL.startsWith('postgresql://')
    );

    let modelRow;
    if (isPostgres) {
      const res = await db.query('SELECT input_cost_per_million, output_cost_per_million FROM models WHERE id = $1', [model]);
      modelRow = res.rows[0];
    } else {
      modelRow = db.prepare('SELECT input_cost_per_million, output_cost_per_million FROM models WHERE id = ?').get(model);
    }
    
    if (!modelRow) return 0;
    const inputCost = (promptTokens / 1_000_000) * modelRow.input_cost_per_million;
    const outputCost = (completionTokens / 1_000_000) * modelRow.output_cost_per_million;
    return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
  } catch {
    return 0;
  }
}

/**
 * GET /api/prompts
 * List unique prompt templates with their latest version.
 */
router.get('/', async (req, res) => {
  try {
    const list = await getPrompts();
    res.json({ data: list });
  } catch (err) {
    console.error('[prompts] GET / error:', err.message);
    res.status(500).json({ error: { message: 'Failed to fetch prompt templates' } });
  }
});

/**
 * GET /api/prompts/:name
 * Fetch the latest version of a prompt template by name.
 */
router.get('/:name', async (req, res) => {
  try {
    const prompt = await getPromptByName(req.params.name);
    if (!prompt) {
      return res.status(404).json({ error: { message: 'Prompt template not found' } });
    }
    res.json(prompt);
  } catch (err) {
    console.error('[prompts] GET /:name error:', err.message);
    res.status(500).json({ error: { message: 'Failed to fetch prompt template' } });
  }
});

/**
 * GET /api/prompts/:name/history
 * Fetch version history of a prompt template.
 */
router.get('/:name/history', async (req, res) => {
  try {
    const history = await getPromptHistory(req.params.name);
    res.json({ data: history });
  } catch (err) {
    console.error('[prompts] GET /:name/history error:', err.message);
    res.status(500).json({ error: { message: 'Failed to fetch prompt history' } });
  }
});

/**
 * POST /api/prompts
 * Create a prompt template or add a new version.
 * Body: { name, system_prompt, user_template, variables: string[] }
 */
router.post('/', async (req, res) => {
  try {
    const { name, system_prompt, user_template, variables } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: { message: 'Prompt name is required' } });
    }

    // Validate template name - no special chars that break URL routing
    if (!/^[a-zA-Z0-9_\-\s.]+$/.test(name.trim())) {
      return res.status(400).json({ error: { message: 'Prompt name can only contain letters, numbers, underscores, hyphens, spaces, and dots' } });
    }

    const newPrompt = await insertPrompt({
      name: name.trim(),
      system_prompt: system_prompt || '',
      user_template: user_template || '',
      variables: variables || []
    });

    res.status(201).json(newPrompt);
  } catch (err) {
    console.error('[prompts] POST / error:', err.message);
    res.status(500).json({ error: { message: 'Failed to save prompt template' } });
  }
});

/**
 * POST /api/prompts/playground
 * Execute a prompt playground run.
 * Body: { model, temperature, system_prompt, user_template, variables: {} }
 */
router.post('/playground', async (req, res) => {
  const requestId = uuidv4();
  const traceId = uuidv4();

  try {
    const { model, temperature, system_prompt, user_template, variables, messages: clientMessages, conversation_id } = req.body;

    if (!model) {
      return res.status(400).json({ error: { message: 'Model is required' } });
    }

    const apiKey = process.env.DEEPINFRA_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ error: { message: 'No DeepInfra API key configured on this InfraSight server' } });
    }

    let messages = [];
    let renderedSystem = null;
    let renderedUser = null;

    if (Array.isArray(clientMessages) && clientMessages.length > 0) {
      messages = clientMessages;
    } else {
      // Render templates
      renderedSystem = renderTemplate(system_prompt || '', variables);
      renderedUser = renderTemplate(user_template || '', variables);

      if (renderedSystem) {
        messages.push({ role: 'system', content: renderedSystem });
      }
      messages.push({ role: 'user', content: renderedUser });
    }

    const startTime = Date.now();

    // Call DeepInfra API
    const response = await fetch(DEEPINFRA_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: temperature != null ? Number(temperature) : 0.7,
        stream: false,
      }),
    });

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const errorMessage = errorBody.error?.message || `DeepInfra returned HTTP ${response.status}`;

      try {
        await insertRequest({
          id: requestId,
          conversation_id: conversation_id || null,
          trace_id: traceId,
          span_id: requestId,
          span_name: conversation_id ? `Playground Chat - ${model}` : `Playground Run - ${model}`,
          span_type: 'llm',
          model,
          provider: 'deepinfra',
          input_messages: messages,
          output_message: null,
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          estimated_cost: 0,
          latency_ms: latencyMs,
          status: 'error',
          error_message: errorMessage,
          temperature: temperature != null ? Number(temperature) : 0.7,
          tags: ['playground'],
          metadata: { playground: true }
        });
      } catch (dbErr) {
        console.error('[prompts] Failed to insert error playground log:', dbErr.message);
      }

      return res.status(response.status).json({
        error: {
          message: errorMessage,
          details: errorBody.error
        }
      });
    }

    const body = await response.json();
    const usage = body.usage || {};
    const promptTokens = usage.prompt_tokens || 0;
    const completionTokens = usage.completion_tokens || 0;
    const totalTokens = usage.total_tokens || (promptTokens + completionTokens);

    const outputText = body.choices?.[0]?.message?.content || '';

    // Calculate metrics
    const cost = body.usage?.estimated_cost != null 
      ? body.usage.estimated_cost 
      : await estimatePlaygroundCost(model, promptTokens, completionTokens);

    // Persist playground run to database
    try {
      await insertRequest({
        id: requestId,
        conversation_id: conversation_id || null,
        trace_id: traceId,
        span_id: requestId,
        span_name: conversation_id ? `Playground Chat - ${model}` : `Playground Run - ${model}`,
        span_type: 'llm',
        model,
        provider: 'deepinfra',
        input_messages: messages,
        output_message: { role: 'assistant', content: outputText },
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        estimated_cost: cost,
        latency_ms: latencyMs,
        status: 'success',
        temperature: temperature != null ? Number(temperature) : 0.7,
        tags: ['playground'],
        metadata: { playground: true }
      });
      
      // Trigger background evaluation
      queueEvaluation(requestId);
    } catch (dbErr) {
      console.error('[prompts] Failed to insert success playground log:', dbErr.message);
    }

    res.json({
      success: true,
      log_id: requestId,
      rendered: {
        system_prompt: renderedSystem,
        user_prompt: renderedUser
      },
      output: outputText,
      metrics: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        latency_ms: latencyMs,
        cost,
        tokens_per_second: completionTokens > 0 ? Math.round((completionTokens / (latencyMs / 1000)) * 10) / 10 : 0
      }
    });

  } catch (err) {
    console.error('[prompts] POST /playground error:', err.message);
    
    // Log exception to database
    try {
      await insertRequest({
        id: requestId,
        conversation_id: req.body?.conversation_id || null,
        trace_id: traceId,
        span_id: requestId,
        span_name: req.body?.conversation_id ? `Playground Chat` : `Playground Run`,
        span_type: 'llm',
        model: req.body?.model || 'unknown',
        provider: 'deepinfra',
        input_messages: [],
        output_message: null,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        estimated_cost: 0,
        latency_ms: 0,
        status: 'error',
        error_message: err.message,
        tags: ['playground'],
        metadata: { playground: true }
      });
    } catch (dbErr) {
      console.error('[prompts] Failed to log exception to database:', dbErr.message);
    }

    res.status(500).json({ error: { message: 'Playground execution failed: ' + err.message } });
  }
});

/**
 * DELETE /api/prompts/:name
 * Delete all versions of a prompt template by name.
 */
router.delete('/:name', async (req, res) => {
  try {
    const { deletePromptByName } = require('../db');
    const success = await deletePromptByName(req.params.name);
    if (!success) {
      return res.status(404).json({ error: { message: 'Prompt template not found' } });
    }
    res.json({ success: true, message: `Prompt template '${req.params.name}' deleted successfully` });
  } catch (err) {
    console.error('[prompts] DELETE /:name error:', err.message);
    res.status(500).json({ error: { message: 'Failed to delete prompt template' } });
  }
});

module.exports = router;
