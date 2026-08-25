import type { ReactNode } from 'react';

import { opensInNewTab } from '../safe-href.js';
import type { DocsLinkComponent } from './markdown-components.js';

/** One row: a question, and the page that answers it. */
export interface DocsExploreLink {
  question: string;
  href: string;
  /** Resolved by the caller — from the navigation, or from the frontmatter. */
  title: string;
}

export interface DocsExploreProps {
  links: DocsExploreLink[];
  /** The block's heading. Defaults to `'Where to go next'`. */
  heading?: string | undefined;
  /** Client-side router link, e.g. `next/link`. Falls back to `<a>`. */
  Link?: DocsLinkComponent | undefined;
  /**
   * Screen-reader suffix on a row whose answer is off-site. Defaults to
   * `'(opens in a new tab)'`.
   */
  externalLabel?: string | undefined;
  className?: string | undefined;
}

/**
 * "Where to go next" — a question per row, and the page that answers it.
 *
 * The sidebar is a structure and this is a router: it says *why* a reader would
 * go somewhere, which no tree of titles can. A page opts in by declaring
 * `explore` in its frontmatter, so the same component is a landing page's
 * onboarding and an ordinary page's footnote.
 *
 * ⚠️ `explore`, NOT `next` — AND NOT `steps` EITHER.
 *
 * `next` is unusable in this package: `src/next.ts` is the Next.js adapter, so
 * two files one directory apart would carry the same name for entirely
 * different things, and `doc.frontmatter.next` would read like a routing hook.
 *
 * `steps` is wrong for a second reason: these rows are a *branch*, not a
 * sequence. A reader picks one and ignores the rest; none of them is first. A
 * numbered "1 → 2 → 3" component is a real and separate thing worth building,
 * and `steps` is the name it will need.
 *
 * ⚠️ A LIST, NOT A TABLE — which is what the markdown this replaces had to be.
 * A screen reader announces "table, 2 columns, 7 rows" for what is a list of
 * links with descriptions, and asks the reader to navigate it by cell. Two
 * columns of sentence-length questions are also cramped on a phone, where this
 * stacks instead.
 *
 * No client JavaScript: a heading and a list of links, rendered on the server.
 */
export function DocsExplore({
  links,
  heading = 'Where to go next',
  Link,
  externalLabel = '(opens in a new tab)',
  className,
}: DocsExploreProps): ReactNode {
  if (links.length === 0) {
    return null;
  }

  return (
    <section
      className={['wave-docs-panel', 'wave-docs-explore', className]
        .filter(Boolean)
        .join(' ')}
      aria-labelledby="wave-docs-explore-heading"
    >
      {/*
       * ⚠️ A HEADING, NOT AN `aria-label`. This block sits at the end of a page
       * of prose, and a reader moving by heading — which is how a screen-reader
       * user skims — would otherwise pass straight over it. It is an `h2`
       * because it is a peer of the page's own sections, and it names the
       * region through `aria-labelledby` so the two cannot drift.
       */}
      <div className="wave-docs-panel__header">
        <h2 className="wave-docs-panel__title" id="wave-docs-explore-heading">
          {heading}
        </h2>
      </div>
      <ul className="wave-docs-panel__body wave-docs-explore__list">
        {links.map((row) => (
          <li key={row.href} className="wave-docs-explore__item">
            <span className="wave-docs-explore__question">{row.question}</span>
            <ExploreAnswer
              row={row}
              Link={Link}
              externalLabel={externalLabel}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ExploreAnswer({
  row,
  Link,
  externalLabel,
}: {
  row: DocsExploreLink;
  Link: DocsLinkComponent | undefined;
  externalLabel: string;
}): ReactNode {
  const className = 'wave-docs-explore__answer';

  /*
   * ⚠️ A PLAIN `<a>` FOR ANYTHING THAT LEAVES THE SITE, whatever `Link` is. A
   * router link to an external URL is a client-side navigation that cannot
   * happen: `next/link` prefetches it, then hands it to the browser anyway.
   * `opensInNewTab` and not "has a scheme" — a `mailto:` opens no tab, so
   * announcing one would describe something that does not happen.
   */
  if (opensInNewTab(row.href)) {
    return (
      <a
        className={className}
        href={row.href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {row.title}
        {/* The leading space is markup: it separates the suffix from the link
            text, and a translator should not have to type it. */}
        <span className="wave-docs-sr-only"> {externalLabel}</span>
      </a>
    );
  }

  return Link === undefined ? (
    <a className={className} href={row.href}>
      {row.title}
    </a>
  ) : (
    <Link className={className} href={row.href}>
      {row.title}
    </Link>
  );
}
