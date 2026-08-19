/**
 * "Did you mean …?" for a link that matched no page.
 *
 * Private — deliberately not an entry point.
 *
 * A broken link is almost always a typo, and a typo is a near-miss by
 * construction: `/instalation` is one edit from `/installation`, while `/login`
 * is six from anything in a docs tree. That gap is what makes a suggestion
 * safe to offer and safe to withhold — the same reason `git`, `tsc`, `cargo`
 * and Python 3.12 all do it, and the reason none of them offers one for a word
 * that is nowhere near a real name.
 *
 * ⚠️ A SUGGESTION ONLY, NEVER A DECISION. Nothing here decides whether a link
 * is an error; `render.ts` has already decided that by the time it asks. Using
 * an edit distance to pick between failing and staying silent would be a
 * heuristic holding a build hostage, which is not a thing to do to somebody
 * whose page happens to be called `/setting`.
 */

/**
 * The ceiling on how far apart two routes may be and still be called a typo.
 *
 * Three is roughly one slip per word in a two-word slug — `instalation`,
 * `gettting-started`, `plugns`. It is a *ceiling*, not the whole rule: the
 * budget is also scaled by the length of what was written, so short routes are
 * held tighter and `/api` is not offered as a fix for `/ui`.
 *
 * Between them, `/docs/instructions` gets no suggestion for
 * `/docs/installation` — five edits apart, similar enough to tempt a generous
 * threshold, and a different word. `render.test.ts` pins that case, because
 * without it this constant could be any number at all.
 */
const MAX_DISTANCE = 3;

/**
 * Levenshtein distance, bounded.
 *
 * Two rows rather than a full matrix: the corpus is every route on the site and
 * this runs per broken link, so the allocation is the only part worth caring
 * about. Returns early once every cell in a row exceeds `limit`, which is the
 * common case — most candidates are nowhere near.
 */
function distance(a: string, b: string, limit: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let best = i;

    for (let j = 1; j <= b.length; j += 1) {
      const substitution =
        (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const deletion = (previous[j] as number) + 1;
      const insertion = (current[j - 1] as number) + 1;
      const cell = Math.min(substitution, deletion, insertion);
      current[j] = cell;
      if (cell < best) best = cell;
    }

    // Every cell in this row is already over budget, so every row below it will
    // be too — the values are non-decreasing down a column.
    if (best > limit) return limit + 1;

    const swap = previous;
    previous = current;
    current = swap;
  }

  return previous[b.length] as number;
}

/**
 * The closest route to `target`, or `undefined` if nothing is close enough.
 *
 * Ties break on the shortest candidate and then alphabetically, so the message
 * is the same on every machine — a suggestion that changes between runs reads
 * as a flaky build.
 */
export function suggestRoute(
  target: string,
  routes: Iterable<string>,
): string | undefined {
  // A route this short has no room for a typo that is not a different word.
  const limit = Math.min(
    MAX_DISTANCE,
    Math.max(1, Math.floor(target.length / 3)),
  );

  let best: string | undefined;
  let bestDistance = limit + 1;

  for (const route of routes) {
    if (route === target) continue;
    const measured = distance(target, route, limit);
    if (measured > limit) continue;

    if (
      measured < bestDistance ||
      (measured === bestDistance &&
        best !== undefined &&
        (route.length < best.length ||
          (route.length === best.length && route < best)))
    ) {
      best = route;
      bestDistance = measured;
    }
  }

  return best;
}

/** ` Did you mean '/installation'?`, or `''` when nothing is close. */
export function describeSuggestion(
  target: string,
  routes: Iterable<string> | undefined,
): string {
  if (routes === undefined) return '';
  const suggestion = suggestRoute(target, routes);
  return suggestion === undefined ? '' : ` Did you mean '${suggestion}'?`;
}
