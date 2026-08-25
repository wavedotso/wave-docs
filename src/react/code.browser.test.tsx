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

  it('draws one header row, whatever is in it', () => {
    /*
     * With a label the row is the label's height; with none it is the button's,
     * and those differ by enough that a page mixing titled and untitled fences
     * shows two header heights. `--wave-docs-panel-header-row` floors it.
     */
    const heights = [{}, { title: 'app/page.tsx' }, { lang: 'json' }].map(
      (options) => {
        document.body.innerHTML = '';
        mount(frame(options));
        const figure = document.querySelector('.wave-docs-code') as HTMLElement;
        const surface = document.querySelector(
          '.wave-docs-code__body',
        ) as HTMLElement;
        return (
          surface.getBoundingClientRect().top -
          figure.getBoundingClientRect().top
        );
      },
    );

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

  it('seats the copy button in the header row, above the code', () => {
    /*
     * The button was positioned against the `<figure>` and is now a grid item
     * in its first row. Both shapes can put it in the wrong place — absolutely
     * positioned it hung off the top of an untitled fence; as a grid item, a
     * missing `grid-row` would drop it into the second row and over the code.
     */
    for (const options of [{}, { title: 'app/page.tsx' }]) {
      document.body.innerHTML = '';
      mount(frame(options));

      const figure = document.querySelector('.wave-docs-code') as HTMLElement;
      const surface = document.querySelector(
        '.wave-docs-code__body',
      ) as HTMLElement;
      const box = button().getBoundingClientRect();
      const frameBox = figure.getBoundingClientRect();

      // Inside the frame, both edges.
      expect(box.top).toBeGreaterThanOrEqual(frameBox.top);
      expect(box.bottom).toBeLessThanOrEqual(frameBox.bottom);
      // And clear of the surface, rather than floating over the code.
      expect(box.bottom).toBeLessThanOrEqual(
        surface.getBoundingClientRect().top,
      );
      // Held at the frame's end, not adrift in the middle of the row.
      expect(frameBox.right - box.right).toBeLessThan(16);
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
