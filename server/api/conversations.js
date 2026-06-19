/**
 * Conversations API router.
 *
 * Mount at: /api/conversations
 *
 * @module api/conversations
 */
'use strict';

const { Router } = require('express');
const { getConversations, getConversation } = require('../db');

const router = Router();

/**
 * GET /api/conversations
 * List conversations with pagination and search.
 *
 * Query params: page, limit, search
 */
router.get('/', async (req, res) => {
  try {
    const result = await getConversations({
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
    });
    res.json(result);
  } catch (err) {
    console.error('[conversations] GET / error:', err.message);
    res.status(500).json({ error: { message: 'Failed to fetch conversations' } });
  }
});

/**
 * GET /api/conversations/:id
 * Get a single conversation with all its messages ordered by created_at.
 */
router.get('/:id', async (req, res) => {
  try {
    const result = await getConversation(req.params.id);
    if (!result.conversation) {
      return res.status(404).json({ error: { message: 'Conversation not found' } });
    }
    if (result.messages) {
      result.messages = result.messages.map(msg => ({
        ...msg,
        cost: msg.estimated_cost !== undefined ? msg.estimated_cost : msg.cost
      }));
    }
    res.json(result);
  } catch (err) {
    console.error('[conversations] GET /:id error:', err.message);
    res.status(500).json({ error: { message: 'Failed to fetch conversation' } });
  }
});

module.exports = router;
