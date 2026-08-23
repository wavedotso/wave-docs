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
 * `offsetParent`, so `offsetTop` was already relative to it and the subtraction
 * removed the column's own offset from the document a second time. Measured at
 * 1280×800 against the shell of the day — a full-width header above the grid,
 * so that offset was the header's 3.5rem — the item scrolled to 206 where 265
 * was correct, leaving a 1024–1055 item inside a 206–1014 viewport: entirely
 * below the fold, on the one navigation where the reader knows exactly what
 * they asked for.
 *
 * The shell renders no header now, so those two numbers record a fix rather
 * than today's arithmetic — the fixture below is the shell as it ships now.
 * What survives the header is the mechanism, and it is still reachable:
 * whatever offset the column carries would be subtracted twice, and
 * `--wave-docs-chrome-offset` exists precisely so a host with their own sticky
 * bar can make that offset non-zero again.
 *
 * No fixture catches that, because a fixture encodes the same belief the code
 * does. Only real layout under the real stylesheet can.
 *
 * The assertion is the invariant — "fully inside the visible box" — not the
 * number. 265 was an artefact of that viewport, that font and that item count;
 * "the reader can see their page" is the thing that must stay true.
 *
 * Runs only under `pnpm test:browser`.
 */

import { render } from '@testing-library/react';
import { page } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';

import styles from '../styles.css?inline';
import type { DocNavNode } from '../types.js';
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
 * public API that changes only in a release carrying the migration.
 * `nav.browser.test.tsx` and `styles.browser.test.ts` do the same, for the same
 * reason.
 *
 * ⚠️ THE SCROLLPORT IS THE SIDEBAR'S *NAVIGATION*, NOT THE SHELL AROUND IT. The
 * shell is the sticky box and paints nothing; the navigation is what scrolls,
 * and it holds the search trigger ahead of every item — so the arithmetic below
 * is done against a column that has one. A fixture that scrolls the shell is
 * measuring a box with no `overflow-y`, which is not a scrollport at all, and
 * every assertion against it would pass.
 */
function mountShell(): HTMLElement {
  document.head.querySelector('#wave-docs-styles')?.remove();
  const style = document.createElement('style');
  style.id = 'wave-docs-styles';
  style.textContent = styles;
  document.head.append(style);

  document.body.innerHTML = `
    <div class="wave-docs-shell">
      <div class="wave-docs-layout">
        <div class="wave-docs-layout__sidebar">
          <div class="wave-docs-layout__sidebar-nav" tabindex="-1">
            <button
              type="button"
              class="wave-docs-search-trigger wave-docs-layout__search"
            >
              <span class="wave-docs-search-trigger-label">Search</span>
            </button>
          </div>
          <button
            type="button"
            class="wave-docs-layout__sidebar-trigger"
            aria-label="Open navigation"
          ></button>
        </div>
        <div class="wave-docs-layout__sidebar-scrim" aria-hidden="true"></div>
        <main class="wave-docs-layout__main"><p>Prose</p></main>
      </div>
    </div>
  `;

  const port = document.querySelector<HTMLElement>(
    '.wave-docs-layout__sidebar-nav',
  );
  if (port === null) throw new Error('the shell has no sidebar navigation');
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

describe('the sidebar while it is closed', () => {
  /*
   * ⚠️ THE SCROLL-INTO-VIEW HAD NEVER RUN ON A PHONE, NOT ONCE, AND THIS IS
   * WHAT FIXED IT.
   *
   * The tree used to live inside `<dialog class="wave-docs-layout__drawer">`,
   * which the UA sheet keeps at `display: none` until `showModal()`. An element
   * in a `display: none` subtree generates no boxes at all, so it reported
   * `scrollHeight === clientHeight === 0` and the search for a scrollable
   * ancestor walked past the drawer, past the strip, past the grid, and
   * returned `null`. Every phone reader, every navigation, opened a long list
   * scrolled to the top with their own page below the fold.
   *
   * A closed sidebar is not hidden — its navigation is translated out past the
   * inline start edge and is laid out the whole time. So there is a scrollport
   * before the reader ever opens it, and the item is already in view when they
   * do. That is the structural argument for moving rather than hiding, and it
   * is worth more than the animation.
   *
   * Invisible to every other tier: jsdom has no layout, and the stylesheet read
   * as text says nothing about what a closed box does to a scrollport.
   */
  it('still has a scrollport, so the current page is already found', async () => {
    await page.viewport(390, 800);
    const port = mountShell();

    render(<DocsSidebar nav={NAV} pathname="/docs/p45" />, { container: port });
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    // The premise, asserted rather than assumed: a closed sidebar is moved, not
    // hidden. A `display: none` version reports 0 for both and the assertion
    // below could not fail.
    expect(port.scrollHeight).toBeGreaterThan(port.clientHeight);

    const active = document.querySelector<HTMLElement>('[aria-current="page"]');
    if (active === null) {
      throw new Error('no item is marked as the current page');
    }
    expect(active.getBoundingClientRect().height).toBeGreaterThan(0);
  });

  it('shows the current page once it is opened', async () => {
    await page.viewport(390, 800);
    const port = mountShell();
    const shell = port.parentElement;
    if (shell === null) throw new Error('no shell');

    render(<DocsSidebar nav={NAV} pathname="/docs/p45" />, { container: port });
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    shell.setAttribute('data-state', 'open');
    await Promise.all(
      document
        .getAnimations()
        .map((animation) => animation.finished.catch(() => undefined)),
    );

    const active = document.querySelector<HTMLElement>('[aria-current="page"]');
    if (active === null) {
      throw new Error('no item is marked as the current page');
    }

    // The invariant, not a number: the reader can see the page they are on.
    const portBox = port.getBoundingClientRect();
    const itemBox = active.getBoundingClientRect();

    expect(portBox.height).toBeGreaterThan(0);
    expect(itemBox.top).toBeGreaterThanOrEqual(portBox.top);
    expect(itemBox.bottom).toBeLessThanOrEqual(portBox.bottom);

    /*
     * ⚠️ AND INSIDE THE VIEWPORT, WHICH THE THREE ABOVE DO NOT ESTABLISH.
     * "Inside the scrollport" is only "visible" while the scrollport is itself
     * on screen, and it is on screen because the shell is `height: calc(100dvh
     * - …)` — a declaration in a stylesheet this fixture does not control.
     * Mutated to `200dvh`, all three above pass against an item whose bottom is
     * off the bottom of the window.
     */
    expect(itemBox.bottom).toBeLessThanOrEqual(window.innerHeight);
  });
});
