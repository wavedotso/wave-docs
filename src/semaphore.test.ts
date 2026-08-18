/**
 * The bound, and the two ways a semaphore looks correct and is not.
 */

import { describe, expect, it } from 'vitest';

import { createSemaphore } from './semaphore.js';

describe('createSemaphore', () => {
  it('admits at most `limit` callers at once', async () => {
    const gate = createSemaphore(3);
    let active = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 50 }, () =>
        gate.run(async () => {
          active += 1;
          peak = Math.max(peak, active);
          // Two turns, so a caller that took a slot it should have waited for
          // is still holding it when the next one arrives.
          await Promise.resolve();
          await Promise.resolve();
          active -= 1;
        }),
      ),
    );

    expect(peak).toBe(3);
    expect(active).toBe(0);
  });

  it('holds the bound when the gated work queues more gated work', async () => {
    /*
     * The shape `source.ts` actually has, and the reason a semaphore is here at
     * all rather than another `mapPooled`: a directory scan reads a directory,
     * and what it finds is more directories to read. Callers arrive from inside
     * the completion of earlier callers, so there is no list to pull from and a
     * per-call pool bounds each level while multiplying across the depth.
     *
     * 121 calls over five levels, four at a time.
     */
    const gate = createSemaphore(4);
    let active = 0;
    let peak = 0;
    let completed = 0;

    const visit = async (depth: number): Promise<void> => {
      await gate.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        await Promise.resolve();
        active -= 1;
        completed += 1;
      });
      if (depth === 0) return;
      await Promise.all([visit(depth - 1), visit(depth - 1), visit(depth - 1)]);
    };

    await visit(4);

    expect(peak).toBe(4);
    expect(completed).toBe(121);
  });

  it('runs waiters in arrival order', async () => {
    const gate = createSemaphore(1);
    const order: number[] = [];

    await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        gate.run(async () => {
          order.push(index);
          await Promise.resolve();
        }),
      ),
    );

    expect(order).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('releases the slot when the call rejects', async () => {
    // A build that fails on page 3 must not leave the gate holding a slot
    // forever; the next scan in the same process would find one fewer.
    const gate = createSemaphore(1);

    await expect(
      gate.run(() => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');

    await expect(gate.run(() => Promise.resolve('through'))).resolves.toBe(
      'through',
    );
  });

  it('falls back to a bound of one for a limit that is not one', async () => {
    /*
     * `0` and negatives come from arithmetic on a config value, and admitting
     * nobody is a hang rather than an error. `NaN` is the worse one: `Math.max(1,
     * NaN)` is `NaN`, `active >= NaN` is false forever, and the semaphore admits
     * everyone — bound gone, nothing reported. Asserting the *bound* rather than
     * that the call ran is what tells those two apart.
     */
    for (const limit of [0, -4, Number.NaN]) {
      const gate = createSemaphore(limit);
      let active = 0;
      let peak = 0;

      await Promise.all(
        Array.from({ length: 8 }, () =>
          gate.run(async () => {
            active += 1;
            peak = Math.max(peak, active);
            await Promise.resolve();
            active -= 1;
          }),
        ),
      );

      expect(peak, `limit ${String(limit)}`).toBe(1);
    }
  });
});
