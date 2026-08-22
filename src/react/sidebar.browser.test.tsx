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
 * public API that changes only in a release carrying the migration.
 * `nav.browser.test.tsx` and `styles.browser.test.ts` do the same, for the
 * same reason.
 *
 * ⚠️ THE CHROME IS INSIDE THE COLUMN, NOT ABOVE IT, AND THE FIXTURE HAS TO SAY
 * SO. `docs.Layout` renders the drawer trigger and the search trigger as the
 * first two children of `.wave-docs-layout__sidebar`, and at this width that
 * wrapper is the scrollport — so the search trigger is inside the scrolling
 * content, ahead of every nav item, and the arithmetic below is done
 * against a column that has it. (The drawer trigger is `display: none` at
 * 64rem and up; it is here because the fixture is the shell, not a subset of
 * it that happens to be enough.) A fixture that puts either of them in a
 * `.wave-docs-layout__header` is markup the stylesheet no longer has one rule
 * for — unstyled, unrendered, and every assertion against it passing.
 *
 * `DocsSidebar` is rendered into that same wrapper because at 64rem and above
 * the drawer holding it is `display: contents` — no box of its own, so the
 * sidebar is laid out as the column directly. `nav.browser.test.tsx` pins that
 * line; here it is why one fewer element is faithful rather than sloppy.
 */
function mountShell(): HTMLElement {
  document.head.querySelector('#wave-docs-styles')?.remove();
  const style = document.createElement('style');
  style.id = 'wave-docs-styles';
  style.textContent = styles;
  document.head.append(style);

  document.body.innerHTML = `
    <div class="wave-docs-layout">
      <div class="wave-docs-layout__sidebar">
        <button
          type="button"
          class="wave-docs-layout__nav-trigger"
          aria-label="Open navigation"
        ></button>
        <button
          type="button"
          class="wave-docs-search-trigger wave-docs-layout__search"
        >
          <span class="wave-docs-search-trigger-label">Search</span>
        </button>
      </div>
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
   * stylesheet keeps at `display: none` until `showModal()`. An element in a
   * `display: none` subtree generates no boxes at all, so it reports
   * `scrollHeight === clientHeight === 0` and `scrollableAncestor` walks past
   * the drawer, past the strip that holds it, past the grid, and returns
   * `null`. The strip changed from `display: contents` to a 3.5rem sticky box
   * and that changed nothing here: a box with no `overflow-y` is not a
   * scrollport either, so the walk still ends at `null`.
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

    // The strip, in the order `docs.Layout` renders it: the trigger, then the
    // drawer it opens by `id`. Both are children of the same wrapper, which
    // is why nothing here needs a header any more.
    render(
      <div className="wave-docs-layout">
        <div className="wave-docs-layout__sidebar">
          <button
            type="button"
            className="wave-docs-layout__nav-trigger"
            aria-label="Open navigation"
            {...{ command: 'show-modal', commandfor: DOCS_NAV_ID }}
          >
            ☰
          </button>
          <DocsNav nav={NAV} pathname={pathname} />
        </div>
        <main className="wave-docs-layout__main">
          <p>Prose</p>
        </main>
      </div>,
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

    /*
     * ⚠️ AND INSIDE THE VIEWPORT, WHICH THE THREE ABOVE DO NOT ESTABLISH.
     * "Inside the scrollport" is only "visible" while the scrollport is itself
     * on screen, and the drawer is on screen because `height: 100dvh` sizes it
     * to exactly one viewport — a declaration in a stylesheet this fixture does
     * not control. Mutated to `200dvh`: the three assertions above all pass,
     * against an item whose bottom is 1594 in an 800px window. The reader is
     * looking at the top of a list their page is nowhere in.
     *
     * (`height: auto` is the mutation that does *not* prove this, and is worth
     * knowing before someone tries it: the UA sheet gives a modal dialog
     * `inset: 0`, so an auto height is over-constrained back to the viewport.)
     */
    expect(itemBox.bottom).toBeLessThanOrEqual(window.innerHeight);
  });
});
