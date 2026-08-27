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
 * ⚠️ NO `externalRoutes`, AND THAT IS THE POINT OF THE ROOT MOUNT HERE. At an
 * empty base path an absolute link like `/installation` cannot be told apart
 * from any other route in the application — so every one of them is checked
 * against the published pages, which is right for an origin that serves
 * documentation and nothing else. This one does. A site with a `/login` of its
 * own would name it here; there is nothing to name.
 *
 * Absolute links are also forbidden outright in this site's markdown by
 * `site-budget.test.ts`, so both halves hold: the rule keeps them relative, and
 * the config would catch one that slipped through.
 */
export const docs = createDocsRoute({
  contentDir: 'site/content',
  basePath: '/',
  siteUrl: 'https://docs.wave.so',
  /*
   * `/llms.txt` and `/llms-full.txt`. Links in both resolve against the
   * `siteUrl` above rather than a second copy of it — see `DocsLlmsOptions`.
   */
  llms: {
    title: '@waveso/docs',
    description:
      'Documentation for Next.js, as a package: markdown to hast at build ' +
      'time, so a reader downloads no parser and no highlighter.',
  },
});
