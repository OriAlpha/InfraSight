/**
 * Seed script for the models table.
 * Populates DeepInfra model pricing data.
 * Safe to run multiple times (uses INSERT OR IGNORE).
 *
 * Usage: node db/seed-models.js
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const { getDb, runMigrations } = require('./index');

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
];

/**
 * Seeds the models table with DeepInfra pricing data.
 */
function seedModels() {
  const db = getDb();

  // Clear existing models to ensure we only have the selected 5 models
  db.prepare('DELETE FROM models').run();

  const insert = db.prepare(`
    INSERT OR IGNORE INTO models (id, name, display_name, provider, input_cost_per_million, output_cost_per_million, context_window)
    VALUES (@id, @name, @display_name, @provider, @input_cost_per_million, @output_cost_per_million, @context_window)
  `);

  const insertMany = db.transaction((models) => {
    for (const model of models) {
      insert.run(model);
    }
  });

  insertMany(MODELS);
  console.log(`[seed-models] Seeded ${MODELS.length} models into the database.`);
}

// Run if invoked directly
if (require.main === module) {
  try {
    runMigrations();
    seedModels();
    console.log('[seed-models] Done.');
    process.exit(0);
  } catch (err) {
    console.error('[seed-models] Error:', err.message);
    process.exit(1);
  }
}

module.exports = { seedModels, MODELS };
