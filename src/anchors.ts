/**
 * Anchor checking: `#section` targets that no heading owns.
 *
 * Private — deliberately not an entry point.
 *
 * ⚠️ THE GAP NOTHING ELSE COVERED. A route was checked and its fragment was
 * thrown away — `toRouteKey` cuts at the first `#` before the existence test —
 * so `[setup](./install.md#setup)` passed the build with no `#setup` on the
 * page. It is the more common failure of the two this package guards, because
 * headings get renamed constantly and nothing renames the links into them.
 *
 * Two halves, because they need different amounts of the corpus:
 *
 * - **Same page** (`#setup`, or `./this-page.md#setup`) is checked inside
 *   `render`, where the tree and the recorded links are both in hand — so the
 *   error carries the file AND the line.
 * - **Another page** (`./other.md#setup`) needs that page's ids, which exist
 *   only once everything is rendered. `renderAll` does it, and the message
 *   names the page and the link rather than a line, because positions are
 *   stripped from a returned tree.
 */

import type { Element, Root as HastRoot } from 'hast';
import { visit } from 'unist-util-visit';

import type { RenderedDoc } from './types.js';

/**
 * Every `id` in a tree, which is the set an anchor may target.
 *
 * Not the table of contents: that captures `h2`–`h3` only, so checking against
 * it would reject a perfectly good link to an `h4` — and would miss an id a
 * `rehypePlugins` entry put on something that is not a heading at all.
 */
export function collectAnchorIds(tree: HastRoot): Set<string> {
  const ids = new Set<string>();
  visit(tree, 'element', (node: Element) => {
    const id = node.properties.id;
    if (typeof id === 'string' && id !== '') ids.add(id);
  });
  return ids;
}

/** An internal link carrying a fragment, as found in a rendered tree. */
export interface AnchorLink {
  /** The href exactly as it stands in the tree, e.g. `/docs/install#setup`. */
  href: string;
  /** Route without the fragment. */
  route: string;
  /** Fragment without the `#`, percent-decoded. */
  fragment: string;
}

/**
 * `#fragment` split off an internal href, or `undefined`.
 *
 * Skips anything with a scheme and anything protocol-relative: an anchor on
 * somebody else's page is theirs to get wrong, and a fragment there is a
 * routine way to link into a spec.
 */
export function splitAnchor(href: string): AnchorLink | undefined {
  if (href === '' || /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return undefined;

  const hash = href.indexOf('#');
  if (hash === -1 || hash === href.length - 1) return undefined;

  const raw = href.slice(hash + 1);
  let fragment: string;
  try {
    fragment = decodeURIComponent(raw);
  } catch {
    // A malformed escape cannot name an id, and the link path already reports
    // one — failing twice for one mistake helps nobody.
    return undefined;
  }

  return { href, route: href.slice(0, hash), fragment };
}

/** Every internal anchor link in a tree, in document order. */
export function collectAnchorLinks(tree: HastRoot): AnchorLink[] {
  const links: AnchorLink[] = [];
  visit(tree, 'element', (node: Element) => {
    if (node.tagName !== 'a') return;
    const href = node.properties.href;
    if (typeof href !== 'string') return;
    const anchor = splitAnchor(href);
    if (anchor !== undefined) links.push(anchor);
  });
  return links;
}

/**
 * Cross-page anchors, once every page has been rendered.
 *
 * `report` is passed in rather than imported so this module stays free of the
 * error factory and the severity plumbing — it answers "which anchors are
 * wrong", and the caller owns what that costs.
 *
 * A link to a route nothing rendered is a *broken link*, not a broken anchor,
 * and `assertLinks` has already reported it at its own severity. Skipped here
 * so one mistake is not two failures.
 */
export function assertAnchors(
  docs: ReadonlyArray<RenderedDoc<never>> | ReadonlyArray<RenderedDoc>,
  report: (from: string, link: AnchorLink, known: Set<string>) => void,
): void {
  const idsByRoute = new Map<string, Set<string>>();
  for (const doc of docs) {
    idsByRoute.set(doc.href, collectAnchorIds(doc.hast));
  }

  for (const doc of docs) {
    for (const link of collectAnchorLinks(doc.hast)) {
      // An empty route is a same-page link, already checked during `render`.
      if (link.route === '') continue;
      const known = idsByRoute.get(link.route);
      if (known === undefined || known.has(link.fragment)) continue;
      report(doc.href, link, known);
    }
  }
}
