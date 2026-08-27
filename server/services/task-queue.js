/**
 * Bounded-concurrency work queue for background tasks.
 *
 * Keyed by task id: pushing an id that is already waiting is a no-op, so a
 * burst of triggers for the same record collapses into one run.
 *
 * @module services/task-queue
 */
'use strict';

/**
 * Creates a queue that runs at most `getLimit()` tasks at a time.
 *
 * @param {Object} opts
 * @param {(id: string) => Promise<void>} opts.run - Task body
 * @param {() => Promise<number>|number} [opts.getLimit] - Concurrency limit, re-read per dispatch
 * @param {(err: Error, id: string) => void} [opts.onError] - Called when a task rejects
 * @returns {{ push: (id: string) => void, drain: (timeoutMs?: number) => Promise<boolean>, stats: () => { pending: number, active: number } }}
 */
function createTaskQueue(opts) {
  const { run, getLimit = () => 3, onError } = opts;

  /** @type {string[]} */
  const pending = [];
  /** @type {Set<string>} */
  const queued = new Set();
  /** @type {Array<() => void>} */
  const idleWaiters = [];

  let active = 0;

  /** Wakes everything waiting on `drain`. */
  function notifyIdle() {
    const waiters = idleWaiters.splice(0, idleWaiters.length);
    for (const resolve of waiters) resolve();
  }

  function schedulePump() {
    setImmediate(() => {
      pump().catch((err) => {
        if (onError) onError(err, '<pump>');
      });
    });
  }

  /**
   * Dispatches queued work up to the current limit.
   *
   * The limit is resolved once, up front. The dispatch loop that follows never
   * awaits, so `active` cannot be observed stale by a concurrent pump and the
   * limit holds even when several pumps overlap.
   */
  async function pump() {
    const resolved = await getLimit();
    const limit = Number.isFinite(resolved) && resolved > 0 ? resolved : 1;

    while (active < limit && pending.length > 0) {
      const id = pending.shift();
      queued.delete(id);
      active++;
      // Not awaited: each worker reschedules the pump as it finishes.
      runOne(id);
    }
  }

  /**
   * @param {string} id
   */
  async function runOne(id) {
    try {
      await run(id);
    } catch (err) {
      if (onError) onError(err, id);
    } finally {
      active--;
      if (pending.length > 0) {
        schedulePump();
      } else if (active === 0) {
        notifyIdle();
      }
    }
  }

  return {
    /**
     * Enqueues a task id, ignoring ids that are already waiting.
     * @param {string} id
     */
    push(id) {
      if (!id || queued.has(id)) return;
      queued.add(id);
      pending.push(id);
      schedulePump();
    },

    /**
     * Resolves once nothing is queued or running.
     * @param {number} [timeoutMs=5000]
     * @returns {Promise<boolean>} False if the timeout hit first
     */
    drain(timeoutMs = 5000) {
      if (active === 0 && pending.length === 0) {
        return Promise.resolve(true);
      }

      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          const idx = idleWaiters.indexOf(onIdle);
          if (idx !== -1) idleWaiters.splice(idx, 1);
          resolve(false);
        }, timeoutMs);

        function onIdle() {
          clearTimeout(timer);
          resolve(true);
        }

        idleWaiters.push(onIdle);
      });
    },

    /** @returns {{ pending: number, active: number }} */
    stats() {
      return { pending: pending.length, active };
    },
  };
}

module.exports = { createTaskQueue };
