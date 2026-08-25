/**
 * The reading order, derived from the navigation tree.
 *
 * A pager's "next page" is not a filesystem question and not an alphabetical
 * one — it is whatever the author put next in the sidebar. `meta.json` already
 * says that, so this reads the same tree `DocsSidebar` renders and flattens it
 * into the order a reader would arrive at by clicking down the column.
 *
 * ⚠️ ONE SOURCE, WHICH IS THE POINT. Ordering the pager separately — by slug,
 * by frontmatter `order`, by anything — gives two answers to one question, and
 * they drift the first time someone reorders a `meta.json`. Here a pager that
 * disagrees with the sidebar is impossible by construction.
 */

import type { DocNavNode } from './types.js';

/** A destination in the reading order. */
export interface NavStop {
  title: string;
  href: string;
}

/** Trailing slashes are a routing detail, not a difference in identity. */
function normalize(href: string): string {
  return href.length > 1 ? href.replace(/\/+$/, '') : href;
}

/**
 * Every page in the tree, in the order a reader meets them.
 *
 * ⚠️ SEPARATORS AND EXTERNAL LINKS ARE NOT STOPS. A separator is a label with
 * nowhere to go, and an external link leaves the documentation entirely — a
 * "next page" that lands on npm has ended the sequence rather than continued
 * it. Internal `link` entries *are* stops: they are hand-written entries
 * pointing at pages of this site, and a reader clicking down the sidebar hits
 * them like any other row.
 *
 * ⚠️ A GROUP CONTRIBUTES ITS OWN PAGE FIRST, WHEN IT HAS ONE. A directory with
 * an `index.md` renders as a link *and* a disclosure, so the reading order is
 * the group's page and then its children — which is the order the rows appear
 * in, and the order someone reading the section would take them.
 */
export function readingOrder(
  nodes: DocNavNode[],
  into: NavStop[] = [],
): NavStop[] {
  for (const node of nodes) {
    switch (node.type) {
      case 'page':
        into.push({ title: node.title, href: node.href });
        break;
      case 'link':
        if (!node.external) into.push({ title: node.title, href: node.href });
        break;
      case 'group':
        if (node.href !== undefined) {
          into.push({ title: node.title, href: node.href });
        }
        readingOrder(node.children, into);
        break;
      default:
        // A separator names a block; it is not a place.
        break;
    }
  }
  return into;
}

/** The stops either side of `href`, or `undefined` at each end of the sequence. */
export function neighbours(
  nodes: DocNavNode[],
  href: string,
): { previous?: NavStop; next?: NavStop } {
  const stops = readingOrder(nodes);
  const here = normalize(href);
  const at = stops.findIndex((stop) => normalize(stop.href) === here);

  /*
   * ⚠️ A PAGE THAT IS NOT IN THE TREE GETS NO PAGER, RATHER THAN THE FIRST
   * ONE. `findIndex` returns -1 for a draft, for a page excluded from the
   * navigation, and for a route a host renders outside the tree entirely —
   * and `-1` reads as "just before the beginning", so `stops[at + 1]` would
   * hand every one of them the same first page as their "next".
   */
  if (at === -1) return {};

  const previous = stops[at - 1];
  const next = stops[at + 1];
  return {
    ...(previous === undefined ? {} : { previous }),
    ...(next === undefined ? {} : { next }),
  };
}

/**
 * A step's link text: the one it named, or the navigation's name for the page.
 *
 * ⚠️ A THROW, NOT A FALLBACK TO THE HREF. A row reading "Where this runs and
 * what that buys → /docs/infrastructure" is a URL where a sentence should be,
 * and it renders perfectly — nothing else in the pipeline would notice. The
 * frontmatter is authored and the author is right there, so the build stops and
 * says which page and which of the two fixes to reach for.
 */
export function stepTitle(
  stops: NavStop[],
  step: { href: string; title?: string | undefined },
): string | undefined {
  if (step.title !== undefined) return step.title;
  const here = normalize(step.href);
  return stops.find((stop) => normalize(stop.href) === here)?.title;
}
