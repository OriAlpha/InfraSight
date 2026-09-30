/**
 * Seed script for the models table.
 * Populates baseline model pricing data.
 *
 * Idempotent: only models that are not already registered are inserted, so
 * pricing edited through the dashboard survives a restart. Goes through the
 * database adapter API rather than a driver directly, so it works on both the
 * SQLite and PostgreSQL backends.
 *
 * Usage: node db/seed-models.js
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const { runMigrations, getModels, insertModel, closeDb } = require('./index');

/** @type {Array<{id: string, name: string, display_name: string, provider: string, input_cost_per_million: number, output_cost_per_million: number, context_window: number}>} */
const MODELS = [
  {
    id: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    name: 'Meta-Llama-3.1-8B-Instruct',
    display_name: 'Llama 3.1 8B Instruct',
    provider: 'deepinfra',
    input_cost_per_million: 0.06,
    output_cost_per_million: 0.06,
    context_window: 131072,
  },
  {
    id: 'meta-llama/Meta-Llama-3.1-70B-Instruct',
    name: 'Meta-Llama-3.1-70B-Instruct',
    display_name: 'Llama 3.1 70B Instruct',
    provider: 'deepinfra',
    input_cost_per_million: 0.35,
    output_cost_per_million: 0.40,
    context_window: 131072,
  },
  {
    id: 'meta-llama/Llama-3.3-70B-Instruct',
    name: 'Llama-3.3-70B-Instruct',
    display_name: 'Llama 3.3 70B Instruct',
    provider: 'deepinfra',
    input_cost_per_million: 0.35,
    output_cost_per_million: 0.40,
    context_window: 131072,
  },
  {
    id: 'deepseek-ai/DeepSeek-V3',
    name: 'DeepSeek-V3',
    display_name: 'DeepSeek V3',
    provider: 'deepinfra',
    input_cost_per_million: 0.49,
    output_cost_per_million: 0.89,
    context_window: 131072,
  },
  {
    id: 'google/gemma-2-27b-it',
    name: 'gemma-2-27b-it',
    display_name: 'Gemma 2 27B IT',
    provider: 'deepinfra',
    input_cost_per_million: 0.27,
    output_cost_per_million: 0.27,
    context_window: 8192,
  },
  {
    id: 'Qwen/Qwen2.5-72B-Instruct',
    name: 'Qwen2.5-72B-Instruct',
    display_name: 'Qwen 2.5 72B Instruct',
    provider: 'deepinfra',
    input_cost_per_million: 0.35,
    output_cost_per_million: 0.40,
    context_window: 131072,
  },
];

/**
 * Ensures the baseline models are registered.
 *
 * Existing rows are left untouched — a model whose pricing was edited in the
 * dashboard keeps that pricing, and custom models are never removed.
 *
 * @returns {Promise<{ inserted: number, skipped: number }>}
 */
async function seedModels() {
  const existing = (await getModels()) || [];
  const known = new Set(existing.map((m) => m.id));

  let inserted = 0;
  for (const model of MODELS) {
    if (known.has(model.id)) continue;
    await insertModel(model);
    inserted++;
  }

  const skipped = MODELS.length - inserted;
  console.log(`[seed-models] ${inserted} model(s) added, ${skipped} already present.`);

  return { inserted, skipped };
}

// Run if invoked directly
if (require.main === module) {
  (async () => {
    try {
      await runMigrations();
      await seedModels();
      console.log('[seed-models] Done.');
      await closeDb();
      process.exit(0);
    } catch (err) {
      console.error('[seed-models] Error:', err.message);
      process.exit(1);
    }
  })();
}

module.exports = { seedModels, MODELS };
