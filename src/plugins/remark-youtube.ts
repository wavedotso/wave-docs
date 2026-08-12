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
 * And it takes the detection off the render path: `parseYouTubeId` and the
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

/**
 * Extract a video id from a YouTube watch/short/embed URL.
 *
 * Returns `undefined` for anything else, including YouTube URLs that are not a
 * single video (channels, playlists) — those stay ordinary links.
 */
export function parseYouTubeId(href: string): string | undefined {
  let url: URL;
  try {
    url = new URL(href, 'https://example.invalid');
  } catch {
    return undefined;
  }

  const host = url.hostname.replace(/^(www|m)\./, '');
  const segments = url.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be') {
    const [id] = segments;
    return id !== undefined && VIDEO_ID.test(id) ? id : undefined;
  }

  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') {
    return undefined;
  }

  if (url.pathname === '/watch') {
    const id = url.searchParams.get('v');
    return id !== null && VIDEO_ID.test(id) ? id : undefined;
  }

  const [prefix, id] = segments;
  if ((prefix === 'embed' || prefix === 'shorts') && id !== undefined) {
    return VIDEO_ID.test(id) ? id : undefined;
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
      const id = only.type === 'link' ? parseYouTubeId(only.url) : undefined;

      if (id === undefined) {
        return;
      }

      (parent.children as RootContent[])[index] = {
        type: 'paragraph',
        children: [],
        data: { hName: 'youtube', hProperties: { id } },
      };

      // The replacement sits at the same index; re-visiting walks an empty node.
      return [SKIP, index + 1];
    });

    return undefined;
  };
};
