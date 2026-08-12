/**
 * The link is three lines of markup; what matters is where it sits in the tab
 * order and that activating it actually navigates. The other half of the
 * contract — visually hidden until focused — lives in the stylesheet, so it is
 * asserted in `styles.test.ts` where the CSS is already parsed.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { SkipLink } from './skip-link.js';

/** A sidebar of the kind this link exists to jump over. */
function Layout(): ReactNode {
  return (
    <>
      <SkipLink />
      <nav aria-label="Docs">
        <a href="/docs/install">Install</a>
        <a href="/docs/usage">Usage</a>
      </nav>
      <article id="docs-content" tabIndex={-1}>
        <h1>Install</h1>
      </article>
    </>
  );
}

describe('SkipLink', () => {
  it('is the first thing a keyboard reader reaches', async () => {
    const user = userEvent.setup();
    render(<Layout />);

    await user.tab();

    // A docs sidebar is a hundred links deep; being second in the tab order
    // makes this link decoration.
    expect(document.activeElement).toBe(
      screen.getByRole('link', { name: 'Skip to content' }),
    );
  });

  it('announces what it does', () => {
    render(<SkipLink />);

    expect(
      screen.getByRole('link', { name: 'Skip to content' }),
    ).toBeInTheDocument();
  });

  it('lets a consumer supply their own wording', () => {
    render(<SkipLink>Passer au contenu</SkipLink>);

    expect(
      screen.getByRole('link', { name: 'Passer au contenu' }),
    ).toBeInTheDocument();
  });

  it('targets the id the Next adapter puts on the article', () => {
    // Spelled out rather than imported: this is the published default, and a
    // test that reads it from the component asserts nothing about it. Both
    // halves now derive from `DOCS_CONTENT_ID`, so the adapter cannot drift from
    // it silently — `next.test.ts` pins the same literal on the article.
    render(<SkipLink />);

    expect(screen.getByRole('link')).toHaveAttribute('href', '#docs-content');
  });

  it('navigates to the content region when activated', async () => {
    const user = userEvent.setup();
    render(<Layout />);

    await user.click(screen.getByRole('link', { name: 'Skip to content' }));

    // Nothing may call `preventDefault` on this click, or the reader stays in
    // the sidebar. jsdom performs the fragment navigation but not the browser's
    // subsequent focusing step, so the hash is what is observable here.
    expect(window.location.hash).toBe('#docs-content');
    expect(document.querySelector(window.location.hash)).toBe(
      screen.getByRole('article'),
    );
  });

  it('merges a consumer class without dropping its own', () => {
    render(<SkipLink className="custom" />);

    expect(screen.getByRole('link')).toHaveClass(
      'wave-docs-skip-link',
      'custom',
    );
  });
});
