/**
 * Tracing REST API endpoints.
 * Mounts at: /api/traces
 */
'use strict';

const { Router } = require('express');
const { getTraces, getTraceSpans } = require('../db');

const router = Router();

/**
 * GET /api/traces
 * Returns paginated, aggregated trace sessions.
 */
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    
    const result = await getTraces({
      page,
      limit,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });
    
    res.json(result);
  } catch (err) {
    console.error('[traces] Error fetching traces:', err.message);
    res.status(500).json({ error: { message: err.message } });
  }
});

/**
 * GET /api/traces/:id
 * Fetches spans for a trace and returns a nested tree.
 */
router.get('/:id', async (req, res) => {
  try {
    const traceId = req.params.id;
    
    const spans = await getTraceSpans(traceId);
    
    if (spans.length === 0) {
      return res.status(404).json({ error: { message: 'Trace not found' } });
    }
    
    // Construct parent-child tree mapping
    const spansMap = {};
    const rootSpans = [];
    
    for (const span of spans) {
      // Parse JSON fields
      try {
        span.input_messages = typeof span.input_messages === 'string' ? JSON.parse(span.input_messages) : span.input_messages;
        span.output_message = typeof span.output_message === 'string' ? JSON.parse(span.output_message) : span.output_message;
        span.metadata = typeof span.metadata === 'string' ? JSON.parse(span.metadata) : span.metadata;
        span.tags = typeof span.tags === 'string' ? JSON.parse(span.tags) : span.tags;
        span.feedback = typeof span.feedback === 'string' ? JSON.parse(span.feedback) : span.feedback;
        span.evaluation = typeof span.evaluation === 'string' ? JSON.parse(span.evaluation) : span.evaluation;
      } catch (e) {
        // Keep as original
      }
      
      spansMap[span.span_id] = {
        ...span,
        cost: span.estimated_cost !== undefined ? span.estimated_cost : span.cost,
        children: []
      };
    }
    
    for (const span of spans) {
      const node = spansMap[span.span_id];
      const parentId = span.parent_span_id;
      
      if (parentId && parentId !== 'root' && spansMap[parentId]) {
        spansMap[parentId].children.push(node);
      } else {
        rootSpans.push(node);
      }
    }
    
    res.json({
      traceId,
      rootSpans
    });
  } catch (err) {
    console.error('[traces] Error fetching trace tree:', err.message);
    res.status(500).json({ error: { message: err.message } });
  }
});

module.exports = router;
