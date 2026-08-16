/**
 * The two things that make a no-JavaScript video facade a facade.
 *
 * Neither is observable in jsdom: one is a network request, the other is
 * `<summary>`'s native keyboard activation, which jsdom does not implement.
 * Without this file both would be verified by reading a specification — and
 * the first of them is the entire reason the component exists, so "probably
 * lazy" is not good enough.
 *
 * Runs only under `pnpm test:browser`.
 */

import { render } from '@testing-library/react';
import { page, userEvent } from 'vitest/browser';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import styles from '../styles.css?inline';
import { YouTube } from './youtube.js';

const VIDEO_ID = 'dQw4w9WgXcQ';

/*
 * The real stylesheet, because two of the claims below are made by CSS alone:
 * the open facade is visually hidden, and it comes back when it has focus.
 * Without the sheet those tests would render an unstyled `<summary>` and pass
 * against any stylesheet at all, including one with neither rule in it.
 */
beforeAll(() => {
  const style = document.createElement('style');
  style.textContent = styles;
  document.head.append(style);
});

/** Every URL the page has requested since the observer started. */
function watchRequests(): () => string[] {
  const seen: string[] = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) seen.push(entry.name);
  });
  observer.observe({ entryTypes: ['resource'] });
  return () => [...seen];
}

const details = (): HTMLDetailsElement =>
  document.querySelector('details') as HTMLDetailsElement;

beforeEach(async () => {
  document.body.innerHTML = '';
  await page.viewport(1024, 800);
});

describe('the YouTube facade', () => {
  it('requests no player while it is closed', async () => {
    const requests = watchRequests();
    render(<YouTube id={VIDEO_ID} />);

    await new Promise((resolve) => {
      setTimeout(resolve, 300);
    });

    /*
     * ⚠️ THE MEASUREMENT THE WHOLE DESIGN RESTS ON. The iframe is in the
     * markup from the start, because there is no JavaScript to insert it
     * later — so the only thing standing between a reader and ~717 KB of
     * player is `loading="lazy"` inside a closed `<details>`. Measured: an
     * eager iframe in the same position IS fetched immediately.
     */
    expect(
      requests().filter((url) => url.includes('youtube-nocookie')),
    ).toHaveLength(0);
  });

  it('opens on Enter and fetches the player then, not before', async () => {
    const requests = watchRequests();
    render(<YouTube id={VIDEO_ID} />);

    // Native keyboard support, which is half the argument for `<details>`:
    // the button version had to spell this out and test it.
    await userEvent.keyboard('{Tab}');
    await userEvent.keyboard('{Enter}');

    expect(details().open).toBe(true);
    await expect
      .poll(() => requests().some((url) => url.includes('youtube-nocookie')))
      .toBe(true);
  });

  it('leaves focus on the control it just opened', async () => {
    /*
     * The client version unmounted the button under the reader's focus and
     * needed an effect to recover. Here the summary is only visually hidden,
     * so focus is never orphaned — and the reader keeps a way to collapse it.
     */
    render(<YouTube id={VIDEO_ID} />);
    const summary = document.querySelector('summary');

    await userEvent.keyboard('{Tab}');
    await userEvent.keyboard('{Enter}');

    expect(details().open).toBe(true);
    expect(document.activeElement).toBe(summary);
  });

  it('keeps that focus visible, instead of parking it on a 1px element', async () => {
    /*
     * ⚠️ THE OTHER HALF OF THE TEST ABOVE, AND IT WAS MISSING. "Focus stays on
     * the summary" was asserted while the open state clipped that summary to
     * 1×1 unconditionally — so the assertion above was pinning a WCAG 2.4.7
     * failure in place: press Enter, and the focus indicator disappears from
     * the page with no way to tell that the next Enter collapses the player.
     *
     * Sizes, not the rule: `getComputedStyle().clipPath` would pass against a
     * rule that revealed the element and left it 1px square, and a reader can
     * see neither.
     */
    render(<YouTube id={VIDEO_ID} title="How caching works" />);
    const summary = document.querySelector('summary');
    if (summary === null) throw new Error('no summary');

    await userEvent.keyboard('{Tab}');
    await userEvent.keyboard('{Enter}');

    const box = summary.getBoundingClientRect();
    expect(box.width).toBeGreaterThan(40);
    expect(box.height).toBeGreaterThan(20);
    expect(getComputedStyle(summary).clipPath).toBe('none');
  });

  it('renames the control to match what activating it now does', async () => {
    /*
     * A `<summary>` reading "Play video" while activating it *stops* the video
     * lies to exactly the reader who cannot see that the player is open. Both
     * labels are in the markup and `[open]` picks one — `display: none`, so the
     * other leaves the accessibility tree rather than merely the viewport.
     */
    render(<YouTube id={VIDEO_ID} title="How caching works" />);
    const summary = document.querySelector('summary');
    if (summary === null) throw new Error('no summary');

    expect(summary.innerText).toContain('Play video: How caching works');
    expect(summary.innerText).not.toContain('Hide video');

    await userEvent.keyboard('{Tab}');
    await userEvent.keyboard('{Enter}');

    expect(summary.innerText).toContain('Hide video: How caching works');
    expect(summary.innerText).not.toContain('Play video');
  });
});
