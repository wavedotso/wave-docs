/**
 * Collect the table of contents from the rendered tree.
 *
 * The ids are read off the tree rather than recomputed, which is the whole
 * point of doing this as a rehype pass instead of a second parse of the
 * markdown: `rehype-slug` seeds a `GithubSlugger` per document, so a second
 * slugger sees different collisions and assigns `-1` suffixes to different
 * headings. The TOC and the anchors then disagree on exactly the pages that
 * repeat a heading — "Parameters", "Returns", "Example" — which is most API
 * reference pages. Reading the ids makes them match by construction.
 */

import type { Element, ElementContent, Root } from 'hast';
import { toString as toText } from 'hast-util-to-string';
import type { Plugin } from 'unified';
import { SKIP, visit } from 'unist-util-visit';
import type { VFile } from 'vfile';
import type { TocEntry } from '../types.js';

declare module 'vfile' {
  interface DataMap {
    /** Written by {@link rehypeCaptureToc}. */
    toc: TocEntry[];
  }
}

/** `h2`–`h6`. `h1` is the page title and never appears in a TOC. */
const HEADING = /^h([2-6])$/;

/**
 * Drop the permalink anchor `rehype-autolink-headings` appends.
 *
 * This plugin is ordered before that one, so in practice there is nothing to
 * drop — but the check costs nothing and the alternative, if the order ever
 * changes, is every TOC entry silently gaining a trailing `#`.
 */
function isPermalink(child: ElementContent): boolean {
  if (child.type !== 'element' || child.tagName !== 'a') {
    return false;
  }
  const className = child.properties.className;
  // `@types/hast` types `ariaHidden` as a string, but a hand-built tree may
  // carry the boolean the DOM ends up with either way.
  const ariaHidden: unknown = child.properties.ariaHidden;
  return (
    ariaHidden === true ||
    ariaHidden === 'true' ||
    (Array.isArray(className) && className.includes('heading-anchor'))
  );
}

/**
 * The GFM footnote block `mdast-util-to-hast` appends.
 *
 * It carries a generated `<h2 id="footnote-label">Footnotes</h2>` that is
 * machinery rather than a section of the page — and is visually hidden, so a
 * TOC entry for it points the reader at nothing they can see. `search-index.ts`
 * skips the same subtree; the two must agree about which sections exist.
 */
function isFootnotes(node: Element): boolean {
  return node.properties.dataFootnotes !== undefined;
}

function headingText(node: Element): string {
  return node.children
    .filter((child) => !isPermalink(child))
    .map((child) => toText(child))
    .join('')
    .trim();
}

/**
 * rehype plugin. Must run after `rehype-slug`; ordering is enforced by the
 * renderer rather than checked here, because a heading legitimately may have
 * been given an id by hand.
 */
export const rehypeCaptureToc: Plugin<[], Root> = () => {
  return (tree: Root, file: VFile): undefined => {
    const toc: TocEntry[] = [];
    /** Open ancestors, outermost first. */
    const stack: TocEntry[] = [];

    visit(tree, 'element', (node) => {
      if (isFootnotes(node)) {
        return SKIP;
      }
      const match = HEADING.exec(node.tagName);
      const level = match?.[1];
      if (level === undefined) {
        return;
      }
      const id = node.properties.id;
      if (typeof id !== 'string' || id === '') {
        // A heading nothing can link to is not a table-of-contents entry.
        return;
      }

      const entry: TocEntry = {
        id,
        text: headingText(node),
        depth: Number(level),
        children: [],
      };

      // Pop until the top of the stack is strictly shallower. Handles skipped
      // levels (`h2` straight to `h4`) by nesting the h4 under the h2, and a
      // document that opens on an `h4` by treating it as a root entry.
      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (top !== undefined && top.depth < entry.depth) {
          break;
        }
        stack.pop();
      }

      const parent = stack[stack.length - 1];
      if (parent === undefined) {
        toc.push(entry);
      } else {
        parent.children.push(entry);
      }
      stack.push(entry);
    });

    file.data.toc = toc;
    return undefined;
  };
};
