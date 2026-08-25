/**
 * The markup a reader gets, and the shapes that must render nothing.
 *
 * Title resolution is `nav-order.test.ts`; this is what the component does with
 * the rows once they are resolved.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { DocsLinkProps } from './markdown-components.js';
import { DocsExplore } from './explore.js';

const links = [
  {
    question: 'How a person is recognised',
    href: '/docs/identity',
    title: 'Identity',
  },
  {
    question: 'Where the source lives',
    href: 'https://example.com',
    title: 'GitHub',
  },
];

describe('DocsExplore', () => {
  it('pairs each question with the page that answers it', () => {
    render(<DocsExplore links={links} />);

    expect(screen.getByText('How a person is recognised')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Identity' })).toHaveAttribute(
      'href',
      '/docs/identity',
    );
  });

  /**
   * ⚠️ A LIST, NOT A TABLE — which is what the markdown this replaces had to
   * be. A screen reader announces "table, 2 columns, 7 rows" for a list of
   * links with descriptions, and asks the reader to navigate it by cell.
   */
  it('is a list of links, not a grid of cells', () => {
    render(<DocsExplore links={links} />);

    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  /**
   * ⚠️ A REAL HEADING, NOT AN `aria-label`. This sits at the end of a page of
   * prose, and a reader moving by heading — which is how a screen-reader user
   * skims — would pass straight over a region named only by an attribute.
   */
  it('names the region with a heading the reader can land on', () => {
    render(<DocsExplore links={links} heading="Para onde ir" />);

    const heading = screen.getByRole('heading', { name: 'Para onde ir' });
    expect(heading).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Para onde ir' }),
      'the region and its heading disagree',
    ).toBeInTheDocument();
  });

  /**
   * ⚠️ A PLAIN `<a>` FOR ANYTHING THAT LEAVES THE SITE, whatever `Link` is. A
   * router link to an external URL is a client-side navigation that cannot
   * happen — `next/link` prefetches it and hands it to the browser anyway.
   */
  it('sends an off-site answer to a new tab, with the warning', () => {
    const Link = ({ href, children, className }: DocsLinkProps) => (
      <a className={className} href={href} data-injected="">
        {children}
      </a>
    );
    render(<DocsExplore links={links} Link={Link} />);

    const external = screen.getByRole('link', { name: /GitHub/ });
    expect(external).toHaveAttribute('target', '_blank');
    expect(external).toHaveAttribute('rel', 'noopener noreferrer');
    expect(external.textContent).toContain('(opens in a new tab)');

    /*
     * And the internal one *did* go through the router — which is what makes
     * the branch above a decision rather than an accident.
     */
    const internal = screen.getByRole('link', { name: 'Identity' });
    expect(internal).toHaveAttribute('data-injected');
    expect(
      external,
      'an off-site answer was handed to the router',
    ).not.toHaveAttribute('data-injected');
  });

  it('takes the external suffix from a prop, in whatever language', () => {
    render(
      <DocsExplore links={links} externalLabel="(abre noutro separador)" />,
    );
    expect(
      screen.getByRole('link', { name: /abre noutro separador/ }),
    ).toBeInTheDocument();
  });

  it('renders nothing at all with no rows', () => {
    const { container } = render(<DocsExplore links={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
