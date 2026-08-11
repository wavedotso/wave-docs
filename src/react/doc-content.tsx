import type { Root } from 'hast';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import type { ReactNode } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';

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
}

/**
 * Render a hast tree as React elements.
 *
 * Not a client component, and it must stay that way: the markdown parser and
 * Shiki ran in Node at build time, and this component only walks the resulting
 * tree. Nothing here pulls unified, remark or a highlighter into the browser.
 *
 * `passNode` is left off (the default). `react-markdown` hardcodes it *on* with
 * no opt-out, so any mapped component that spreads its props renders
 * `node="[object Object]"` into production HTML — with no type error to warn
 * you, because `node` is a legal prop on the component and an unknown attribute
 * on the element.
 */
export function DocContent({ hast, components }: DocContentProps): ReactNode {
  return toJsxRuntime(hast, {
    Fragment,
    jsx,
    jsxs,
    components: { ...defaultMarkdownComponents, ...components },
  });
}
