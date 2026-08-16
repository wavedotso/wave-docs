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

import { CODE_READY_ATTRIBUTE } from '../code-frame.js';
import styles from '../styles.css?inline';

/**
 * The frame's markup, as `rehypeCodeFrame` emits it.
 *
 * Written out rather than rendered through the pipeline: this file is about
 * what the *stylesheet* does with that shape, and
 * `rehype-code-frame.test.ts` is what pins the shape itself. Running the
 * markdown pipeline in a browser bundle would drag unified and Shiki into it
 * to assert nothing extra.
 */
function frame(options: { title?: string } = {}): string {
  const caption =
    options.title === undefined
      ? ''
      : `<figcaption class="wave-docs-code__title">${options.title}</figcaption>`;
  return `
    <figure class="wave-docs-code" data-wave-docs-code="" data-lang="ts">
      ${caption}
      <button type="button" class="wave-docs-code__copy"
              data-wave-docs-copy="" aria-label="Copy code">⧉</button>
      <pre class="shiki" tabindex="0"><code><span class="line">const a = 1;</span></code></pre>
    </figure>`;
}

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

  it('stays out of the way until the block is hovered or focused', async () => {
    mount(frame());

    expect(getComputedStyle(button()).opacity).toBe('0');

    // `:focus-within` on the figure, so reaching the code region by keyboard
    // reveals the control that copies it.
    (document.querySelector('pre') as HTMLElement).focus();

    /*
     * Polled, not read once. `opacity` is transitioned, and
     * `getComputedStyle` reports the value *mid-flight* — so reading it on the
     * line after `.focus()` returns `0` against a rule that is applying
     * correctly, and the test fails describing a bug that is not there.
     */
    await expect.poll(() => getComputedStyle(button()).opacity).toBe('1');
  });

  it('is always visible on a block that has a title bar', () => {
    /*
     * The bar already reserves the space, so there is nothing to reveal and
     * a control that fades in would just be motion for its own sake. This is
     * the `:has()` rule, which jsdom cannot evaluate at all.
     */
    mount(frame({ title: 'app/page.tsx' }));

    expect(getComputedStyle(button()).opacity).toBe('1');
  });

  it('squares off the corners the title bar covers', () => {
    mount(frame({ title: 'app/page.tsx' }));
    const pre = document.querySelector('pre') as HTMLElement;

    expect(getComputedStyle(pre).borderTopLeftRadius).toBe('0px');
    expect(getComputedStyle(pre).borderBottomLeftRadius).not.toBe('0px');
  });

  it('gives an excluded fence the same surface as a highlighted one', () => {
    /*
     * `excludeLangs` shipped as half a feature: there was no bare `pre` rule
     * anywhere in the stylesheet, and the inline-code rule is explicitly
     * `:not(pre) > code` — so a Mermaid fence rendered as a wall of UA default
     * text with no background, no border and no horizontal scroll, bleeding
     * out of the reading column.
     */
    mount('<pre><code class="language-mermaid">graph TD;</code></pre>');
    const pre = document.querySelector('pre') as HTMLElement;
    const computed = getComputedStyle(pre);

    expect(computed.overflowX).toBe('auto');
    expect(computed.borderTopWidth).toBe('1px');
    expect(computed.fontFamily).toContain('mono');
    expect(computed.paddingLeft).not.toBe('0px');
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
  it('leaves no gap between the title bar and the code', () => {
    mount(frame({ title: 'app/page.tsx' }));

    const caption = document.querySelector(
      '.wave-docs-code__title',
    ) as HTMLElement;
    const pre = document.querySelector('pre') as HTMLElement;

    const gap =
      pre.getBoundingClientRect().top - caption.getBoundingClientRect().bottom;

    // Exactly zero: they share an edge, which is the whole point of the title
    // bar dropping its bottom border.
    expect(gap).toBe(0);
  });

  it('seats the copy button on the code, with or without a title', () => {
    /*
     * The same margin slid an untitled fence's code out from under its button,
     * because the button is positioned against the `<figure>` and the `<pre>`
     * was no longer at the top of it.
     */
    for (const options of [{}, { title: 'app/page.tsx' }]) {
      document.body.innerHTML = '';
      mount(frame(options));

      const figure = document.querySelector('.wave-docs-code') as HTMLElement;
      const box = button().getBoundingClientRect();
      const frameBox = figure.getBoundingClientRect();

      // Inside the frame, both edges — a button hanging off the top is the
      // symptom the margin produced.
      expect(box.top).toBeGreaterThanOrEqual(frameBox.top);
      expect(box.bottom).toBeLessThanOrEqual(frameBox.bottom);
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
