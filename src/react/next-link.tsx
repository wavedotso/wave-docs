'use client';

/**
 * `next/link`, adapted to this package's {@link DocsLinkProps} and ready to pass.
 *
 * ⚠️ IT EXISTS BECAUSE PASSING `next/link` DIRECTLY DOES NOT TYPE-CHECK. Under
 * `exactOptionalPropertyTypes` — which this package compiles with, and which any
 * consumer may turn on — Next's `LinkProps` re-declares `onClick?`,
 * `onMouseEnter?` and `onTouchStart?` *without* `| undefined` while React's
 * anchor props include it, so `<DocsSidebar Link={Link} />` fails to compile
 * over three handlers `next/link` accepts perfectly well at run time. It is a
 * disagreement between two dependencies' declaration files, true of every
 * `next/link` call site in a project with that flag on, and nothing the shape of
 * `DocsLinkProps` can fix without breaking the plain-`<a>` fallback that makes
 * these components host-agnostic.
 *
 * `docs.Layout` and `DocsSearch` have always absorbed it internally, so it only
 * ever bit someone composing a shell by hand — who was told to write
 * `Link={Link as DocsLinkComponent}` and wait for this module. This is it; the
 * cast is retired.
 *
 * ```tsx
 * 'use client';
 * import { DocsLink } from '@waveso/docs/react/next-link';
 * import { DocsSidebar } from '@waveso/docs/react/sidebar';
 *
 * <DocsSidebar nav={nav} pathname={pathname} Link={DocsLink} />
 * ```
 *
 * ## Why `'use client'`
 *
 * Not for a hook — there is none. {@link DocsLink} is a *function*, and a
 * function cannot be handed from a Server Component to a Client one: React
 * serialises those props and refuses. Without the directive this module's export
 * would be a server reference, and passing it to `DocsSidebar` — which is itself
 * `'use client'` — would fail `next build` with "Functions cannot be passed
 * directly to Client Components". The directive makes it a client reference,
 * which crosses fine.
 */

import NextLink from 'next/link';

import type { DocsLinkComponent } from './markdown-components.js';
import type { NextLinkComponent } from './link-adapter.js';
import { wrapNextLink } from './link-adapter.js';

/**
 * Module scope, and never inside a render.
 *
 * A fresh component identity for a link remounts every link in the document on
 * every render — which is why `next-search.tsx` and `next-nav.tsx` each build
 * theirs at module scope too, and why this is a constant rather than a factory.
 */
export const DocsLink: DocsLinkComponent = wrapNextLink(
  NextLink as NextLinkComponent,
);
