/**
 * Lift a lone image out of its wrapping paragraph.
 *
 * Markdown wraps `![alt](x.png)` in a `<p>`. That is harmless until the React
 * layer renders images as `<figure>`, at which point the tree says
 * `<p><figure>…</figure></p>`, the browser's HTML parser closes the paragraph
 * early because `<figure>` is not phrasing content, and the DOM no longer
 * matches what the server rendered. On a statically generated page React
 * reports this as a hydration mismatch with no indication of the cause — and
 * often not at all, just a silently discarded subtree.
 *
 * Cheaper to make impossible than to debug, so it is removed at the source.
 */

import type { Root, RootContent } from 'mdast';
import type { Plugin } from 'unified';
import { SKIP, visit } from 'unist-util-visit';

/** Whitespace-only text is what separates `![a](a.png)\n![b](b.png)`. */
function isIgnorable(node: RootContent): boolean {
  return node.type === 'text' && node.value.trim() === '';
}

/**
 * remark plugin. Only unwraps paragraphs whose sole meaningful child is an
 * image — a paragraph with a caption beside the image is prose, and prose
 * belongs in a paragraph.
 */
export const remarkUnwrapImages: Plugin<[], Root> = () => {
  return (tree: Root): undefined => {
    visit(tree, 'paragraph', (node, index, parent) => {
      if (parent === undefined || index === undefined) {
        return;
      }
      const meaningful = node.children.filter((child) => !isIgnorable(child));
      const only = meaningful[0];
      if (
        meaningful.length !== 1 ||
        only === undefined ||
        (only.type !== 'image' && only.type !== 'imageReference')
      ) {
        return;
      }

      // mdast's types place phrasing content strictly inside block content.
      // `mdast-util-to-hast` dispatches on node type rather than position, so
      // the image serialises to exactly the `<img>` it would have produced
      // inside the paragraph; only the type declaration objects.
      (parent.children as RootContent[])[index] = only;
      // The replacement occupies the same index; re-visiting it would only
      // walk the image again.
      return [SKIP, index + 1];
    });

    return undefined;
  };
};
