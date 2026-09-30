/**
 * Log management API router.
 *
 * Mount at: /api/logs
 *
 * @module api/logs
 */
'use strict';

const { Router } = require('express');
const {
  getRequests,
  getRequestById,
  deleteRequest,
  updateFeedback,
  insertRequest,
  getRequestBySpanId,
  clearAllLogs,
  updateTags,
  updateStatus,
  getSubsequentSpans,
} = require('../db');
const { queueEvaluation } = require('../services/evaluator');

const router = Router();

/**
 * GET /api/logs
 * Paginated list of request logs with filtering and sorting.
 *
 * Query params: page, limit, model, status, startDate, endDate,
 *               search, sortBy, sortOrder, userId, minCost, maxCost
 */
router.get('/', async (req, res) => {
  try {
    const result = await getRequests({
      page: req.query.page,
      limit: req.query.limit,
      model: req.query.model,
      status: req.query.status,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      search: req.query.search,
      sortBy: req.query.sortBy,
      sortOrder: req.query.sortOrder,
      userId: req.query.userId,
      minCost: req.query.minCost,
      maxCost: req.query.maxCost,
      feedback: req.query.feedback,
      minEval: req.query.minEval,
      maxEval: req.query.maxEval,
      taskType: req.query.taskType,
      safety: req.query.safety,
    });

    if (result && result.data) {
      result.data = result.data.map(row => ({
        ...row,
        cost: row.estimated_cost !== undefined ? row.estimated_cost : row.cost
      }));
    }

    res.json(result);
  } catch (err) {
    console.error('[logs] GET / error:', err.message);
    res.status(500).json({ error: { message: 'Failed to fetch logs' } });
  }
});

/**
 * GET /api/logs/export/csv
 * Export filtered logs as CSV.
 * Accepts the same query params as GET /api/logs (except page/limit — exports all matching rows, up to 10 000).
 */
router.get('/export/csv', async (req, res) => {
  try {
    const result = await getRequests({
      page: 1,
      limit: 10000,
      model: req.query.model,
      status: req.query.status,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      search: req.query.search,
      sortBy: req.query.sortBy || 'created_at',
      sortOrder: req.query.sortOrder || 'DESC',
      userId: req.query.userId,
      minCost: req.query.minCost,
      maxCost: req.query.maxCost,
      feedback: req.query.feedback,
      minEval: req.query.minEval,
      maxEval: req.query.maxEval,
      taskType: req.query.taskType,
    });

    const CSV_COLUMNS = [
      'id',
      'model',
      'provider',
      'status',
      'prompt_tokens',
      'completion_tokens',
      'total_tokens',
      'estimated_cost',
      'latency_ms',
      'temperature',
      'max_tokens',
      'user_id',
      'stream',
      'error_message',
      'tags',
      'feedback',
      'evaluation',
      'created_at',
    ];

    /**
     * Escapes a CSV field value.
     * @param {*} val
     * @returns {string}
     */
    const escapeCsv = (val) => {
      if (val == null) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const headerLine = CSV_COLUMNS.join(',');
    const lines = result.data.map((row) =>
      CSV_COLUMNS.map((col) => escapeCsv(row[col])).join(',')
    );

    const csv = [headerLine, ...lines].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="infrasight-logs.csv"');
    res.send(csv);
  } catch (err) {
    console.error('[logs] GET /export/csv error:', err.message);
    res.status(500).json({ error: { message: 'Failed to export logs' } });
  }
});

/**
 * GET /api/logs/export/finetuning
 * Export filtered logs in OpenAI-compatible JSONL fine-tuning format.
 */
router.get('/export/finetuning', async (req, res) => {
  try {
    const result = await getRequests({
      page: 1,
      limit: 10000,
      model: req.query.model,
      status: req.query.status || 'success', // Default to successful logs for training
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      search: req.query.search,
      sortBy: req.query.sortBy || 'created_at',
      sortOrder: req.query.sortOrder || 'DESC',
      userId: req.query.userId,
      minCost: req.query.minCost,
      maxCost: req.query.maxCost,
      feedback: req.query.feedback,
      minEval: req.query.minEval,
      maxEval: req.query.maxEval,
      taskType: req.query.taskType,
    });

    const lines = [];

    for (const row of result.data) {
      let inputs = [];
      try {
        inputs = typeof row.input_messages === 'string' ? JSON.parse(row.input_messages) : (row.input_messages || []);
      } catch (e) {
        inputs = [];
      }

      let output = null;
      try {
        output = typeof row.output_message === 'string' ? JSON.parse(row.output_message) : row.output_message;
      } catch (e) {
        output = null;
      }

      if (inputs.length > 0 && output) {
        const messages = [...inputs];
        messages.push(output);
        lines.push(JSON.stringify({ messages }));
      }
    }

    const jsonl = lines.join('\n');

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Content-Disposition', 'attachment; filename="infrasight-dataset.jsonl"');
    res.send(jsonl);
  } catch (err) {
    console.error('[logs] GET /export/finetuning error:', err.message);
    res.status(500).json({ error: { message: 'Failed to export dataset' } });
  }
});

/**
 * GET /api/logs/:id
 * Full detail for a single request log.
 */
router.get('/:id', async (req, res) => {
  try {
    let row = await getRequestById(req.params.id);
    if (!row) {
      row = await getRequestBySpanId(req.params.id);
    }
    if (!row) {
      return res.status(404).json({ error: { message: 'Request not found' } });
    }
    row.cost = row.estimated_cost !== undefined ? row.estimated_cost : row.cost;
    // Alias raw_request/raw_response to request_body/response_body with fallback reconstruction
    let requestBody = null;
    try {
      requestBody = row.raw_request ? (typeof row.raw_request === 'string' ? JSON.parse(row.raw_request) : row.raw_request) : null;
    } catch {
      requestBody = row.raw_request;
    }
    if (!requestBody && row.input_messages) {
      let msgs = row.input_messages;
      try {
        if (typeof msgs === 'string') msgs = JSON.parse(msgs);
      } catch {}
      if (Array.isArray(msgs) && msgs.length > 0) {
        requestBody = {
          model: row.model || 'unknown',
          messages: msgs,
          temperature: row.temperature != null ? Number(row.temperature) : 0.7,
          stream: Boolean(row.stream),
        };
        if (row.max_tokens) requestBody.max_tokens = Number(row.max_tokens);
      }
    }

    let responseBody = null;
    try {
      responseBody = row.raw_response ? (typeof row.raw_response === 'string' ? JSON.parse(row.raw_response) : row.raw_response) : null;
    } catch {
      responseBody = row.raw_response;
    }
    if (!responseBody && row.output_message) {
      let outMsg = row.output_message;
      try {
        if (typeof outMsg === 'string') outMsg = JSON.parse(outMsg);
      } catch {}
      if (outMsg) {
        if (typeof outMsg === 'string') outMsg = { role: 'assistant', content: outMsg };
        responseBody = {
          id: row.id,
          object: 'chat.completion',
          model: row.model,
          choices: [
            {
              index: 0,
              message: outMsg,
              finish_reason: row.status === 'success' ? 'stop' : 'error',
            },
          ],
          usage: {
            prompt_tokens: row.prompt_tokens || 0,
            completion_tokens: row.completion_tokens || 0,
            total_tokens: row.total_tokens || 0,
            estimated_cost: row.estimated_cost !== undefined ? row.estimated_cost : row.cost || 0,
          },
        };
      }
    }

    row.request_body = requestBody;
    row.response_body = responseBody;
    res.json(row);
  } catch (err) {
    console.error('[logs] GET /:id error:', err.message);
    res.status(500).json({ error: { message: 'Failed to fetch log' } });
  }
});

/**
 * DELETE /api/logs/:id
 * Delete a log entry.
 */
router.delete('/:id', async (req, res) => {
  try {
    const result = await deleteRequest(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: { message: 'Request not found' } });
    }
    res.json({ success: true, id: req.params.id });
  } catch (err) {
    console.error('[logs] DELETE /:id error:', err.message);
    res.status(500).json({ error: { message: 'Failed to delete log' } });
  }
});

/**
 * DELETE /api/logs
 * Clear all logs, conversations, and daily stats.
 *
 * Irreversible, so it requires an explicit confirmation: `?confirm=true` or a
 * JSON body of `{ "confirm": true }`. This keeps a stray DELETE against the
 * collection root from wiping the database.
 */
router.delete('/', async (req, res) => {
  try {
    const confirmed = req.query.confirm === 'true'
      || (req.body && req.body.confirm === true);

    if (!confirmed) {
      return res.status(400).json({
        error: {
          message: 'Refusing to clear all logs without confirmation. '
            + 'Repeat the request with ?confirm=true to proceed.',
          type: 'confirmation_required',
          code: 'confirmation_required',
        }
      });
    }

    await clearAllLogs();
    res.json({ success: true, message: 'All logs cleared successfully' });
  } catch (err) {
    console.error('[logs] DELETE / error:', err.message);
    res.status(500).json({ error: { message: 'Failed to clear logs' } });
  }
});

/**
 * POST /api/logs/seed-demo
 * Clear database and seed mock logs.
 */
router.post('/seed-demo', async (req, res) => {
  try {
    const { seed } = require('../db/seed-mock-logs');
    // Seed internally executes DB calls asynchronously if PG is active
    await seed();
    res.json({ success: true, message: 'Demo logs seeded successfully' });
  } catch (err) {
    console.error('[logs] POST /seed-demo error:', err.message);
    res.status(500).json({ error: { message: 'Failed to seed demo logs: ' + err.message } });
  }
});

/**
 * PATCH /api/logs/:id/tags
 * Update tags for a log entry.
 * Body: { tags: string[] }
 */
router.patch('/:id/tags', async (req, res) => {
  try {
    const { tags } = req.body;

    if (!Array.isArray(tags)) {
      return res.status(400).json({ error: { message: 'tags must be an array' } });
    }

    const row = await getRequestById(req.params.id);
    if (!row) {
      return res.status(404).json({ error: { message: 'Request not found' } });
    }

    await updateTags(req.params.id, tags);

    res.json({ success: true, id: req.params.id, tags });
  } catch (err) {
    console.error('[logs] PATCH /:id/tags error:', err.message);
    res.status(500).json({ error: { message: 'Failed to update tags' } });
  }
});

/**
 * PATCH /api/logs/:id/feedback
 * Update human feedback (rating, comment, task success, expected answer).
 * Body: { score?: 1 | -1, rating?: number, comment?: string, task_success?: boolean, expected_answer?: string }
 */
router.patch('/:id/feedback', async (req, res) => {
  try {
    const { score, rating, comment, task_success, expected_answer } = req.body;

    const row = await getRequestById(req.params.id);
    if (!row) {
      return res.status(404).json({ error: { message: 'Request not found' } });
    }

    // Auto-calculate score (thumbs up/down) based on star rating if not explicitly provided
    let derivedScore = score;
    if (derivedScore === undefined && rating != null) {
      if (rating >= 4) derivedScore = 1;
      else if (rating <= 2) derivedScore = -1;
      else derivedScore = null;
    }

    const feedback = {
      score: derivedScore,
      rating: rating != null ? Number(rating) : null,
      comment: comment || '',
      task_success: task_success === undefined ? null : !!task_success,
      expected_answer: expected_answer || '',
    };
    
    const success = await updateFeedback(req.params.id, feedback);
    
    // Trigger background evaluator to recalculate metrics based on new feedback inputs
    queueEvaluation(req.params.id);

    res.json({ success, id: req.params.id, feedback });
  } catch (err) {
    console.error('[logs] PATCH /:id/feedback error:', err.message);
    res.status(500).json({ error: { message: 'Failed to update feedback: ' + err.message } });
  }
});

/**
 * PATCH /api/logs/:id/status
 * Update the status of a log entry (e.g. approve/reject from paused or awaiting_approval).
 * Body: { status: string }
 */
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ error: { message: 'status is required' } });
    }

    let row = await getRequestById(req.params.id);
    let targetId = req.params.id;

    if (!row) {
      row = await getRequestBySpanId(req.params.id);
      if (row) {
        targetId = row.id;
      }
    }

    if (!row) {
      return res.status(404).json({ error: { message: 'Request not found' } });
    }

    await updateStatus(targetId, status);

    // Asynchronously check if we need to simulate the agent continuing the conversation
    if (row.span_type === 'check') {
      setTimeout(async () => {
        try {
          // Check if any other spans have been logged for this trace since this check was updated
          const subsequent = await getSubsequentSpans(row.trace_id, row.created_at);
          
          if (subsequent.length === 0) {
            // No active python process has logged new spans (i.e. static trace). Let's simulate the next steps.
            const { v4: uuidv4 } = require('uuid');
            
            const isBanking = (row.trace_id && row.trace_id.toLowerCase().includes('wire')) || 
                              (row.span_name && row.span_name.toLowerCase().includes('wire')) || 
                              (row.span_name && row.span_name.toLowerCase().includes('transfer'));
                              
            const isInvoice = (row.trace_id && row.trace_id.toLowerCase().includes('invoice')) || 
                              (row.span_name && row.span_name.toLowerCase().includes('invoice')) ||
                              (row.trace_id && row.trace_id.toLowerCase().includes('all'));

            let simulatedContent = '';
            if (status === 'success') {
              if (isBanking) {
                // Log simulated banking tool execution
                const toolSpanId = `span_tool_${uuidv4().substring(0, 8)}`;
                const toolInput = [{ role: 'user', content: 'Execute ACH wire settlement for validated transfer request' }];
                const toolOutput = { role: 'assistant', content: '{"wire_id": "ACH-99482", "status": "SETTLED"}' };
                await insertRequest({
                  id: uuidv4(),
                  model: 'ach-banking-gateway',
                  input_messages: toolInput,
                  output_message: toolOutput,
                  status: 'success',
                  trace_id: row.trace_id,
                  span_id: toolSpanId,
                  parent_span_id: row.parent_span_id,
                  span_name: 'Bank Wire API Service',
                  span_type: 'tool',
                  raw_request: { tool: 'ach-banking-gateway', action: 'settle_transfer' },
                  raw_response: { wire_id: 'ACH-99482', status: 'SETTLED' }
                });
                
                simulatedContent = 'Manager has approved the transfer.\n\nBank Wire Service returned ACH-99482: "Transaction approved. Funds will be settled in the next 2 business days."\n\nTransfer has been successfully completed and settled.';
              } else if (isInvoice) {
                // Log simulated database ledger write tool execution
                const toolSpanId = `span_tool_${uuidv4().substring(0, 8)}`;
                const toolInput = [{ role: 'user', content: 'Update ledger status for invoice record #INV-772' }];
                const toolOutput = { role: 'assistant', content: '{"status": "PAID", "ledger_status": "synced"}' };
                await insertRequest({
                  id: uuidv4(),
                  model: 'accounting-ledger-db',
                  input_messages: toolInput,
                  output_message: toolOutput,
                  status: 'success',
                  trace_id: row.trace_id,
                  span_id: toolSpanId,
                  parent_span_id: row.parent_span_id,
                  span_name: 'Database Ledger Write',
                  span_type: 'tool',
                  raw_request: { tool: 'accounting-ledger-db', action: 'write_record' },
                  raw_response: { status: 'PAID', ledger_status: 'synced' }
                });
                
                simulatedContent = 'The invoice payment validation check has been approved. The invoice payment record for #INV-772 has been logged and fully settled in the accounting database.';
              } else {
                simulatedContent = 'The compliance and safety validation check has been approved. Proceeding with the requested operation.';
              }
            } else {
              simulatedContent = `The validation check was rejected. The request has been declined due to compliance guidelines.`;
            }

            // Log final conversational assistant response span
            const finalInput = [{ role: 'user', content: 'Generate conversational response reflecting compliance outcome.' }];
            const finalOutput = { role: 'assistant', content: simulatedContent };
            await insertRequest({
              id: uuidv4(),
              model: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
              input_messages: finalInput,
              output_message: finalOutput,
              status: 'success',
              trace_id: row.trace_id,
              span_id: `span_llm_${uuidv4().substring(0, 8)}`,
              parent_span_id: row.parent_span_id,
              span_name: 'Final Response Generator',
              span_type: 'llm',
              raw_request: { model: 'meta-llama/Meta-Llama-3.1-8B-Instruct', messages: finalInput },
              raw_response: { choices: [{ message: finalOutput }] }
            });
          }
        } catch (simError) {
          console.error('[logs] HITL simulated response error:', simError.message);
        }
      }, 600);
    }

    res.json({ success: true, id: req.params.id, status });
  } catch (err) {
    console.error('[logs] PATCH /:id/status error:', err.message);
    res.status(500).json({ error: { message: 'Failed to update status' } });
  }
});

/**
 * POST /api/logs/import
 * Import an array of request logs.
 * Body: { logs: Array }
 */
router.post('/import', async (req, res) => {
  try {
    const { logs } = req.body;
    if (!Array.isArray(logs)) {
      return res.status(400).json({ error: { message: 'Payload logs must be an array' } });
    }

    const { v4: uuidv4 } = require('uuid');

    let importedCount = 0;
    const errors = [];

    // Loop import sequentially (or via Promise.all) to keep database agnostic
    for (const log of logs) {
      try {
        const id = log.id || uuidv4();
        
        let inputs = log.input_messages || [];
        if (typeof inputs === 'string') {
          try { inputs = JSON.parse(inputs); } catch { inputs = []; }
        }
        
        let output = log.output_message || null;
        if (typeof output === 'string') {
          try { output = JSON.parse(output); } catch { output = null; }
        }

        let metadata = log.metadata || {};
        if (typeof metadata === 'string') {
          try { metadata = JSON.parse(metadata); } catch { metadata = {}; }
        }
        if (metadata && typeof metadata === 'object') {
          metadata.imported = true;
        } else {
          metadata = { imported: true };
        }

        let tags = log.tags || [];
        if (typeof tags === 'string') {
          try { tags = JSON.parse(tags); } catch { tags = []; }
        }
        if (!Array.isArray(tags)) tags = [];
        if (!tags.includes('imported')) {
          tags.push('imported');
        }

        await insertRequest({
          id,
          conversation_id: log.conversation_id || null,
          model: log.model || 'unknown',
          provider: log.provider || 'imported',
          input_messages: inputs,
          output_message: output,
          prompt_tokens: Number(log.prompt_tokens) || 0,
          completion_tokens: Number(log.completion_tokens) || 0,
          total_tokens: Number(log.total_tokens) || (Number(log.prompt_tokens) + Number(log.completion_tokens)) || 0,
          estimated_cost: Number(log.estimated_cost) || Number(log.cost) || 0,
          latency_ms: Number(log.latency_ms) || 0,
          status: log.status || 'success',
          error_message: log.error_message || null,
          temperature: log.temperature != null ? Number(log.temperature) : null,
          max_tokens: log.max_tokens != null ? Number(log.max_tokens) : null,
          top_p: log.top_p != null ? Number(log.top_p) : null,
          frequency_penalty: log.frequency_penalty != null ? Number(log.frequency_penalty) : null,
          presence_penalty: log.presence_penalty != null ? Number(log.presence_penalty) : null,
          user_id: log.user_id || null,
          metadata,
          tags,
          stream: log.stream ? 1 : 0,
          trace_id: log.trace_id || null,
          span_id: log.span_id || log.id || id,
          parent_span_id: log.parent_span_id || null,
          span_name: log.span_name || `Imported - ${log.model || 'unknown'}`,
          span_type: log.span_type || 'llm',
          raw_request: log.raw_request || log.request_body || null,
          raw_response: log.raw_response || log.response_body || null,
          created_at: log.created_at || new Date().toISOString()
        });
        importedCount++;
      } catch (insertErr) {
        errors.push(`Row index ${importedCount + errors.length}: ${insertErr.message}`);
      }
    }

    if (errors.length > 0 && importedCount === 0) {
      return res.status(400).json({
        error: {
          message: 'All log inserts failed',
          details: errors
        }
      });
    }

    res.json({
      success: true,
      importedCount,
      failedCount: errors.length,
      errors: errors.slice(0, 100)
    });

  } catch (err) {
    console.error('[logs] POST /import error:', err.message);
    res.status(500).json({ error: { message: 'Failed to import logs: ' + err.message } });
  }
});

module.exports = router;
