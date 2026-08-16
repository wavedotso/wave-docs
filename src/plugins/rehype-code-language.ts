/**
 * Decide, before Shiki runs, what language a fence is written in — and which
 * fences Shiki may not touch at all.
 *
 * Two problems, one pass, because both are answers to the same question and
 * both have to be settled while `<pre><code class="language-…">` still exists:
 * Shiki REPLACES that subtree, so nothing downstream can recover what the
 * author typed.
 *
 * 1. `@shikijs/rehype` tests `getLoadedLanguages().includes(lang)` with no case
 *    folding, and this pipeline's `fallbackLanguage: 'text'` — which exists so
 *    an unloaded grammar is not fatal — then swallows the miss. So ```JSON,
 *    ```Bash and ```TSX ship MONOCHROME with `<pre>` properties byte-identical
 *    to a highlighted block: nothing in the markup to grep for, correct in the
 *    author's editor and on GitHub, wrong only in production. GitHub, VS Code,
 *    Prism and highlight.js all fold the case; so do we. Folding beats adding
 *    capitalised `langAlias` entries because it is total — ```JSon and ```BASH
 *    are the same fence to an author, and no guessed list covers them.
 *
 * 2. A ```mermaid fence is not code to be coloured, it is a diagram for the
 *    consumer's own component. Shiki has no `excludeLangs`, and it claims every
 *    `<pre>` whose first child is a `<code>`, so the only way past it is to
 *    make the node stop looking like a `<pre>` for the length of its visit.
 *    {@link rehypeRestoreExcludedCode} puts the tag back afterwards.
 */

import type { Root } from 'hast';
import type { Plugin } from 'unified';
import { CONTINUE, SKIP, visit } from 'unist-util-visit';

/** `language-ts` on a `<code>` — how a fence's language survives to hast. */
const LANGUAGE_CLASS = /^language-(.+)$/;

/**
 * The tag an excluded `<pre>` wears while Shiki walks the tree.
 *
 * Exported so a test can prove it never reaches the output: a leaked sentinel
 * is an unstyled block with an invented tag name, which React renders happily
 * and nobody notices.
 */
export const EXCLUDED_PRE_TAG = 'wave-docs-excluded-pre';

export interface RehypeCodeLanguageOptions {
  /** Lower-cased fence languages Shiki must leave alone, e.g. `['mermaid']`. */
  exclude?: readonly string[];
}

export const rehypeNormalizeCodeLanguage: Plugin<
  [RehypeCodeLanguageOptions?],
  Root
> = (options = {}) => {
  const excluded = new Set(
    (options.exclude ?? []).map((lang) => lang.toLowerCase()),
  );

  return (tree: Root): undefined => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'pre') {
        return CONTINUE;
      }
      const code = node.children[0];
      if (code === undefined || code.type !== 'element') {
        return CONTINUE;
      }
      const classNames = code.properties.className;
      if (!Array.isArray(classNames)) {
        return SKIP;
      }

      let language: string | undefined;
      code.properties.className = classNames.map((name) => {
        if (typeof name !== 'string') {
          return name;
        }
        const found = LANGUAGE_CLASS.exec(name)?.[1];
        if (found === undefined) {
          return name;
        }
        language = found.toLowerCase();
        return `language-${language}`;
      });

      if (language !== undefined && excluded.has(language)) {
        node.tagName = EXCLUDED_PRE_TAG;
      }
      return SKIP;
    });
    return undefined;
  };
};

/**
 * Undo the disguise. Must run after `rehypeShikiFromHighlighter`, and it is a
 * separate plugin rather than a flag on the first one because unified gives a
 * plugin one position in the pipeline and this needs the other side of Shiki.
 */
export const rehypeRestoreExcludedCode: Plugin<[], Root> = () => {
  return (tree: Root): undefined => {
    visit(tree, 'element', (node) => {
      if (node.tagName === EXCLUDED_PRE_TAG) {
        node.tagName = 'pre';
        /*
         * ⚠️ AND THE `tabindex` SHIKI WOULD HAVE ADDED. The stylesheet gives an
         * excluded fence the same surface as a highlighted one, `overflow-x:
         * auto` included — and a scrollable region that cannot be focused is
         * one no keyboard can scroll (WCAG 2.1.1). Shiki puts `tabindex="0"` on
         * every `<pre>` it emits for exactly this reason; this block is the one
         * it never saw, so it was the one block on the page a keyboard reader
         * could not read the right-hand side of.
         *
         * `role`/`aria-label` deliberately not added: a bare focusable `<pre>`
         * is what Shiki produces and what every other code block here is, and
         * one block announcing itself differently from its neighbours is worse
         * than the small imperfection they share.
         */
        node.properties = { ...node.properties, tabIndex: 0 };
      }
    });
    return undefined;
  };
};
