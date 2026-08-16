import { describe, expect, it } from 'vitest';

import { nearestScrollTop } from './nearest-scroll-top.js';

/** A 400px-tall scrollport over 2000px of nav, with 40px items. */
const port = {
  itemHeight: 40,
  viewHeight: 400,
  scrollHeight: 2000,
  scrollTop: 0,
};

describe('nearestScrollTop', () => {
  it('does nothing when the item is already visible', () => {
    /*
     * The common case — most navigations are to a page already on screen — and
     * it must be a genuine no-op rather than a same-value assignment, which
     * still cancels a smooth scroll in progress and still fires `scroll`.
     */
    expect(nearestScrollTop({ ...port, itemTop: 0 })).toBeUndefined();
    expect(nearestScrollTop({ ...port, itemTop: 180 })).toBeUndefined();
    // Exactly flush with the bottom edge counts as visible.
    expect(nearestScrollTop({ ...port, itemTop: 360 })).toBeUndefined();
  });

  it('brings an item above the fold into view', () => {
    // Scrolled to 800, item at 500: 16px of air above it.
    expect(nearestScrollTop({ ...port, scrollTop: 800, itemTop: 500 })).toBe(
      484,
    );
  });

  it('brings an item below the fold into view, without paging it to the top', () => {
    /*
     * Aligning the item's BOTTOM keeps everything above it on screen, which is
     * the context a reader wants — the siblings they might click next. Aligning
     * its top would throw that away for no reason.
     */
    expect(nearestScrollTop({ ...port, itemTop: 600 })).toBe(256);
  });

  it('clamps at both ends', () => {
    // The first item cannot ask for a negative offset…
    expect(nearestScrollTop({ ...port, scrollTop: 500, itemTop: 0 })).toBe(0);
    // …and the last cannot ask past the end of the content.
    expect(nearestScrollTop({ ...port, itemTop: 1960 })).toBe(1600);
  });

  it('aligns the top of an item taller than the scrollport', () => {
    // Both edges cannot be satisfied at once; reading order wins.
    expect(nearestScrollTop({ ...port, itemTop: 700, itemHeight: 600 })).toBe(
      684,
    );
  });

  it('does nothing when there is nothing to scroll', () => {
    /*
     * Three ways this happens and all three are real: a nav shorter than its
     * column, a `display: none` ancestor, and jsdom — which reports every
     * dimension as zero, so without this the effect would compute a scroll for
     * every test that mounts a sidebar.
     */
    expect(
      nearestScrollTop({ ...port, itemTop: 900, scrollHeight: 400 }),
    ).toBeUndefined();
    expect(
      nearestScrollTop({
        ...port,
        itemTop: 900,
        viewHeight: 0,
        scrollHeight: 0,
      }),
    ).toBeUndefined();
    expect(
      nearestScrollTop({ ...port, itemTop: 900, scrollHeight: 200 }),
    ).toBeUndefined();
  });
});
