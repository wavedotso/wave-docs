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

import { fireEvent, render, screen } from '@testing-library/react';
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
     * ⚠️ ONE SIDEBAR, AND NO DIALOG BESIDE IT. There were two shapes of the
     * same DOM — a modal drawer below 64rem, `display: contents` above it — and
     * every attempt to simplify that ended in a second copy of the tree: double
     * the links in the payload, and two identical landmarks for a
     * screen-reader user to choose between.
     */
    expect(container.querySelectorAll('nav[aria-label]')).toHaveLength(1);
    expect(container.querySelectorAll('dialog')).toHaveLength(0);
    expect(
      container.querySelectorAll('.wave-docs-layout__sidebar'),
    ).toHaveLength(1);
  });

  /**
   * ⚠️ ONE CONTROL, AND IT IS THE ONLY ONE. The drawer had two — a trigger
   * outside it and a close button inside — which is two buttons for one piece
   * of navigation, and they drifted apart every time either was touched.
   */
  it('renders exactly one control for the sidebar', () => {
    const container = renderShell();

    expect(
      container.querySelectorAll('.wave-docs-layout__sidebar-trigger'),
    ).toHaveLength(1);
    expect(
      container.querySelector('.wave-docs-layout__nav-trigger'),
    ).toBeNull();
    expect(
      container.querySelector('.wave-docs-layout__drawer-close'),
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveClass(
      'wave-docs-layout__sidebar-trigger',
    );
  });

  /**
   * ⚠️ THE QUERY CONTAINER IS AN ELEMENT, AND IT HAS TO BE OUTSIDE THE GRID.
   *
   * A container query never matches its own container, so with `container-type`
   * on `.wave-docs-layout` no rule inside a query could touch
   * `grid-template-columns` — which is the one declaration the layout has to
   * change between cover and push. One wrapper buys every rule.
   */
  it('wraps the grid in the query container', () => {
    const container = renderShell();

    const shell = container.querySelector('.wave-docs-shell');
    const grid = container.querySelector('.wave-docs-layout');
    if (shell === null || grid === null) {
      throw new Error('expected a query container around the grid');
    }
    expect(grid.parentElement).toBe(shell);
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

  /**
   * ⚠️ THE SHELL RENDERS NO HEADER, AND NOTHING ELSE IT RENDERS IS FULL-WIDTH
   * AND OUT OF FLOW.
   *
   * A header is the one element that competes with a host application's own for
   * the viewport's top edge. The chrome it held is inside
   * `.wave-docs-layout__sidebar` now, which is a grid item at every width.
   */
  it('renders no header, and puts the chrome in the sidebar', () => {
    const container = renderShell();

    expect(container.querySelector('.wave-docs-layout__header')).toBeNull();
    expect(container.querySelector('.wave-docs-layout__title')).toBeNull();
    expect(container.querySelector('.wave-docs-layout__actions')).toBeNull();

    const sidebar = container.querySelector('.wave-docs-layout__sidebar');
    if (sidebar === null) throw new Error('expected the chrome wrapper');

    // Both survivors of the header, and the control that moves them.
    expect(
      sidebar.querySelector('.wave-docs-layout__sidebar-trigger'),
    ).not.toBeNull();
    expect(sidebar.querySelector('.wave-docs-layout__search')).not.toBeNull();
  });

  /**
   * ⚠️ THE SCRIM IS THE SIDEBAR'S SIBLING, NOT ITS CHILD. It has to cover the
   * article, and the article is the sidebar's sibling — inside, it could only
   * ever cover the navigation itself.
   */
  it('renders the scrim beside the sidebar, inside the grid', () => {
    const container = renderShell();

    const sidebar = container.querySelector('.wave-docs-layout__sidebar');
    const scrim = container.querySelector('.wave-docs-layout__sidebar-scrim');
    const grid = container.querySelector('.wave-docs-layout');
    if (sidebar === null || scrim === null || grid === null) {
      throw new Error('expected a sidebar, a scrim and a grid');
    }

    expect(scrim.parentElement).toBe(grid);
    expect(sidebar.nextElementSibling).toBe(scrim);
    // Decoration, and never a tab stop or an announced element.
    expect(scrim).toHaveAttribute('aria-hidden', 'true');
  });

  /**
   * ⚠️ THE SEARCH IS ON THE SIDEBAR. ALWAYS. THERE IS NO WIDTH AT WHICH IT IS
   * SOMEWHERE ELSE, AND THIS IS THE TEST THAT KEEPS IT THAT WAY.
   *
   * It has been in three places: a full-width header, then a strip that
   * replaced the header, and now the sidebar. Twice it moved because the
   * container around it moved, not because anyone decided the search should
   * live somewhere new — which is exactly how it would drift a third time.
   *
   * The containment is what makes it structural: it is inside the sidebar's
   * *navigation*, which is the box the trigger moves. So it travels with the
   * tree, at every width, and there is no second placement to get wrong.
   */
  it('puts the search inside the sidebar, above the tree, at every width', () => {
    const container = renderShell();

    const sidebar = container.querySelector('.wave-docs-layout__sidebar');
    const nav = container.querySelector('.wave-docs-layout__sidebar-nav');
    const search = container.querySelector('button.wave-docs-search-trigger');
    const tree = container.querySelector('.wave-docs-sidebar');
    if (sidebar === null || nav === null || search === null || tree === null) {
      throw new Error(
        'expected a sidebar, its nav, a search trigger and a tree',
      );
    }

    expect(sidebar.contains(search)).toBe(true);
    expect(nav.contains(search)).toBe(true);

    // Above the tree, and by document order rather than by index arithmetic, so
    // this survives a change to how many wrappers sit between them.
    expect(
      search.compareDocumentPosition(tree) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  /**
   * The trigger names the box it moves, so a screen reader announces the
   * relationship the sighted reader can see.
   */
  it('binds the trigger to the navigation it moves', () => {
    const container = renderShell();

    const trigger = container.querySelector(
      '.wave-docs-layout__sidebar-trigger',
    );
    const nav = container.querySelector('.wave-docs-layout__sidebar-nav');
    if (trigger === null || nav === null) {
      throw new Error('expected a trigger and the navigation it controls');
    }

    expect(trigger.getAttribute('aria-controls')).toBe(nav.id);
    expect(trigger.contains(nav)).toBe(false);
  });
});

describe('the shell in another language', () => {
  /**
   * The four strings `docs.Layout` renders itself, and the only test that can
   * see all four: they pass through `SkipLink`, the sidebar's nav trigger and
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
    const trigger = screen.getByRole('button', { name: LABELS.openNav });
    expect(trigger).toBeTruthy();
    /*
     * ⚠️ THE OTHER NAME ONLY EXISTS IN THE OTHER STATE, SO PRESS IT. One
     * control carries both strings — it is named for what pressing it does
     * next — so a test that never toggles can only ever see one of the two.
     */
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: LABELS.closeNav })).toBeTruthy();
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

  it('reaches the sidebar tree, four components down', async () => {
    /*
     * ⚠️ THE HOP THAT WAS MISSING FOR EVERY STRING BUT THESE FOUR. The
     * disclosure verbs and the external-link suffix are rendered by
     * `DocsSidebar`, which is `DocsLayoutShell` → `DocsNextNav` → `DocsNav` →
     * `DocsSidebar` from here — and a prop dropped at any of those four hops is
     * silent, which is exactly how `DocsNav`'s own `label` came to be documented,
     * defaulted and never passed.
     *
     * A group and an external link, because those are the two nodes that render
     * them, and `NAV` above has neither.
     */
    render(
      <DocsLayoutShell
        nav={[
          {
            /*
             * With an `href`, deliberately. A group without one renders a single
             * button whose name is the group title; only the linked form has the
             * separate icon-only toggle these two labels name, so a group without
             * an href would make this assertion unfailable.
             */
            type: 'group',
            title: 'Reference',
            href: '/docs/reference',
            children: [
              { type: 'page', title: 'API', href: '/docs/api', slug: 'api' },
            ],
          },
          {
            type: 'link',
            title: 'Changelog',
            href: 'https://example.com/changelog',
            external: true,
          },
        ]}
        searchIndexUrl="/docs/search-index.json"
        labels={{
          expandGroup: 'Abrir {title}',
          collapseGroup: 'Fechar {title}',
          externalLink: '(abre num novo separador)',
        }}
      >
        <article id="docs-content">Page body</article>
      </DocsLayoutShell>,
    );

    /*
     * The group holds the active page (`usePathname` is mocked to
     * `/docs/guide`, so it does not) — closed, then. `hidden: true` because the
     * whole tree is inside a closed `<dialog>`.
     */
    expect(
      screen.getByRole('button', { name: 'Abrir Reference', hidden: true }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Expand Reference', hidden: true }),
    ).toBeNull();

    /*
     * No space between the two: the suffix is its own `<span>`, and
     * dom-testing-library concatenates each element's text without inserting a
     * boundary. Real browsers do insert one — the markup carries the space, and
     * `renderToStaticMarkup` shows `<span> (…)</span>` — so this spelling is a
     * property of the test library rather than of what a reader hears.
     */
    expect(
      screen.getByRole('link', {
        name: 'Changelog(abre num novo separador)',
        hidden: true,
      }),
    ).toBeTruthy();
  });

  it("adds a host className to the layout's, rather than replacing it", () => {
    /*
     * ⚠️ `className` WAS BEFORE THE SPREAD, SO A HOST PASSING ONE DELETED
     * `wave-docs-layout__search` — the class that places the trigger in the
     * sidebar chrome at both of its shapes. Passing a class is the ordinary
     * reason to pass `search` an object at all, and the result was a control
     * that lost its position, from an addition that should not have removed
     * anything.
     */
    const container = renderShell({ search: { className: 'my-search' } });
    /*
     * `querySelector`, not `getByRole`: the trigger lives inside the drawer
     * `<dialog>`, which is closed until something opens it and is therefore
     * correctly absent from the accessibility tree at rest. The class is on the
     * element either way, and the class is what this test is about.
     */
    const trigger = container.querySelector('button.wave-docs-search-trigger');
    if (trigger === null) throw new Error('expected a search trigger');

    expect(trigger.className).toContain('wave-docs-layout__search');
    expect(trigger.className).toContain('my-search');
  });

  it('falls back per string, so a partial map is not a half-English shell', () => {
    renderShell({ labels: { openNav: 'Abrir navegação' } });

    const trigger = screen.getByRole('button', { name: 'Abrir navegação' });
    expect(trigger).toBeTruthy();
    // The rest keep their defaults rather than becoming `undefined`, which
    // would leave a button with no accessible name at all.
    expect(screen.getByRole('link', { name: 'Skip to content' })).toBeTruthy();
    fireEvent.click(trigger);
    expect(
      screen.getByRole('button', { name: 'Close navigation' }),
    ).toBeTruthy();
  });
});
