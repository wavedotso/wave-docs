/**
 * Route segments to the names a reader knows them by.
 *
 * A search result's second line is a trail — `getting-started › installation`
 * — and those are slugs, which is what a URL is made of and not what anything
 * is called. The navigation already holds both: every page carries its `slug`
 * and its `title`, and every directory carries the `title` from its
 * `meta.json`.
 *
 * ⚠️ BUILT FROM THE NAVIGATION RATHER THAN SHIPPED IN THE SEARCH INDEX, WHICH
 * IS THE WHOLE REASON THIS IS AFFORDABLE. `search-index.json` is 46 KB gzipped
 * on this site and the README publishes that number; a title on every record
 * would grow the one artifact the package is sold on. This is one entry per
 * *directory*, computed on the server from a tree the layout already has, and
 * the dialog joins slugs through it.
 *
 * ⚠️ AND A GROUP HAS NO SLUG OF ITS OWN. `DocNavGroup` carries a title, a
 * children array and an optional `href`, and nothing that names its directory
 * — so the path comes from the first descendant page's slug, cut at the depth
 * the group sits at. A group with no pages under it names nothing, which is
 * correct: nothing links there.
 */

import type { DocNavNode } from './types.js';

/**
 * Segment path to display name, e.g. `{ 'getting-started': 'Getting started' }`.
 *
 * Keyed by the *cumulative* path rather than the bare segment, so two
 * directories that happen to share a name — `guides/api` and `reference/api` —
 * cannot overwrite each other.
 */
export type DocsCrumbTitles = Record<string, string>;

/** The first page found under a node, depth first. */
function firstSlug(node: DocNavNode): string | undefined {
  if (node.type === 'page') return node.slug;
  if (node.type !== 'group') return undefined;
  for (const child of node.children) {
    const slug = firstSlug(child);
    if (slug !== undefined) return slug;
  }
  return undefined;
}

function walk(
  nodes: readonly DocNavNode[],
  depth: number,
  out: DocsCrumbTitles,
): void {
  for (const node of nodes) {
    if (node.type === 'page') {
      out[node.slug] = node.title;
      continue;
    }
    if (node.type !== 'group') continue;

    const slug = firstSlug(node);
    if (slug !== undefined) {
      const segments = slug.split('/').filter(Boolean);
      /*
       * The group's own directory is the segment at its depth. Deeper than the
       * page it borrowed the slug from means the tree and the filesystem
       * disagree, which cannot happen — but a shorter slug would key `''` and
       * quietly claim the root, so it is guarded rather than assumed.
       */
      if (segments.length > depth) {
        out[segments.slice(0, depth + 1).join('/')] = node.title;
      }
    }

    walk(node.children, depth + 1, out);
  }
}

/**
 * Every route segment path in the navigation, mapped to its display title.
 *
 * The root page is included under `''`, which is what a result for the site's
 * own index has instead of a trail.
 */
export function buildCrumbTitles(nav: readonly DocNavNode[]): DocsCrumbTitles {
  const out: DocsCrumbTitles = {};
  walk(nav, 0, out);
  return out;
}
