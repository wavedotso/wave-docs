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
 * ⚠️ AND `basePath` IS STILL `/docs`, WHICH IS WHY THE DOMAIN IS CUSTOM. A
 * project-pages URL would serve this from `wavedotso.github.io/wave-docs`, and
 * every route would need `/wave-docs` prefixed — a `basePath` the quick start
 * never mentions, in the one file whose value is that it is configured with
 * nothing the quick start does not mention. A harness allowed private options
 * stops being evidence, so the domain moved instead of the config.
 */
export const docs = createDocsRoute({
  contentDir: 'site/content',
  basePath: '/docs',
  siteUrl: 'https://docs.wave.so',
});
