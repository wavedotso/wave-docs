import { createDocsRoute } from '@waveso/docs/next';

/*
 * The site is the acceptance harness for `docs.Layout`, so it uses the package
 * exactly as the README tells a stranger to — imported by name through the
 * real `exports` map, configured with nothing the quick start does not mention.
 *
 * `siteUrl` is the one addition, and only because a docs site with no canonical
 * URLs is a docs site search engines index twice.
 */
export const docs = createDocsRoute({
  contentDir: 'site/content',
  basePath: '/docs',
  siteUrl: 'https://wave-docs.pages.dev',
});
