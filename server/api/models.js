/**
 * Models API router.
 *
 * Mount at: /api/models
 *
 * @module api/models
 */
'use strict';

const { Router } = require('express');
const { getModels, updateModelPricing, insertModel, recalculateCosts } = require('../db');

const router = Router();

/**
 * GET /api/models
 * List all models with pricing information.
 */
router.get('/', async (req, res) => {
  try {
    const models = await getModels();
    res.json({ data: models });
  } catch (err) {
    console.error('[models] GET / error:', err.message);
    res.status(500).json({ error: { message: 'Failed to fetch models' } });
  }
});

/**
 * POST /api/models
 * Register a new model.
 */
router.post('/', async (req, res) => {
  try {
    const { id, name, display_name, provider, input_cost_per_million, output_cost_per_million, context_window } = req.body;
    if (!id) {
      return res.status(400).json({ error: { message: 'Model ID is required' } });
    }
    await insertModel({ id, name, display_name, provider, input_cost_per_million, output_cost_per_million, context_window });
    res.json({ success: true, id });
  } catch (err) {
    if (err.message && (err.message.includes('UNIQUE constraint failed') || err.message.includes('duplicate key value'))) {
      return res.status(400).json({ error: { message: 'Model ID already exists' } });
    }
    console.error('[models] POST / error:', err.message);
    res.status(500).json({ error: { message: 'Failed to insert model' } });
  }
});

/**
 * PUT /api/models/:id
 * Update model pricing.
 *
 * The :id param is URL-encoded (e.g. meta-llama%2FMeta-Llama-3.1-8B-Instruct).
 * Body: { input_cost_per_million: number, output_cost_per_million: number }
 */
router.put('/:id(*)', async (req, res) => {
  try {
    const modelId = req.params.id;
    const { input_cost_per_million, output_cost_per_million } = req.body;

    if (input_cost_per_million == null && output_cost_per_million == null) {
      return res.status(400).json({
        error: { message: 'At least one of input_cost_per_million or output_cost_per_million is required' },
      });
    }

    if (input_cost_per_million != null && (typeof input_cost_per_million !== 'number' || input_cost_per_million < 0)) {
      return res.status(400).json({
        error: { message: 'input_cost_per_million must be a non-negative number' },
      });
    }
    if (output_cost_per_million != null && (typeof output_cost_per_million !== 'number' || output_cost_per_million < 0)) {
      return res.status(400).json({
        error: { message: 'output_cost_per_million must be a non-negative number' },
      });
    }

    const result = await updateModelPricing(modelId, { input_cost_per_million, output_cost_per_million });

    if (result.changes === 0) {
      return res.status(404).json({ error: { message: 'Model not found' } });
    }

    res.json({ success: true, id: modelId });
  } catch (err) {
    console.error('[models] PUT /:id error:', err.message);
    res.status(500).json({ error: { message: 'Failed to update model pricing' } });
  }
});

/**
 * POST /api/models/recalculate
 * Recalculate all historical request costs based on current pricing tables.
 */
router.post('/recalculate', async (req, res) => {
  try {
    const result = await recalculateCosts();
    res.json({ success: true, changes: result.changes });
  } catch (err) {
    console.error('[models] POST /recalculate error:', err.message);
    res.status(500).json({ error: { message: 'Failed to recalculate historical costs: ' + err.message } });
  }
});

module.exports = router;
