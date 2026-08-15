/**
 * Give a heading that slugs to nothing an id of its own, before `rehype-slug`
 * decides for it.
 *
 * `github-slugger` strips emoji and punctuation, so `## 🎉` slugs to the empty
 * string. One such heading is merely unlinkable. Two are worse than that: the
 * slugger records the empty slug as taken, so `## 🚀` below it becomes `-1` and
 * the next `-2`. Those ids are positional — insert another emoji heading above
 * and every anchor beneath it moves — and every link anyone shared rots.
 *
 * Substituting BEFORE `rehype-slug` runs is what keeps the empty string out of
 * its collision table; a fix applied afterwards would inherit the `-1` chain it
 * was meant to remove.
 */

import type { Element, Root } from 'hast';
import rehypeSlug from 'rehype-slug';
import type { Plugin } from 'unified';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

const HEADING = /^h[1-6]$/;

/** `-1`, `-2` … — what `github-slugger` returns for a repeated empty slug. */
const EMPTY_SLUG_COLLISION = /^-\d+$/;

/**
 * `rehype-slug` itself, run over a throwaway tree, is how we learn what it will
 * assign. Reimplementing `github-slugger`'s removal table would put a second,
 * drifting opinion about slugs in the pipeline — the exact failure
 * `rehypeCaptureToc` reads ids off the tree to avoid.
 */
const slugProbe = unified().use(rehypeSlug).freeze();

function readId(node: Element): string {
  const id = node.properties.id;
  return typeof id === 'string' ? id : '';
}

export const rehypeFallbackHeadingIds: Plugin<[], Root> = () => {
  return (tree: Root): undefined => {
    const headings: Element[] = [];
    visit(tree, 'element', (node) => {
      if (HEADING.test(node.tagName)) {
        headings.push(node);
      }
    });
    if (headings.length === 0) {
      return undefined;
    }

    // Shallow copies sharing their children: the probe reads heading text and
    // writes `properties.id`, so only `properties` has to be its own object.
    const probe: Root = {
      type: 'root',
      children: headings.map((heading) => ({
        ...heading,
        properties: { ...heading.properties },
      })),
    };
    slugProbe.runSync(probe);

    const willBe = probe.children.map((child) =>
      child.type === 'element' ? readId(child) : '',
    );
    // Every id the document is about to contain, so `section-1` cannot collide
    // with a heading literally called "Section 1".
    const taken = new Set(willBe);

    let counter = 0;
    headings.forEach((heading, index) => {
      const id = willBe[index] ?? '';
      if (id !== '' && !EMPTY_SLUG_COLLISION.test(id)) {
        return;
      }
      let fallback: string;
      do {
        counter += 1;
        fallback = `section-${counter}`;
      } while (taken.has(fallback));
      heading.properties.id = fallback;
      taken.add(fallback);
    });

    return undefined;
  };
};
