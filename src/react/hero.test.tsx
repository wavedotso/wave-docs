/**
 * The hero, and the one thing about it that is not visual: it is opt-in, and a
 * page that does not opt in must be byte-for-byte what it was.
 *
 * The geometry — that the words line up with the prose, that the grid is
 * behind rather than over them — needs a real engine and lives in
 * `styles.browser.test.ts`.
 */

import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { DocsHero } from './hero.js';

describe('DocsHero', () => {
  it('renders the title as the page heading', () => {
    const { container } = render(<DocsHero title="Wave Docs" />);

    const heading = container.querySelector('h1');
    expect(heading).toHaveTextContent('Wave Docs');
    expect(heading).toHaveClass('wave-docs-hero__title');
  });

  /**
   * ⚠️ OMITTED, NOT EMPTIED. `description` is optional and an empty `<p>` is a
   * paragraph a screen reader announces and a stylesheet reserves space for.
   */
  it('renders no tagline without a description, and none for an empty one', () => {
    for (const description of [undefined, '']) {
      const { container } = render(
        <DocsHero title="Wave Docs" description={description} />,
      );
      expect(container.querySelector('.wave-docs-hero__tagline')).toBeNull();
    }
  });

  it('renders no action list when there are none', () => {
    const { container } = render(<DocsHero title="Wave Docs" actions={[]} />);
    expect(container.querySelector('.wave-docs-hero__actions')).toBeNull();
  });

  /**
   * The shape every landing page has, so the common case needs no `variant` in
   * the frontmatter at all — and stating one still wins.
   */
  it('makes the first action primary and the rest secondary', () => {
    const { container } = render(
      <DocsHero
        title="Wave Docs"
        actions={[
          { label: 'Quick start', href: '/start' },
          { label: 'Guides', href: '/guides' },
          { label: 'Reference', href: '/reference', variant: 'primary' },
        ]}
      />,
    );

    expect(
      [...container.querySelectorAll('.wave-docs-hero__action')].map((a) =>
        a.getAttribute('data-variant'),
      ),
    ).toEqual(['primary', 'secondary', 'primary']);
  });

  /**
   * ⚠️ A PLAIN `<a>` FOR ANYTHING THAT LEAVES THE SITE, AND THE ROUTER LINK FOR
   * EVERYTHING ELSE. A router link to an external URL is a client-side
   * navigation that cannot happen — it prefetches and then hands off to the
   * browser anyway. The sidebar draws the same line.
   */
  it('routes internal actions and opens external ones in a new tab', () => {
    const Link = ({
      href,
      children,
      className,
    }: {
      href: string;
      children?: ReactNode;
      className?: string | undefined;
    }) => (
      <a href={href} className={className} data-router="">
        {children}
      </a>
    );

    const { container } = render(
      <DocsHero
        title="Wave Docs"
        Link={Link as never}
        actions={[
          { label: 'Quick start', href: '/start' },
          { label: 'GitHub', href: 'https://github.com/waveso/docs' },
        ]}
      />,
    );

    const [internal, external] = [
      ...container.querySelectorAll('.wave-docs-hero__action'),
    ];
    expect(internal).toHaveAttribute('data-router');
    expect(internal).not.toHaveAttribute('target');

    expect(external).not.toHaveAttribute('data-router');
    expect(external).toHaveAttribute('target', '_blank');
    expect(external).toHaveAttribute('rel', 'noreferrer');
    // Announced, not merely visual: the reader who cannot see the new tab open
    // is the one who most needs telling.
    expect(external).toHaveTextContent('(opens in a new tab)');
  });

  /**
   * ⚠️ `mailto:` AND `tel:` DO NOT OPEN A TAB. `meta.json` once used "has a
   * scheme" for this and announced "(opens in a new tab)" for a tab that never
   * opened, to precisely the reader who could not see that it had not.
   */
  it('treats a mailto action as staying on the page', () => {
    const { container } = render(
      <DocsHero
        title="Wave Docs"
        actions={[{ label: 'Email', href: 'mailto:hi@example.com' }]}
      />,
    );

    const action = container.querySelector('.wave-docs-hero__action');
    expect(action).not.toHaveAttribute('target');
    expect(action).not.toHaveTextContent('(opens in a new tab)');
  });
});
