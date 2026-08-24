/**
 * The sidebar's behaviour, in a real layout engine.
 *
 * ⚠️ THIS FILE USED TO TEST A `<dialog>`. It pinned the four things that
 * justified one over `popover="auto"` — focus trapping, Escape, the scroll
 * lock, inertness — and the `display: contents` line that turned the same DOM
 * into a desktop column. None of that exists any more: there is one sidebar at
 * every width and the trigger moves it.
 *
 * What replaces it is the pair of things only a layout engine can answer:
 *
 * - **which mode the stylesheet resolved.** The component reads it from a
 *   custom property because `matchMedia` cannot answer a `@container` query,
 *   and that read is the seam where a rename would silently leave every
 *   sidebar in cover mode for ever.
 * - **that the container decides it, not the viewport.** The same viewport with
 *   a narrow container has to behave like a phone, because that is the whole
 *   reason the media queries were dropped.
 *
 * Runs only under `pnpm test:browser`.
 */

import { render } from '@testing-library/react';
import { page, userEvent } from 'vitest/browser';
import { beforeEach, describe, expect, it } from 'vitest';

import styles from '../styles.css?inline';
import type { DocNavNode } from '../types.js';
import { DocsNav } from './nav.js';

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
  shell: HTMLElement;
  nav: HTMLElement;
  trigger: HTMLButtonElement;
  scrim: HTMLElement;
  main: HTMLElement;
}

/** `width` constrains the query container, which is what decides the mode. */
function mount(width?: string): Mounted {
  document.head.querySelector('#wave-docs-styles')?.remove();
  const style = document.createElement('style');
  style.id = 'wave-docs-styles';
  style.textContent = styles;
  document.head.append(style);

  render(
    <div
      className="wave-docs-shell"
      {...(width === undefined ? {} : { style: { width } })}
    >
      <div className="wave-docs-layout">
        {/*
         * `DocsNav` renders the whole sidebar — shell, navigation, trigger and
         * scrim — so there is nothing to write out around it. That is the point
         * of the shape: `docs.Layout` places one element.
         */}
        <DocsNav nav={NAV} pathname="/docs/guide">
          <button
            type="button"
            className="wave-docs-search-trigger wave-docs-layout__search"
          >
            Search
          </button>
        </DocsNav>
        <main className="wave-docs-layout__main">
          <a href="/elsewhere">A link in the article</a>
          {/*
           * A sticky table header, because it is `z-index: 1` — the same layer
           * the scrim is on — and it is what punched through it.
           */}
          <section className="wave-docs-table-scroll">
            <table className="wave-docs-table">
              <thead>
                <tr>
                  <th>Package</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 40 }, (_, row) => `row ${row}`).map(
                  (label) => (
                    <tr key={label}>
                      <td>{label}</td>
                      <td>Required</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </section>
          {/* Tall, so the page has something to scroll. */}
          <p style={{ height: '4000px' }}>Body</p>
        </main>
      </div>
    </div>,
  );

  const q = <T extends HTMLElement>(selector: string): T => {
    const element = document.querySelector<T>(selector);
    if (element === null) throw new Error(`no ${selector}`);
    return element;
  };
  return {
    shell: q('.wave-docs-layout__sidebar'),
    nav: q('.wave-docs-layout__sidebar-nav'),
    trigger: q<HTMLButtonElement>('.wave-docs-layout__sidebar-trigger'),
    scrim: q('.wave-docs-layout__sidebar-scrim'),
    main: q('.wave-docs-layout__main'),
  };
}

/**
 * Two frames for layout and the effect that resolves the mode, then every
 * running transition.
 *
 * ⚠️ THE TRANSITIONS ARE NOT OPTIONAL TO WAIT FOR. The sidebar animates its
 * translate over 200ms, so two frames after a click the navigation is a third
 * of the way across and the scrim is at 0.07 opacity — measured. Asserting
 * there is asserting the easing curve.
 */
async function settle(): Promise<void> {
  await new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve(null);
      });
    });
  });
  /*
   * ⚠️ TRANSITIONS ONLY, AND `getAnimations()` IS NOT THAT.
   *
   * It returns every running animation, and the table scroll shadow is driven
   * by `animation-timeline: scroll(nearest inline)` — a scroll-driven animation
   * whose `finished` promise resolves when the *scroll position* reaches the
   * end, which is to say never on an unscrolled table. Awaiting the whole list
   * hung every test in this file for the full 15s timeout the moment a table
   * appeared in the fixture.
   */
  await Promise.all(
    document
      .getAnimations()
      .filter((animation) => animation instanceof CSSTransition)
      .map((animation) => animation.finished.catch(() => undefined)),
  );
}

const mode = (shell: HTMLElement): string =>
  getComputedStyle(shell).getPropertyValue('--wave-docs-sidebar-mode').trim();

beforeEach(async () => {
  document.body.innerHTML = '';
  window.scrollTo(0, 0);
  await page.viewport(1280, 800);
});

describe('the sidebar, in a wide container', () => {
  it('resolves push mode and opens itself', async () => {
    const { shell, trigger, main } = mount();
    await settle();

    expect(mode(shell)).toBe('push');
    expect(shell.getAttribute('data-state')).toBe('open');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    // Beside the article, not on top of it.
    expect(main.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      shell.getBoundingClientRect().right,
    );
  });

  /**
   * ⚠️ THE ARTICLE HAS TO TAKE THE ROOM BACK, AND THAT IS THE ASSERTION. Every
   * version of this driven by `translate` alone left a sidebar-shaped hole in
   * the grid — the sidebar looked closed and the text stayed exactly as narrow
   * as it had been. The negative margin is what makes the track follow.
   */
  it('gives the article the room when it closes, and takes it back', async () => {
    const { shell, nav, trigger, main } = mount();
    await settle();

    const openWidth = main.getBoundingClientRect().width;
    const navWidth = nav.getBoundingClientRect().width;

    await userEvent.click(trigger);
    await settle();
    const closedWidth = main.getBoundingClientRect().width;

    expect(closedWidth).toBeGreaterThan(openWidth);
    // The navigation is off the page rather than merely invisible.
    expect(nav.getBoundingClientRect().right).toBeLessThanOrEqual(0);

    /*
     * And the article gained exactly the navigation's width — no more, which
     * would mean the trigger stopped being reserved, and no less, which is the
     * sidebar-shaped hole every `translate`-only version of this left behind.
     *
     * ⚠️ NOT MEASURED AGAINST THE SHELL'S OWN WIDTH. The shell is `max-content`
     * in both states; what changes is its negative margin, so its border box
     * says 300px either way.
     */
    expect(closedWidth - openWidth).toBeCloseTo(navWidth, 0);
    // The shell's own box does not change: it is `max-content` in both states,
    // and what moves is its negative margin.
    expect(Math.round(shell.getBoundingClientRect().width)).toBe(
      Math.round(navWidth + trigger.getBoundingClientRect().width),
    );
  });

  it('never covers the article, so nothing is scrimmed or inert', async () => {
    const { trigger, scrim, main } = mount();
    await settle();

    expect(getComputedStyle(scrim).display).toBe('none');
    expect(main.hasAttribute('inert')).toBe(false);

    await userEvent.click(trigger);
    await userEvent.click(trigger);
    await settle();
    expect(main.hasAttribute('inert')).toBe(false);
  });
});

/**
 * ⚠️ SAME VIEWPORT, NARROW CONTAINER — AND THIS IS THE WHOLE REASON THE MEDIA
 * QUERIES WENT.
 *
 * A host who mounts this in a 700px panel on a 1280px screen gets a 1280px
 * answer from `matchMedia` and a reading column of about 60px. `@container`
 * asks about the box we were given, which is the question with an answer.
 */
describe('the sidebar, in a narrow container on a wide screen', () => {
  it('resolves cover mode from the container, not the viewport', async () => {
    const { shell } = mount('520px');
    await settle();

    expect(window.innerWidth).toBeGreaterThan(1000);
    expect(mode(shell)).toBe('cover');
    expect(shell.getAttribute('data-state')).toBe('closed');
  });

  it('covers the article rather than squeezing it', async () => {
    const { shell, trigger, main } = mount('520px');
    await settle();

    const closed = main.getBoundingClientRect();
    await userEvent.click(trigger);
    await settle();
    const open = main.getBoundingClientRect();

    // The article does not move and does not re-wrap …
    expect(open.width).toBe(closed.width);
    expect(open.left).toBe(closed.left);
    // … because the sidebar is on top of it.
    expect(shell.getBoundingClientRect().right).toBeGreaterThan(open.left);
  });

  /**
   * The five things `<dialog>` was giving us for free, and the reason an
   * overlay without them is worse than the drawer it replaced: `inert` is what
   * stops Tab walking out of the navigation into text behind a scrim.
   */
  it('scrims and inerts what it covers, and undoes both on close', async () => {
    const { trigger, scrim, main } = mount('520px');
    await settle();

    expect(getComputedStyle(scrim).display).not.toBe('none');
    expect(getComputedStyle(scrim).opacity).toBe('0');
    expect(main.hasAttribute('inert')).toBe(false);

    await userEvent.click(trigger);
    await settle();
    expect(getComputedStyle(scrim).opacity).toBe('1');
    expect(main.hasAttribute('inert')).toBe(true);

    await userEvent.click(trigger);
    await settle();
    expect(getComputedStyle(scrim).opacity).toBe('0');
    expect(main.hasAttribute('inert')).toBe(false);
  });

  /**
   * ⚠️ THE SCRIM COVERS THE ARTICLE, NOT MOST OF IT.
   *
   * `.wave-docs-table thead th` is `position: sticky; z-index: 1`, and so is the
   * scrim. Same stacking context, equal z-index, and the header comes later in
   * the document — so with the navigation open over a table on a phone, the
   * header row was the one bright thing on a dimmed page.
   *
   * Raising the scrim would have fixed that element and left the next one, so
   * the article is `isolation: isolate` instead: nothing inside it can be
   * weighed against the scrim at all, ours or a consumer's own content. This
   * hit-tests rather than reading `z-index`, because the defect was never in
   * the value — it was in which stacking context the value was compared in.
   */
  it('covers everything in the article, including a sticky table header', async () => {
    const { shell, trigger, main } = mount('520px');
    await settle();

    const header = main.querySelector('.wave-docs-table thead th');
    if (!(header instanceof HTMLElement)) throw new Error('no table header');

    await userEvent.click(trigger);
    await settle();

    const box = header.getBoundingClientRect();
    expect(box.width).toBeGreaterThan(0);

    /*
     * ⚠️ PROBE CLEAR OF THE NAVIGATION. The header's own centre is behind the
     * open panel, so hit-testing there returns the navigation and the test
     * passes for the wrong reason — it would pass with no scrim at all.
     */
    const x = Math.round(
      Math.max(box.left + 2, shell.getBoundingClientRect().right + 8),
    );
    const top = document.elementFromPoint(
      x,
      Math.round(box.top + box.height / 2),
    );

    expect(x).toBeLessThan(box.right);
    expect(top).toHaveClass('wave-docs-layout__sidebar-scrim');
  });

  it('moves focus into the navigation and gives it back', async () => {
    const { nav, trigger } = mount('520px');
    await settle();

    trigger.focus();
    await userEvent.click(trigger);
    await settle();
    expect(document.activeElement).toBe(nav);

    await userEvent.keyboard('{Escape}');
    await settle();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('the sidebar, at every container width', () => {
  it('puts the trigger directly against the navigation, with nothing between', async () => {
    const { nav, trigger } = mount();
    await settle();

    expect(trigger.getBoundingClientRect().left).toBeCloseTo(
      nav.getBoundingClientRect().right,
      0,
    );
  });

  it('paints nothing on the shell and nothing on the trigger', async () => {
    const { shell, nav, trigger, main } = mount();
    // The pointer is wherever the last test left it, and `:hover` on this
    // control is the one state that *does* paint. Park it on the article.
    await userEvent.hover(main);
    await settle();

    const transparent = 'rgba(0, 0, 0, 0)';
    expect(getComputedStyle(shell).backgroundColor).toBe(transparent);
    expect(getComputedStyle(trigger).backgroundColor).toBe(transparent);

    for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
      expect(getComputedStyle(shell)[`border${side}Width`]).toBe('0px');
      expect(getComputedStyle(trigger)[`border${side}Width`]).toBe('0px');
    }

    // Opaque, because in cover mode it sits on the article and a translucent
    // surface puts two columns of text through each other.
    expect(getComputedStyle(nav).backgroundColor).not.toBe(transparent);
  });

  /**
   * ⚠️ THE DIVISION IS THE PAGE'S HEIGHT IN PUSH MODE AND THE PANEL'S IN COVER
   * MODE, AND CONFLATING THEM IS THE BUG THIS REPLACED.
   *
   * One box was `sticky` with `height: 100dvh` — sized against the viewport
   * while positioned against the layout — so with the UA's 8px of `body` margin
   * the line stopped 8px short of the top and ran 8px past the bottom, and
   * snapped into place the moment the page scrolled. Measured on the site.
   *
   * They are two different things: in push mode the line divides the page, so
   * it is the page's height; in cover mode it is the edge of a panel lying on
   * top of the page, so it is the panel's.
   */
  it('draws the division against the page, not against the viewport', async () => {
    const { shell, nav } = mount();
    await settle();

    // Push: the shell's, spanning the whole docs region — top to bottom, and
    // wherever the host placed it.
    expect(getComputedStyle(nav).borderInlineEndWidth).toBe('0px');
    const divider = getComputedStyle(shell, '::after');
    expect(divider.content).not.toBe('none');
    expect(divider.width).toBe('1px');

    const layout = shell.parentElement;
    if (layout === null) throw new Error('no layout');
    expect(Math.round(shell.getBoundingClientRect().height)).toBe(
      Math.round(layout.getBoundingClientRect().height),
    );
    expect(Math.round(shell.getBoundingClientRect().top)).toBe(
      Math.round(layout.getBoundingClientRect().top),
    );

    document.body.innerHTML = '';
    // Cover: the panel's own edge, because it is a panel and not a column.
    const narrow = mount('520px');
    await settle();
    expect(
      Number.parseFloat(getComputedStyle(narrow.nav).borderInlineEndWidth),
    ).toBeGreaterThan(0);
    expect(getComputedStyle(narrow.shell, '::after').content).toBe('none');
  });

  /**
   * Apple's minimum tap target, and the strip *is* the target — there is no
   * transparent border buying hit area behind it, so what the layout reserves
   * and what a thumb gets are the same number.
   */
  /**
   * ⚠️ THE STRIP IS SIZED BY THE BUTTON, NOT BESIDE IT. Both were fixed for a
   * while and the gap between them was a third number nobody set — 24px of
   * button left 10px a side, 16px left 14px. The strip is `auto` with 4px of
   * padding now, so `--wave-docs-trigger-width` is the only thing to change and
   * the hit area follows the paint.
   */
  it('sizes the trigger from the button plus its padding', async () => {
    const { trigger } = mount();
    await settle();

    const button = getComputedStyle(trigger, '::before');
    expect(button.height).toBe('56px');

    const strip = trigger.getBoundingClientRect().width;
    const paint = Number.parseFloat(button.width);
    expect(Math.round(paint)).toBe(16);
    expect(Math.round(strip - paint)).toBe(8);
    expect(getComputedStyle(trigger).padding).toBe('4px');

    /*
     * ⚠️ 24px IS THE FLOOR, AND THIS RULE IS NOW ON IT. WCAG 2.5.8 asks for a
     * 24x24 CSS-pixel target; the strip is 16px of paint plus 4px of padding a
     * side, and full-height, so it clears the minimum in one axis exactly and
     * by a mile in the other. Narrow `--wave-docs-trigger-width` again and the
     * target fails — which is the whole reason the hit area is derived from
     * that token rather than set beside it.
     */
    expect(Math.round(strip)).toBeGreaterThanOrEqual(24);
  });

  /**
   * Blue means the grip is the thing to press; grey means it is at rest.
   *
   * ⚠️ THE STATE LIVES ON AN ANCESTOR AND HOVER LIVES ON THE BUTTON, so written
   * as backgrounds the state selector outranks the hover one by a whole class
   * and silently kills hover on the state that still needs it. The sheet sets
   * custom properties instead and lets inheritance decide — these are the cases
   * that hold that.
   */
  it.each([
    ['closed', true],
    ['open', false],
  ])('lights the grip while %s', async (state, lit) => {
    const { shell, trigger } = mount();
    await settle();

    // `shell` *is* `.wave-docs-layout__sidebar` here — see `mount`.
    const sidebar = shell;
    if (sidebar.getAttribute('data-state') !== state) {
      trigger.click();
      await settle();
    }
    expect(sidebar.getAttribute('data-state')).toBe(state);

    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue('--wave-docs-accent')
      .trim();
    const fill = getComputedStyle(sidebar)
      .getPropertyValue('--wave-docs-trigger-fill')
      .trim();

    expect(fill === `var(--wave-docs-accent)` || fill === accent).toBe(lit);
  });

  it('toggles from the keyboard, not only the pointer', async () => {
    const { shell, trigger } = mount();
    await settle();
    trigger.focus();

    const before = shell.getAttribute('data-state');
    await userEvent.keyboard('{Enter}');
    await settle();
    expect(shell.getAttribute('data-state')).not.toBe(before);

    await userEvent.keyboard(' ');
    await settle();
    expect(shell.getAttribute('data-state')).toBe(before);
  });

  /**
   * The trigger is in the sticky shell and the tree is in the scroller beside
   * it, so reaching the end of a long navigation cannot carry the control away
   * with it. It was `position: fixed` for exactly this, which is what put it on
   * top of the tree.
   */
  it('holds the trigger still while the navigation scrolls', async () => {
    const { nav, trigger } = mount();
    await settle();

    const before = trigger.getBoundingClientRect().top;
    nav.scrollTop = 400;
    await settle();

    expect(trigger.getBoundingClientRect().top).toBe(before);
  });

  it('renders one tree and no dialog', async () => {
    mount();
    await settle();

    expect(document.querySelectorAll('nav[aria-label]')).toHaveLength(1);
    expect(document.querySelectorAll('dialog')).toHaveLength(0);
  });
});
