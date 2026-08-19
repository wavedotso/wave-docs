'use client';

/**
 * {@link DocsNav}, wired to Next's router.
 *
 * Private, and the **only** module in `src/react/` that imports
 * `next/navigation` — named so that is obvious from the file list. Everything
 * else in here takes `pathname` and `Link` as props, which is what lets the
 * components be tested without mounting a router and reused outside Next.
 *
 * The split is not ceremony: `usePathname` is why the consumer used to have to
 * hand-write a `'use client'` wrapper of their own, and deleting that file from
 * the README is most of what `docs.Layout` is for.
 */

import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import type { DocNavNode } from '../types.js';
import { DocsNav } from './nav.js';
import type { NextLinkComponent } from './link-adapter.js';
import { wrapNextLink } from './link-adapter.js';

/** Module scope: a fresh identity here remounts every nav link on every render. */
const Link = wrapNextLink(NextLink as NextLinkComponent);

export interface DocsNextNavProps {
  nav: DocNavNode[];
  label?: string | undefined;
  closeLabel?: string | undefined;
  /** Passed through to the tree. See `DocsSidebarProps.expandGroup`. */
  expandGroup?: string | undefined;
  collapseGroup?: string | undefined;
  externalLink?: string | undefined;
}

export function DocsNextNav({
  nav,
  label,
  closeLabel,
  expandGroup,
  collapseGroup,
  externalLink,
}: DocsNextNavProps): ReactNode {
  return (
    <DocsNav
      nav={nav}
      pathname={usePathname()}
      Link={Link}
      {...(label === undefined ? {} : { label })}
      {...(closeLabel === undefined ? {} : { closeLabel })}
      {...(expandGroup === undefined ? {} : { expandGroup })}
      {...(collapseGroup === undefined ? {} : { collapseGroup })}
      {...(externalLink === undefined ? {} : { externalLink })}
    />
  );
}
