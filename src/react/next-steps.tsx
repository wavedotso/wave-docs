import type { ReactNode } from 'react';

import { opensInNewTab } from '../safe-href.js';
import type { DocsLinkComponent } from './markdown-components.js';

/** One row: a question, and the page that answers it. */
export interface DocsNextStep {
  question: string;
  href: string;
  /** Resolved by the caller — from the navigation, or from the frontmatter. */
  title: string;
}

export interface DocsNextStepsProps {
  steps: DocsNextStep[];
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
 * go somewhere, which no tree of titles can. A page opts in by declaring `next`
 * in its frontmatter, so the same component is a landing page's onboarding and
 * an ordinary page's footnote.
 *
 * ⚠️ A LIST, NOT A TABLE — which is what the markdown this replaces had to be.
 * A screen reader announces "table, 2 columns, 7 rows" for what is a list of
 * links with descriptions, and asks the reader to navigate it by cell. Two
 * columns of sentence-length questions are also cramped on a phone, where this
 * stacks instead.
 *
 * No client JavaScript: a heading and a list of links, rendered on the server.
 */
export function DocsNextSteps({
  steps,
  heading = 'Where to go next',
  Link,
  externalLabel = '(opens in a new tab)',
  className,
}: DocsNextStepsProps): ReactNode {
  if (steps.length === 0) {
    return null;
  }

  return (
    <section
      className={['wave-docs-panel', 'wave-docs-next', className]
        .filter(Boolean)
        .join(' ')}
      aria-labelledby="wave-docs-next-heading"
    >
      {/*
       * ⚠️ A HEADING, NOT AN `aria-label`. This block sits at the end of a page
       * of prose, and a reader moving by heading — which is how a screen-reader
       * user skims — would otherwise pass straight over it. It is an `h2`
       * because it is a peer of the page's own sections, and it names the
       * region through `aria-labelledby` so the two cannot drift.
       */}
      <div className="wave-docs-panel__header">
        <h2 className="wave-docs-panel__title" id="wave-docs-next-heading">
          {heading}
        </h2>
      </div>
      <ul className="wave-docs-panel__body wave-docs-next__list">
        {steps.map((step) => (
          <li key={step.href} className="wave-docs-next__item">
            <span className="wave-docs-next__question">{step.question}</span>
            <NextLink step={step} Link={Link} externalLabel={externalLabel} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function NextLink({
  step,
  Link,
  externalLabel,
}: {
  step: DocsNextStep;
  Link: DocsLinkComponent | undefined;
  externalLabel: string;
}): ReactNode {
  const className = 'wave-docs-next__answer';

  /*
   * ⚠️ A PLAIN `<a>` FOR ANYTHING THAT LEAVES THE SITE, whatever `Link` is. A
   * router link to an external URL is a client-side navigation that cannot
   * happen: `next/link` prefetches it, then hands it to the browser anyway.
   * `opensInNewTab` and not "has a scheme" — a `mailto:` opens no tab, so
   * announcing one would describe something that does not happen.
   */
  if (opensInNewTab(step.href)) {
    return (
      <a
        className={className}
        href={step.href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {step.title}
        {/* The leading space is markup: it separates the suffix from the link
            text, and a translator should not have to type it. */}
        <span className="wave-docs-sr-only"> {externalLabel}</span>
      </a>
    );
  }

  return Link === undefined ? (
    <a className={className} href={step.href}>
      {step.title}
    </a>
  ) : (
    <Link className={className} href={step.href}>
      {step.title}
    </Link>
  );
}
