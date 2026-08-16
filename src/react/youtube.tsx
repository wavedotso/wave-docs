import type { ReactNode } from 'react';

export interface YouTubeProps {
  /** The 11-character video id, e.g. `dQw4w9WgXcQ`. */
  id?: string | undefined;
  /**
   * Accessible name for the player. Markdown carries no video title, so the
   * fallback is generic — pass a real one where you have it.
   */
  title?: string | undefined;
  className?: string | undefined;
}

const DEFAULT_TITLE = 'YouTube video player';

/**
 * Click-to-load YouTube embed, with **no client JavaScript at all**.
 *
 * An eager `<iframe>` costs ~137 KB of embed document plus ~580 KB gzipped of
 * player JavaScript on every page view, whether or not anyone presses play. A
 * facade costs one ~15 KB JPEG and loads the rest on demand.
 *
 * ## Why `<details>` and not `useState`
 *
 * This was a `'use client'` component, and that made it the one thing in
 * `defaultMarkdownComponents` that crossed the client boundary — so every page
 * carried a reference to it whether or not it embedded a video. Measured on
 * the smoke build over a corpus containing no YouTube URL anywhere: its code
 * was in a client chunk **referenced from the prerendered HTML and the flight
 * payload of every page**, and afterwards it is in no chunk at all.
 *
 * Be precise about the size, because the tempting number is the wrong one:
 * that chunk was 41 KB raw / 12.70 KB brotli, but it was a *shared* chunk and
 * most of it was not this component. Total client JavaScript went 610.8 KB to
 * 609.2 KB raw. The win here is a client boundary removed from the path every
 * consumer renders — one fewer hydration root, and a default map that is now
 * provably server-only — not a large byte saving.
 *
 * `<details>` does the same job in markup. Measured in Chromium: an
 * `<iframe loading="lazy">` inside a **closed** `<details>` issues no request
 * at all, and issues one the moment it opens — so the facade still defers the
 * player, without a state hook, a hydration root or a client reference. Native
 * also brings the keyboard handling and the disclosure semantics the button
 * version had to spell out.
 *
 * The summary stays in the DOM once open, visually hidden rather than removed:
 * removing the element under the reader's focus is what the old version needed
 * a `useEffect` to paper over, and a hidden-but-focusable control keeps focus
 * where the reader put it *and* leaves them a way to collapse it again.
 *
 * `hqdefault.jpg` rather than `maxresdefault.jpg` deliberately: maxres does not
 * exist for uploads below 1280×720 and 404s to a broken image with no fallback.
 */
export function YouTube({ id, title, className }: YouTubeProps): ReactNode {
  // Only reachable if the pipeline emitted a malformed element; a missing id
  // can only ever produce a broken player, so render nothing at all.
  if (!id) {
    return null;
  }

  // The id reaches us from markdown, so it is untrusted input being spliced
  // into a URL. Encoding it keeps a crafted "id" from adding query parameters
  // or escaping the path.
  const safeId = encodeURIComponent(id);
  // Blank is absent: `title=""` reaches us the same untrusted way `id` does,
  // and it would name the control "Play video:" and the frame nothing at all.
  const label = title?.trim() || DEFAULT_TITLE;
  const rootClassName = ['wave-docs-youtube', className]
    .filter(Boolean)
    .join(' ');

  return (
    <details className={rootClassName}>
      <summary className="wave-docs-youtube__facade">
        {/* biome-ignore lint/performance/noImgElement: a facade thumbnail is a
            remote YouTube URL on a host we do not control; routing it through
            an image optimiser buys nothing and this package cannot import
            `next/image` anyway. */}
        <img
          className="wave-docs-youtube__thumbnail"
          src={`https://i.ytimg.com/vi/${safeId}/hqdefault.jpg`}
          // Decorative: the summary's own text names the video.
          alt=""
          width={480}
          height={360}
          loading="lazy"
          decoding="async"
        />
        <span className="wave-docs-youtube__play" aria-hidden="true">
          <svg
            viewBox="0 0 68 48"
            width="68"
            height="48"
            aria-hidden="true"
            focusable="false"
          >
            <path
              className="wave-docs-youtube__play-bg"
              d="M66.52 7.74a8 8 0 0 0-5.65-5.66C56.1.99 34 .99 34 .99s-22.1 0-26.87 1.09a8 8 0 0 0-5.65 5.66C.39 12.51.39 24 .39 24s0 11.49 1.09 16.26a8 8 0 0 0 5.65 5.66C11.9 47 34 47 34 47s22.1 0 26.87-1.08a8 8 0 0 0 5.65-5.66C67.61 35.49 67.61 24 67.61 24s0-11.49-1.09-16.26"
            />
            <path
              className="wave-docs-youtube__play-arrow"
              d="M27 34V14l17 10z"
            />
          </svg>
        </span>
        {/*
         * Both labels ship, and CSS shows one. The control said "Play video"
         * in every state, including the state where activating it stops the
         * video — a control that misreports what it does, to precisely the
         * reader who cannot see that the player is already open. The open/closed
         * state is in the DOM, so `[open]` picks the right one and no script is
         * involved; `display: none` is what keeps the other out of the
         * accessibility tree rather than merely off-screen.
         */}
        <span className="wave-docs-sr-only wave-docs-youtube__label-play">
          {`Play video: ${label}`}
        </span>
        <span className="wave-docs-youtube__label-hide">{`Hide video: ${label}`}</span>
      </summary>
      <iframe
        className="wave-docs-youtube__frame"
        /*
         * `loading="lazy"` is LOAD-BEARING, not an optimisation. It is the only
         * reason a closed `<details>` costs nothing: an eager iframe inside one
         * is fetched immediately in every engine tested, which would make this
         * an eager embed wearing a facade's markup — the exact 717 KB the
         * component exists to avoid, now invisible in review.
         */
        loading="lazy"
        /*
         * `youtube-nocookie.com` defers the tracking cookie until playback,
         * which is what makes this embeddable without a consent banner.
         *
         * `autoplay=1` because the reader has already asked. A click-to-load
         * facade whose click only *loads* costs two clicks to watch a video —
         * the reader presses play, gets a player showing a play button, and
         * presses play again. That is the one interaction this component
         * exists to own, and getting it wrong makes the facade feel like a
         * bug rather than a courtesy.
         *
         * It is not an autoplaying embed: the iframe does not exist until the
         * `<details>` opens, so nothing plays until someone opens it. Browsers
         * gate unmuted autoplay on a user gesture, and opening the disclosure
         * *is* that gesture — which is exactly why this is allowed here and
         * would not be on a page-load embed.
         */
        src={`https://www.youtube-nocookie.com/embed/${safeId}?rel=0&autoplay=1`}
        title={label}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
    </details>
  );
}
