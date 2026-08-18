/**
 * A counting semaphore, for bounding how much of a process resource is in use.
 *
 * Private — deliberately not an entry point in `package.json`.
 *
 * {@link mapPooled} bounds a fan-out over a list, which is the easy case: the
 * list is known, so the pool can pull from it. A recursive tree walk has no
 * list — `scanDir` calls itself once per subdirectory, so a per-call pool
 * bounds each directory and multiplies across the depth, which is not a bound
 * at all. That is what this is for.
 *
 * ⚠️ NEVER ACQUIRE A SLOT WHILE HOLDING ONE. Nested acquisition deadlocks the
 * moment every slot is held by a caller waiting for a slot, and no amount of
 * timeout rescues it. Guard the leaf operation — the `readFile`, the `readdir`
 * — and never the recursive call around it. In `source.ts` this is why the
 * traversal itself is ungated: only the filesystem calls take slots, so the
 * descriptors are bounded exactly while the walk stays as parallel as it was.
 */

/** @see createSemaphore */
export interface Semaphore {
  /**
   * Run `fn` once a slot is free, and give the slot back when it settles.
   *
   * Rejections propagate untouched, and release the slot on the way out.
   */
  run<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * A semaphore admitting `limit` concurrent callers.
 *
 * Waiters are woken in arrival order, so a long queue cannot starve its head.
 *
 * A limit below one falls back to one, for the same reason {@link mapPooled}
 * clamps: a caller passing `0` — or a negative, from arithmetic on a config
 * value — would otherwise admit nobody, and the symptom is a build that hangs
 * rather than one that fails.
 *
 * ⚠️ `Math.max(1, limit)` IS NOT ENOUGH, BECAUSE `Math.max(1, NaN)` IS `NaN`.
 * With `max` set to `NaN`, `active >= max` is false forever and the semaphore
 * admits everyone — no hang, no error, and no bound, which is the one outcome
 * worse than either. Non-finite means one.
 */
export function createSemaphore(limit: number): Semaphore {
  const requested = Math.floor(limit);
  const max = Number.isFinite(requested) && requested >= 1 ? requested : 1;
  const waiting: Array<() => void> = [];
  let active = 0;

  /**
   * Hand the slot to the next waiter rather than releasing and re-taking it.
   *
   * The naive form — decrement here, let the woken waiter increment itself — is
   * *equivalent*, and this was written that way first on the assumption that it
   * was not. It is equivalent because the decrement and the wake happen in one
   * synchronous step: no microtask can be interposed between them, and anything
   * enqueued earlier runs before this function rather than inside it, so there
   * is no window for a caller to read `active` below the limit. Mutation-tested
   * — swapping in the naive form fails nothing, which is the honest result.
   *
   * It stays this way because that argument is about the scheduler rather than
   * about this code. One `await` between the decrement and the wake and the
   * bound is gone, with nothing able to observe it. Handing the slot over makes
   * `active` a count of owned slots at every point, whoever holds them, so the
   * invariant is local and needs no argument at all.
   */
  const release = (): void => {
    const next = waiting.shift();
    if (next !== undefined) {
      next();
      return;
    }
    active -= 1;
  };

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (active >= max) {
        await new Promise<void>((resolve) => {
          waiting.push(resolve);
        });
        // The slot was handed over by `release`, which never gave it up.
      } else {
        active += 1;
      }

      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}
