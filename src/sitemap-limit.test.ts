import { describe, expect, it } from 'vitest';

import { SITEMAP_URL_LIMIT, sitemapLimitWarning } from './sitemap-limit.js';

/**
 * The branch `next.test.ts` claimed to cover and could not reach.
 *
 * "warns rather than silently emitting an oversized sitemap" built a one-page
 * site and asserted `console.warn` was *not* called — so it passed for every
 * implementation except one with the comparison inverted, and the warning's
 * wording, its number and its boundary were all unasserted. Reaching them
 * through `createDocsSitemap` means 50,001 files on disk; reaching them here
 * costs nothing, which is the whole reason the module exists.
 */
describe('sitemapLimitWarning', () => {
  it('says nothing about an ordinary sitemap', () => {
    expect(sitemapLimitWarning(0)).toBeUndefined();
    expect(sitemapLimitWarning(1)).toBeUndefined();
    expect(sitemapLimitWarning(9_999)).toBeUndefined();
  });

  it('treats exactly the limit as legal', () => {
    // The boundary is the whole of what can be wrong here. A sitemap of
    // precisely 50,000 URLs is one Google accepts, and warning about it trains
    // everyone to ignore the warning that matters.
    expect(sitemapLimitWarning(SITEMAP_URL_LIMIT)).toBeUndefined();
    expect(sitemapLimitWarning(SITEMAP_URL_LIMIT + 1)).toBeDefined();
  });

  it('names the count, the limit and the way out', () => {
    const warning = sitemapLimitWarning(50_001);

    // Not a snapshot: each clause is here because a warning missing it sends
    // the reader somewhere else to work out what to do.
    expect(warning).toContain('@waveso/docs');
    expect(warning).toContain('50001');
    expect(warning).toContain('50000');
    expect(warning).toContain('generateSitemaps');
  });
});
