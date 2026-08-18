import { createDocsRoute } from '@waveso/docs/next';

/*
 * Resolved against `process.cwd()`, which is the repository root: CI runs
 * `next build smoke` from there, not from inside this directory.
 */
export const docs = createDocsRoute({
  contentDir: 'smoke/content',
  /*
   * ⚠️ HERE TO BE FORWARDED, NOT TO TUNE ANYTHING. `docs.Layout` hands these to
   * the search dialog, which is a Client Component — so this is a Server →
   * Client prop and React serialises it. `docs.Layout` shipped in 0.3.0 and
   * 0.4.0 forwarding whatever it was given, and a `tokenize` or `processTerm`
   * here killed `next build` with "Functions cannot be passed directly to
   * Client Components". Nothing caught it: the unit test asserted on
   * `element.props.search` and so never crossed the boundary it was testing.
   *
   * `fuzzy` is data, which is what makes it the positive control — it has to
   * survive the crossing, and `check.ts` looks for it in the flight payload the
   * build writes. The refusal for functions is `next.test.ts`; only a real
   * build can prove the allowed half actually arrives.
   */
  miniSearchOptions: { searchOptions: { fuzzy: 0.3 } },
});
