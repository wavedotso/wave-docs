/**
 * The four behaviours that justify `<dialog>` over `popover="auto"`, plus the
 * one CSS line the desktop sidebar depends on.
 *
 * All five are invisible to jsdom, which has no `showModal`, no `:modal`, no
 * focus management, no inertness and no layout — the shim in
 * `vitest.setup.dom.ts` moves attributes and says so in its own docstring. So
 * without this file, "focus is trapped" and "the page does not scroll
 * underneath" are claims verified by reading a specification, which is the
 * practice that let a `<div>` inside a `<p>` ship in the YouTube mapping.
 *
 * ## Why the shell is written out here rather than imported
 *
 * `DocsLayoutShell` reaches `next/link` and `next/navigation` through its
 * client components, and vitest's browser module mocker wraps a factory's
 * result one level deeper than the jsdom one does — so a stubbed default
 * import arrives as `{ default: Component }` and React throws
 * "Element type is invalid". Rather than encode that quirk, the split is:
 *
 * - **`layout.test.tsx` (jsdom)** pins the *wiring* — that the real drawer
 *   trigger, the one `docs.Layout` renders inside
 *   `.wave-docs-layout__sidebar`, carries `command="show-modal"` and a
 *   `commandfor` equal to the real dialog's `id`. That is the assertion a
 *   hand-written fixture could drift from, and it is made against the real
 *   component.
 * - **this file** pins the *behaviour* those attributes buy, against a fixture
 *   built from the same frozen class names, with the real `DocsNav` inside it.
 *
 * ⚠️ THE FIXTURE IS THE SHELL AS IT RENDERS TODAY, AND THAT IS NOT COSMETIC.
 * It used to mount the trigger inside a `.wave-docs-layout__header`, and the
 * stylesheet has no rule for that class any more — so the fixture would have
 * been unstyled markup that no shell renders, with every assertion below still
 * passing against nothing. The class names it does use are public API and
 * change only in a release that carries the migration, which is what makes
 * writing them out here safe — `styles.browser.test.ts` does the same.
 *
 * Runs only under `pnpm test:browser`.
 */

import { render } from '@testing-library/react';
import { page, userEvent } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import styles from '../styles.css?inline';
import type { DocNavNode } from '../types.js';
import { DOCS_NAV_ID, DocsNav } from './nav.js';

const NAV: DocNavNode[] = [
  { type: 'page', title: 'Guide', href: '/docs/guide', slug: 'guide' },
  { type: 'page', title: 'API', href: '/docs/api', slug: 'api' },
  {
    type: 'page',
    title: 'Reference',
    href: '/docs/reference',
    slug: 'reference',
  },
];

interface Mounted {
  trigger: HTMLButtonElement;
  dialog: HTMLDialogElement;
  search: HTMLButtonElement;
}

function mount(): Mounted {
  document.head.querySelector('#wave-docs-styles')?.remove();
  const style = document.createElement('style');
  style.id = 'wave-docs-styles';
  style.textContent = styles;
  document.head.append(style);

  render(
    <div className="wave-docs-layout">
      {/* The chrome strip: the trigger, the search trigger and the drawer, all
          three children of one wrapper, in the order `docs.Layout` renders
          them. The trigger opens the dialog by `id`, so the search trigger
          sitting between the two costs nothing. */}
      <div className="wave-docs-layout__sidebar">
        <button
          type="button"
          className="wave-docs-layout__nav-trigger"
          aria-label="Open navigation"
          {...{ command: 'show-modal', commandfor: DOCS_NAV_ID }}
        >
          ☰
        </button>
        {/* Stands in for the search trigger: something focusable after the menu
            button and outside the drawer, so a leaking focus trap has somewhere
            to leak to. Both class names, because `docs.Layout` gives it both,
            and its placement inside the sidebar is the half that matters
            here. */}
        <button
          type="button"
          className="wave-docs-search-trigger wave-docs-layout__search"
        >
          Search
        </button>
        <DocsNav nav={NAV} pathname="/docs/guide" />
      </div>
      <article className="wave-docs-prose wave-docs-layout__main">
        {/* Tall, so the scroll lock has something to lock. */}
        <p style={{ height: '4000px' }}>Body</p>
      </article>
    </div>,
  );

  const trigger = document.querySelector<HTMLButtonElement>(
    '.wave-docs-layout__nav-trigger',
  );
  const search = document.querySelector<HTMLButtonElement>(
    '.wave-docs-search-trigger',
  );
  const dialog = document.querySelector('dialog');
  if (trigger === null || dialog === null || search === null) {
    throw new Error('failed to mount the shell fixture');
  }
  return { trigger, dialog, search };
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.scrollTo(0, 0);
});

afterEach(() => {
  for (const dialog of document.querySelectorAll('dialog')) {
    if (dialog.open) dialog.close();
  }
});

describe('the drawer, below 64rem', () => {
  beforeEach(async () => {
    await page.viewport(390, 800);
  });

  it('opens modally from a server-rendered command button', async () => {
    const { trigger, dialog } = mount();

    // Declarative: none of our JavaScript runs to open it, which is what makes
    // the drawer work on the first tap, before hydration.
    await userEvent.click(trigger);

    expect(dialog.matches(':modal')).toBe(true);
  });

  it('moves focus inside, and never lets Tab back out to the strip', async () => {
    const { trigger, dialog, search } = mount();
    await userEvent.click(trigger);

    expect(dialog.contains(document.activeElement)).toBe(true);

    /*
     * MEASURED, AND NOT WHAT THE FIRST VERSION OF THIS TEST ASSERTED. The
     * cycle is: close button → each nav link → `<body>` → close button. That
     * middle step is the browser's own focus ring passing through the
     * document between wraps; it is not an escape, and asserting
     * `dialog.contains(activeElement)` on every step failed against a drawer
     * that was behaving perfectly.
     *
     * What matters is the thing the trap exists for: no focusable element
     * *outside* the drawer is ever reached — and both of them, the drawer's
     * own trigger and the search trigger, sit in the strip the drawer opens
     * over. Twelve presses is three full cycles, so a trap with a gap in it
     * has ample opportunity to leak.
     */
    const outside = [trigger, search];
    for (let index = 0; index < 12; index += 1) {
      await userEvent.keyboard('{Tab}');

      expect(outside).not.toContain(document.activeElement);
      expect(
        dialog.contains(document.activeElement) ||
          document.activeElement === document.body,
      ).toBe(true);
    }
  });

  it('closes on Escape and gives focus back to the trigger', async () => {
    const { trigger, dialog } = mount();
    await userEvent.click(trigger);

    await userEvent.keyboard('{Escape}');

    expect(dialog.open).toBe(false);
    // Without focus restoration a keyboard reader is returned to the top of
    // the document and tabs all the way back to where they were.
    expect(document.activeElement).toBe(trigger);
  });

  it('locks the page behind it, and unlocks it after', async () => {
    const { trigger } = mount();
    await userEvent.click(trigger);

    expect(getComputedStyle(document.documentElement).overflow).toBe('hidden');

    await userEvent.keyboard('{Escape}');
    expect(getComputedStyle(document.documentElement).overflow).not.toBe(
      'hidden',
    );
  });

  it('keeps the nav out of the page until it is asked for', () => {
    const { dialog } = mount();
    const nav = document.querySelector('nav');

    expect(dialog.open).toBe(false);
    expect(nav?.getBoundingClientRect().height).toBe(0);
  });
});

describe('the drawer, at 64rem and above', () => {
  beforeEach(async () => {
    await page.viewport(1280, 900);
  });

  it('becomes the sidebar column instead of a second copy of it', () => {
    const { dialog } = mount();

    /*
     * `display: contents` — the dialog generates no box of its own, so the nav
     * inside it is laid out as the sticky column directly. One nav in the DOM
     * serves both breakpoints: one landmark, one copy of the links.
     */
    expect(getComputedStyle(dialog).display).toBe('contents');

    const rect = document.querySelector('nav')?.getBoundingClientRect();
    expect(rect?.width).toBeGreaterThan(0);
    // In the first grid track, not floating over the page as a dialog would.
    expect(rect?.left).toBeLessThan(200);
    expect(dialog.matches(':modal')).toBe(false);
  });

  it('hides the drawer furniture that has nothing left to open', () => {
    const { trigger } = mount();
    const close = document.querySelector('.wave-docs-layout__drawer-close');

    expect(getComputedStyle(trigger).display).toBe('none');
    expect(getComputedStyle(close as Element).display).toBe('none');
  });

  it('leaves the page scrollable', () => {
    mount();

    expect(getComputedStyle(document.documentElement).overflow).not.toBe(
      'hidden',
    );
  });
});
