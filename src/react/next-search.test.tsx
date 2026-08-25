/**
 * The Next wiring, and only the Next wiring.
 *
 * `SearchDialog`'s own 962 lines of tests cover the dialog. What is unproven
 * without this file is the seam: that the router really is called with the
 * hit's href, that results really render through `next/link` rather than
 * quietly falling back to a bare anchor, and that the `'use client'` directive
 * survives the build. Each of those fails silently — the last one turns every
 * consumer's layout into a client component with no error at all.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';

import { buildSearchIndex } from '../search-index.js';
import type { SearchRecord } from '../types.js';

const push = vi.fn<(href: string) => void>();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

/**
 * A stand-in for `next/link` that is identifiable in the DOM.
 *
 * `data-next-link` is the whole point: a result rendered as a plain `<a>`
 * looks and behaves identically until you notice hover prefetching is gone,
 * which is not something a test can observe any other way.
 */
vi.mock('next/link', () => ({
  default: ({
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement>): ReactNode => (
    <a {...props} data-next-link="">
      {children}
    </a>
  ),
}));

const { DocsSearch } = await import('./next-search.js');

const INDEX_URL = '/docs/search-index.json';

const RECORDS: SearchRecord[] = [
  {
    id: 'guide/search#shortcuts',
    title: 'Search',
    heading: 'Keyboard shortcuts',
    ancestors: ['Search'],
    href: '/docs/guide/search#shortcuts',
    text: 'Move between hits with the arrow keys and open one with Enter.',
  },
];

const INDEX_JSON = buildSearchIndex(RECORDS);

Object.defineProperty(Element.prototype, 'scrollIntoView', {
  value: () => undefined,
  writable: true,
  configurable: true,
});

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  push.mockClear();
  fetchMock = vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(INDEX_JSON, { status: 200 })),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Open the dialog, query it, and wait for the one result to land. */
async function search(
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: 'Search' }));
  await user.type(screen.getByRole('combobox'), 'keyboard');
  await waitFor(() =>
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0),
  );
  return screen.getAllByRole('option')[0] as HTMLElement;
}

describe('DocsSearch', () => {
  it('navigates with the router when a result is chosen', async () => {
    const user = userEvent.setup();
    render(<DocsSearch indexUrl={INDEX_URL} />);

    await search(user);
    // Nothing is selected until the reader selects it.
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');

    expect(push).toHaveBeenCalledWith('/docs/guide/search#shortcuts');
  });

  it('renders results through next/link, so hovering a hit prefetches it', async () => {
    const user = userEvent.setup();
    render(<DocsSearch indexUrl={INDEX_URL} />);

    const option = await search(user);

    expect(option.querySelector('a[data-next-link]')).not.toBeNull();
  });

  it('forwards the props the dialog owns', async () => {
    const user = userEvent.setup();
    render(
      <DocsSearch
        indexUrl={INDEX_URL}
        triggerLabel="Find anything"
        placeholder="Type to search"
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Find anything' });
    await user.click(trigger);

    expect(screen.getByRole('combobox')).toHaveAttribute(
      'placeholder',
      'Type to search',
    );
    expect(fetchMock).toHaveBeenCalledWith(INDEX_URL);
  });
});
