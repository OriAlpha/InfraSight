'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createTaskQueue } = require('../services/task-queue');

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

test('every pushed task runs exactly once', async () => {
  const seen = [];
  const queue = createTaskQueue({ run: async (id) => { seen.push(id); } });

  for (const id of ['a', 'b', 'c']) queue.push(id);

  assert.equal(await queue.drain(1000), true);
  assert.deepEqual(seen.sort(), ['a', 'b', 'c']);
});

test('pushing the same id while it is queued collapses into one run', async () => {
  let runs = 0;
  const queue = createTaskQueue({ run: async () => { runs++; await tick(10); } });

  queue.push('same');
  queue.push('same');
  queue.push('same');

  assert.equal(queue.stats().pending, 1);
  assert.equal(await queue.drain(1000), true);
  assert.equal(runs, 1);
});

test('concurrency never exceeds the configured limit', async () => {
  let inFlight = 0;
  let peak = 0;

  const queue = createTaskQueue({
    getLimit: () => 2,
    run: async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await tick(15);
      inFlight--;
    },
  });

  for (let i = 0; i < 12; i++) queue.push(`task-${i}`);

  assert.equal(await queue.drain(5000), true);
  assert.equal(peak, 2, `expected at most 2 concurrent tasks, saw ${peak}`);
});

test('an async limit resolver is still enforced', async () => {
  // Regression: awaiting the limit used to let workers past the check before
  // the in-flight counter was incremented.
  let inFlight = 0;
  let peak = 0;

  const queue = createTaskQueue({
    getLimit: async () => { await tick(1); return 3; },
    run: async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await tick(10);
      inFlight--;
    },
  });

  for (let i = 0; i < 20; i++) queue.push(`task-${i}`);

  assert.equal(await queue.drain(5000), true);
  assert.ok(peak <= 3, `expected at most 3 concurrent tasks, saw ${peak}`);
});

test('a failing task does not stall the queue', async () => {
  const errors = [];
  const completed = [];

  const queue = createTaskQueue({
    getLimit: () => 1,
    run: async (id) => {
      if (id === 'bad') throw new Error('boom');
      completed.push(id);
    },
    onError: (err, id) => errors.push([id, err.message]),
  });

  queue.push('bad');
  queue.push('good');

  assert.equal(await queue.drain(1000), true);
  assert.deepEqual(errors, [['bad', 'boom']]);
  assert.deepEqual(completed, ['good']);
});

test('drain resolves immediately when the queue is already idle', async () => {
  const queue = createTaskQueue({ run: async () => {} });
  assert.equal(await queue.drain(1000), true);
});

test('drain reports false when work outlives the timeout', async () => {
  const queue = createTaskQueue({ run: async () => { await tick(200); } });
  queue.push('slow');

  assert.equal(await queue.drain(30), false);
  assert.equal(await queue.drain(1000), true);
});

test('stats reflect pending and active work', async () => {
  const queue = createTaskQueue({ getLimit: () => 1, run: async () => { await tick(20); } });

  queue.push('one');
  queue.push('two');
  assert.deepEqual(queue.stats(), { pending: 2, active: 0 });

  await tick(5);
  assert.equal(queue.stats().active, 1);

  await queue.drain(1000);
  assert.deepEqual(queue.stats(), { pending: 0, active: 0 });
});
