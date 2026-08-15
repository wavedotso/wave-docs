/**
 * One adapter from `next/link` to {@link DocsLinkProps}, for both halves.
 *
 * Private — deliberately not an entry point. It exists because the mismatch it
 * absorbs is real and would otherwise be solved twice, on opposite sides of
 * the bundle boundary: `@waveso/docs/next` wires `next/link` into the markdown
 * components on the server, and `@waveso/docs/react/next-search` wires it into
 * the search dialog on the client. Two copies of "how do you pass a link
 * component to this package" is two chances to fix a bug in one of them.
 *
 * The component is a parameter rather than an import, which is what lets one
 * function serve both. `next.ts` must not statically import `next` — it is an
 * optional peer, and that entry point is loaded by `next.config.ts` — so it
 * hands over a lazily-imported module's default. `next-search.tsx` is a client
 * component inside a Next app, where the static import is the right thing, and
 * hands over that.
 */

import type { ComponentProps, ComponentType, ReactNode } from 'react';
import { createElement } from 'react';

import type {
  DocsLinkComponent,
  DocsLinkProps,
} from './markdown-components.js';

/**
 * The part of `next/link` this package uses.
 *
 * Declared structurally rather than imported: `next` is an optional peer, and
 * a type-only import of it would still be a hard resolution requirement for
 * anyone type-checking against our `.d.ts`.
 */
export type NextLinkComponent = ComponentType<
  Omit<ComponentProps<'a'>, 'href' | 'ref'> & {
    href: string;
    /*
     * No `| undefined`, unlike every other optional in this package. Under
     * `exactOptionalPropertyTypes` that union member is what makes the real
     * `next/link` unassignable here — its own `prefetch` is
     * `boolean | 'auto' | null`, with no `undefined` — and the failure lands
     * on the consumer as an error about our types.
     */
    prefetch?: boolean | null;
  }
>;

/**
 * Adapt `next/link` to {@link DocsLinkProps}.
 *
 * `next/link` widens `href` to `string | UrlObject` and `prefetch` to
 * `boolean | 'auto' | null`; the React layer promises neither, because it must
 * also run with a plain `<a>`. One wrapper keeps that mismatch in a single
 * place instead of at every call site.
 *
 * `prefetch` is omitted rather than passed as `undefined`, which is not
 * pedantry: under `exactOptionalPropertyTypes` — which this package compiles
 * with, and which any consumer may turn on — `undefined` is not assignable to
 * `boolean | 'auto' | null`, and `<SearchDialog Link={Link} />` written by
 * hand fails to compile for a reason that reads as our bug.
 *
 * Call it once at module scope, never during a render: a fresh component
 * identity for `a` remounts every link in the document on every render.
 */
export function wrapNextLink(NextLink: NextLinkComponent): DocsLinkComponent {
  return function DocsNextLink({
    href,
    prefetch,
    children,
    ...rest
  }: DocsLinkProps): ReactNode {
    return createElement(
      NextLink,
      {
        ...rest,
        href,
        ...(prefetch === undefined ? {} : { prefetch }),
      },
      children,
    );
  };
}
