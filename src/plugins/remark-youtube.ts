/**
 * Turn a paragraph containing only a bare YouTube URL into a `<youtube>` node.
 *
 * ⚠️ THIS USED TO HAPPEN IN THE ANCHOR COMPONENT, AND THAT PRODUCED INVALID
 * HTML. `createAnchor` returned `<YouTube>` when it recognised a bare URL — but
 * an anchor is inside its paragraph, and `YouTube` renders a `<div>`. So the
 * server emitted `<p><div class="wave-docs-youtube">…</div></p>`, the browser's
 * parser closed the paragraph early because a `div` is not phrasing content,
 * and the DOM stopped matching what was rendered. React 19 reports that as a
 * hydration mismatch and re-renders the root — on the feature the README
 * advertises.
 *
 * `remark-unwrap-images` beside this file was written to prevent exactly that
 * failure for images, and documents it at length. This is the same bug with a
 * different element, so it gets the same answer: fix the TREE, not the
 * renderer.
 *
 * IT ALSO MAKES THE PUBLIC TYPE TRUE. `MarkdownComponents.youtube` exists and
 * was unreachable — a consumer passing `components={{ youtube: MyPlayer }}`
 * type-checked, merged, and was silently ignored, because nothing ever emitted
 * a `youtube` element for the map to match. Emitting one here is what connects
 * the option to the output.
 *
 * And it takes the detection off the render path: `parseYouTubeRef` and the
 * bare-URL check ran per anchor, in a module that ships to the browser. They
 * now run once per document, in Node, at build time.
 */

import type { Paragraph, Root, RootContent } from 'mdast';
import type { Plugin } from 'unified';
import { SKIP, visit } from 'unist-util-visit';

/** YouTube ids are exactly eleven URL-safe characters. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** `https://` or `http://`, for comparing a label against its own href. */
const HTTP_SCHEME = /^https?:\/\//i;

/** A playlist id, conservatively: what YouTube uses and nothing else. */
const PLAYLIST_ID = /^[A-Za-z0-9_-]{2,64}$/;

/**
 * `1h2m3s`, `90s`, `90` — every spelling YouTube's own `t` parameter takes.
 */
const TIMESTAMP = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/;

/** What a YouTube URL says, beyond which video it is. */
export interface YouTubeRef {
  id: string;
  /** Seconds to start at, from `t` or `start`. */
  start?: number | undefined;
  /** Playlist the video was linked inside, from `list`. */
  list?: string | undefined;
}

/**
 * Seconds from a `t`/`start` value, or `undefined` if it is not one.
 *
 * YouTube accepts `t=90`, `t=90s` and `t=1m30s`, and an author linking to a
 * moment in a talk pastes whichever the share dialog gave them.
 */
function parseTimestamp(value: string | null): number | undefined {
  if (value === null || value === '') return undefined;

  const match = TIMESTAMP.exec(value);
  if (match === null) return undefined;

  const [, hours, minutes, seconds] = match;
  const total =
    Number(hours ?? 0) * 3600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0);

  return Number.isFinite(total) && total > 0 ? total : undefined;
}

/**
 * Extract a video reference from a YouTube watch/short/embed URL.
 *
 * Returns `undefined` for anything else, including YouTube URLs that are not a
 * single video (channels, playlists) — those stay ordinary links.
 *
 * ⚠️ THE TIMESTAMP AND THE PLAYLIST ARE PART OF THE LINK, AND WERE DROPPED. Only
 * the id survived, so `https://youtu.be/x?t=754` — a link to one specific moment
 * in a two-hour talk, which is most of why anyone deep-links a video — opened at
 * zero. And because the facade passes `autoplay=1`, it did not merely start in
 * the wrong place: it started *playing* in the wrong place, so the reader had to
 * work out that the author had meant somewhere else.
 */
export function parseYouTubeRef(href: string): YouTubeRef | undefined {
  let url: URL;
  try {
    url = new URL(href, 'https://example.invalid');
  } catch {
    return undefined;
  }

  const host = url.hostname.replace(/^(www|m)\./, '');
  const segments = url.pathname.split('/').filter(Boolean);

  /*
   * `t` on a watch or short link, `start` on an embed — YouTube's own two names
   * for the same thing. The fragment carries it too on older share links
   * (`#t=1m30s`), and `URL` hands that over as `url.hash`.
   */
  const extras = (): Omit<YouTubeRef, 'id'> => {
    const start =
      parseTimestamp(url.searchParams.get('t')) ??
      parseTimestamp(url.searchParams.get('start')) ??
      parseTimestamp(url.hash.replace(/^#t=/, '') || null);
    const list = url.searchParams.get('list');

    return {
      ...(start === undefined ? {} : { start }),
      ...(list !== null && PLAYLIST_ID.test(list) ? { list } : {}),
    };
  };

  if (host === 'youtu.be') {
    const [id] = segments;
    return id !== undefined && VIDEO_ID.test(id)
      ? { id, ...extras() }
      : undefined;
  }

  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') {
    return undefined;
  }

  if (url.pathname === '/watch') {
    const id = url.searchParams.get('v');
    return id !== null && VIDEO_ID.test(id) ? { id, ...extras() } : undefined;
  }

  const [prefix, id] = segments;
  if ((prefix === 'embed' || prefix === 'shorts') && id !== undefined) {
    return VIDEO_ID.test(id) ? { id, ...extras() } : undefined;
  }

  return undefined;
}

/** Whitespace-only text is what separates two links on consecutive lines. */
function isIgnorable(node: RootContent): boolean {
  return node.type === 'text' && node.value.trim() === '';
}

/**
 * Is this link a BARE URL rather than a labelled one?
 *
 * `[the intro](https://youtu.be/x)` keeps its label and stays a link; only a
 * link whose visible text IS its own href becomes a video. Compared with the
 * scheme and any trailing slash removed, because a markdown autolink often
 * drops the scheme from the label.
 */
function isBareUrl(node: Paragraph['children'][number]): boolean {
  if (node.type !== 'link' || node.children.length !== 1) {
    return false;
  }

  const [only] = node.children;
  if (only === undefined || only.type !== 'text') {
    return false;
  }

  const strip = (value: string) =>
    value.replace(HTTP_SCHEME, '').replace(/\/$/, '');

  return strip(only.value) === strip(node.url);
}

/**
 * remark plugin. Replaces the whole PARAGRAPH, not the link inside it — which
 * is the point: leaving the paragraph is what nested a block element in
 * phrasing content.
 *
 * `data.hName` / `data.hProperties` is how `mdast-util-to-hast` is told to
 * serialise a node as something other than its default, so the output is a
 * plain hast element and the React layer maps it like any other.
 */
export const remarkYouTube: Plugin<[], Root> = () => {
  return (tree: Root): undefined => {
    visit(tree, 'paragraph', (node, index, parent) => {
      if (parent === undefined || index === undefined) {
        return;
      }

      const meaningful = node.children.filter((child) => !isIgnorable(child));
      const only = meaningful[0];

      if (meaningful.length !== 1 || only === undefined || !isBareUrl(only)) {
        return;
      }

      // Narrowed by `isBareUrl`, which returns false for anything but a link.
      const ref = only.type === 'link' ? parseYouTubeRef(only.url) : undefined;

      if (ref === undefined) {
        return;
      }

      (parent.children as RootContent[])[index] = {
        type: 'paragraph',
        children: [],
        data: {
          hName: 'youtube',
          hProperties: {
            id: ref.id,
            // Omitted rather than emitted empty: an attribute is markup, and
            // `start="undefined"` would reach the embed URL as a literal.
            ...(ref.start === undefined ? {} : { start: ref.start }),
            ...(ref.list === undefined ? {} : { list: ref.list }),
          },
        },
      };

      // The replacement sits at the same index; re-visiting walks an empty node.
      return [SKIP, index + 1];
    });

    return undefined;
  };
};
