import { describe, expect, it } from 'vitest';

import { mapPooled } from './map-pooled.js';

/** Resolves after `ms`, so overlapping calls are observable. */
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('mapPooled', () => {
  it('keeps input order regardless of completion order', async () => {
    const items = [40, 5, 30, 10, 20];

    const result = await mapPooled(items, 2, async (ms) => {
      await delay(ms);
      return ms;
    });

    expect(result).toEqual(items);
  });

  it('never exceeds the limit', async () => {
    let live = 0;
    let peak = 0;

    await mapPooled(
      Array.from({ length: 40 }, (_, i) => i),
      4,
      async () => {
        live += 1;
        peak = Math.max(peak, live);
        await delay(1);
        live -= 1;
      },
    );

    expect(peak).toBe(4);
  });

  it('runs everything when there are fewer items than the limit', async () => {
    const result = await mapPooled([1, 2], 16, async (n) => n * 2);
    expect(result).toEqual([2, 4]);
  });

  /*
   * The whole point of the pool. `Promise.all(files.map(render))` was fine only
   * while the pipeline was effectively synchronous; an async `imageResolver`
   * puts every page's tree and every resolver call in flight at once.
   */
  it('stops pulling new items once one has thrown', async () => {
    let calls = 0;

    await expect(
      mapPooled(
        Array.from({ length: 40 }, (_, i) => i),
        4,
        async (n) => {
          calls += 1;
          await delay(1);
          if (n === 0) {
            throw new Error('boom');
          }
          return n;
        },
      ),
    ).rejects.toThrow('boom');

    // The four workers that were already in flight may finish; the remaining
    // 36 items must never be started.
    expect(calls).toBeLessThanOrEqual(4);
  });

  /*
   * A caller passing 0 — or a negative, from arithmetic on a config value —
   * used to spawn no workers at all and resolve to a holey array of
   * `undefined`, silently mapping nothing.
   */
  it('maps every item even when the limit is zero or negative', async () => {
    for (const limit of [0, -1]) {
      const result = await mapPooled([1, 2, 3], limit, async (n) => n * 10);
      expect(result).toEqual([10, 20, 30]);
    }
  });

  it('handles an empty input', async () => {
    expect(await mapPooled([], 4, async (n) => n)).toEqual([]);
  });
});
