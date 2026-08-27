/**
 * The docs shell: skip link, sidebar, search trigger, grid. There is
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
import type { DocsIconMap } from './sidebar.js';
import type { DocsLabels } from './shell-labels.js';
import { resolveLabels } from './shell-labels.js';
import { buildCrumbTitles } from '../nav-crumbs.js';
import { DocsNextNav } from './next-nav.js';
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
  /**
   * The sidebar's marker column: `true` (default), `false`, or your own icons
   * keyed by the `icon` names your content authors. See
   * {@link DocsSidebarProps.icons}.
   *
   * ⚠️ EVERY COMPONENT IN THE MAP MUST BE A CLIENT COMPONENT. This shell is a
   * Server Component and the tree it hands them to is not, so the map crosses
   * that boundary — React can serialise a *reference* to a client component and
   * cannot serialise a server one. Import your icons from a module carrying
   * `'use client'` (every icon library does) and this is invisible; define one
   * inline in a server file and the build fails at the boundary rather than
   * here.
   */
  icons?: boolean | DocsIconMap | undefined;
}

export function DocsLayoutShell({
  children,
  nav,
  searchIndexUrl,
  search = true,
  labels,
  icons,
}: DocsLayoutShellProps): ReactNode {
  const text = resolveLabels(labels);

  return (
    <>
      <SkipLink>{text.skipToContent}</SkipLink>

      <div className="wave-docs-shell">
        <div className="wave-docs-layout">
          {/*
           * ⚠️ THIS PACKAGE RENDERS NOTHING ACROSS THE TOP OF THE PAGE.
           *
           * It used to render a full-width sticky header holding a brand, the
           * search trigger and the sidebar's trigger. Two of the sites using
           * this already have a fixed navbar of their own, and a second bar at
           * the same edge overlaps the first — so the header is gone and
           * nothing replaced it there.
           *
           * The sidebar is the chrome instead: one shell at every width,
           * holding the search trigger, the tree, and the strip that moves
           * them. It renders its own wrapper and its own scrim, so there is
           * nothing to place here.
           */}

          {/* The three the tree renders are forwarded only when set: they cross
              into a client component, so an unconfigured site must not pay for
              them in every page's payload. */}
          <DocsNextNav
            nav={nav}
            label={text.nav}
            closeLabel={text.closeNav}
            openLabel={text.openNav}
            {...(labels?.expandGroup === undefined
              ? {}
              : { expandGroup: labels.expandGroup })}
            {...(labels?.collapseGroup === undefined
              ? {}
              : { collapseGroup: labels.collapseGroup })}
            {...(labels?.externalLink === undefined
              ? {}
              : { externalLink: labels.externalLink })}
            {...(icons === undefined ? {} : { icons })}
          >
            {search === false ? null : (
              <DocsSearch
                indexUrl={searchIndexUrl}
                /*
                 * ⚠️ BEFORE THE SPREAD, SO A HOST CAN REPLACE IT. Built from
                 * the navigation this layout already holds, which is why a
                 * result's trail can read `Getting started › Installation`
                 * without a title on every search record — `search-index.json`
                 * is the artifact the README publishes a size for.
                 */
                crumbTitles={buildCrumbTitles(nav)}
                {...(search === true ? {} : search)}
                /*
                 * ⚠️ AFTER THE SPREAD, AND JOINED. `className` was before it,
                 * so a host passing `search={{ className: 'my-search' }}` — the
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
          {children}
        </div>
      </div>
    </>
  );
}
