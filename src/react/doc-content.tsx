import type { Root } from 'hast';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import type { ReactNode } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';

import { hasCodeFrame } from '../code-frame.js';
import type { CodeRuntimeLabels } from './code-runtime.js';
import { DocsCodeRuntime } from './code-runtime.js';
import type { MarkdownComponents } from './markdown-components.js';
import { defaultMarkdownComponents } from './markdown-components.js';

export interface DocContentProps {
  /**
   * The tree from `@waveso/docs/render`. Plain serialisable JSON, so it
   * crosses the RSC boundary and survives any build-time artifact intact.
   */
  hast: Root;
  /** Overrides, merged over {@link defaultMarkdownComponents}. */
  components?: MarkdownComponents | undefined;
  /**
   * Appended to `wave-docs-prose`, never substituted for it.
   *
   * Substitution is the failure this whole wrapper exists to prevent, so it is
   * not offered: almost every rule in the stylesheet is scoped under
   * `.wave-docs-prose`, and dropping it leaves a page whose code blocks still
   * carry correct syntax colours and nothing else — which reads as a design
   * choice rather than as a mistake.
   */
  className?: string | undefined;
  /**
   * The two things the copy runtime announces, for a site that is not in
   * English.
   *
   * Here rather than on `docs.Layout` because this is the component that mounts
   * the runtime, and it is the one no consumer can avoid — the hand-rolled route
   * in the README renders it directly. Forwarded only when set, so a site that
   * overrides nothing sends no extra props across the boundary.
   */
  labels?: CodeRuntimeLabels | undefined;
}

/**
 * Render a hast tree as React elements, inside the prose wrapper.
 *
 * Not a client component, and it must stay that way: the markdown parser and
 * Shiki ran in Node at build time, and this component only walks the resulting
 * tree. Nothing here pulls unified, remark or a highlighter into the browser.
 *
 * ## Why the wrapper is here and not on your `<article>`
 *
 * `.wave-docs-prose` is the scope for nearly every rule in `styles.css` —
 * including `.wave-docs-prose .shiki`, which is deliberately scoped so the
 * package never styles a code block it did not render. `createDocsRoute.Page`
 * always put the class on for you, but the documented hand-rolled path made
 * the consumer type it, and forgetting it silently unstyled every code block
 * on the site while leaving the syntax colours intact. One component owning
 * the class removes the way to get that wrong.
 *
 * The rules that care about tree shape are `.wave-docs-prose > * + *` and
 * `.wave-docs-prose > :is(h2…h6)`, and the tree's own children are this
 * element's direct children, so nothing moves.
 *
 * ## The copy runtime is mounted here
 *
 * Because this is the component no consumer can avoid: `createDocsRoute.Page`
 * renders it, and the documented hand-rolled route renders it directly. Wiring
 * the listener from `docs.Layout` instead would ship dead buttons to everyone
 * composing their own shell, and "what about someone not using the layout?"
 * would be a caveat rather than a non-question.
 *
 * It renders only when the tree actually contains a code frame. The server has
 * the tree in hand, the check is one pass, and the result is that a page
 * without fences ships zero extra bytes rather than a runtime with nothing to
 * do.
 *
 * `passNode` is left off (the default). `react-markdown` hardcodes it *on* with
 * no opt-out, so any mapped component that spreads its props renders
 * `node="[object Object]"` into production HTML — with no type error to warn
 * you, because `node` is a legal prop on the component and an unknown attribute
 * on the element.
 */
export function DocContent({
  hast,
  components,
  className,
  labels,
}: DocContentProps): ReactNode {
  return (
    <div
      className={
        className === undefined || className === ''
          ? 'wave-docs-prose'
          : `wave-docs-prose ${className}`
      }
    >
      {hasCodeFrame(hast) ? <DocsCodeRuntime {...labels} /> : null}
      {toJsxRuntime(hast, {
        Fragment,
        jsx,
        jsxs,
        components: { ...defaultMarkdownComponents, ...components },
      })}
    </div>
  );
}
