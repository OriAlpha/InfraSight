/**
 * Analytics API router.
 *
 * Mount at: /api/analytics
 *
 * @module api/analytics
 */
'use strict';

const { Router } = require('express');
const {
  getAnalyticsOverview,
  getCostOverTime,
  getTokenUsage,
  getModelUsage,
  getLatencyStats,
  getErrorStats,
  getUserStats,
  getEvaluationAnalytics,
} = require('../db');

const router = Router();

/**
 * GET /api/analytics/overview
 * KPI summary with percentage change vs previous period.
 *
 * Query params: startDate, endDate (ISO strings)
 */
router.get('/overview', async (req, res) => {
  try {
    const result = await getAnalyticsOverview({
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });
    res.json(result);
  } catch (err) {
    console.error('[analytics] GET /overview error:', err.message);
    res.status(500).json({ error: { message: 'Failed to fetch analytics overview' } });
  }
});

/**
 * GET /api/analytics/cost
 * Cost over time grouped by model.
 *
 * Query params: startDate, endDate, granularity (hourly/daily)
 */
router.get('/cost', async (req, res) => {
  try {
    const result = await getCostOverTime({
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      granularity: req.query.granularity,
    });
    res.json(result);
  } catch (err) {
    console.error('[analytics] GET /cost error:', err.message);
    res.status(500).json({ error: { message: 'Failed to fetch cost data' } });
  }
});

/**
 * GET /api/analytics/tokens
 * Token usage over time.
 *
 * Query params: startDate, endDate
 */
router.get('/tokens', async (req, res) => {
  try {
    const result = await getTokenUsage({
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });
    res.json(result);
  } catch (err) {
    console.error('[analytics] GET /tokens error:', err.message);
    res.status(500).json({ error: { message: 'Failed to fetch token data' } });
  }
});

/**
 * GET /api/analytics/models
 * Model usage breakdown.
 *
 * Query params: startDate, endDate
 */
router.get('/models', async (req, res) => {
  try {
    const result = await getModelUsage({
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });
    res.json(result);
  } catch (err) {
    console.error('[analytics] GET /models error:', err.message);
    res.status(500).json({ error: { message: 'Failed to fetch model usage' } });
  }
});

/**
 * GET /api/analytics/latency
 * Latency percentiles (p50, p95, p99, avg) over time.
 *
 * Query params: startDate, endDate
 */
router.get('/latency', async (req, res) => {
  try {
    const result = await getLatencyStats({
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });
    res.json(result);
  } catch (err) {
    console.error('[analytics] GET /latency error:', err.message);
    res.status(500).json({ error: { message: 'Failed to fetch latency stats' } });
  }
});

/**
 * GET /api/analytics/errors
 * Error trends and top error messages.
 *
 * Query params: startDate, endDate
 */
router.get('/errors', async (req, res) => {
  try {
    const result = await getErrorStats({
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });
    res.json(result);
  } catch (err) {
    console.error('[analytics] GET /errors error:', err.message);
    res.status(500).json({ error: { message: 'Failed to fetch error stats' } });
  }
});

/**
 * GET /api/analytics/users
 * Per-user usage breakdown.
 *
 * Query params: startDate, endDate
 */
router.get('/users', async (req, res) => {
  try {
    const result = await getUserStats({
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });
    res.json(result);
  } catch (err) {
    console.error('[analytics] GET /users error:', err.message);
    res.status(500).json({ error: { message: 'Failed to fetch user stats' } });
  }
});

/**
 * GET /api/analytics/evals
 * Aggregated evaluation and quality metrics.
 *
 * Query params: startDate, endDate
 */
router.get('/evals', async (req, res) => {
  try {
    const result = await getEvaluationAnalytics({
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });
    res.json(result);
  } catch (err) {
    console.error('[analytics] GET /evals error:', err.message);
    res.status(500).json({ error: { message: 'Failed to fetch evaluation analytics' } });
  }
});

module.exports = router;
