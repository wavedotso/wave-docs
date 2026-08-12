/**
 * Rewrite internal markdown links to site routes.
 *
 * `[auth](./api/auth.md)` is the *correct* way to link between markdown files:
 * it works in the GitHub file browser, in an editor preview, and in every
 * markdown linter. It also 404s on the published site, and because it works
 * everywhere the author looks, nobody notices until a reader complains. The
 * same applies to extensionless relative links (`[users](../api/users)`),
 * which resolve against the wrong directory once the page is a route.
 *
 * So: resolve relative to the containing document, drop the extension,
 * collapse `/index`, keep `?query` and `#anchor`, and leave anything absolute
 * or external alone. Every rewritten href is recorded on the file so the
 * caller can assert the target exists instead of shipping a dead link.
 */

import type { Root } from 'mdast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';
import type { VFile } from 'vfile';
import type { DocLinkContext, LinkResolver } from '../types.js';

/**
 * Where a link was found and what it resolved to.
 *
 * `href` is `undefined` when resolution failed — an unknown resolver result,
 * or a `../` chain that climbs out of the content root. That is a distinct
 * condition from "resolved but the page does not exist", and the caller
 * reports them differently.
 */
export interface DocLinkRef {
  /** The href exactly as authored, e.g. `'./api/auth.md'`. */
  raw: string;
  /** Resolved route including `?query` and `#anchor`, or `undefined`. */
  href: string | undefined;
  /** 1-based line in the source markdown, when the parser recorded one. */
  line?: number;
}

/**
 * Identity of the document currently being processed.
 *
 * Passed through `file.data` rather than plugin options so a single frozen
 * processor can render every page. Constructing a processor per file is the
 * obvious mistake here and it costs more than the parse does.
 *
 * DECLARED IN `types.ts` NOW, because it is the second argument of both public
 * resolvers and a consumer has to be able to name it. Re-exported here so the
 * plugin still reads as self-contained.
 */
export type { DocLinkContext } from '../types.js';

declare module 'vfile' {
  interface DataMap {
    /** Set by the caller before running the processor. */
    docLinkContext: DocLinkContext;
    /** Appended to by {@link remarkDocLinks}. */
    docLinks: DocLinkRef[];
  }
}

export interface RemarkDocLinksOptions {
  /** URL prefix the docs are mounted at, e.g. `'/docs'`. */
  basePath: string;
  /** Overrides the built-in resolution entirely, for every relative link. */
  resolve?: LinkResolver;
}

/** `scheme:` — matches `https:`, `mailto:`, `tel:`, `data:`. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** Splits `path?query#hash`; every group is optional. */
const HREF_PARTS = /^([^?#]*)(\?[^#]*)?(#.*)?$/;
const MARKDOWN_EXTENSION = /\.mdx?$/i;
/** A dot-extension on the final segment, e.g. `.png` in `img/logo.png`. */
const FILE_EXTENSION = /\.[^./]+$/;

/**
 * Does this href point at another page in the same docs tree?
 *
 * Absolute paths are already routes, in-page anchors are already correct, and
 * anything with a scheme belongs to someone else. A path-less href — `?tab=json`
 * — addresses the current page and is left alone for the same reason `#anchor`
 * is: there is nothing to resolve, and resolving it to `undefined` would fail
 * the build with advice the author cannot act on.
 */
function isRelativeLink(href: string): boolean {
  return (
    href !== '' &&
    !href.startsWith('#') &&
    !href.startsWith('?') &&
    !href.startsWith('/') &&
    !HAS_SCHEME.test(href)
  );
}

/**
 * Fold `.` and `..` against a starting directory.
 *
 * Hand-rolled rather than `path.resolve` because these are URL paths, not
 * filesystem paths: they must use `/` on Windows and must not pick up the
 * process working directory. Returns `undefined` when the chain climbs above
 * the content root, which is always an authoring error worth surfacing.
 *
 * EXPORTED as part of the wrap-don't-replace surface. Getting `../` right is
 * the fiddly half of writing a {@link LinkResolver}, and a host that reuses
 * this cannot disagree with the built-in resolver about where a link points.
 * It is also what `render.ts` folds image sources with, so links and images
 * are contained by one implementation rather than two.
 */
export function foldSegments(
  from: readonly string[],
  path: string,
): string[] | undefined {
  const out = [...from];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') {
      continue;
    }
    if (part === '..') {
      if (out.length === 0) {
        return undefined;
      }
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out;
}

/** Join route segments onto the base path, e.g. `('/docs', ['api'])`. */
function toRoute(basePath: string, segments: readonly string[]): string {
  const base = basePath.replace(/\/+$/, '');
  const path = segments.join('/');
  if (path === '') {
    return base === '' ? '/' : base;
  }
  return `${base}/${path}`;
}

/**
 * The built-in {@link LinkResolver}: markdown file path in, route out.
 *
 * Exported for reuse by hosts that want to wrap rather than replace it.
 */
export function resolveMarkdownLink(
  href: string,
  fromDir: readonly string[],
  basePath: string,
): string | undefined {
  const parts = HREF_PARTS.exec(href);
  const path = parts?.[1] ?? '';
  const query = parts?.[2] ?? '';
  const hash = parts?.[3] ?? '';

  if (path === '') {
    return undefined;
  }

  const segments = foldSegments(fromDir, path);
  if (segments === undefined) {
    return undefined;
  }

  const last = segments.at(-1);
  if (last !== undefined) {
    const stripped = last.replace(MARKDOWN_EXTENSION, '');
    if (stripped === 'index') {
      // `./api/index.md` and `./api/` are both the directory's own page.
      segments.pop();
    } else {
      segments[segments.length - 1] = stripped;
    }
  }

  return `${toRoute(basePath, segments)}${query}${hash}`;
}

/**
 * Is this relative href pointing at an asset rather than a page?
 *
 * A link to `./diagram.svg` or `./schema.sql` is a download, not a route, and
 * rewriting it would break it. Markdown extensions are pages; any other
 * extension on the final segment is an asset; no extension is a page.
 * The false positive is a page literally named `v2.0`, which is rare enough
 * to accept and is fixed by writing `v2.0.md`.
 */
function isAssetLink(href: string): boolean {
  const path = HREF_PARTS.exec(href)?.[1] ?? '';
  const last = path.split('/').at(-1) ?? '';
  return FILE_EXTENSION.test(last) && !MARKDOWN_EXTENSION.test(last);
}

/**
 * remark plugin. Requires `file.data.docLinkContext` to be set; without it the
 * containing document is unknown and every relative link would resolve against
 * the content root, which is worse than leaving them alone.
 */
export const remarkDocLinks: Plugin<[RemarkDocLinksOptions], Root> = (
  options,
) => {
  const { basePath, resolve } = options;

  return (tree: Root, file: VFile): undefined => {
    const context = file.data.docLinkContext;
    if (context === undefined) {
      throw new Error(
        `@waveso/docs: remarkDocLinks ran without file.data.docLinkContext${
          file.path === undefined ? '' : ` (file: ${file.path})`
        }. Set it before running the processor.`,
      );
    }

    const refs: DocLinkRef[] = file.data.docLinks ?? [];
    file.data.docLinks = refs;

    // `definition` covers reference-style links (`[a]: ./b.md`), which break
    // exactly as inline ones do and are easy to forget.
    visit(tree, ['link', 'definition'], (node) => {
      if (node.type !== 'link' && node.type !== 'definition') {
        return;
      }
      const raw = node.url;
      if (!isRelativeLink(raw)) {
        return;
      }
      // A custom resolver owns every relative link, assets included; the
      // built-in one only claims pages.
      if (resolve === undefined && isAssetLink(raw)) {
        return;
      }

      /*
       * ⚠️ THE WHOLE CONTEXT, NOT `context.segments`. This used to hand a
       * custom resolver the ROUTE segments while the built-in one below took
       * the DIRECTORY segments — so a consumer replacing the resolver got
       * strictly less than it needed, and `./sibling.md` resolved wrongly on
       * every directory index page. The comment on `DocLinkContext` is the
       * diagnosis; this line was the bug it described.
       */
      const href = resolve
        ? resolve(raw, context)
        : resolveMarkdownLink(raw, context.dirSegments, basePath);

      const line = node.position?.start.line;
      refs.push(line === undefined ? { raw, href } : { raw, href, line });

      if (href !== undefined) {
        node.url = href;
      }
    });

    return undefined;
  };
};
