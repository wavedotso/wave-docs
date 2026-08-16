/**
 * The id of the rendered `<article>`, and the target of the skip link.
 *
 * Private — deliberately not an entry point in `package.json`. The documented
 * import is `@waveso/docs/react/skip-link`, which re-exports it; this module
 * exists so `src/next.ts` can have the constant without importing a
 * `'use client'` module for a string.
 *
 * One constant for both halves, and no way to change it. The two files spelled
 * it independently once, and a skip link pointing at an id nothing carries
 * scrolls nowhere and focuses nothing — a failure with no symptom until a
 * keyboard user hits it. `createDocsRoute` used to accept a `contentId` option
 * that broke exactly that pairing, silently, because `SkipLink` had no matching
 * option to follow it with.
 */
export const DOCS_CONTENT_ID = 'docs-content';
