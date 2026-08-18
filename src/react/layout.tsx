/**
 * The docs shell: skip link, header, sidebar column, drawer, grid.
 *
 * Private, and a Server Component — it ships no JavaScript of its own. The two
 * pieces that need a client are `DocsNextNav` and `DocsSearch`, each carrying
 * its own `'use client'`, so a consumer's `app/docs/layout.tsx` stays a Server
 * Component even though it renders all of this.
 *
 * Every class name here is fixed by `docs/adr/001-shell-contract.md` and is
 * public API from 0.3.0.
 *
 * ## It does not wrap `children`
 *
 * `docs.Page` returns two elements — the `<article class="…__main">` and the
 * TOC `<aside class="…__toc">` — and both must be direct children of the grid
 * for `grid-template-columns` to place them in their own tracks. A wrapper
 * here would put the TOC inside the article's column and the third track would
 * sit empty. Next inserts no wrapper of its own around a layout's `children`,
 * which is what makes this work; `layout.test.tsx` pins it.
 */

import type { ReactNode } from 'react';

import type { SerializableSearchOptions } from '../search-options.js';
import type { DocNavNode } from '../types.js';
import type { DocsSearchProps } from './next-search.js';
import { DocsSearch } from './next-search.js';
import type { DocsLabels } from './shell-labels.js';
import { resolveLabels } from './shell-labels.js';
import { DocsNextNav } from './next-nav.js';
import { DOCS_NAV_ID } from './nav.js';
import { SkipLink } from './skip-link.js';

/**
 * What a host may say about the search trigger, minus the URL.
 *
 * `indexUrl` is derived from `basePath` and is not negotiable here: the whole
 * reason `docs.Layout` exists is that nobody should have to know the index's
 * address, and a hand-passed one is wrong under every non-root `basePath`.
 *
 * `miniSearchOptions` is narrower than the one `DocsSearch` itself takes, and
 * has to be. `docs.Layout` is a Server Component and `DocsSearch` is a Client
 * Component, so everything here is serialised on its way across — a `tokenize`
 * or a `processTerm` passed at this seam fails `next build` with *"Functions
 * cannot be passed directly to Client Components"*. {@link
 * SerializableSearchOptions} documents the escape hatch: a `'use client'`
 * wrapper of your own, where the function is a module import on both sides
 * rather than a prop between them.
 */
export type DocsLayoutSearchProps = Omit<
  DocsSearchProps,
  'indexUrl' | 'miniSearchOptions'
> & {
  miniSearchOptions?: SerializableSearchOptions | undefined;
};

export interface DocsLayoutShellProps {
  children: ReactNode;
  nav: DocNavNode[];
  searchIndexUrl: string;
  title?: ReactNode;
  actions?: ReactNode;
  /**
   * `false` to omit the trigger; an object to configure it.
   *
   * ⚠️ AN OBJECT IS WHAT MAKES `miniSearchOptions` REACHABLE, AND ONLY THE
   * SERIALISABLE PART OF IT. MiniSearch reads `tokenize` and `processTerm` both
   * when indexing and when querying, so the object `createDocsRoute` built the
   * index with has to be the object the dialog queries it with — and while this
   * was a bare boolean there was no channel for it at all. Configuring the
   * route and rendering `docs.Layout` produced an index whose terms no query
   * could spell: zero results, no error, nothing in the console.
   *
   * Widening it to a boolean-or-object fixed that for data overrides and broke
   * the function ones, which is the harder half: this prop is serialised on its
   * way from a Server Component to a Client one, so a function in it is a build
   * failure rather than a silent miss. `createDocsRoute` refuses to forward one
   * and says so; {@link DocsLayoutSearchProps} carries the remedy.
   */
  search?: boolean | DocsLayoutSearchProps | undefined;
  /**
   * The four strings the chrome renders, for a site that is not in English.
   *
   * `DocsNav` declared `label` and `closeLabel`, documented them and defaulted
   * them — and this component, the only thing that renders `DocsNav`, never
   * passed either. Configuration that could not be configured.
   */
  labels?: DocsLabels | undefined;
}

export function DocsLayoutShell({
  children,
  nav,
  searchIndexUrl,
  title,
  actions,
  search = true,
  labels,
}: DocsLayoutShellProps): ReactNode {
  const text = resolveLabels(labels);

  return (
    <>
      <SkipLink>{text.skipToContent}</SkipLink>
      <header className="wave-docs-layout__header">
        <div className="wave-docs-layout__header-inner">
          <button
            type="button"
            className="wave-docs-layout__nav-trigger"
            aria-label={text.openNav}
            /*
             * Server-rendered and declarative: `command` opens the dialog with
             * no JavaScript of ours involved, so the drawer works on the first
             * tap — before hydration, and with scripts disabled. The attributes
             * are not in `@types/react` yet, and JSX skips excess-property
             * checking on a spread; React passes both through because they are
             * lowercase.
             */
            {...{ command: 'show-modal', commandfor: DOCS_NAV_ID }}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
            </svg>
          </button>

          {/*
           * Rendered only when given. An empty wrapper is not free in a flex
           * row: it still consumes a `gap`, so an unset `title` would push the
           * search trigger 0.75rem off the trigger button for no reason.
           */}
          {title === undefined ? null : (
            <div className="wave-docs-layout__title">{title}</div>
          )}

          {search === false ? null : (
            <DocsSearch
              indexUrl={searchIndexUrl}
              className="wave-docs-layout__search"
              {...(search === true ? {} : search)}
            />
          )}

          {actions === undefined ? null : (
            <div className="wave-docs-layout__actions">{actions}</div>
          )}
        </div>
      </header>

      <div className="wave-docs-layout">
        <div className="wave-docs-layout__sidebar">
          <DocsNextNav nav={nav} label={text.nav} closeLabel={text.closeNav} />
        </div>
        {children}
      </div>
    </>
  );
}
