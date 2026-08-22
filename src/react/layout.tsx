/**
 * The docs shell: skip link, sidebar, search trigger, drawer, grid. There is
 * no header: the sidebar is the chrome at every width, and the comment on it
 * below is why.
 *
 * Private, and a Server Component — it ships no JavaScript of its own. The two
 * pieces that need a client are `DocsNextNav` and `DocsSearch`, each carrying
 * its own `'use client'`, so a consumer's `app/docs/layout.tsx` stays a Server
 * Component even though it renders all of this.
 *
 * Every class name here is public API from 0.3.0, and is
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
  search = true,
  labels,
}: DocsLayoutShellProps): ReactNode {
  const text = resolveLabels(labels);

  return (
    <>
      <SkipLink>{text.skipToContent}</SkipLink>

      <div className="wave-docs-layout">
        {/*
         * ⚠️ THIS PACKAGE RENDERS NOTHING ACROSS THE TOP OF THE PAGE.
         *
         * It used to render a full-width sticky header holding a brand, the
         * search trigger and the drawer's trigger. Two of the sites using this
         * already have a fixed navbar of their own, and a second bar at the same
         * edge overlaps the first — so the header is gone and nothing replaced
         * it there.
         *
         * Above 64rem this wrapper is the 16rem sidebar column, and the drawer
         * inside it is `display: contents`, so the search trigger and the tree
         * become its children directly. Below 64rem it generates no box at all:
         * the tree and the search live in a closed `<dialog>`, opened by a small
         * floating button. One nav in the DOM at every width, and nothing of
         * ours competing for the top edge.
         */}
        <div className="wave-docs-layout__sidebar">
          <button
            type="button"
            className="wave-docs-layout__nav-trigger"
            aria-label={text.openNav}
            /*
             * Server-rendered and declarative: `command` opens the dialog with
             * no JavaScript of ours involved, so the drawer works on the first
             * tap — before hydration, and with scripts disabled. `commandfor`
             * binds by id, so the dialog below being a later sibling rather
             * than a descendant costs nothing. The attributes are not in
             * `@types/react` yet, and JSX skips excess-property checking on a
             * spread; React passes both through because they are lowercase.
             */
            {...{ command: 'show-modal', commandfor: DOCS_NAV_ID }}
          >
            {/*
             * No icon. The control is a 24px strip down the edge of the screen,
             * which is too narrow to hold one legibly — `styles.css` draws a
             * grip on it instead, decoratively. The button's accessible name is
             * `aria-label`, so nothing here is load-bearing for a reader.
             */}
          </button>

          {/* The three the tree renders are forwarded only when set: they cross
              into a client component, so an unconfigured site must not pay for
              them in every page's payload. */}
          <DocsNextNav
            nav={nav}
            label={text.nav}
            closeLabel={text.closeNav}
            {...(labels?.expandGroup === undefined
              ? {}
              : { expandGroup: labels.expandGroup })}
            {...(labels?.collapseGroup === undefined
              ? {}
              : { collapseGroup: labels.collapseGroup })}
            {...(labels?.externalLink === undefined
              ? {}
              : { externalLink: labels.externalLink })}
          >
            {search === false ? null : (
              <DocsSearch
                indexUrl={searchIndexUrl}
                {...(search === true ? {} : search)}
                /*
                 * ⚠️ AFTER THE SPREAD, AND JOINED. `className` was before it, so
                 * a host passing `search={{ className: 'my-search' }}` — the
                 * ordinary reason to pass one — replaced
                 * `wave-docs-layout__search` instead of adding to it, and the
                 * trigger lost the placement the shell depends on. Adding a
                 * class should not remove one.
                 */
                className={[
                  'wave-docs-layout__search',
                  search === true ? undefined : search?.className,
                ]
                  .filter(Boolean)
                  .join(' ')}
              />
            )}
          </DocsNextNav>
        </div>
        {children}
      </div>
    </>
  );
}
