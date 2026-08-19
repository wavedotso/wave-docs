'use client';

/**
 * {@link SearchDialog}, wired to Next's router and `next/link`.
 *
 * `SearchDialog` takes `navigate` and `Link` as props so it stays
 * host-agnostic, and that seam is why its own tests are worth having — they
 * assert behaviour against a stub router rather than mounting Next. But this
 * package is a Next adapter, so in practice every consumer wrote the same
 * fifteen-line `'use client'` wrapper around `useRouter().push` and
 * `next/link`, and the ones who skipped `Link` lost hover prefetching on
 * every result without anything telling them.
 *
 * So it ships. The same bargain `createDocsRoute` already strikes on the
 * server, where `next/link` and `next/image` are wired by default and
 * overridable through `components`.
 *
 * ```tsx
 * // app/docs/layout.tsx — a Server Component; this file carries the boundary
 * import { DocsSearch } from '@waveso/docs/react/next-search';
 * import { docs } from '@/lib/docs';
 *
 * <DocsSearch indexUrl={docs.searchIndexUrl} />
 * ```
 */

import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useCallback } from 'react';

import type { NextLinkComponent } from './link-adapter.js';
import { wrapNextLink } from './link-adapter.js';
import { SearchDialog } from './search-dialog.js';
import type { SearchDialogProps } from './search-dialog.js';

/*
 * Module scope, not render scope. A fresh component identity for the result
 * link would remount every hit on every keystroke — and this is also the one
 * adapter `@waveso/docs/next` uses for the markdown layer, so the two halves
 * cannot disagree about what `next/link` accepts.
 *
 * The cast is real, and `next-nav.tsx` needs the identical one — this comment
 * claimed to be the only place, which was wrong the moment the shell landed.
 * Both are `next/link` crossing into `DocsLinkProps`, and both go through
 * `wrapNextLink`, which is the one adapter they share.
 * `DocsLinkProps` extends React's anchor props, where every optional is
 * `| undefined`; Next's `LinkProps` declares `onClick?`, `onMouseEnter?` and
 * `onTouchStart?` *without* it, so under `exactOptionalPropertyTypes` — which
 * this package compiles with — the two are not assignable in either
 * direction. Both are correct on their own terms and `next/link` accepts all
 * of them at runtime; the incompatibility is entirely in the declaration
 * files. Narrowing `DocsLinkProps` to fit would break the plain `<a>` fallback
 * that makes `SearchDialog` host-agnostic, which is a real feature traded for
 * a types artifact.
 */
const Link = wrapNextLink(NextLink as NextLinkComponent);

/**
 * Everything `SearchDialog` takes except the two things Next answers for you.
 *
 * `indexUrl` stays required, and `docs.searchIndexUrl` is the only value
 * anyone should pass: defaulting it to `/search-index.json` would be wrong
 * under every non-root `basePath`, and wrong as a 404 the reader hits and the
 * author never sees.
 */
export type DocsSearchProps = Omit<SearchDialogProps, 'navigate' | 'Link'>;

/**
 * Search trigger and dialog for a Next application.
 *
 * `next/link` is passed through rather than left to the plain-anchor fallback,
 * so hovering a result prefetches the page it points at — which is most of why
 * a hit feels instant when you press Enter.
 */
export function DocsSearch(props: DocsSearchProps): ReactNode {
  const router = useRouter();
  /*
   * Wrapped, not passed as `router.push`. In Next 16.3.0 `push` is an arrow
   * function on a module-level singleton, so the bare reference is both safe
   * and stable — but that is an implementation detail of an optional peer,
   * and the day it becomes a method shorthand, `this` is `undefined` and
   * selecting a result throws inside the dialog. Three lines is a cheaper
   * price than depending on how someone else spells a function.
   */
  const navigate = useCallback(
    (href: string) => {
      router.push(href);
    },
    [router],
  );

  return <SearchDialog {...props} navigate={navigate} Link={Link} />;
}
