import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { YouTube } from './youtube.js';

const VIDEO_ID = 'dQw4w9WgXcQ';

/**
 * An `<iframe>` maps to no ARIA role, so there is no `getByRole` for it and a
 * `title` query would presume the title the component chose. Query the DOM.
 */
function getFrame(): HTMLIFrameElement {
  const frame = document.querySelector('iframe');
  if (frame === null) {
    throw new Error('expected a player iframe in the document');
  }
  return frame;
}

function getDetails(): HTMLDetailsElement {
  const details = document.querySelector('details');
  if (details === null) {
    throw new Error('expected a disclosure in the document');
  }
  return details;
}

function getThumbnail(): HTMLImageElement {
  const image = document.querySelector('img');
  if (image === null) {
    throw new Error('expected a facade thumbnail in the document');
  }
  return image;
}

describe('YouTube', () => {
  it('ships no client JavaScript', () => {
    /*
     * The whole point of the rewrite. As a `'use client'` component this was
     * the one thing in `defaultMarkdownComponents` crossing the client
     * boundary, so every page carried a reference to it whether or not it
     * embedded a video — measured on a corpus with no YouTube URL in it
     * anywhere, its code was in a client chunk the prerendered HTML pointed at.
     *
     * `renderToStaticMarkup` is the assertion: a client component cannot be
     * rendered this way at all, and a `<details>` needs no hook to work.
     */
    const html = renderToStaticMarkup(<YouTube id={VIDEO_ID} />);

    expect(html).toContain('<details');
    expect(html).toContain('<iframe');
    expect(html).not.toContain('<button');
  });

  it('starts closed, with the player deferred', () => {
    render(<YouTube id={VIDEO_ID} />);

    /*
     * The iframe is in the markup now — it has to be, with no JavaScript to
     * insert it later — and `loading="lazy"` is what stops it being fetched.
     * Measured in Chromium: an eager iframe inside a closed `<details>` is
     * requested immediately, a lazy one is not requested until it opens. jsdom
     * cannot see a network request, so the deferral itself is asserted in
     * `youtube.browser.test.tsx`; what belongs here is that the attribute the
     * deferral depends on is present at all.
     */
    expect(getDetails().open).toBe(false);
    expect(getFrame()).toHaveAttribute('loading', 'lazy');
    expect(getThumbnail()).toBeInTheDocument();
  });

  it('requests the thumbnail every upload has', () => {
    render(<YouTube id={VIDEO_ID} />);

    // `maxresdefault` does not exist below 1280×720 and 404s to a broken
    // image with no fallback.
    expect(getThumbnail().src).toBe(
      `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`,
    );
  });

  it('names the video it is about to play', () => {
    render(<YouTube id={VIDEO_ID} title="How caching works" />);

    expect(
      screen.getByText('Play video: How caching works'),
    ).toBeInTheDocument();
    expect(getFrame()).toHaveAttribute('title', 'How caching works');
  });

  it('falls back to a generic name when markdown carries no title', () => {
    render(<YouTube id={VIDEO_ID} />);

    expect(
      screen.getByText('Play video: YouTube video player'),
    ).toBeInTheDocument();
  });

  it('falls back to a generic name when the title is blank', () => {
    // `title=""` reaches this the same untrusted way `id` does, and would
    // otherwise name the control "Play video:" and the frame nothing at all.
    render(<YouTube id={VIDEO_ID} title="   " />);

    expect(
      screen.getByText('Play video: YouTube video player'),
    ).toBeInTheDocument();
    expect(getFrame()).toHaveAttribute('title', 'YouTube video player');
  });

  it('opens on click, with no handler of ours', async () => {
    const user = userEvent.setup();
    render(<YouTube id={VIDEO_ID} />);

    await user.click(screen.getByText(/^Play video:/));

    expect(getDetails().open).toBe(true);
  });

  /*
   * Enter/Space on the summary, and where focus lands after it opens, are in
   * `youtube.browser.test.tsx`. jsdom implements `<summary>`'s click toggle
   * but not its keyboard activation, so asserting it here would assert
   * nothing — and the deferral those keys are supposed to trigger is a network
   * request jsdom cannot see either.
   */

  it('keeps a crafted id inside the embed path', () => {
    // The id comes from markdown, so it is untrusted input spliced into a URL.
    render(<YouTube id="abc?autoplay=1&evil=1" />);

    const src = getFrame().src;
    expect(src).toContain('abc%3Fautoplay%3D1%26evil%3D1');
    expect(src.startsWith('https://www.youtube-nocookie.com/embed/')).toBe(
      true,
    );
    // Encoded, so the crafted parameters are path characters rather than
    // query. `autoplay` is ours and appears once; `evil` never becomes one.
    const query = new URL(src).searchParams;
    expect(query.get('autoplay')).toBe('1');
    expect(query.has('evil')).toBe(false);
  });

  it('asks the player to start, because the reader already pressed play', () => {
    /*
     * Without `autoplay=1` a click-to-load facade costs two clicks: the reader
     * presses play, gets a player showing a play button, and presses play
     * again. This is the one interaction the component owns.
     *
     * Not an autoplaying embed — the iframe is inside a closed `<details>`
     * with `loading="lazy"`, so nothing is fetched, let alone played, until
     * someone opens it. That opening is the user gesture browsers gate unmuted
     * autoplay on, which is why it is allowed here and would not be on a
     * page-load embed.
     */
    render(<YouTube id={VIDEO_ID} />);

    expect(new URL(getFrame().src).searchParams.get('autoplay')).toBe('1');
    expect(getFrame().getAttribute('loading')).toBe('lazy');
    expect(getFrame().closest('details')?.open).toBe(false);
  });

  it('renders nothing when the pipeline emitted no id', () => {
    const { container } = render(<YouTube />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders a block root, which is why the paragraph is replaced upstream', () => {
    // A `<details>` inside a `<p>` is invalid HTML and hydrates as a mismatch;
    // `remarkYouTube` lifts the node out of its paragraph for this reason.
    const html = renderToStaticMarkup(<YouTube id={VIDEO_ID} />);

    expect(html.startsWith('<details')).toBe(true);
  });
});

it('puts the timestamp and the playlist in the embed URL', () => {
  const { container } = render(
    <YouTube id="dQw4w9WgXcQ" start={754} list="PLabcdef123" />,
  );
  const src = container.querySelector('iframe')?.getAttribute('src') ?? '';
  const url = new URL(src);

  expect(url.searchParams.get('start')).toBe('754');
  expect(url.searchParams.get('list')).toBe('PLabcdef123');
  // The two that were already there, and still have to be.
  expect(url.searchParams.get('autoplay')).toBe('1');
  expect(url.searchParams.get('rel')).toBe('0');
});

it('adds neither parameter when the link carried neither', () => {
  const { container } = render(<YouTube id="dQw4w9WgXcQ" />);
  const url = new URL(
    container.querySelector('iframe')?.getAttribute('src') ?? '',
  );

  expect(url.searchParams.has('start')).toBe(false);
  expect(url.searchParams.has('list')).toBe(false);
});

it('builds the URL with URLSearchParams, so a crafted playlist cannot inject', () => {
  /*
   * `list` comes out of a document and goes into a URL. The plugin refuses a
   * shape like this before it gets here, and this is the second layer: built by
   * hand, `list=x%26autoplay%3D0` would have decoded into a real `&autoplay=0`
   * and silently turned the facade's one interaction off.
   */
  const { container } = render(
    <YouTube id="dQw4w9WgXcQ" list="x&autoplay=0" />,
  );
  const url = new URL(
    container.querySelector('iframe')?.getAttribute('src') ?? '',
  );

  expect(url.searchParams.get('autoplay')).toBe('1');
  expect(url.searchParams.get('list')).toBe('x&autoplay=0');
});
