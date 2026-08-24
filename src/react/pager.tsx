import type { ReactNode } from 'react';

import type { NavStop } from '../nav-order.js';
import type { DocsLinkComponent } from './markdown-components.js';

export interface DocsPagerProps {
  /** The stop before this page in the reading order. Omit at the beginning. */
  previous?: NavStop | undefined;
  /** The stop after it. Omit at the end. */
  next?: NavStop | undefined;
  /** Client-side router link, e.g. `next/link`. Falls back to `<a>`. */
  Link?: DocsLinkComponent | undefined;
  /** Above the previous page's title. Defaults to `'Previous'`. */
  previousLabel?: string | undefined;
  /** Above the next page's title. Defaults to `'Next'`. */
  nextLabel?: string | undefined;
  /**
   * Accessible name for the landmark. Defaults to `'Pagination'`.
   *
   * Named because a page can hold more than one navigation landmark — this,
   * the sidebar and the table of contents — and "navigation" three times is
   * not a list anyone can steer by.
   */
  label?: string | undefined;
  className?: string | undefined;
}

/**
 * Links to the pages either side of this one in the reading order.
 *
 * Derived from the same tree `DocsSidebar` renders, so it cannot disagree with
 * the column beside it — see `nav-order.ts`. Nothing here is authored: a page
 * gets a pager by being in the navigation.
 *
 * ⚠️ NOTHING RENDERS AT ALL WHEN THERE IS NO NEIGHBOUR EITHER SIDE. A single
 * page site, or a route outside the tree, would otherwise get an empty
 * landmark — announced by a screen reader as a navigation region containing
 * nothing, which is worse than the absence it is standing in for.
 *
 * No client JavaScript: two links and a heading, rendered on the server.
 */
export function DocsPager({
  previous,
  next,
  Link,
  previousLabel = 'Previous',
  nextLabel = 'Next',
  label = 'Pagination',
  className,
}: DocsPagerProps): ReactNode {
  if (previous === undefined && next === undefined) {
    return null;
  }

  return (
    <nav
      aria-label={label}
      className={['wave-docs-pager', className].filter(Boolean).join(' ')}
    >
      <PagerLink
        stop={previous}
        direction="previous"
        caption={previousLabel}
        Link={Link}
      />
      <PagerLink stop={next} direction="next" caption={nextLabel} Link={Link} />
    </nav>
  );
}

function PagerLink({
  stop,
  direction,
  caption,
  Link,
}: {
  stop: NavStop | undefined;
  direction: 'previous' | 'next';
  caption: string;
  Link: DocsLinkComponent | undefined;
}): ReactNode {
  /*
   * ⚠️ AN EMPTY CELL AT THE START AND END OF THE SEQUENCE, NOT A MISSING ONE.
   * The two links share a grid row; drop the first page's absent `previous`
   * and the `next` link slides into its track, so the first page of a site
   * puts "Next" on the left and every other page puts it on the right.
   */
  if (stop === undefined) {
    return <div className="wave-docs-pager__gap" />;
  }

  const body = (
    <>
      {/*
       * The direction is the label a reader hears, and the page title is the
       * name — so the accessible name is "Previous: Authentication" rather
       * than a bare title that says nothing about where it goes. Two elements
       * rather than one string, because they are set differently.
       *
       * The arrow rides on the caption's line rather than beside the pair: it
       * belongs to the word that names the direction, not to the page title,
       * which starts at the card's own edge either way.
       */}
      <span className="wave-docs-pager__caption">
        {direction === 'previous' ? <PagerChevron /> : null}
        {caption}
        {direction === 'next' ? <PagerChevron /> : null}
      </span>
      <span className="wave-docs-pager__title">{stop.title}</span>
    </>
  );

  const props = {
    className: 'wave-docs-pager__link',
    href: stop.href,
    'data-direction': direction,
    'aria-label': `${caption}: ${stop.title}`,
  } as const;

  return Link === undefined ? (
    <a {...props}>{body}</a>
  ) : (
    <Link {...props}>{body}</Link>
  );
}

/**
 * The arrow on the outer edge of each link, pointing the way it goes.
 *
 * Decorative: the link is named "Previous: Installation" by `aria-label`, so
 * this would only repeat a word already in the name — and `⌘`-style symbols
 * read badly when they reach a screen reader at all.
 *
 * Which way it points is the stylesheet's, not this component's: it is a
 * physical direction, and it mirrors under `dir="rtl"` where "previous" is on
 * the right. Rotating it here would put that decision somewhere CSS cannot
 * correct it.
 */
function PagerChevron(): ReactNode {
  return (
    <svg
      className="wave-docs-pager__chevron"
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
