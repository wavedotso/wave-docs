/**
 * What counts as a section of a page.
 *
 * Private — deliberately not an entry point in `package.json`, and deliberately
 * a leaf: it imports nothing but a type.
 *
 * Both the table-of-contents capture (`plugins/rehype-capture-toc.ts`) and the
 * search-record extraction (`search-index.ts`) have to answer the same question,
 * and this module is the one answer. It lives here rather than in either of them
 * because a shared rule owned by one consumer is not shared, it is borrowed:
 * when `rehypeCaptureToc` imported these from `search-index.js`, every page
 * render — and every `next.config.ts` load, through `createDocsRedirects` —
 * pulled `minisearch` and `node:fs/promises` in behind them, and two functions
 * documented as internal became public API of the `search-index` entry point.
 */

import type { Element } from 'hast';

/**
 * Containers a heading can sit inside and still open a section.
 *
 * ⚠️ THIS SET IS THE SECTION-BOUNDARY RULE, AND BOTH READERS HAVE TO AGREE ON
 * IT. A heading the TOC captures but the index does not gets a table-of-contents
 * entry with no searchable section behind it, its prose folded into the section
 * above, and a hit that deep-links to the wrong anchor under the wrong
 * breadcrumb. `callout` — what `> [!NOTE]` renders to in this very package — was
 * exactly that case. Use {@link isTransparentContainer} rather than reaching for
 * the set, and add to it in one place.
 *
 * `li` is deliberately absent, and not as an oversight: a list item's children
 * can be bare inline nodes, so descending into one would yield `re`, `<em>al`,
 * `ly` as three separate blocks and index `re al ly` as three terms.
 */
const TRANSPARENT_TAGS = new Set([
  'article',
  'blockquote',
  'callout',
  'div',
  'main',
  'section',
]);

/** Whether a heading nested in `node` still opens a section of its own. */
export function isTransparentContainer(node: Element): boolean {
  return TRANSPARENT_TAGS.has(node.tagName);
}

/**
 * The GFM footnote block `mdast-util-to-hast` appends, and everything in it.
 *
 * It is a `section` — so {@link TRANSPARENT_TAGS} would otherwise walk straight
 * into it — carrying a generated `<h2 id="footnote-label">Footnotes</h2>`. That
 * heading is machinery, not a section of the page: indexing it puts a
 * `Footnotes` hit in the dialog for every footnoted page, and the footnote text
 * itself is already indexed where it was written. Both readers skip the same
 * subtree, so the TOC and the index agree.
 */
export function isFootnotes(node: Element): boolean {
  return node.properties.dataFootnotes !== undefined;
}
