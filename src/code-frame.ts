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
