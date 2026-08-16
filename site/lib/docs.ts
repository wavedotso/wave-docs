import { createDocsRoute } from '@waveso/docs/next';

/*
 * The acceptance harness for `docs.Layout`, and nothing else — this is not a
 * website anyone visits. It is the package documenting itself with itself,
 * built in CI and thrown away, because a shell that cannot lay out six real
 * pages without local CSS has a defect its own authors would never find.
 *
 * ⚠️ NO `siteUrl`, DELIBERATELY. There is no deployment and therefore no
 * canonical origin, and inventing one would put a URL that resolves to nothing
 * into every page's metadata. Canonicals stay relative, which is correct for a
 * harness. A real deployment would add it here and nowhere else.
 *
 * Configured with nothing the quick start does not mention, for the same
 * reason: a harness allowed private options stops being evidence.
 */
export const docs = createDocsRoute({
  contentDir: 'site/content',
  basePath: '/docs',
});
