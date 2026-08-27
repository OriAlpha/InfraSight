#!/usr/bin/env node
/**
 * Parses every server-side JavaScript file.
 *
 * Replaces the hand-maintained `node --check` list that CI used to carry, which
 * silently skipped any file nobody remembered to add.
 */
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', 'server');
const SKIP_DIRS = new Set(['node_modules', 'data', '.git']);

/**
 * @param {string} dir
 * @returns {string[]} Absolute paths of .js files below `dir`
 */
function collect(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      found.push(...collect(path.join(dir, entry.name)));
    } else if (entry.name.endsWith('.js')) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

const files = collect(ROOT);
const failures = [];

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    failures.push(`${path.relative(ROOT, file)}\n${err.stderr?.toString().trim()}`);
  }
}

if (failures.length > 0) {
  console.error(`Syntax check failed for ${failures.length} file(s):\n`);
  console.error(failures.join('\n\n'));
  process.exit(1);
}

console.log(`Syntax OK: ${files.length} server file(s) checked.`);
