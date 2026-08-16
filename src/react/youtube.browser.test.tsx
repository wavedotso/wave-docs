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
import { beforeEach, describe, expect, it } from 'vitest';

import { YouTube } from './youtube.js';

const VIDEO_ID = 'dQw4w9WgXcQ';

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
});
