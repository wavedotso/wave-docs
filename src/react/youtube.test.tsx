import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

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

function getThumbnail(): HTMLImageElement {
  const image = document.querySelector('img');
  if (image === null) {
    throw new Error('expected a facade thumbnail in the document');
  }
  return image;
}

describe('YouTube', () => {
  it('loads no player at all until the reader asks for one', () => {
    render(<YouTube id={VIDEO_ID} />);

    // The entire reason this component exists: an eager embed costs ~700 KB
    // per video on every page view, pressed or not.
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('button')).toBeInTheDocument();
    expect(getThumbnail()).toBeInTheDocument();
  });

  it('requests the thumbnail every upload has', () => {
    render(<YouTube id={VIDEO_ID} />);

    // `maxresdefault.jpg` does not exist below 1280×720 and 404s to a broken
    // image with no fallback, which is worse than a soft-looking thumbnail.
    expect(getThumbnail().src).toBe(
      `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`,
    );
  });

  it('names the video it is about to play', () => {
    render(<YouTube id={VIDEO_ID} title="Deploying to Vercel" />);

    expect(
      screen.getByRole('button', { name: 'Play video: Deploying to Vercel' }),
    ).toBeInTheDocument();
  });

  it('falls back to a generic name when markdown carries no title', () => {
    render(<YouTube id={VIDEO_ID} />);

    expect(
      screen.getByRole('button', { name: 'Play video: YouTube video player' }),
    ).toBeInTheDocument();
  });

  it('falls back to a generic name when the title is blank', () => {
    // `title` arrives as an unvalidated attribute like `type` does, and a blank
    // one would leave the button announced as "Play video:" — a name with no
    // object. Empty is absent.
    render(<YouTube id={VIDEO_ID} title="   " />);

    expect(
      screen.getByRole('button', { name: 'Play video: YouTube video player' }),
    ).toBeInTheDocument();
  });

  it('swaps in the nocookie player when the button is clicked', async () => {
    const user = userEvent.setup();
    render(<YouTube id={VIDEO_ID} title="Deploying to Vercel" />);

    await user.click(screen.getByRole('button'));

    const frame = getFrame();
    // `youtube-nocookie.com` is what makes this embeddable with no consent
    // banner; a slip back to `youtube.com` sets a tracking cookie on load.
    expect(frame.src).toContain('https://www.youtube-nocookie.com/embed/');
    expect(frame.src).toContain(VIDEO_ID);
    // Nobody presses play twice.
    expect(frame.src).toContain('autoplay=1');
    expect(frame.title).toBe('Deploying to Vercel');
    expect(frame).toHaveAttribute('allowfullscreen');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('starts playback when Enter is pressed on the focused button', async () => {
    const user = userEvent.setup();
    render(<YouTube id={VIDEO_ID} />);

    screen.getByRole('button').focus();
    await user.keyboard('{Enter}');

    // Free from a real `<button>`, and absent from the `div` + `onClick` this
    // could have been — which is the point of asserting it.
    expect(getFrame().src).toContain('autoplay=1');
  });

  it('starts playback when Space is pressed on the focused button', async () => {
    const user = userEvent.setup();
    render(<YouTube id={VIDEO_ID} />);

    screen.getByRole('button').focus();
    await user.keyboard('[Space]');

    expect(getFrame().src).toContain('autoplay=1');
  });

  it('moves focus into the player that replaced the button', async () => {
    const user = userEvent.setup();
    render(<YouTube id={VIDEO_ID} />);

    await user.click(screen.getByRole('button'));

    // The button unmounted under the reader's focus. Without the ref handing it
    // to the frame, a keyboard user is dropped at the top of the document.
    expect(document.activeElement).toBe(getFrame());
  });

  it('leaves focus alone once the reader has moved it on', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<YouTube id={VIDEO_ID} />);
    await user.click(screen.getByRole('button'));
    expect(document.activeElement).toBe(getFrame());

    const elsewhere = document.createElement('input');
    document.body.append(elsewhere);
    elsewhere.focus();

    // Any unrelated parent state change re-renders the playing branch — a theme
    // toggle, a version switcher, `router.refresh()`. Moving focus from an
    // inline `ref` callback made every one of them steal the keyboard back:
    // the callback's identity changes each render, so React detaches it and
    // calls the new one, mid-sentence into whatever the reader was typing.
    rerender(<YouTube id={VIDEO_ID} title="Deploying to Vercel" />);

    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it('keeps a crafted id inside the embed path', async () => {
    const user = userEvent.setup();
    render(<YouTube id="../../watch?v=x&autoplay=0" />);

    await user.click(screen.getByRole('button'));

    // The id comes from markdown. Encoded, it can add no parameters and climb
    // out of no path.
    expect(getFrame().src).toBe(
      'https://www.youtube-nocookie.com/embed/' +
        '..%2F..%2Fwatch%3Fv%3Dx%26autoplay%3D0?autoplay=1&rel=0',
    );
  });

  it('renders nothing when the pipeline emitted no id', () => {
    const { container } = render(<YouTube />);

    // A player with no video can only be a broken player.
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a block root, which is why the paragraph is replaced upstream', () => {
    // The shipped bug, reproduced through the parser that caused it: React
    // builds `<p><div>` happily with `appendChild`, but the HTML parser closes
    // the paragraph at the `<div>`, so the hydrated DOM stops matching the
    // server output and React 19 remounts the root.
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = renderToStaticMarkup(
      <p>
        <YouTube id={VIDEO_ID} />
      </p>,
    );
    warn.mockRestore();

    const host = document.createElement('div');
    host.innerHTML = html;

    expect(host.querySelector('p > .wave-docs-youtube')).toBeNull();
    // Ejected to a sibling of the paragraph it was written inside.
    expect(host.querySelector(':scope > .wave-docs-youtube')).not.toBeNull();
  });
});
