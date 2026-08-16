/**
 * The shell's markup contract.
 *
 * Everything here is structure rather than behaviour, and that is the right
 * split: the four things that make the drawer usable — focus moving inside,
 * Tab not escaping, Escape restoring focus, the page not scrolling underneath
 * — are unassertable in jsdom and live in `nav.browser.test.tsx`. What jsdom
 * *can* answer is whether the pieces are wired to each other at all, which is
 * where this shell's failures actually are: a trigger pointing at an id nothing
 * carries opens nothing, and says nothing while doing it.
 */

import { render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocNavNode } from '../types.js';

vi.mock('next/navigation', () => ({
  usePathname: () => '/docs/guide',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement>): ReactNode => (
    <a {...props}>{children}</a>
  ),
}));

const { DocsLayoutShell } = await import('./layout.js');
const { DOCS_NAV_ID } = await import('./nav.js');

const NAV: DocNavNode[] = [
  { type: 'page', title: 'Guide', href: '/docs/guide', slug: 'guide' },
  { type: 'page', title: 'API', href: '/docs/api', slug: 'api' },
];

function renderShell(props: Record<string, unknown> = {}): HTMLElement {
  const { container } = render(
    <DocsLayoutShell
      nav={NAV}
      searchIndexUrl="/docs/search-index.json"
      {...props}
    >
      <article id="docs-content">Page body</article>
    </DocsLayoutShell>,
  );
  return container;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))),
  );
});

describe('DocsLayoutShell', () => {
  it('puts exactly one skip link first in the document', () => {
    const container = renderShell();

    const links = container.querySelectorAll('a.wave-docs-skip-link');
    expect(links).toHaveLength(1);
    // First in the tab order is the entire point: a docs sidebar can be a
    // hundred links deep, and a skip link that is not first skips nothing.
    expect(container.firstElementChild).toBe(links[0]);
  });

  it('renders one navigation landmark, not one per breakpoint', () => {
    const container = renderShell();

    /*
     * The mobile drawer and the desktop sidebar are the same DOM — at 64rem
     * the dialog goes `display: contents` and the nav inside it becomes the
     * column. A second copy would double every link in the payload and give a
     * screen-reader user two identical landmarks to choose between.
     */
    expect(container.querySelectorAll('nav[aria-label]')).toHaveLength(1);
    expect(container.querySelectorAll('dialog')).toHaveLength(1);
  });

  it('binds the header trigger to the drawer it opens', () => {
    const container = renderShell();

    const trigger = screen.getByRole('button', { name: 'Open navigation' });
    const dialog = container.querySelector('dialog');

    // The trigger is server-rendered in a different subtree from the dialog,
    // so `commandfor` is the only thing connecting them — and a mismatch is
    // silent, a button that does nothing at all when tapped.
    expect(trigger.getAttribute('commandfor')).toBe(DOCS_NAV_ID);
    expect(trigger.getAttribute('command')).toBe('show-modal');
    expect(dialog?.id).toBe(DOCS_NAV_ID);
  });

  it('lets the drawer be dismissed by the two routes a reader reaches for', () => {
    const container = renderShell();
    const dialog = container.querySelector('dialog');

    // Light dismiss and Escape, both native, both free — and both absent from
    // the `popover="auto"` and `<details>` alternatives this replaced.
    expect(dialog?.getAttribute('closedby')).toBe('any');
    expect(
      container.querySelector('button.wave-docs-layout__drawer-close'),
    ).not.toBeNull();
  });

  it('puts children directly in the grid, with no wrapper', () => {
    const container = renderShell();

    const grid = container.querySelector('.wave-docs-layout');
    const body = container.querySelector('#docs-content');

    /*
     * `docs.Page` returns the article and the TOC as siblings so the grid can
     * place them in separate tracks. A wrapper here would nest both in one,
     * leaving the TOC column empty at every width above 80rem.
     */
    expect(body?.parentElement).toBe(grid);
  });

  it('renders the search trigger by default', () => {
    const container = renderShell();

    expect(container.querySelector('.wave-docs-layout__search')).not.toBeNull();
    expect(
      container.querySelectorAll('button.wave-docs-search-trigger'),
    ).toHaveLength(1);
  });

  it('omits the search trigger entirely on search={false}', () => {
    /*
     * Scoped to this render's own container, not `screen`. Both assertions
     * queried the whole document at first, and the "no trigger" half passed
     * against the *previous* render's trigger — a test that could never have
     * failed.
     */
    const container = renderShell({ search: false });

    expect(container.querySelector('.wave-docs-layout__search')).toBeNull();
    expect(
      container.querySelectorAll('button.wave-docs-search-trigger'),
    ).toHaveLength(0);
  });

  it('emits no wrapper for chrome it was not given', () => {
    /*
     * An empty `<div>` is not free in a flex row: it still consumes a `gap`,
     * so an unset `title` would push the search trigger 0.75rem off the menu
     * button — a defect that looks like a design decision.
     */
    const container = renderShell();

    expect(container.querySelector('.wave-docs-layout__title')).toBeNull();
    expect(container.querySelector('.wave-docs-layout__actions')).toBeNull();
  });

  it('places actions after search, inside the header', () => {
    const container = renderShell({
      title: <span>Wave</span>,
      actions: <button type="button">Theme</button>,
    });

    const header = container.querySelector('.wave-docs-layout__header');
    const search = container.querySelector('.wave-docs-layout__search');
    const actions = container.querySelector('.wave-docs-layout__actions');

    expect(header?.contains(actions ?? null)).toBe(true);
    expect(container.querySelector('.wave-docs-layout__title')).not.toBeNull();
    // `compareDocumentPosition` rather than index arithmetic: it survives a
    // change to how many wrappers sit between them.
    if (search === null || actions === null) {
      throw new Error('expected both search and actions to render');
    }
    expect(
      search.compareDocumentPosition(actions) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('the shell in another language', () => {
  /**
   * The four strings `docs.Layout` renders itself, and the only test that can
   * see all four: they pass through `SkipLink`, the header button and
   * `DocsNextNav` into `DocsNav`, and a props assertion on the outermost
   * element proves none of that journey.
   *
   * ⚠️ THEY WERE UNREACHABLE. `DocsNav` declared `label` and `closeLabel`,
   * documented them and gave them defaults — and this shell, the only thing
   * that renders `DocsNav`, passed neither, while `DocsLayoutProps` had no way
   * to say them. Configuration that could not be configured, and a package
   * whose whole chrome was hardcoded English.
   */
  const LABELS = {
    nav: 'Documentação',
    openNav: 'Abrir navegação',
    closeNav: 'Fechar navegação',
    skipToContent: 'Ir para o conteúdo',
  };

  it('renders every one of them, and none of the defaults', () => {
    renderShell({ labels: LABELS });

    expect(
      screen.getByRole('link', { name: LABELS.skipToContent }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: LABELS.openNav })).toBeTruthy();
    /*
     * `hidden: true` for everything inside the drawer. A closed `<dialog>` is
     * out of the accessibility tree — correct, and it means the default query
     * cannot see the close button in *either* direction, so asserting the
     * English default's absence without this flag would be an assertion that
     * could not fail.
     */
    expect(
      screen.getByRole('button', { name: LABELS.closeNav, hidden: true }),
    ).toBeTruthy();
    expect(
      screen.getAllByRole('navigation', { name: LABELS.nav, hidden: true })
        .length,
    ).toBeGreaterThan(0);

    for (const english of [
      'Skip to content',
      'Open navigation',
      'Close navigation',
      'Documentation',
    ]) {
      expect(
        screen.queryByRole('button', { name: english, hidden: true }),
      ).toBeNull();
      expect(
        screen.queryByRole('link', { name: english, hidden: true }),
      ).toBeNull();
      expect(
        screen.queryByRole('navigation', { name: english, hidden: true }),
      ).toBeNull();
    }
  });

  it('falls back per string, so a partial map is not a half-English shell', () => {
    renderShell({ labels: { openNav: 'Abrir navegação' } });

    expect(
      screen.getByRole('button', { name: 'Abrir navegação' }),
    ).toBeTruthy();
    // The rest keep their defaults rather than becoming `undefined`, which
    // would leave a button with no accessible name at all.
    expect(screen.getByRole('link', { name: 'Skip to content' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Close navigation', hidden: true }),
    ).toBeTruthy();
  });
});
