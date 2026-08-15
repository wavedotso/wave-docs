/**
 * Collect the table of contents from the rendered tree.
 *
 * ## Why this runs dead last
 *
 * Because `extractSearchRecords` walks the finished tree, and the TOC must
 * describe the same document search does. Captured earlier, a consumer plugin
 * attached through `rehypePlugins` could add or remove a heading and put the
 * two out of step — silently, in both directions: a deleted heading id leaves
 * a TOC entry pointing at nothing while search drops the section, and an added
 * `<h2>` becomes a search record with no TOC entry. Reading last makes them
 * agree by construction rather than by a validation pass that would have to
 * exist and be maintained.
 *
 * The ids are read off the tree rather than recomputed, which is the whole
 * point of doing this as a rehype pass instead of a second parse of the
 * markdown: `rehype-slug` seeds a `GithubSlugger` per document, so a second
 * slugger sees different collisions and assigns `-1` suffixes to different
 * headings. The TOC and the anchors then disagree on exactly the pages that
 * repeat a heading — "Parameters", "Returns", "Example" — which is most API
 * reference pages. Reading the ids makes them match by construction.
 */

import type { Element, ElementContent, Root, RootContent } from 'hast';
import { toString as toText } from 'hast-util-to-string';
import type { Plugin } from 'unified';
import type { VFile } from 'vfile';
import { isFootnotes, isTransparentContainer } from '../section-boundary.js';
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
 * ⚠️ LOAD-BEARING NOW. This used to run *before* autolinking, so there was
 * nothing to drop and this was insurance against an order that might change.
 * The order changed: the capture is dead last, after Shiki and after the
 * consumer's own plugins, so every heading really does carry an appended
 * anchor by the time this walks it. Delete this and every TOC entry gains a
 * trailing `#`.
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

    const capture = (node: Element): void => {
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
    };

    /**
     * Block-level nodes in document order, stepping into wrappers a section may
     * legitimately sit inside — and no further.
     *
     * ⚠️ THE BOUND IS THE POINT, AND IT IS SHARED WITH THE SEARCH INDEX. A
     * whole-tree walk gave a TOC entry to any heading with an id however deeply
     * wrapped, while `extractSearchRecords` opens a section only inside an
     * {@link isTransparentContainer} — so a `## ` written inside a list item or
     * a table cell got a TOC entry with no searchable section behind it, and its
     * prose was folded into the section above under the wrong breadcrumb. One
     * exported predicate is what stops the two drifting apart again.
     */
    const walk = (nodes: readonly RootContent[]): void => {
      for (const node of nodes) {
        if (node.type !== 'element' || isFootnotes(node)) {
          continue;
        }
        if (isTransparentContainer(node)) {
          walk(node.children);
          continue;
        }
        capture(node);
      }
    };

    walk(tree.children);

    file.data.toc = toc;
    return undefined;
  };
};
