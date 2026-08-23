/**
 * The page header a landing page opts into: the title, the tagline under it,
 * and the calls to action.
 *
 * ## It is opt-in, and the opt-in is the actions
 *
 * A page with no `actions` in its frontmatter renders exactly as it did before
 * this existed — the `<h1>` comes from the body or from `frontmatter.title`, and
 * `description` stays a `<meta>` tag. Declare `actions` and the page gets a
 * hero instead: same two strings, laid out as a header, with the links under
 * them.
 *
 * That is the whole of the adaptation for the two shapes this package serves.
 * Documentation that is the entire site puts a hero on its index; documentation
 * mounted at `/docs` inside an application that already has a marketing page
 * leaves `actions` off and gets an ordinary page. There is no mode, no
 * `standalone` flag and nothing to configure — the opt-in is in the file that
 * wants it.
 *
 * ## Why it owns the `<h1>`
 *
 * `render` prepends an `<h1>` from `frontmatter.title` when the markdown body
 * has none, so the title is normally the first thing inside the prose. A hero
 * has to put the tagline and the actions *under* that heading, and no component
 * can insert itself into the middle of another's tree — so on a hero page the
 * renderer skips the injection and this renders the heading instead.
 *
 * A page that writes its own `# Title` in the body **and** declares `actions`
 * ships two `h1`s. That is the same duplication `titleHeading` has always
 * warned about, and the same fix: let the frontmatter own the title.
 */

import type { ReactNode } from 'react';

import type { DocAction } from '../types.js';
import { opensInNewTab } from '../safe-href.js';
import type { DocsLinkComponent } from './markdown-components.js';

export interface DocsHeroProps {
  /** `frontmatter.title`, rendered as the page's `<h1>`. */
  title: string;
  /** `frontmatter.description`. Omitted rather than rendered empty. */
  description?: string | undefined;
  /** `frontmatter.actions`. An empty list renders no `<nav>` at all. */
  actions?: readonly DocAction[] | undefined;
  /** Client-side router link, e.g. `next/link`. Falls back to `<a>`. */
  Link?: DocsLinkComponent | undefined;
  /** Screen-reader suffix on a link that opens elsewhere. */
  externalLabel?: string | undefined;
}

export function DocsHero({
  title,
  description,
  actions,
  Link,
  externalLabel = '(opens in a new tab)',
}: DocsHeroProps): ReactNode {
  const Anchor = Link ?? 'a';

  return (
    <header className="wave-docs-hero">
      {/*
       * ⚠️ AN INNER COLUMN, BECAUSE TWO THINGS WANT DIFFERENT WIDTHS. The grid
       * behind the hero is full-bleed across the article track; the words have
       * to line up with the prose underneath them, which is capped at
       * `--wave-docs-measure` and centred. Without this the title sat 70px left
       * of the first paragraph.
       */}
      <div className="wave-docs-hero__body">
        <h1 className="wave-docs-hero__title">{title}</h1>
        {description === undefined || description === '' ? null : (
          <p className="wave-docs-hero__tagline">{description}</p>
        )}
        {actions === undefined || actions.length === 0 ? null : (
          <div className="wave-docs-hero__actions">
            {actions.map((action, index) => {
              const external = opensInNewTab(action.href);
              /*
               * First is the primary, the rest are secondary — the shape every
               * landing page has, so the common case needs no `variant` at all.
               * Stating one overrides the position.
               */
              const variant =
                action.variant ?? (index === 0 ? 'primary' : 'secondary');

              /*
               * ⚠️ A PLAIN `<a>` FOR ANYTHING THAT LEAVES THE SITE. A router link
               * to an external URL is a client-side navigation that cannot
               * happen: `next/link` prefetches it and then hands it to the
               * browser anyway. The sidebar draws the same line for the same
               * reason.
               */
              const Component = external ? 'a' : Anchor;

              return (
                <Component
                  key={action.href}
                  href={action.href}
                  className="wave-docs-hero__action"
                  data-variant={variant}
                  {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
                >
                  {action.label}
                  {external ? (
                    <span className="wave-docs-sr-only">{` ${externalLabel}`}</span>
                  ) : null}
                </Component>
              );
            })}
          </div>
        )}
      </div>
    </header>
  );
}
