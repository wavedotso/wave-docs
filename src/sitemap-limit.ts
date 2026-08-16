/**
 * Google's per-sitemap URL cap, and the warning for crossing it.
 *
 * Private — deliberately not an entry point in `package.json`. It lives in its
 * own module for one reason: the branch is otherwise untestable. `next.ts` held
 * the limit and the `console.warn` inline, and reaching them from a test meant
 * writing 50,001 markdown files to a temporary directory, so the test that
 * claimed to cover it ("warns rather than silently emitting an oversized
 * sitemap") built a one-page site and asserted the warning did *not* fire. It
 * could only ever fail if the comparison were inverted.
 *
 * A count is the whole input. Split out, the arithmetic and the wording are
 * checkable in microseconds, and `createDocsSitemap`'s own test keeps covering
 * the case that matters at the integration level: an ordinary sitemap stays
 * quiet.
 */

/**
 * The cap.
 *
 * 50,000 URLs or 50 MB uncompressed, whichever comes first; a crawler rejects
 * the file whole rather than truncating it.
 */
export const SITEMAP_URL_LIMIT = 50_000;

/**
 * The warning for a sitemap of `count` URLs, or `undefined` when it fits.
 *
 * Splitting belongs to the caller — Next's `generateSitemaps` plus a slice of
 * the returned array is three lines — but silently emitting a file no crawler
 * will read is not something to discover from Search Console six weeks later.
 */
export function sitemapLimitWarning(count: number): string | undefined {
  // Strictly greater: a sitemap of exactly the limit is legal, and warning
  // about it would train everyone to ignore the warning.
  if (count <= SITEMAP_URL_LIMIT) return undefined;

  return (
    `@waveso/docs: this sitemap has ${count} URLs, above Google's ` +
    `limit of ${SITEMAP_URL_LIMIT}. Split it with Next's ` +
    '`generateSitemaps` and slice the array this returns.'
  );
}
