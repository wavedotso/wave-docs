/**
 * The contract between the code frame the pipeline emits and the runtime that
 * makes its button work.
 *
 * Private, and dependency-free on purpose: one half is a rehype plugin running
 * in Node, the other is a `'use client'` module in the browser, and a shared
 * constant is the only thing that stops the two spelling an attribute
 * differently — a failure whose entire symptom is a button that does nothing.
 */

import type { Element, Root, RootContent } from 'hast';

/** Marks the `<figure>` a code block is wrapped in. */
export const CODE_FRAME_ATTRIBUTE = 'data-wave-docs-code';

/** The copy button inside that figure. */
export const CODE_COPY_ATTRIBUTE = 'data-wave-docs-copy';

/**
 * Set on `<html>` by the runtime once its listener is attached.
 *
 * ⚠️ THIS IS WHAT CLOSES THE INERT-MARKUP TRAP, AND IT IS STRUCTURAL RATHER
 * THAN DOCUMENTED. The button is in the HTML whether or not any JavaScript
 * runs — a `renderToStaticMarkup` consumer, a reader with scripts off, anyone
 * rendering the hast by hand. The stylesheet keeps it `visibility: hidden`
 * until this attribute appears, which also takes it out of the tab order, so
 * none of those readers meets a button that silently does nothing or a dead
 * tab stop where a control should be.
 */
export const CODE_READY_ATTRIBUTE = 'data-wave-docs-code-ready';

/**
 * The copy button's three icons, as Lucide paths.
 *
 * ⚠️ PATHS FROM THE SAME SET AS EVERY OTHER ICON HERE, AND THEY WERE FONT
 * GLYPHS. The button rendered `⧉` and swapped in `✓` and `×` through CSS
 * `content` — three characters drawn by whatever font resolved, at whatever
 * weight and baseline that font has, beside a sidebar, a pager and a search
 * dialog that are all Lucide at `stroke-width: 2`. It read as a different
 * icon set because it was one.
 *
 * `copy`, `check` and `x`, on the 24×24 grid the rest of the package uses.
 * Lucide draws its `copy` as a `<rect>` plus a `<path>`; the rect is written
 * here as the path it is, so a frame's icons are one shape of node and the
 * builder stays a list of `d` strings — the same shape `NAV_ICON_PATHS` has.
 */
export const CODE_ICON_PATHS: Record<'copy' | 'check' | 'x', string[]> = {
  copy: [
    'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z',
    'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2',
  ],
  check: ['M20 6 9 17l-5-5'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
};

/**
 * The three states the button draws, in the order they are emitted.
 *
 * `idle` is what a reader sees; the runtime writes `data-copied` on the button
 * and the stylesheet swaps which of the three is displayed. `display`, not
 * `visibility`: the button is `visibility: hidden` until the runtime attaches,
 * and `visibility` inherits — a child setting it back to `visible` would show
 * an icon inside a button that is meant to be invisible and out of the tab
 * order.
 */
export const CODE_ICON_STATES = [
  ['idle', 'copy'],
  ['copied', 'check'],
  ['failed', 'x'],
] as const satisfies ReadonlyArray<
  readonly [string, keyof typeof CODE_ICON_PATHS]
>;

/**
 * Whether a tree contains a code frame.
 *
 * `DocContent` asks before rendering the runtime, so a page with no fences
 * ships zero extra bytes rather than a client component that finds nothing to
 * do. The server has the tree in hand and this is one pass over it, so the
 * check costs nothing the render was not already paying.
 */
export function hasCodeFrame(tree: Root): boolean {
  return containsFrame(tree.children);
}

function containsFrame(nodes: readonly RootContent[]): boolean {
  for (const node of nodes) {
    if (node.type !== 'element') continue;
    if (isCodeFrame(node)) return true;
    if (containsFrame(node.children)) return true;
  }
  return false;
}

function isCodeFrame(node: Element): boolean {
  return node.properties[CODE_FRAME_ATTRIBUTE] !== undefined;
}
