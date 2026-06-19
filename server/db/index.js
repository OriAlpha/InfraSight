/**
 * Main database routing gateway for InfraSight.
 * Dynamically selects SQLite or PostgreSQL adapter based on DATABASE_URL connection string.
 *
 * @module db/index
 */
'use strict';

const isPostgres = process.env.DATABASE_URL && (
  process.env.DATABASE_URL.startsWith('postgres://') ||
  process.env.DATABASE_URL.startsWith('postgresql://')
);

const adapter = isPostgres ? require('./postgres') : require('./sqlite');

module.exports = adapter;
