import { createDocsRoute } from '@waveso/docs/next';

/*
 * The acceptance harness for `docs.Layout`, and now the site it produces — the
 * package documenting itself with itself, served at docs.wave.so and rebuilt
 * from `main` on every push. Both roles at once, deliberately: a shell that
 * cannot lay out its own documentation without local CSS has a defect its
 * authors would never find, and `site-budget.test.ts` is what keeps the harness
 * half honest by forbidding this site a single line of layout CSS.
 *
 * ⚠️ `siteUrl` IS THE ONLY THING A DEPLOYMENT ADDED. The note that used to sit
 * here said a real one would add it "here and nowhere else", and that held:
 * `alternates.canonical`, `og:url` and the sitemap all derive from it, so there
 * is one origin in this repository and it is on this line.
 *
 * ⚠️ `basePath: '/'` IS THE ROOT MOUNT, AND IT IS THE LESS-TESTED HALF ON
 * PURPOSE. The domain is only documentation, so `docs.wave.so/installation`
 * is the address a reader should get; `/docs/installation` on a host called
 * `docs` says it twice.
 *
 * The obvious objection is that the harness should exercise what a new install
 * gets, which is the `/docs` default — and `smoke/` already does, in both output
 * modes, on every CI run. So the default is covered either way, and putting this
 * site on the root mount covers the configuration that was thin instead: an
 * empty base path is a distinct code path in `toHref`, `toRoute` and
 * `isInternalAbsoluteLink`, and until now two unit assertions were all of it.
 *
 * ⚠️ `onUnverifiableLinks: 'throw'` IS WHAT MAKES THE ROOT MOUNT SAFE HERE, AND
 * IT IS A CLAIM ONLY THIS FILE CAN MAKE. At an empty base path an absolute link
 * like `/installation` cannot be told apart from any other route in the
 * application, so the package refuses to guess and says nothing by default.
 *
 * This domain has no other routes: it serves documentation and nothing else. So
 * every absolute link here IS a documentation link, an unknown one is always a
 * bug, and the site says so. That is the whole design of the option — the tool
 * does not guess, the site declares.
 */
export const docs = createDocsRoute({
  contentDir: 'site/content',
  basePath: '/',
  siteUrl: 'https://docs.wave.so',
  onUnverifiableLinks: 'throw',
});
