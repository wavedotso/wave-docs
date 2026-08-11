'use client';

import { useState } from 'react';
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
 * Click-to-load YouTube embed.
 *
 * An eager `<iframe>` costs ~137 KB of embed document plus ~580 KB gzipped of
 * player JavaScript, on every page view, whether or not anyone presses play.
 * A facade costs one ~15 KB JPEG and loads the rest on demand. On a docs page
 * with three videos that is the difference between a good Lighthouse score and
 * a bad one.
 *
 * `hqdefault.jpg` rather than `maxresdefault.jpg` deliberately: maxres does not
 * exist for uploads below 1280×720 and 404s to a broken image with no fallback.
 */
export function YouTube({ id, title, className }: YouTubeProps): ReactNode {
  const [isPlaying, setIsPlaying] = useState(false);

  // Only reachable if the pipeline emitted a malformed element; a missing id
  // can only ever produce a broken player, so render nothing at all.
  if (!id) {
    return null;
  }

  // The id reaches us from markdown, so it is untrusted input being spliced
  // into a URL. Encoding it keeps a crafted "id" from adding query parameters
  // or escaping the path.
  const safeId = encodeURIComponent(id);
  const label = title ?? DEFAULT_TITLE;
  const rootClassName = ['wave-docs-youtube', className]
    .filter(Boolean)
    .join(' ');

  if (isPlaying) {
    return (
      <div className={rootClassName}>
        <iframe
          className="wave-docs-youtube__frame"
          // `youtube-nocookie.com` defers the tracking cookie until playback,
          // which is what makes this embeddable without a consent banner.
          src={`https://www.youtube-nocookie.com/embed/${safeId}?autoplay=1&rel=0`}
          title={label}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          // The button that triggered this just unmounted, so without moving
          // focus a keyboard user is dropped back at the top of the document.
          ref={(node) => {
            node?.focus();
          }}
        />
      </div>
    );
  }

  return (
    <div className={rootClassName}>
      <button
        type="button"
        className="wave-docs-youtube__facade"
        onClick={() => setIsPlaying(true)}
        aria-label={`Play video: ${label}`}
      >
        {/* biome-ignore lint/performance/noImgElement: a facade thumbnail is a
            remote YouTube URL on a host we do not control; routing it through
            an image optimiser buys nothing and this package cannot import
            `next/image` anyway. */}
        <img
          className="wave-docs-youtube__thumbnail"
          src={`https://i.ytimg.com/vi/${safeId}/hqdefault.jpg`}
          // Decorative: the button's own label names the video.
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
      </button>
    </div>
  );
}
