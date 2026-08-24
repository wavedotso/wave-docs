/**
 * The pager's markup and the shapes that must render nothing.
 *
 * The ordering itself is `nav-order.test.ts`; this is what a reader gets.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DocsPager } from './pager.js';

const previous = { title: 'Installation', href: '/docs/install' };
const next = { title: 'Writing content', href: '/docs/writing' };

describe('DocsPager', () => {
  it('names each link by direction and destination', () => {
    render(<DocsPager previous={previous} next={next} />);

    /*
     * ⚠️ THE DIRECTION IS PART OF THE NAME. A link announced as "Installation"
     * says nothing about which way it goes, and a reader hearing two of them
     * has to infer the order from the reading order they cannot see.
     */
    expect(
      screen.getByRole('link', { name: 'Previous: Installation' }),
    ).toHaveAttribute('href', '/docs/install');
    expect(
      screen.getByRole('link', { name: 'Next: Writing content' }),
    ).toHaveAttribute('href', '/docs/writing');
  });

  it('names the landmark, so it is not a third unnamed navigation', () => {
    render(<DocsPager previous={previous} next={next} label="Paginação" />);
    expect(
      screen.getByRole('navigation', { name: 'Paginação' }),
    ).toBeInTheDocument();
  });

  it('takes both captions from props', () => {
    render(
      <DocsPager
        previous={previous}
        next={next}
        previousLabel="Anterior"
        nextLabel="Próxima"
      />,
    );

    expect(screen.getByText('Anterior')).toBeInTheDocument();
    expect(screen.getByText('Próxima')).toBeInTheDocument();
  });

  /**
   * ⚠️ AN EMPTY CELL, NOT A MISSING ONE. The two links share a grid row; drop
   * the absent side and the surviving link slides into the first track, so the
   * first page of a site puts "Next" on the left and every other page puts it
   * on the right. The reader learns the position, and the one page where it
   * moves is the one they see first.
   */
  it('holds the empty side at each end of the sequence', () => {
    const { container } = render(<DocsPager next={next} />);

    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(
      container.querySelector('.wave-docs-pager__gap'),
      'the absent side left no cell behind it',
    ).not.toBeNull();
  });

  /**
   * ⚠️ NOT AN EMPTY LANDMARK. A one-page site, or a route outside the tree,
   * would otherwise get a navigation region containing nothing — which a
   * screen reader announces, and which is worse than the absence it stands in
   * for.
   */
  it('renders nothing at all with no neighbour either side', () => {
    const { container } = render(<DocsPager />);
    expect(container).toBeEmptyDOMElement();
  });
});
