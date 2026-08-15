/**
 * Splice a nested `root` back into its parent.
 *
 * `@shikijs/rehype` highlights a block by building a fresh hast tree and
 * assigning it over the `<pre>` — `parent.children[index] = fragment`, where
 * `fragment` is a `root`. So any document with a code block ships a tree whose
 * `children.map(node => node.type)` reads `['element', 'root', …]`.
 *
 * `RenderedDoc.hast` is published as `Root`, and `@types/hast` states that a
 * `root` cannot appear in `RootContent` — a consumer writing the walker
 * `types.ts` explicitly invites them to write, typed against `RootContent`,
 * therefore silently drops every code block. It only goes unnoticed inside this
 * package because `hast-util-to-jsx-runtime` happens to render a nested root as
 * a Fragment.
 *
 * Flattening also removes a level from the JSON that crosses the RSC boundary,
 * which is the payload this package sells.
 */

import type { Element, ElementContent, Root, RootContent } from 'hast';
import type { Plugin } from 'unified';

/**
 * The one field every node in any unist tree has.
 *
 * Declared here rather than imported from `@types/unist`, which reaches this
 * package only through `@types/hast` — naming a phantom dependency in an import
 * is how a published `.d.ts` fails to resolve on a consumer's machine.
 */
interface AnyNode {
  type: string;
}

/**
 * Takes the open {@link AnyNode} on purpose: `RootContent` has no `root`
 * member, so `child.type === 'root'` on a typed child is a compile error
 * ("no overlap"). The declared type is the thing being repaired here.
 */
function isNestedRoot(node: AnyNode): node is Root {
  return node.type === 'root';
}

/** `RootContent` minus `doctype`, which is the only member an element rejects. */
function isElementContent(node: RootContent): node is ElementContent {
  return node.type !== 'doctype';
}

function flatten(parent: Root | Element): void {
  const children: RootContent[] = [];
  let nested = false;

  for (const child of parent.children) {
    const node: AnyNode = child;
    if (isNestedRoot(node)) {
      nested = true;
      children.push(...node.children);
      continue;
    }
    children.push(child);
  }

  if (nested) {
    if (parent.type === 'root') {
      parent.children = children;
    } else {
      parent.children = children.filter(isElementContent);
    }
  }

  for (const child of parent.children) {
    if (child.type === 'element') {
      flatten(child);
    }
  }
}

/** rehype plugin. Must run after every plugin that can splice in a subtree. */
export const rehypeFlattenRoots: Plugin<[], Root> = () => {
  return (tree: Root): undefined => {
    flatten(tree);
    return undefined;
  };
};
