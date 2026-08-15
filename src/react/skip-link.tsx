import type { ReactNode } from 'react';

/**
 * The `id` this link targets, and the one `createDocsRoute` puts on its
 * `<article>`. Defined in a private module so the Node adapter can read it
 * without importing this `'use client'` file; re-exported here because this is
 * the documented import path.
 */
import { DOCS_CONTENT_ID } from '../docs-content-id.js';

export { DOCS_CONTENT_ID };

export interface SkipLinkProps {
  /** Fragment id of the main content region. */
  href?: string | undefined;
  className?: string | undefined;
  children?: ReactNode;
}

/**
 * Skip-to-content link: invisible until focused, first in the tab order.
 *
 * A docs sidebar can be a hundred links deep, and without this every keyboard
 * and switch user tabs through all of them on every page to reach the prose.
 * It is three lines of markup and most docs sites still do not have it.
 *
 * Put it first inside `<body>`, and give the target `tabIndex={-1}` — browsers
 * move the *scroll* position on a fragment link but not always the focus, so
 * an unfocusable target leaves focus stranded at the top of the document.
 *
 * @example
 * ```tsx
 * <SkipLink href="#docs-content" />
 * <main id="docs-content" tabIndex={-1}>{children}</main>
 * ```
 */
export function SkipLink({
  href = `#${DOCS_CONTENT_ID}`,
  className,
  children = 'Skip to content',
}: SkipLinkProps): ReactNode {
  return (
    <a
      href={href}
      className={['wave-docs-skip-link', className].filter(Boolean).join(' ')}
    >
      {children}
    </a>
  );
}
