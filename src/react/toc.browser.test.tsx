/**
 * The scrollspy's one claim that only real layout can check: the entry marked
 * current is the section the reader is actually looking at.
 *
 * ⚠️ AND THE DEFECT THIS FILE WAS WRITTEN FOR IS INVISIBLE WITHOUT LAYOUT.
 * `rootMargin` makes the top 40% of the viewport the region that counts, which
 * works while there is document left to scroll. At the end there is none: a
 * short trailing section sits on screen, fully readable, below a band it can
 * never enter — while the heading above it is still *inside* that band, so the
 * observer keeps marking it. Every assertion about `rootMargin` passed; the
 * page was simply wrong at the bottom, and the only way to reach the last entry
 * was to click it.
 *
 * jsdom cannot see it: `scrollHeight`, `innerHeight` and every rect are 0, so
 * the arithmetic below is satisfied by a blank page.
 *
 * Runs only under `pnpm test:browser`.
 */

import { render } from '@testing-library/react';
import { page } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';

import styles from '../styles.css?inline';
import type { TocEntry } from '../types.js';
import { DocsToc } from './toc.js';

/** Three sections, the last one deliberately shorter than the band it must beat. */
const ENTRIES: TocEntry[] = [
  { id: 'one', text: 'One', depth: 2, children: [] },
  { id: 'two', text: 'Two', depth: 2, children: [] },
  { id: 'tail', text: 'Tail', depth: 2, children: [] },
];

afterEach(() => {
  document.body.innerHTML = '';
  document.body.style.margin = '';
  window.scrollTo(0, 0);
});

function mount(): HTMLElement {
  document.head.querySelector('#wave-docs-styles')?.remove();
  const style = document.createElement('style');
  style.id = 'wave-docs-styles';
  style.textContent = styles;
  document.head.append(style);

  document.body.innerHTML = `
    <article class="wave-docs-prose">
      <h2 id="one">One</h2><p style="block-size: 150dvh">Long.</p>
      <h2 id="two">Two</h2><p style="block-size: 150dvh">Long.</p>
      <h2 id="tail">Tail</h2><p>Short — this is the whole section.</p>
    </article>
    <div id="toc"></div>`;

  const host = document.querySelector<HTMLElement>('#toc');
  if (host === null) throw new Error('no toc host');
  render(<DocsToc entries={ENTRIES} />, { container: host });
  return host;
}

/** Two frames: the observer reports asynchronously, and so does a scroll. */
async function settle(): Promise<void> {
  await new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
}

function current(): string | null {
  return (
    document.querySelector('.wave-docs-toc__link[aria-current="location"]')
      ?.textContent ?? null
  );
}

async function scrollTo(top: number): Promise<void> {
  window.scrollTo({ top, behavior: 'instant' });
  await settle();
}

describe('the table of contents follows the reader', () => {
  it('marks the section at the top of the screen while there is page left', async () => {
    await page.viewport(1280, 800);
    mount();
    await scrollTo(0);

    expect(current()).toBe('One');
  });

  /**
   * ⚠️ THE ASSERTION THE OLD IMPLEMENTATION FAILED. At the foot of the document
   * `Two`'s heading is still inside the top 40% — a correct answer to the wrong
   * question — while `Tail` is on screen and unreachable by scrolling. The band
   * cannot resolve this, so the end of the document is handled as what it is.
   */
  it('marks the last section once the document runs out', async () => {
    await page.viewport(1280, 800);
    mount();
    await scrollTo(document.documentElement.scrollHeight);

    expect(current()).toBe('Tail');
  });

  /**
   * And hands the answer straight back, rather than sticking on the last one.
   *
   * ⚠️ SCROLLED TO A HEADING, NOT TO A FRACTION. Between two headings the band
   * holds nothing and the previous answer stands — by design, or the highlight
   * would blank out through every long section. A test that scrolls to
   * `scrollHeight / 2` can land in one of those gaps and fail against correct
   * code, which is exactly what the first draft of this did.
   */
  it('releases the last section as soon as the reader scrolls up', async () => {
    await page.viewport(1280, 800);
    mount();

    await scrollTo(document.documentElement.scrollHeight);
    expect(current()).toBe('Tail');

    const two = document.getElementById('two');
    if (two === null) throw new Error('no second heading');
    // Just past it, so the heading sits inside the band rather than above it.
    await scrollTo(two.offsetTop - 40);

    expect(current()).toBe('Two');
  });

  /**
   * ⚠️ A PAGE THAT FITS IS "SCROLLED TO THE BOTTOM" AT REST. Without the guard
   * on `scrollHeight`, its last section is current before the reader has read a
   * word of the first.
   *
   * No stylesheet here, deliberately: the guard is arithmetic on two numbers,
   * and injecting the sheet made the fixture grow with the viewport — every
   * attempt to give it room made it taller by the same amount.
   */
  it('does not jump to the end on a page that does not scroll', async () => {
    await page.viewport(1280, 800);

    document.head.querySelector('#wave-docs-styles')?.remove();
    /*
     * ⚠️ MARGINS ZEROED AND THE CONTENT WRAPPED, BECAUSE BOTH LEAK INTO THE
     * SCROLL HEIGHT. The body's own 8px a side is scrollable distance, and an
     * `h2`'s block margin collapses *through* a marginless body onto the root —
     * so this fixture had 20px to scroll while claiming to have none, and the
     * guard it exists to test was never reached.
     */
    document.body.style.margin = '0';
    document.body.innerHTML =
      '<div style="overflow: hidden">' +
      '<h2 id="one">One</h2><h2 id="tail">Tail</h2><div id="toc"></div>' +
      '</div>';
    const host = document.querySelector<HTMLElement>('#toc');
    if (host === null) throw new Error('no toc host');
    render(
      <DocsToc
        entries={[
          { id: 'one', text: 'One', depth: 2, children: [] },
          { id: 'tail', text: 'Tail', depth: 2, children: [] },
        ]}
      />,
      { container: host },
    );
    await settle();

    const doc = document.documentElement;
    expect(
      doc.scrollHeight - window.innerHeight,
      'the fixture is meant to have nothing to scroll',
    ).toBeLessThanOrEqual(2);
    expect(current()).not.toBe('Tail');
  });
});
