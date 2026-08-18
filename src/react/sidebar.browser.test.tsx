/**
 * The one claim the sidebar makes that only a browser can check: after a
 * navigation, the current page is *visible* in the navigation column.
 *
 * ## Why this file exists
 *
 * The jsdom test asserts the arithmetic against a fixture, and the fixture is a
 * model. The bug this file was written for was not in the arithmetic — it was
 * in the *premise*: the code read `active.offsetTop - port.offsetTop`, on the
 * reasonable-sounding belief that `offsetTop` needed rebasing onto the
 * scrollport. It did not. The column is `position: sticky`, which makes it the
 * `offsetParent`, so `offsetTop` was already relative to it and the
 * subtraction removed the header height a second time. Measured here at
 * 1280×800: the item scrolled to 206 where 265 was correct, leaving a 1024–1055
 * item inside a 206–1014 viewport — entirely below the fold, on the one
 * navigation where the reader knows exactly what they asked for.
 *
 * No fixture catches that, because a fixture encodes the same belief the code
 * does. Only real layout under the real stylesheet can.
 *
 * The assertion is the invariant — "fully inside the visible box" — not the
 * number. 265 is an artefact of this viewport, this font and this item count;
 * "the reader can see their page" is the thing that must stay true.
 *
 * Runs only under `pnpm test:browser`.
 */

import { render } from '@testing-library/react';
import { page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';

import styles from '../styles.css?inline';
import type { DocNavNode } from '../types.js';
import { DOCS_NAV_ID, DocsNav } from './nav.js';
import { DocsSidebar } from './sidebar.js';

/** Long enough that the column must scroll at any plausible viewport height. */
const NAV: DocNavNode[] = Array.from({ length: 60 }, (_, index) => ({
  type: 'page' as const,
  title: `Page ${index}`,
  href: `/docs/p${index}`,
  slug: `p${index}`,
}));

afterEach(() => {
  document.body.innerHTML = '';
});

/**
 * The frozen shell, written out rather than imported: `DocsLayoutShell` reaches
 * `next/navigation` through its client components, and the class names are
 * fixed by `docs/adr/001-shell-contract.md`. `nav.browser.test.tsx` and
 * `styles.browser.test.ts` do the same, for the same reason.
 */
function mountShell(): HTMLElement {
  const style = document.createElement('style');
  style.textContent = styles;
  document.head.append(style);

  document.body.innerHTML = `
    <header class="wave-docs-layout__header">
      <div class="wave-docs-layout__header-inner">Docs</div>
    </header>
    <div class="wave-docs-layout">
      <div class="wave-docs-layout__sidebar"></div>
      <main class="wave-docs-layout__main"><p>Prose</p></main>
    </div>
  `;

  const port = document.querySelector<HTMLElement>(
    '.wave-docs-layout__sidebar',
  );
  if (port === null) throw new Error('the shell has no sidebar column');
  return port;
}

it('leaves the current page fully visible in the navigation column', async () => {
  await page.viewport(1280, 800);
  const port = mountShell();

  render(<DocsSidebar nav={NAV} pathname="/docs/p45" />, { container: port });
  // One frame, so sticky positioning and the scroll assignment have settled.
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

  // The premise, asserted rather than assumed: at this breakpoint the column
  // really is the scrollport. If a stylesheet change ever makes it something
  // else, this fails here rather than silently downgrading the test below into
  // one that cannot fail.
  const portBox = port.getBoundingClientRect();
  expect(port.scrollHeight).toBeGreaterThan(port.clientHeight);

  const active = document.querySelector<HTMLElement>('[aria-current="page"]');
  if (active === null) throw new Error('no item is marked as the current page');
  const itemBox = active.getBoundingClientRect();

  expect(itemBox.top).toBeGreaterThanOrEqual(portBox.top);
  expect(itemBox.bottom).toBeLessThanOrEqual(portBox.bottom);
});

it('does not move a column whose current page is already in view', async () => {
  await page.viewport(1280, 800);
  const port = mountShell();

  // The first item is visible without scrolling anything, and assigning
  // `scrollTop` even to its current value cancels a smooth scroll in flight and
  // fires a `scroll` event — so the effect has to decline, not merely compute
  // zero.
  render(<DocsSidebar nav={NAV} pathname="/docs/p0" />, { container: port });
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

  expect(port.scrollTop).toBe(0);
});

describe('the mobile drawer, below 64rem', () => {
  /*
   * ⚠️ THE SCROLL-INTO-VIEW HAD NEVER RUN ON A PHONE, NOT ONCE. Below 64rem the
   * sidebar is inside `<dialog class="wave-docs-layout__drawer">`, which the UA
   * stylesheet keeps at `display: none` until `showModal()`, wrapped in a
   * `.wave-docs-layout__sidebar` that is `display: contents`. An element in a
   * `display: none` subtree generates no boxes at all, so both report
   * `scrollHeight === clientHeight === 0` and `scrollableAncestor` walks past
   * the drawer, past the grid, and returns `null`.
   *
   * And the timing made it unreachable rather than flaky: the effect was keyed
   * on `pathname` alone, and `DocsNav` closes the drawer on every `pathname`
   * change — so at the one moment it could fire, the drawer was always shut, and
   * nothing re-ran when the reader opened it. Every phone reader, every
   * navigation, opened a long list scrolled to the top with their own page below
   * the fold.
   *
   * Invisible to every other tier: jsdom has no layout and no `showModal`, and
   * the stylesheet read as text says nothing about what `display: contents`
   * does to a scrollport.
   */
  afterEach(() => {
    for (const dialog of document.querySelectorAll('dialog')) {
      if (dialog.open) dialog.close();
    }
  });

  function mountDrawer(pathname: string): HTMLDialogElement {
    document.head.querySelector('#wave-docs-styles')?.remove();
    const style = document.createElement('style');
    style.id = 'wave-docs-styles';
    style.textContent = styles;
    document.head.append(style);

    render(
      <>
        <header className="wave-docs-layout__header">
          <div className="wave-docs-layout__header-inner">
            <button
              type="button"
              className="wave-docs-layout__nav-trigger"
              aria-label="Open navigation"
              {...{ command: 'show-modal', commandfor: DOCS_NAV_ID }}
            >
              ☰
            </button>
          </div>
        </header>
        <div className="wave-docs-layout">
          <div className="wave-docs-layout__sidebar">
            <DocsNav nav={NAV} pathname={pathname} />
          </div>
          <main className="wave-docs-layout__main">
            <p>Prose</p>
          </main>
        </div>
      </>,
    );

    const dialog = document.querySelector('dialog');
    if (dialog === null) throw new Error('the drawer did not mount');
    return dialog;
  }

  it('has no scrollport at all while it is closed', async () => {
    // The premise, asserted rather than assumed. If this ever stops being true
    // the test below stops testing anything, and would keep passing.
    await page.viewport(390, 800);
    mountDrawer('/docs/p45');

    const active = document.querySelector<HTMLElement>('[aria-current="page"]');
    if (active === null)
      throw new Error('no item is marked as the current page');

    expect(active.getBoundingClientRect().height).toBe(0);
  });

  it('shows the current page as soon as the drawer opens', async () => {
    await page.viewport(390, 800);
    mountDrawer('/docs/p45');

    const trigger = document.querySelector<HTMLButtonElement>(
      '.wave-docs-layout__nav-trigger',
    );
    if (trigger === null) throw new Error('no trigger');

    await userEvent.click(trigger);
    // One frame, so the open transition and the scroll assignment have landed.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    const active = document.querySelector<HTMLElement>('[aria-current="page"]');
    if (active === null)
      throw new Error('no item is marked as the current page');

    const port =
      active.closest<HTMLElement>('.wave-docs-sidebar')?.parentElement;
    if (port == null) throw new Error('the drawer has no scrollport');

    // The invariant, not a number: the reader can see the page they are on.
    const portBox = port.getBoundingClientRect();
    const itemBox = active.getBoundingClientRect();

    expect(portBox.height).toBeGreaterThan(0);
    expect(itemBox.top).toBeGreaterThanOrEqual(portBox.top);
    expect(itemBox.bottom).toBeLessThanOrEqual(portBox.bottom);
  });
});
