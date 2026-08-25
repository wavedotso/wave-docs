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
 * inside the surface `<div>` this put around it. The `root` node it splices in is
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

import {
  CODE_COPY_ATTRIBUTE,
  CODE_FRAME_ATTRIBUTE,
  CODE_ICON_PATHS,
  CODE_ICON_STATES,
} from '../code-frame.js';
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
      /*
       * ⚠️ THE `<figcaption>` STAYS A DIRECT CHILD OF THE `<figure>`, WHICH IS
       * WHY THIS HAS NO HEADER WRAPPER.
       *
       * A `figcaption` has to be the first or last child of its figure. Put
       * inside the `.wave-docs-panel__header` `<div>` that "where to go next"
       * uses, it captions nothing: the markup is invalid and the figure loses
       * the accessible name a titled block used to have. So the frame wears
       * `.wave-docs-panel` and `.wave-docs-panel__body` and the stylesheet
       * lays these children out on a grid — sharing the primitive's insets
       * rather than its header element.
       *
       * The button stays out of the caption for the same reason it is not
       * inside it: a `<button>` in a `<figcaption>` contributes its accessible
       * name to the figure's, so a block called `swap.ts` would announce as
       * "swap.ts Copy code from swap.ts".
       */
      if (title !== undefined) {
        children.push({
          type: 'element',
          tagName: 'figcaption',
          properties: { className: ['wave-docs-code__title'] },
          children: [{ type: 'text', value: title }],
        });
      } else if (language !== undefined) {
        /*
         * The language, when the author named no file — one label slot, and a
         * filename already says what the language is more precisely than the
         * language does.
         *
         * ⚠️ `aria-hidden`, WHICH IS ALSO WHAT KEEPS IT OUT OF THE SEARCH
         * INDEX. `buildSearchIndex` drops any subtree marked presentational,
         * so the badge costs the index nothing. As real text it would put
         * "typescript" or "bash" into the searchable body of every page that
         * has a fence — the same relevance poisoning `pre` is skipped to
         * avoid — and a screen reader would read it out ahead of every block.
         */
        children.push({
          type: 'element',
          tagName: 'span',
          properties: {
            className: ['wave-docs-code__lang'],
            'aria-hidden': 'true',
          },
          children: [{ type: 'text', value: language }],
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
        /*
         * The panel's inset surface. It is a wrapper rather than the `<pre>`
         * itself because the `<pre>` is the scroll container for a wide line,
         * and a box cannot both clip to a radius and scroll inside it.
         */
        {
          type: 'element',
          tagName: 'div',
          properties: {
            className: ['wave-docs-panel__body', 'wave-docs-code__body'],
          },
          children: [node],
        },
      );

      parent.children[index] = {
        type: 'element',
        tagName: 'figure',
        properties: {
          className: ['wave-docs-panel', 'wave-docs-code'],
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
    /*
     * All three states ship in the markup and the stylesheet shows one. There
     * is no component here to re-render and nothing to hydrate — the runtime
     * writes one attribute on the button and the swap is CSS.
     *
     * Three icons per fence is fifty on a page with fifty of them, and the
     * repeat is why that is affordable: it is byte-identical every time, which
     * is the case gzip handles best. The measured cost is in `size-budget`.
     */
    children: CODE_ICON_STATES.map(([state, name]) => stateIcon(state, name)),
  };
}

/**
 * One Lucide glyph, as hast.
 *
 * Decoration, so it is out of the accessibility tree — the button reads as its
 * `aria-label` — and out of the search index by the same rule that drops the
 * heading anchor icons.
 */
function stateIcon(state: string, name: keyof typeof CODE_ICON_PATHS): Element {
  return {
    type: 'element',
    tagName: 'svg',
    properties: {
      className: ['wave-docs-code__copy-icon'],
      'data-state': state,
      'aria-hidden': 'true',
      focusable: 'false',
      viewBox: '0 0 24 24',
      width: '16',
      height: '16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: '2',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    },
    children: CODE_ICON_PATHS[name].map((d) => ({
      type: 'element' as const,
      tagName: 'path',
      properties: { d },
      children: [],
    })),
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
