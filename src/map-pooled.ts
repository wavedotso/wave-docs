/**
 * Bounded-concurrency `Promise.all`.
 *
 * Private — deliberately not an entry point in `package.json`.
 */

/**
 * Like `Promise.all(items.map(fn))`, but with at most `limit` calls in flight.
 *
 * Results keep input order, and the first rejection rejects the whole call,
 * exactly as `Promise.all` does. Workers also stop pulling new items once one
 * has thrown: a build that is going to fail on page 3 should not render the
 * other 1,997 first. In-flight calls are not cancelled — there is nothing to
 * cancel them with — so up to `limit - 1` may still settle after the rejection.
 *
 * `Promise.all` over a whole documentation set is fine only while the mapped
 * function is effectively synchronous — which is true of the markdown pipeline
 * today, and stops being true the moment a consumer wires the async
 * `imageResolver` the docs recommend. At that point every page's tree is live
 * at once, and a 2,000-page site holds 2,000 hast trees plus 2,000 in-flight
 * resolver calls in memory to produce output that was always going to be
 * written in order.
 */
export async function mapPooled<TItem, TResult>(
  items: readonly TItem[],
  limit: number,
  fn: (item: TItem, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  if (items.length <= limit) {
    return Promise.all(items.map((item, index) => fn(item, index)));
  }

  const results = new Array<TResult>(items.length);
  let next = 0;
  let failed = false;

  const worker = async (): Promise<void> => {
    while (next < items.length && !failed) {
      const index = next++;
      try {
        // `noUncheckedIndexedAccess`: the bound above guarantees this is
        // present, and the cursor is read-then-incremented so no two workers
        // ever share one.
        results[index] = await fn(items[index] as TItem, index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };

  // `Math.max(1, …)`: a caller passing 0 — or a negative, from arithmetic on a
  // config value — would otherwise spawn no workers at all, and this would
  // resolve to a holey array of `undefined` with every item silently unmapped.
  // A pool of one is slow; losing the work is a bug.
  const workers = Math.max(1, Math.min(limit, items.length));

  await Promise.all(Array.from({ length: workers }, () => worker()));

  return results;
}
