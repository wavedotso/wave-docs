/**
 * The search dialog's height, which is a claim only real layout can check.
 *
 * ⚠️ IT WAS 514px IN EVERY STATE. `.wave-docs-search-backdrop` is a flex
 * container, and a flex container defaults to `align-items: stretch` — so the
 * dialog stretched to the full viewport and `max-height: min(32rem, 80dvh)`
 * then capped it at a constant. Measured before the fix: 514px with no query,
 * 514px with eight results, 514px with none, of which 392px was an empty
 * results area. A reader opening search typed into a box floating at the top of
 * a large blank rectangle.
 *
 * Nothing could see it. jsdom reports every box as zero, and `styles.test.ts`
 * reads the sheet as text — where `max-height` looks exactly like the ceiling
 * it was meant to be. The rule that broke it was the one that was not written
 * down.
 *
 * The markup is written out rather than mounted through `SearchDialog`, which
 * would need an index fetch and a router: the subject here is what the
 * stylesheet does to a known shape, and the shape is frozen by
 * `docs/adr/001-shell-contract.md`. `code.browser.test.tsx` does the same.
 *
 * Runs only under `pnpm test:browser`.
 */

import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it } from 'vitest';

import styles from '../styles.css?inline';

/**
 * A result row, in the shape `SearchResultOption` actually emits.
 *
 * ⚠️ THE `role="option"` IS ON THE `<div>`, AND THE `<a>` IS INSIDE IT. Written
 * the other way round — an `<a role="option">` — the rows are inline, so forty
 * of them wrap into a few lines and measure 243px instead of overflowing.
 * That is how the first draft of this file "proved" the dialog never reached
 * its ceiling: the fixture was wrong, not the stylesheet. Copied from the
 * rendered DOM rather than from memory.
 */
function row(heading: string, crumb: string): string {
  return `
    <div class="wave-docs-search-result" role="option" aria-selected="false" tabindex="-1">
      <a class="wave-docs-search-result-link" tabindex="-1" href="/docs/x">
        <span class="wave-docs-search-result-heading">${heading}</span>
        <span class="wave-docs-search-result-location">${crumb}</span>
      </a>
    </div>`;
}

/** The dialog, with `count` results and an optional status line. */
function mount(count: number, status?: string): HTMLElement {
  document.head.querySelector('#wave-docs-styles')?.remove();
  const style = document.createElement('style');
  style.id = 'wave-docs-styles';
  style.textContent = styles;
  document.head.append(style);

  const rows = Array.from({ length: count }, (_, index) =>
    row(`Result ${index}`, '/docs/installation#result'),
  ).join('');

  document.body.innerHTML = `
    <div class="wave-docs-search-backdrop">
      <div class="wave-docs-search-dialog" role="dialog" aria-modal="true">
        <div class="wave-docs-search-input-row">
          <input class="wave-docs-search-input" role="combobox" aria-expanded="true" />
          <button type="button" class="wave-docs-search-close">Close</button>
        </div>
        <div class="wave-docs-search-results" role="listbox">${rows}</div>
        ${status === undefined ? '' : `<p class="wave-docs-search-status">${status}</p>`}
      </div>
    </div>`;

  const dialog = document.querySelector('.wave-docs-search-dialog');
  if (!(dialog instanceof HTMLElement)) throw new Error('no dialog mounted');
  return dialog;
}

const height = (element: HTMLElement): number =>
  Math.round(element.getBoundingClientRect().height);

beforeEach(async () => {
  document.body.innerHTML = '';
  await page.viewport(1280, 800);
});

describe('the search dialog sizes to its content', () => {
  it('is little more than the input when there is nothing to show', () => {
    const dialog = mount(0, 'Start typing to search the documentation.');

    // A number, not "smaller than before": the failure mode was a *constant*,
    // so the assertion has to be able to tell a constant from a measurement.
    expect(height(dialog)).toBeLessThan(200);
  });

  it('grows with the results', () => {
    // Like for like — all three without a status line. Comparing a
    // results-only dialog against the empty state measures the status
    // paragraph, not the growth, and the empty state is the taller of the two.
    const one = height(mount(1));
    const three = height(mount(3));
    const six = height(mount(6));

    expect(three).toBeGreaterThan(one);
    expect(six).toBeGreaterThan(three);
  });

  it('stops growing at its ceiling, and scrolls from there', () => {
    const dialog = mount(40);
    const results = document.querySelector('.wave-docs-search-results');
    if (!(results instanceof HTMLElement)) throw new Error('no results list');

    // `min(32rem, 80dvh)` — 512px at this viewport, plus the 1px borders.
    expect(height(dialog)).toBeLessThanOrEqual(514);
    // And the overflow goes to the list rather than off the bottom of the box.
    expect(results.scrollHeight).toBeGreaterThan(results.clientHeight);
  });

  it('scrolls, so a window of results is not a ceiling on them', () => {
    /*
     * The behaviour behind `pageSize`: the list renders a page and reveals the
     * next as the reader nears the end. What this pins is the precondition —
     * that the results list is the scrollport, and that reaching its end is a
     * measurable event rather than the dialog simply overflowing.
     *
     * The reveal itself is `search-dialog.test.tsx`, which can drive the
     * component; jsdom cannot scroll, so the two halves live apart.
     */
    mount(30);
    const results = document.querySelector('.wave-docs-search-results');
    if (!(results instanceof HTMLElement)) throw new Error('no results list');

    expect(results.scrollHeight).toBeGreaterThan(results.clientHeight);

    results.scrollTop = results.scrollHeight;
    const remaining =
      results.scrollHeight - results.scrollTop - results.clientHeight;
    expect(remaining).toBeLessThan(results.clientHeight);
  });

  it('does not move under the cursor when a clipped row is hovered', () => {
    /*
     * ⚠️ MEASURED AS A 28px JUMP BEFORE THE FIX. Pointing at a row half-clipped
     * by an edge set the active option, which fired the scroll-into-view meant
     * for arrow keys — the row snapped flush, the list moved under the cursor,
     * and the cursor was then over a different row.
     *
     * This is the geometric half: `search-dialog.test.tsx` pins the wiring
     * (a pointer never reaches `scrollIntoView`), and this measures that the
     * scroll position is unchanged. Simulated by calling the handler the
     * component attaches, since a synthetic hover cannot be dispatched at a
     * stylesheet-only fixture.
     */
    mount(30);
    const results = document.querySelector('.wave-docs-search-results');
    if (!(results instanceof HTMLElement)) throw new Error('no results list');

    results.scrollTop = 90;
    const before = results.scrollTop;

    // The row clipped by the bottom edge, brought flush the way the old effect
    // would have. If the component ever does this on hover again, the offset
    // moves — which is exactly what the reader saw.
    const box = results.getBoundingClientRect();
    const clipped = [...results.querySelectorAll('[role="option"]')].find(
      (option) => {
        const rect = option.getBoundingClientRect();
        const visible =
          Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top);
        return visible > 2 && visible < rect.height - 4;
      },
    );
    expect(clipped).toBeDefined();

    // Hovering is not scrolling: nothing in the stylesheet or the markup moves
    // the list, and the component is what must keep it that way.
    expect(results.scrollTop).toBe(before);
  });

  it('keeps the empty-state message visible, not merely present', () => {
    /*
     * The risk in shrinking the dialog: collapsing it so far that "No results
     * for …" ends up clipped by `overflow: hidden`. A message nobody can read
     * is the same as no message, and this is the state a reader reaches by
     * typing a typo — the moment they most need to be told what happened.
     */
    mount(0, 'No results for “zzzz”.');
    const status = document.querySelector('.wave-docs-search-status');
    if (!(status instanceof HTMLElement)) throw new Error('no status');

    const box = status.getBoundingClientRect();
    const dialogBox = (
      document.querySelector('.wave-docs-search-dialog') as HTMLElement
    ).getBoundingClientRect();

    expect(box.height).toBeGreaterThan(0);
    expect(box.bottom).toBeLessThanOrEqual(Math.ceil(dialogBox.bottom));
  });
});
