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
  // `dir` is on the root element, so it outlives a body reset.
  document.documentElement.dir = '';
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
              <svg class="wave-docs-search-glyph" width="16" height="16" aria-hidden="true"></svg>
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
/**
 * Which way the disclosure chevron faces.
 *
 * Here rather than in `styles.browser.test.ts` because the angle is only half
 * of the answer: `sidebar.tsx` owns the icon, and a rotation is a claim about
 * ink that no stylesheet can honour alone. Swap `chevron-right` for
 * `chevron-left` in that file and every angle the sheet declares is still what
 * it always was while every chevron in the navigation faces backwards. Only a
 * test that renders the real component can see it.
 */
describe('the disclosure chevron', () => {
  /** A collapsed group and, because it holds the current page, an open one. */
  const GROUPS: DocNavNode[] = [
    {
      type: 'group',
      title: 'Closed group',
      children: [
        { type: 'page', title: 'Hidden', href: '/docs/hidden', slug: 'hidden' },
      ],
    },
    {
      type: 'group',
      title: 'Open group',
      children: [
        { type: 'page', title: 'Here', href: '/docs/here', slug: 'here' },
      ],
    },
  ];

  function mountGroups(direction: 'ltr' | 'rtl'): SVGSVGElement[] {
    document.documentElement.dir = direction;
    const port = mountShell();
    render(<DocsSidebar nav={GROUPS} pathname="/docs/here" />, {
      container: port,
    });

    const icons = [
      ...document.querySelectorAll<SVGSVGElement>(
        '.wave-docs-sidebar__chevron',
      ),
    ];
    expect(icons, 'expected a chevron on each group').toHaveLength(2);
    return icons;
  }

  /**
   * Where the chevron's point lands on screen, relative to the middle of its
   * own box. Negative `x` is toward the viewport's left and positive toward its
   * right; positive `y` is downward.
   *
   * ⚠️ FROM THE PATH, NOT FROM A BOUNDING BOX. A chevron's ink is symmetric
   * about its own centre — Lucide's is `9,18 → 15,12 → 9,6`, three units either
   * side — so `getBoundingClientRect` reports the same extent whichever way it
   * faces, and the first version of this assertion was deciding on sub-pixel
   * noise. The middle vertex is the point; the path knows where that is, and
   * `getScreenCTM` carries it through the rotation.
   */
  function pointOffset(icon: SVGSVGElement): { x: number; y: number } {
    const path = icon.querySelector('path');
    if (path === null) throw new Error('the chevron has no path');

    const ctm = path.getScreenCTM();
    if (ctm === null) throw new Error('the chevron is not rendered');

    const tip = path.getPointAtLength(path.getTotalLength() / 2);
    const onScreen = new DOMPoint(tip.x, tip.y).matrixTransform(ctm);
    const box = icon.getBoundingClientRect();
    return {
      x: onScreen.x - (box.left + box.width / 2),
      y: onScreen.y - (box.top + box.height / 2),
    };
  }

  /**
   * The group header is `justify-content: space-between`, so the chevron is
   * flush against the row's inline end and the label is at the other side of
   * it. Unrotated the icon therefore aimed at the panel's border — and a
   * chevron at the trailing edge of a row is the platform idiom for "this takes
   * you somewhere else", so it also read as navigation on a control that only
   * opens a list in place.
   */
  it('aims a collapsed group at its own label', async () => {
    await page.viewport(1280, 800);
    const [closed] = mountGroups('ltr');
    if (closed === undefined) throw new Error('no collapsed chevron');

    // The label is to its left, so the point must be too.
    expect(pointOffset(closed).x).toBeLessThan(-1);
  });

  /**
   * ⚠️ AND IT MIRRORS, WHICH A ROTATION DOES NOT DO BY ITSELF.
   *
   * `rotate` is physical — 180deg is left in every writing mode — while every
   * other property placing this row is logical. Under `dir="rtl"` the header
   * mirrors, the chevron moves to the inline start and the label lands to its
   * right, so a single unmirrored rotation points it out of the panel on the
   * other side: the same defect this rule exists to fix, reflected. The
   * stylesheet carries a `:dir(rtl)` rule for exactly this, and deleting it
   * fails here and nowhere else.
   */
  it('still aims at the label when the sidebar is mirrored', async () => {
    await page.viewport(1280, 800);
    const [closed] = mountGroups('rtl');
    if (closed === undefined) throw new Error('no collapsed chevron');

    expect(pointOffset(closed).x).toBeGreaterThan(1);
  });

  /**
   * ⚠️ SOURCE ORDER IS LOAD-BEARING FOR THIS ONE. `:dir(rtl)` and `[data-open]`
   * match with the same specificity, so an open group in a mirrored sidebar
   * points down only while the open rule is written last. Swap the two and a
   * chevron lies flat above a list that is expanded beneath it.
   */
  it.each(['ltr', 'rtl'] as const)(
    'aims an open group down, under dir=%s',
    async (direction) => {
      await page.viewport(1280, 800);
      const open = mountGroups(direction)[1];
      if (open === undefined) throw new Error('no open chevron');

      expect(getComputedStyle(open).rotate).toBe('90deg');

      // Down, not merely rotated: the point sits below its own centre, and no
      // further to one side than rounding.
      const { x, y } = pointOffset(open);
      expect(y).toBeGreaterThan(1);
      expect(Math.abs(x)).toBeLessThan(1);
    },
  );
});
/**
 * The type markers, measured — because the claim they make is about a *column*,
 * and a column is geometry.
 */
describe('the sidebar type markers', () => {
  const MIXED: DocNavNode[] = [
    { type: 'page', title: 'Overview', href: '/docs', slug: '' },
    {
      type: 'group',
      title: 'Reference',
      children: [
        { type: 'page', title: 'Inside', href: '/docs/inside', slug: 'inside' },
      ],
    },
    {
      type: 'page',
      title: 'Internals',
      href: '/docs/internals',
      slug: 'internals',
    },
    {
      type: 'link',
      title: 'GitHub',
      href: 'https://example.com',
      external: true,
    },
  ];

  /**
   * Every row's label. `Reference` is shut at this route, so nothing nested
   * renders and each of these is a top-level row.
   */
  function labelLefts(): number[] {
    return [
      ...document.querySelectorAll<HTMLElement>(
        '.wave-docs-sidebar__label, .wave-docs-sidebar__group-title',
      ),
    ].map((el) => Math.round(el.getBoundingClientRect().left));
  }

  /**
   * ⚠️ THE EXTERNAL LINK IS WHY THIS TEST EXISTS. Its mark used to sit at the
   * far end of its row, which left the near end empty and its label starting a
   * whole icon left of every label above it — a ragged column, the defect the
   * markers were added to remove. The mark is that row's type marker now and
   * leads it like every other, and only layout can prove the column closed up.
   */
  it('starts every top-level label on the same line', async () => {
    await page.viewport(1280, 800);
    const port = mountShell();
    render(<DocsSidebar nav={MIXED} pathname="/docs" />, { container: port });

    const lefts = labelLefts();
    expect(lefts, 'expected four top-level rows').toHaveLength(4);
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThan(1);
  });

  /** And the markers really are drawn, not merely present with zero size. */
  it('gives each marker a real box', async () => {
    await page.viewport(1280, 800);
    const port = mountShell();
    render(<DocsSidebar nav={MIXED} pathname="/docs" />, { container: port });

    const boxes = [
      ...document.querySelectorAll<Element>('.wave-docs-sidebar__icon'),
    ].map((el) => el.getBoundingClientRect());
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) {
      expect(box.width).toBeGreaterThan(12);
      expect(box.height).toBeGreaterThan(12);
    }
  });

  /** Turning them off closes the column up rather than leaving a gutter. */
  it('reclaims the space when a host turns them off', async () => {
    await page.viewport(1280, 800);

    const withIcons = mountShell();
    render(<DocsSidebar nav={MIXED} pathname="/docs" />, {
      container: withIcons,
    });
    const on = labelLefts()[0];

    const withoutIcons = mountShell();
    render(<DocsSidebar nav={MIXED} pathname="/docs" icons={false} />, {
      container: withoutIcons,
    });
    const off = labelLefts()[0];

    if (on === undefined || off === undefined) throw new Error('no labels');
    // A 16px marker plus the row's 0.5rem gap.
    expect(on - off).toBeGreaterThan(20);
  });
});
/**
 * One column, from the search trigger down through the tree.
 *
 * The trigger sits directly above the navigation inside the same scrollport, so
 * its magnifier is the first thing in the column every folder and page marker
 * continues, and its label starts the column every title continues. Nothing in
 * either stylesheet rule says so — they are separate components with separate
 * padding — which is exactly why it drifted, and why only geometry can hold it.
 */
describe('the search trigger and the tree share a column', () => {
  function left(selector: string): number {
    const el = document.querySelector(selector);
    if (!(el instanceof Element)) throw new Error(`no ${selector}`);
    return el.getBoundingClientRect().left;
  }

  /**
   * ⚠️ MEASURED OFF BY 3px AND 11px BEFORE THIS. The trigger was spaced as a
   * standalone control — 10px of inline padding against the rows' 8px, and a
   * 16px gap against their 8px — and it carries a 1px border the rows do not,
   * so the fix is `calc(0.5rem - 1px)` rather than `0.5rem`. A rule matching
   * the number instead of the *content edge* leaves this 1px out and looks
   * fixed in a screenshot.
   */
  it('starts the magnifier and the label where the tree does', async () => {
    await page.viewport(1280, 800);
    const port = mountShell();

    /*
     * ⚠️ A CHILD OF THE PORT, NOT THE PORT ITSELF. `createRoot` clears its
     * container on mount, so rendering straight into the scrollport deletes the
     * search trigger the fixture just put there — and this test would then be
     * measuring the tree against nothing, and throwing rather than failing. A
     * sibling node is also the real shape: the trigger is markup the shell
     * emits ahead of the tree, not something the tree renders.
     */
    const host = document.createElement('div');
    port.append(host);
    render(
      <DocsSidebar
        nav={[{ type: 'page', title: 'Overview', href: '/docs', slug: '' }]}
        pathname="/docs"
      />,
      { container: host },
    );

    expect(
      Math.abs(
        left('.wave-docs-search-glyph') - left('.wave-docs-sidebar__icon'),
      ),
      'the magnifier is not in the markers’ column',
    ).toBeLessThan(1);

    expect(
      Math.abs(
        left('.wave-docs-search-trigger-label') -
          left('.wave-docs-sidebar__label'),
      ),
      'the placeholder is not in the titles’ column',
    ).toBeLessThan(1);
  });
});
/**
 * A separator's label starts where a row's content starts — the marker column
 * when there is one, the words when there is not.
 *
 * ⚠️ THAT IS ONE TARGET IN BOTH MODES, AND IT IS EASY TO TALK YOURSELF INTO
 * TWO. A row's own `padding-inline` is what the modes share: the icon sits on
 * it with markers on, the text sits on it with `icons={false}`. Aim at the
 * row's *text* instead and the label chases a number that moves by 24px
 * between modes — which is what these two cases are here to catch.
 *
 * And a test that fakes the off state with `display: none` proves nothing about
 * any of it: the element stays in the DOM, so anything asking the tree what it
 * drew still sees a marker. These render the real prop.
 */
describe('a separator label starts where a row does', () => {
  const NAV: DocNavNode[] = [
    { type: 'page', title: 'Overview', href: '/docs', slug: '' },
    { type: 'separator', title: 'Links' },
    {
      type: 'link',
      title: 'GitHub',
      href: 'https://example.com',
      external: true,
    },
  ];

  /** Where the glyphs start, not where the box does — the label is a block. */
  function textLeft(selector: string): number {
    const el = document.querySelector(selector);
    if (!(el instanceof Element)) throw new Error(`no ${selector}`);
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect().left;
  }

  function mountNav(icons: boolean): void {
    const port = mountShell();
    const host = document.createElement('div');
    port.append(host);
    render(<DocsSidebar nav={NAV} pathname="/docs" icons={icons} />, {
      container: host,
    });
  }

  it('lines up with the marker column when markers are drawn', async () => {
    await page.viewport(1280, 800);
    mountNav(true);

    const icon = document.querySelector('.wave-docs-sidebar__icon');
    if (icon === null) throw new Error('no marker to line up with');

    expect(
      Math.abs(
        textLeft('.wave-docs-sidebar__separator') -
          icon.getBoundingClientRect().left,
      ),
    ).toBeLessThan(1);
  });

  it('lines up with the words when they are not', async () => {
    await page.viewport(1280, 800);
    mountNav(false);

    expect(document.querySelector('.wave-docs-sidebar__icon')).toBeNull();
    expect(
      Math.abs(
        textLeft('.wave-docs-sidebar__separator') -
          textLeft('.wave-docs-sidebar__label'),
      ),
    ).toBeLessThan(1);
  });

  /** The rule is not the label: it divides the column, so it keeps its edge. */
  it('keeps the rule on the column edge in both modes', async () => {
    await page.viewport(1280, 800);

    mountNav(true);
    const withIcons = document
      .querySelector('.wave-docs-sidebar__separator-item')
      ?.getBoundingClientRect().left;

    mountNav(false);
    const without = document
      .querySelector('.wave-docs-sidebar__separator-item')
      ?.getBoundingClientRect().left;

    expect(withIcons).toBeDefined();
    expect(without).toBe(withIcons);
  });
});
