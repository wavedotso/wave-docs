/**
 * The copy button's visibility rules, in an engine that has `:has()`,
 * `@media (hover: none)` and a real tab order.
 *
 * These are the assertions that keep a *structural* promise rather than a
 * documented one: the button ships in the HTML whether or not any JavaScript
 * runs, so something has to guarantee that a reader with scripts off never
 * meets a control that silently does nothing — and never tabs onto one.
 * `visibility: hidden` does both, and only a real engine can say so.
 *
 * Runs only under `pnpm test:browser`.
 */

import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it } from 'vitest';

import { codeFrameMarkup } from '../__fixtures__/code/frame-markup.js';
import { CODE_READY_ATTRIBUTE } from '../code-frame.js';
import styles from '../styles.css?inline';

/**
 * The frame's markup, as `rehypeCodeFrame` emits it.
 *
 * ⚠️ IMPORTED, NOT WRITTEN OUT HERE, AND THAT CHANGED AFTER IT BIT. This file
 * is about what the *stylesheet* does with the shape and
 * `rehype-code-frame.test.ts` is what pins the shape — but a second hand
 * -written copy of it is not a separation of concerns, it is a fixture that
 * goes on describing a frame the pipeline has stopped emitting while every
 * assertion here stays green. One home, and the plugin tier asserts the
 * pipeline agrees with it.
 */
const frame = (options: { title?: string; lang?: string } = {}): string =>
  codeFrameMarkup({ lang: 'ts', ...options });

function mount(html: string): void {
  document.documentElement.removeAttribute(CODE_READY_ATTRIBUTE);
  document.head.querySelector('#wave-docs-styles')?.remove();
  const style = document.createElement('style');
  style.id = 'wave-docs-styles';
  style.textContent = styles;
  document.head.append(style);

  /*
   * Plain DOM, not React. Nothing here is about a component — the subject is
   * what the stylesheet does to a known shape — and going through React would
   * mean `dangerouslySetInnerHTML`, which this package does not use anywhere,
   * test or otherwise.
   */
  const host = document.createElement('div');
  host.className = 'wave-docs-prose';
  host.innerHTML = html;
  document.body.append(host);
}

const button = (): HTMLElement =>
  document.querySelector('.wave-docs-code__copy') as HTMLElement;

beforeEach(async () => {
  document.body.innerHTML = '';
  await page.viewport(1280, 900);
});

describe('the copy button before the runtime mounts', () => {
  it('is invisible, and not a tab stop', () => {
    mount(frame());

    /*
     * The inert-markup trap, closed structurally. `opacity: 0` would have
     * looked identical and left a focusable control that does nothing — the
     * reader tabs to it, hears "Copy code, button", presses Enter, and the
     * page does not respond.
     */
    expect(getComputedStyle(button()).visibility).toBe('hidden');

    button().focus();
    expect(document.activeElement).not.toBe(button());
  });

  it('keeps every state icon out of sight with it', () => {
    /*
     * ⚠️ THE REASON THE SWAP BELOW IS `display` AND NOT `visibility`.
     *
     * The button is `visibility: hidden` until the runtime attaches, and
     * `visibility` inherits — so an icon rule setting it back to `visible`
     * would draw a glyph inside a button that is meant to be invisible, on
     * every page rendered without JavaScript. `display` does not inherit, so
     * the button's own rule still governs all three.
     */
    mount(frame());

    const icons = document.querySelectorAll('.wave-docs-code__copy-icon');
    expect(icons).toHaveLength(3);
    for (const icon of icons) {
      expect(getComputedStyle(icon).visibility).toBe('hidden');
    }
  });

  it('becomes visible and focusable once the runtime says so', () => {
    mount(frame());
    document.documentElement.setAttribute(CODE_READY_ATTRIBUTE, '');

    expect(getComputedStyle(button()).visibility).toBe('visible');

    button().focus();
    expect(document.activeElement).toBe(button());
  });
});

describe('the copy button once it is live', () => {
  beforeEach(() => {
    document.documentElement.setAttribute(CODE_READY_ATTRIBUTE, '');
  });

  it('sits in the header row at rest, on every block', async () => {
    /*
     * ⚠️ NO HOVER REVEAL ANY MORE, AND THE OLD TESTS HERE ASSERTED THE
     * OPPOSITE. The button used to fade in on `:hover` or `:focus-within`
     * because it was absolutely positioned over the code and had nowhere of
     * its own to be. It has a slot in the header row now, and a reserved slot
     * that stays empty until you point at it reads as a rendering fault — as
     * well as being a control that does not exist at all on a phone, which is
     * what the `@media (hover: none)` exception was for.
     */
    for (const options of [{}, { title: 'app/page.tsx' }]) {
      document.body.innerHTML = '';
      mount(frame(options));
      document.documentElement.setAttribute(CODE_READY_ATTRIBUTE, '');

      await expect.poll(() => getComputedStyle(button()).opacity).toBe('1');
    }
  });

  it('draws one icon per state, from the set the rest of the package uses', () => {
    /*
     * The button rendered `⧉` and swapped in `✓` and `×` through CSS
     * `content` — font glyphs, at whatever weight and baseline the resolved
     * font has, beside a sidebar, a pager and a search dialog that are all
     * Lucide at `stroke-width: 2`. It read as a different icon set because it
     * was one.
     */
    mount(frame());
    document.documentElement.setAttribute(CODE_READY_ATTRIBUTE, '');

    const icon = (state: string): HTMLElement =>
      document.querySelector(
        `.wave-docs-code__copy-icon[data-state="${state}"]`,
      ) as unknown as HTMLElement;
    const shown = (state: string): boolean =>
      getComputedStyle(icon(state)).display !== 'none';

    const seats: DOMRect[] = [];

    expect([shown('idle'), shown('copied'), shown('failed')]).toEqual([
      true,
      false,
      false,
    ]);
    seats.push(icon('idle').getBoundingClientRect());

    button().setAttribute('data-copied', 'true');
    expect([shown('idle'), shown('copied'), shown('failed')]).toEqual([
      false,
      true,
      false,
    ]);
    seats.push(icon('copied').getBoundingClientRect());

    button().setAttribute('data-copied', 'false');
    expect([shown('idle'), shown('copied'), shown('failed')]).toEqual([
      false,
      false,
      true,
    ]);
    seats.push(icon('failed').getBoundingClientRect());

    /*
     * One grid cell, measured whichever icon is the one on show — comparing a
     * hidden icon's box to a visible one measures nothing, because
     * `display: none` reports zeroes. The button must not resize and the glyph
     * must not shift as the state changes.
     */
    for (const seat of seats.slice(1)) {
      expect(seat.left).toBeCloseTo(seats[0]?.left ?? 0, 1);
      expect(seat.top).toBeCloseTo(seats[0]?.top ?? 0, 1);
    }
  });

  it('shares a column with the code it copies', () => {
    /*
     * ⚠️ THE INVARIANT THE EXPORTED INSET EXISTS FOR, MEASURED.
     *
     * The label sits at `--wave-docs-panel-inset` plus the surface's border;
     * the code sits at the surface's border plus the `<pre>`'s padding. Equal
     * only if both are written as the same token — and the `1.125rem` the
     * `<pre>` carried before put the first character 2px right of the filename
     * above it, which is visible and attributable to nothing.
     *
     * A `Range`, not the caption's own box: the `<figcaption>` is a grid item
     * whose border box starts at the frame's padding, and it is the *text*
     * inside it that has to line up.
     */
    mount(frame({ title: 'app/page.tsx' }));

    const caption = document.querySelector(
      '.wave-docs-code__title',
    ) as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(caption);

    const line = document.querySelector('.line') as HTMLElement;

    expect(
      Math.abs(
        range.getBoundingClientRect().left - line.getBoundingClientRect().left,
      ),
    ).toBeLessThan(1);
  });

  it('drops the frame entirely when there is no title', () => {
    /*
     * ⚠️ A TITLE IS WHAT DECIDES WHETHER THIS BLOCK HAS A FRAME.
     *
     * With one the figure is a panel: a band carrying the filename and the copy
     * button, and the code set into a card below. With none there is nothing to
     * put in a band, so the frame flattens away, the surface becomes the block,
     * and the button sits on the code. A band holding only a button is a
     * reserved slot with nothing in it, which reads as a rendering fault.
     *
     * ⚠️ AND A LANGUAGE IS NOT A TITLE. A fence declaring `ts` and no filename
     * is still an untitled fence; a band holding a two-letter badge is the same
     * empty header with a word in it.
     */
    for (const options of [{}, { lang: 'json' }]) {
      document.body.innerHTML = '';
      mount(frame(options));

      const figure = document.querySelector('.wave-docs-code') as HTMLElement;
      const surface = document.querySelector(
        '.wave-docs-code__body',
      ) as HTMLElement;

      expect(getComputedStyle(figure).borderTopWidth).toBe('0px');
      expect(getComputedStyle(figure).paddingTop).toBe('0px');
      // No band: the surface starts where the block does.
      expect(
        surface.getBoundingClientRect().top -
          figure.getBoundingClientRect().top,
      ).toBe(0);
      /*
       * And the surface is the outer box now, so it takes the outer radius.
       *
       * ⚠️ THE TOKEN IS TEXT, NOT PIXELS. `getPropertyValue` returns the
       * declaration as written — `1.1875rem` — so comparing it to a computed
       * `19px` fails against a rule that is correct.
       */
      const token = getComputedStyle(document.documentElement).getPropertyValue(
        '--wave-docs-radius-lg',
      );
      expect(
        Number.parseFloat(getComputedStyle(surface).borderTopLeftRadius),
      ).toBe(Number.parseFloat(token) * 16);
    }
  });

  it('keeps one band height across every titled fence', () => {
    // Two filenames of different lengths still draw the same header, so a page
    // of titled fences does not show two header heights.
    const heights = [
      { title: 'a.ts' },
      { title: 'app/routes/very/long/name.tsx' },
    ].map((options) => {
      document.body.innerHTML = '';
      mount(frame(options));
      const figure = document.querySelector('.wave-docs-code') as HTMLElement;
      const surface = document.querySelector(
        '.wave-docs-code__body',
      ) as HTMLElement;
      return (
        surface.getBoundingClientRect().top - figure.getBoundingClientRect().top
      );
    });

    expect(new Set(heights).size).toBe(1);
  });

  it('lets the surface draw the frame, and the code draw none', () => {
    /*
     * ⚠️ TWO FRAMES, ONE PIXEL APART, IS WHAT THIS PREVENTS. The `<pre>` used
     * to carry the border, the radius and the background itself. Inside a
     * `.wave-docs-panel__body` that carries all three, leaving them on would
     * draw the frame twice — and the inner one would square off the outer
     * one's corners from behind.
     */
    mount(frame({ title: 'app/page.tsx' }));

    const surface = document.querySelector(
      '.wave-docs-code__body',
    ) as HTMLElement;
    const pre = document.querySelector('pre') as HTMLElement;

    expect(getComputedStyle(surface).borderTopWidth).toBe('1px');
    expect(getComputedStyle(pre).borderTopWidth).toBe('0px');
    expect(getComputedStyle(pre).borderTopLeftRadius).toBe('0px');
    // Transparent, so the surface's ground is the one you see.
    expect(getComputedStyle(pre).backgroundColor).toBe('rgba(0, 0, 0, 0)');
  });

  it('keeps the focus ring on the code inside the box that clips it', () => {
    /*
     * ⚠️ THE SURFACE IS `overflow: hidden` AND THE `<pre>` FILLS IT, SO AN
     * OUTLINE DRAWN OUTSIDE THE `<pre>` IS CLIPPED AWAY TO NOTHING.
     *
     * Shiki puts `tabindex="0"` on the `<pre>` so a keyboard reader can scroll
     * a wide block, which makes it the one focusable thing in a code block —
     * and a `+2px` offset would have left it with a focus style that exists in
     * the stylesheet and cannot be seen on the page. `styles.test.ts` reads
     * rules as text and would have gone on passing.
     */
    mount(frame());
    const surface = document.querySelector(
      '.wave-docs-code__body',
    ) as HTMLElement;
    const pre = document.querySelector('pre') as HTMLElement;

    expect(getComputedStyle(surface).overflow).toBe('hidden');

    pre.focus();
    const computed = getComputedStyle(pre);
    expect(computed.outlineStyle).not.toBe('none');
    expect(Number.parseFloat(computed.outlineOffset)).toBeLessThan(0);
  });

  it('gives an excluded fence the same surface as a framed one', () => {
    /*
     * `excludeLangs` shipped as half a feature: there was no bare `pre` rule
     * anywhere in the stylesheet, and the inline-code rule is explicitly
     * `:not(pre) > code` — so a Mermaid fence rendered as a wall of UA default
     * text with no background, no border and no horizontal scroll, bleeding
     * out of the reading column.
     *
     * ⚠️ COMPARED AGAINST THE SURFACE, NOT THE `<pre>`. An excluded fence is
     * never wrapped, so it is the one `<pre>` that still has to draw its own
     * frame — which is why the rule for it did not move with the rest.
     */
    document.body.innerHTML = '';
    mount(
      `${frame()}<pre><code class="language-mermaid">graph TD;</code></pre>`,
    );

    const surface = document.querySelector(
      '.wave-docs-code__body',
    ) as HTMLElement;
    const excluded = document.querySelector('pre:not(.shiki)') as HTMLElement;
    const computed = getComputedStyle(excluded);

    expect(computed.overflowX).toBe('auto');
    expect(computed.borderTopWidth).toBe('1px');
    expect(computed.fontFamily).toContain('mono');
    expect(computed.paddingLeft).not.toBe('0px');
    expect(computed.backgroundColor).toBe(
      getComputedStyle(surface).backgroundColor,
    );
  });
});

describe('the frame is one object', () => {
  /**
   * ⚠️ FOUND BY A SCREENSHOT, NOT BY A TEST. The title bar drops its bottom
   * border and squares its bottom corners so it joins the code below it — and
   * a `<pre>`'s user-agent `margin-block: 1em` then pushed the two 14px apart,
   * leaving a caption hovering over a gap. The stylesheet's intent was in the
   * file the whole time; the browser simply disagreed.
   *
   * Nothing here could see it. jsdom has no layout at all, and
   * `styles.test.ts` reads the sheet as text — the rules it checked were all
   * present and all correct. It took rendering a real page and looking at it.
   */
  it('leaves no gap between the surface and the code on it', () => {
    /*
     * ⚠️ THE `<pre>`'s USER-AGENT MARGIN, WHICH IS STILL THE DEFECT — the
     * geometry it shows up in is just different now.
     *
     * A `<pre>` defaults to `margin-block: 1em`, and at this block's 0.875rem
     * that is 14px. It used to push the code away from the caption above it,
     * leaving a title bar hovering over a gap. Inside the panel's surface it
     * instead leaves a 14px band of surface ground above and below the code,
     * which reads as a code block that failed to fill its own box.
     */
    for (const options of [{}, { title: 'app/page.tsx' }]) {
      document.body.innerHTML = '';
      mount(frame(options));

      const surface = document.querySelector(
        '.wave-docs-code__body',
      ) as HTMLElement;
      const pre = document.querySelector('pre') as HTMLElement;
      const border = Number.parseFloat(
        getComputedStyle(surface).borderTopWidth,
      );

      const gap =
        pre.getBoundingClientRect().top -
        surface.getBoundingClientRect().top -
        border;

      expect(gap).toBe(0);
    }
  });

  it('seats the copy button in the band, or on the code when there is none', () => {
    /*
     * Two variants, two seats. Titled: a grid item in the first row, clear of
     * the surface. Untitled: absolutely positioned over the code, because there
     * is no band to sit in.
     */
    document.body.innerHTML = '';
    mount(frame({ title: 'app/page.tsx' }));
    {
      const figure = document.querySelector('.wave-docs-code') as HTMLElement;
      const surface = document.querySelector(
        '.wave-docs-code__body',
      ) as HTMLElement;
      const box = button().getBoundingClientRect();
      const frameBox = figure.getBoundingClientRect();

      expect(box.top).toBeGreaterThanOrEqual(frameBox.top);
      // Clear of the surface, rather than floating over the code.
      expect(box.bottom).toBeLessThanOrEqual(
        surface.getBoundingClientRect().top,
      );
      expect(frameBox.right - box.right).toBeLessThan(16);
    }

    document.body.innerHTML = '';
    mount(frame());
    {
      const figure = document.querySelector('.wave-docs-code') as HTMLElement;
      const box = button().getBoundingClientRect();
      const frameBox = figure.getBoundingClientRect();

      // Over the code, and inside the block on both axes.
      expect(getComputedStyle(button()).position).toBe('absolute');
      expect(box.top).toBeGreaterThanOrEqual(frameBox.top);
      expect(box.bottom).toBeLessThanOrEqual(frameBox.bottom);
      expect(frameBox.right - box.right).toBeLessThan(16);
      /*
       * ⚠️ ABOVE THE CODE, NOT UNDER IT. The `<pre>` is a scroll container and
       * paints its content above a static sibling, so without a `z-index` the
       * button vanished under a wide line instead of sitting over it.
       */
      expect(
        Number.parseInt(getComputedStyle(button()).zIndex, 10),
      ).toBeGreaterThan(0);
    }
  });

  it('keeps the frame clear of the paragraph above it', () => {
    // The margin was doing one useful thing — separating the block from
    // surrounding prose — and removing it must not cost that. The spacing now
    // comes from `.wave-docs-prose > * + *` on the figure, which is where it
    // belongs, because the figure is the block.
    document.body.innerHTML = '';
    mount(`<p>Before.</p>${frame({ title: 'app/page.tsx' })}`);

    const paragraph = document.querySelector('p') as HTMLElement;
    const figure = document.querySelector('.wave-docs-code') as HTMLElement;

    expect(
      figure.getBoundingClientRect().top -
        paragraph.getBoundingClientRect().bottom,
    ).toBeGreaterThan(8);
  });
});
