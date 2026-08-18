/**
 * Wrap each code fence in a `<figure>` with an optional title bar and a copy
 * button — as plain hast, in Node, at build time.
 *
 * ## The window this runs in is one step wide
 *
 * It has to be after `rehypeNormalizeCodeLanguage` (step 12), because that is
 * what folds ` ```JSON ` to `json` and disguises the fences `excludeLangs`
 * names. And it has to be before Shiki (step 13), because Shiki **replaces**
 * the `<pre><code>` subtree: `code.data.meta` — the only place a fence's
 * `title="…"` exists — is gone afterwards, in Node, with no client-side
 * recovery.
 *
 * Wrapping before Shiki is safe because Shiki's own `visit` assigns over
 * `parent.children[index]`, so the `<pre>` it replaces is replaced in place,
 * inside the figure this put around it. The `root` node it splices in is
 * flattened by `rehypeFlattenRoots`, which already recurses into element
 * children — this is simply the first thing to put a `root` inside an element,
 * which is why the test suite pins it.
 *
 * ## Not a client component per code block
 *
 * The alternative — mapping `pre` to a `'use client'` component, which is what
 * Fumadocs and Nextra do — puts one client reference and one hydration root in
 * the flight stream per fence, fifty of each on a page with fifty blocks, and
 * drags the highlighted subtree across the client boundary as children. That
 * shape is the thing this package exists to avoid. One delegated listener,
 * mounted once by `DocContent`, does the same job for any number of blocks.
 *
 * ## Excluded fences are not framed
 *
 * `render.ts` promises that a fence whose language is in `excludeLangs`
 * reaches your component *untouched*. A copy button around a rendered Mermaid
 * diagram would copy nothing anybody wants, and the wrapper would break the
 * one contract the option has.
 */

import type { Element, ElementContent, Root } from 'hast';
import type { Plugin } from 'unified';
import { CONTINUE, SKIP, visit } from 'unist-util-visit';
import type { VFile } from 'vfile';

import { CODE_COPY_ATTRIBUTE, CODE_FRAME_ATTRIBUTE } from '../code-frame.js';
import { parseCodeMeta } from '../code-meta.js';

/** `language-ts` on the `<code>`, already folded to lower case by step 12. */
const LANGUAGE_CLASS = /^language-(.+)$/;

export interface RehypeCodeFrameOptions {
  /**
   * Accessible name of the copy button on a fence with no title.
   * Default `'Copy code'`.
   */
  copyLabel?: string | undefined;
  /**
   * The same button on a titled fence. Default `'Copy code from {title}'`.
   *
   * `{title}` is replaced with the fence's own `title="…"`. Two controls both
   * called "Copy code" are indistinguishable in a screen reader's element list,
   * which is why the titled form exists at all — and a translator needs to be
   * able to move the title within the sentence, which concatenation forbade.
   */
  copyFromLabel?: string | undefined;
}

export const rehypeCodeFrame: Plugin<[RehypeCodeFrameOptions?], Root> = (
  options = {},
) => {
  const copyLabel = options.copyLabel ?? 'Copy code';
  const copyFromLabel = options.copyFromLabel ?? 'Copy code from {title}';

  /*
   * The document path comes off the vfile rather than out of options, for the
   * reason `remarkDocLinks` does the same: `buildProcessor` builds ONE frozen
   * processor and every file runs through it, so anything per-file passed as
   * an option would be whichever file happened to be rendered first.
   */
  return (tree: Root, file: VFile): undefined => {
    const path =
      file.data.docLinkContext?.relativePath ?? file.path ?? 'a document';

    visit(tree, 'element', (node, index, parent) => {
      // `EXCLUDED_PRE_TAG` is deliberately not matched: at this point in the
      // pipeline an excluded fence is not a `<pre>` at all, which is exactly
      // the property that keeps it unframed.
      if (node.tagName !== 'pre') return CONTINUE;
      if (parent === undefined || index === undefined) return CONTINUE;

      const code = node.children[0];
      if (code === undefined || code.type !== 'element') return CONTINUE;
      if (code.tagName !== 'code') return CONTINUE;

      const meta = readMeta(code);
      const { title } = parseCodeMeta(meta, path);
      const language = readLanguage(code);

      const children: ElementContent[] = [];
      if (title !== undefined) {
        children.push({
          type: 'element',
          tagName: 'figcaption',
          properties: { className: ['wave-docs-code__title'] },
          children: [{ type: 'text', value: title }],
        });
      }
      children.push(
        copyButton(
          // Named, on a page with eight code blocks, rather than eight
          // controls all called "Copy code".
          title === undefined
            ? copyLabel
            : copyFromLabel.replace('{title}', title),
        ),
        node,
      );

      parent.children[index] = {
        type: 'element',
        tagName: 'figure',
        properties: {
          className: ['wave-docs-code'],
          [CODE_FRAME_ATTRIBUTE]: '',
          /*
           * Only when the author declared one. A bare fence has no
           * `language-*` class here — Shiki's `defaultLanguage: 'text'` adds
           * one later — so `data-lang` is absent rather than `"text"`, and a
           * published badge rule needs no exception for it.
           */
          ...(language === undefined ? {} : { 'data-lang': language }),
        },
        children,
      };

      // Do not descend into the figure we just built; the `<pre>` inside it is
      // the node we came from.
      return SKIP;
    });
    return undefined;
  };
};

/**
 * A real `<button type="button">`, so Enter and Space work with no key
 * handling of ours and the control is announced as a button.
 *
 * It sits before the `<pre>`, which is what makes the tab order read "copy
 * this block" → "the scrollable code region" rather than the reverse.
 */
function copyButton(label: string): Element {
  return {
    type: 'element',
    tagName: 'button',
    properties: {
      type: 'button',
      className: ['wave-docs-code__copy'],
      [CODE_COPY_ATTRIBUTE]: '',
      /*
       * ⚠️ THE ACCESSIBLE NAME NEVER CHANGES, including on success. Mutating
       * the name of the element that currently has focus is announced
       * inconsistently across screen readers, and is the classic wrong fix for
       * "how does a reader know it copied". The runtime announces that through
       * a live region instead.
       */
      'aria-label': label,
    },
    children: [
      {
        type: 'element',
        tagName: 'span',
        // Decoration. Kept out of the accessibility tree so the button reads
        // as its `aria-label`, and out of the search index by the same rule
        // that drops the heading anchor icons.
        properties: { 'aria-hidden': 'true' },
        children: [{ type: 'text', value: '⧉' }],
      },
    ],
  };
}

/** `code.data.meta` — read, never written. */
function readMeta(code: Element): string | undefined {
  const meta = (code.data as { meta?: unknown } | undefined)?.meta;
  return typeof meta === 'string' ? meta : undefined;
}

function readLanguage(code: Element): string | undefined {
  const classNames = code.properties.className;
  if (!Array.isArray(classNames)) return undefined;

  for (const name of classNames) {
    if (typeof name !== 'string') continue;
    const found = LANGUAGE_CLASS.exec(name)?.[1];
    if (found !== undefined) return found;
  }
  return undefined;
}
