/**
 * The sidebar's wiring, and only its wiring.
 *
 * ⚠️ THIS FILE USED TO TEST A `<dialog>`, AND THERE IS NO LONGER ONE. The
 * drawer, its `command`/`commandfor` trigger, the close button inside it and
 * the `display: contents` that turned it into a desktop column are all gone:
 * there is one sidebar at every width, and the trigger moves it.
 *
 * What is worth pinning here is what fails *silently* — a control that stops
 * toggling, an `aria-expanded` that stops tracking what the reader sees, a
 * second copy of the tree creeping back into the payload, and the containment
 * that has to come with an overlay.
 *
 * Where the navigation goes, and whether the article gets out of its way, needs
 * a real layout engine and lives in `styles.browser.test.ts`.
 */

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { DocNavNode } from '../types.js';
import { DOCS_NAV_ID, DocsNav } from './nav.js';

const NAV: DocNavNode[] = [
  { type: 'page', title: 'Guide', href: '/docs/guide', slug: 'guide' },
  { type: 'page', title: 'API', href: '/docs/api', slug: 'api' },
];

/**
 * The stylesheet declares the mode and the component reads it back, so jsdom —
 * which applies no stylesheet — resolves `cover` for everything. That is the
 * useful half here: cover is the mode with containment in it.
 */
function mount(pathname = '/docs/guide', children?: React.ReactNode) {
  const view = render(
    <div className="wave-docs-layout">
      <DocsNav nav={NAV} pathname={pathname}>
        {children}
      </DocsNav>
      <main className="wave-docs-layout__main">
        <a href="/elsewhere">A link in the article</a>
      </main>
    </div>,
  );
  const shell = view.container.querySelector('.wave-docs-layout__sidebar');
  const trigger = view.container.querySelector(
    '.wave-docs-layout__sidebar-trigger',
  );
  const main = view.container.querySelector('.wave-docs-layout__main');
  if (
    !(shell instanceof HTMLElement) ||
    !(trigger instanceof HTMLElement) ||
    !(main instanceof HTMLElement)
  ) {
    throw new Error('expected a shell, a trigger and an article');
  }
  return { ...view, shell, trigger, main };
}

describe('DocsNav', () => {
  it('renders one shell of two children, and one of each', () => {
    const { container, shell } = mount();

    expect(
      container.querySelectorAll('.wave-docs-layout__sidebar'),
    ).toHaveLength(1);
    expect(shell.children).toHaveLength(2);
    expect(shell.children[0]).toHaveClass('wave-docs-layout__sidebar-nav');
    expect(shell.children[1]).toHaveClass('wave-docs-layout__sidebar-trigger');

    // ⚠️ ONE TREE IN THE PAYLOAD. Two nav landmarks is what every "render a
    // second one for mobile" fix produces, and a screen-reader user hears both.
    expect(container.querySelectorAll('nav')).toHaveLength(1);
    expect(container.querySelectorAll('dialog')).toHaveLength(0);
  });

  it('binds the trigger to the navigation it moves', () => {
    const { container, trigger } = mount();

    expect(trigger).toHaveAttribute('aria-controls', DOCS_NAV_ID);
    expect(container.querySelector(`#${DOCS_NAV_ID}`)).toHaveClass(
      'wave-docs-layout__sidebar-nav',
    );
  });

  /**
   * ⚠️ THREE STATES, AND THE THIRD ONE IS WHY THERE IS NO FLASH.
   *
   * The server renders no `data-state` at all, so the stylesheet decides per
   * mode — closed where the navigation would cover the article, open where it
   * would sit beside it. A boolean would have to be picked before the
   * container's width is known, which is a flash on a phone or a flash on a
   * desktop. Once the reader presses the trigger, their choice is explicit and
   * wins at every width.
   */
  it('renders no state until one is resolved or chosen', () => {
    const html = render(<DocsNav nav={NAV} pathname="/docs/guide" />).container
      .innerHTML;

    // The markup React would have sent, before any effect has run.
    expect(html.includes('data-state')).toBe(true);
    // …and once resolved it is concrete, never left for CSS to guess at.
    expect(html).toMatch(/data-state="(open|closed)"/);
  });

  it('toggles the state, the name and what it announces', () => {
    const { shell, trigger } = mount();
    const openLabel = trigger.getAttribute('aria-label');

    expect(shell).toHaveAttribute('data-state', 'closed');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    expect(shell).toHaveAttribute('data-state', 'open');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    // The name says what pressing it does next, so it cannot say "open" twice.
    expect(trigger.getAttribute('aria-label')).not.toBe(openLabel);

    fireEvent.click(trigger);
    expect(shell).toHaveAttribute('data-state', 'closed');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger.getAttribute('aria-label')).toBe(openLabel);
  });

  it('takes both names, so a site that is not in English has both', () => {
    const view = render(
      <DocsNav
        nav={NAV}
        pathname="/docs/guide"
        openLabel="Abrir"
        closeLabel="Fechar"
      />,
    );
    const trigger = view.container.querySelector(
      '.wave-docs-layout__sidebar-trigger',
    );
    if (!(trigger instanceof HTMLElement)) throw new Error('no trigger');

    expect(trigger).toHaveAttribute('aria-label', 'Abrir');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-label', 'Fechar');
  });

  it('renders the search slot above the tree, inside the navigation', () => {
    const { container } = mount(
      '/docs/guide',
      <button type="button" data-testid="search" />,
    );
    const nav = container.querySelector('.wave-docs-layout__sidebar-nav');
    if (!(nav instanceof HTMLElement)) throw new Error('no navigation');

    expect(nav.firstElementChild).toHaveAttribute('data-testid', 'search');
    expect(nav.querySelector('nav')).not.toBeNull();
  });

  /**
   * ⚠️ `inert` IS THE HALF OF AN OVERLAY NOBODY SEES, AND IT WAS DROPPED ONCE.
   *
   * Without it Tab walks straight out of the navigation into an article the
   * reader cannot read, behind a scrim, with no way back. `<dialog>` was doing
   * this before the drawer was replaced; Docsify hand-rolls the same thing for
   * the same reason.
   */
  it('makes the article inert while it covers it, and only then', () => {
    const { trigger, main } = mount();

    expect(main.hasAttribute('inert')).toBe(false);

    fireEvent.click(trigger);
    expect(main.hasAttribute('inert')).toBe(true);

    fireEvent.click(trigger);
    expect(main.hasAttribute('inert')).toBe(false);
  });

  it('never makes the sidebar or the scrim inert', () => {
    const { container, shell, trigger } = mount();
    fireEvent.click(trigger);

    const scrim = container.querySelector('.wave-docs-layout__sidebar-scrim');
    expect(shell.hasAttribute('inert')).toBe(false);
    expect(scrim?.hasAttribute('inert')).toBe(false);
  });

  it('closes on Escape while it covers the article', () => {
    const { shell, trigger } = mount();
    fireEvent.click(trigger);
    expect(shell).toHaveAttribute('data-state', 'open');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(shell).toHaveAttribute('data-state', 'closed');
  });

  it('closes when the scrim is pressed', () => {
    const { container, shell, trigger } = mount();
    fireEvent.click(trigger);

    const scrim = container.querySelector('.wave-docs-layout__sidebar-scrim');
    if (!(scrim instanceof HTMLElement)) throw new Error('no scrim');
    fireEvent.click(scrim);

    expect(shell).toHaveAttribute('data-state', 'closed');
  });

  /**
   * A route change while the navigation is covering the article leaves the
   * reader looking at the navigation they just used. In push mode nothing is
   * covered and closing would be an unrequested change to their layout.
   */
  it('closes itself on navigation while it covers the article', () => {
    const { shell, trigger, rerender } = mount();
    fireEvent.click(trigger);
    expect(shell).toHaveAttribute('data-state', 'open');

    rerender(
      <div className="wave-docs-layout">
        <DocsNav nav={NAV} pathname="/docs/api" />
        <main className="wave-docs-layout__main" />
      </div>,
    );
    expect(shell).toHaveAttribute('data-state', 'closed');
  });

  it('leaves it alone when the route has not changed', () => {
    const { shell, trigger, rerender } = mount();
    fireEvent.click(trigger);

    rerender(
      <div className="wave-docs-layout">
        <DocsNav nav={NAV} pathname="/docs/guide" />
        <main className="wave-docs-layout__main" />
      </div>,
    );
    expect(shell).toHaveAttribute('data-state', 'open');
  });
});
