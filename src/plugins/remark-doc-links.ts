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

import type { Definition, Link, Root } from 'mdast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';
import type { VFile } from 'vfile';
import type { DocLinkContext, LinkResolver } from '../types.js';
import { docsError } from '../docs-error.js';

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
  /**
   * The target is a file served beside the docs (`./schema.json`), not a page.
   *
   * It is still folded and still recorded, because a `../` chain that climbs
   * out of the content root is an authoring error whatever it points at — but
   * it must not be checked against the set of published ROUTES, which it will
   * never be a member of.
   */
  asset?: true;
  /**
   * An absolute link at a root mount, which cannot be proved to be ours.
   *
   * ⚠️ RECORDED RATHER THAN SKIPPED, WHICH IS THE CHANGE. Under
   * `basePath: '/docs'` an absolute link either starts with `/docs` — so it is
   * a documentation route and is checked — or it does not, and belongs to the
   * host's application. Under `basePath: '/'` that test cannot be made:
   * `/setup` may be a page here and `/login` almost certainly is not, and
   * nothing in the markdown says which.
   *
   * So it is collected and marked, and `DocsConfig.onUnverifiableLinks` decides
   * what a site wants done about it — `'ignore'` by default, because only the
   * site knows whether it is documentation and nothing else.
   */
  unverifiable?: true;
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
 * Is this already-absolute href one of OUR routes?
 *
 * `/docs/api/auht` needs no rewriting and used to need no thought either — so
 * it was never recorded, never asserted, and shipped a 404 with a green build.
 * A typo in a hand-written absolute link is exactly as likely as one in a
 * relative link; only the rewriting differs.
 *
 * Requires a non-empty base path. Docs mounted at the site root cannot be told
 * apart from the rest of the site, and asserting `/login` against the set of
 * documentation routes would fail builds over links that are perfectly good.
 */
/** No prefix at all — the docs own the whole origin. */
export function isRootMount(basePath: string): boolean {
  return basePath.replace(/\/+$/, '') === '';
}

function isInternalAbsoluteLink(href: string, basePath: string): boolean {
  const base = basePath.replace(/\/+$/, '');
  if (base === '' || href.startsWith('//')) {
    return false;
  }
  const path = HREF_PARTS.exec(href)?.[1] ?? '';
  return path === base || path.startsWith(`${base}/`);
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

/**
 * Join route segments onto the base path, e.g. `('/docs', ['api'])`.
 *
 * ⚠️ ENCODES EACH SEGMENT, which is the half of the percent-encoding contract
 * that lives here: `source.ts` builds every published `href` as
 * `basePath + '/' + segments.map(encodeURIComponent).join('/')` and keeps
 * `segments` raw, so a route computed from a link has to be spelled the same
 * way or `assertLinks` compares an encoded route against a decoded one and
 * fails the build on a page that exists.
 */
function toRoute(basePath: string, segments: readonly string[]): string {
  const base = basePath.replace(/\/+$/, '');
  const path = segments.map((segment) => encodeURIComponent(segment)).join('/');
  if (path === '') {
    return base === '' ? '/' : base;
  }
  return `${base}/${path}`;
}

/**
 * Percent-decode one authored path segment, and normalise it.
 *
 * GitHub's own UI writes `[gs](./getting%20started.md)` when you drag a file
 * with a space in its name into an issue, and that is the form that ends up in
 * a repository's markdown. Without decoding, the segment stays `getting%20started`,
 * matches no file, and hard-fails the build on a link GitHub renders correctly.
 *
 * NFC because macOS hands back decomposed filenames and `source.ts` normalises
 * at the `readdir` boundary; two spellings of `é` are one page.
 *
 * Throws rather than returning the input on failure: `decodeURIComponent`
 * rejects `100%-faster`, and a silent pass-through would turn a malformed link
 * into a mystery 404 instead of a message the author can act on.
 */
function decodeSegment(segment: string, href: string): string {
  try {
    return decodeURIComponent(segment).normalize('NFC');
  } catch (error) {
    throw new URIError(
      `@waveso/docs: link '${href}' is not valid percent-encoding — ` +
        `'${segment}' cannot be decoded. Write '%25' for a literal percent ` +
        'sign, or link to the file by its real name.',
      { cause: error },
    );
  }
}

/**
 * Decode BEFORE folding, never after: `%2E%2E%2F` is `../` in disguise, and
 * `foldSegments` is the only thing that refuses a chain climbing out of the
 * content root.
 *
 * Exported for `route-path.ts`, which needs the decode without the split:
 * an alias may carry a literal `#` or `?` — `c# guide` is a page name — and
 * {@link splitHref} would cut the string there and throw the rest away.
 */
export function decodePath(path: string, href: string): string {
  return path
    .split('/')
    .map((segment) => decodeSegment(segment, href))
    .join('/');
}

/**
 * An href, split at `?` and `#`, with the path decoded and the rest left alone.
 *
 * ⚠️ ONE IMPLEMENTATION, BECAUSE THE THIRD COPY WAS WRONG. Four call sites need
 * this exact sequence — split, decode the path, fold, re-attach — and three of
 * them had it inline while `foldImageSrc` in `render.ts` had none of it. An
 * author dragging a file into GitHub's editor gets `![a](./getting%20started.png)`
 * written for them, and that reached the resolver undecoded: `readFile` on a
 * filename with a literal `%20` in it, `ENOENT`, and a build failed on an image
 * that is plainly on disk and that GitHub renders. `./diagram.png?v=2` and
 * `./sprite.svg#icon` baked the query and the fragment into the filename the
 * same way.
 *
 * A query and a fragment are never decoded: `?q=a%26b` carries a literal
 * ampersand that decoding would turn into a separator, and neither is part of
 * any filename.
 */
export interface HrefParts {
  /** Path, percent-decoded and NFC-normalised — what {@link foldSegments} needs. */
  path: string;
  /**
   * The same span exactly as authored.
   *
   * One caller needs it: {@link normalizeInternalRoute} strips `basePath` off
   * the front by length, and doing that to a decoded path would cut at the
   * wrong offset for any href that percent-encoded part of the prefix.
   */
  rawPath: string;
  /** `?query` as authored, or `''`. */
  query: string;
  /** `#hash` as authored, or `''`. */
  hash: string;
}

/**
 * Split an href into its path, query and fragment; decode only the path.
 *
 * Throws a {@link URIError} if the path is not valid percent-encoding, with the
 * whole href in the message — see {@link decodeSegment}.
 */
export function splitHref(href: string): HrefParts {
  const parts = HREF_PARTS.exec(href);
  const rawPath = parts?.[1] ?? '';
  return {
    path: decodePath(rawPath, href),
    rawPath,
    query: parts?.[2] ?? '',
    hash: parts?.[3] ?? '',
  };
}

/**
 * The built-in {@link LinkResolver}: markdown file path in, route out.
 *
 * Exported for reuse by hosts that want to wrap rather than replace it. Throws
 * a {@link URIError} on a malformed percent-escape; every other failure is
 * reported as `undefined`.
 */
export function resolveMarkdownLink(
  href: string,
  fromDir: readonly string[],
  basePath: string,
): string | undefined {
  const { path, query, hash } = splitHref(href);

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
 * Respell an already-absolute internal link the way route keys are spelled.
 *
 * An absolute link is not rewritten — it is already a route — but it still has
 * to be *compared* against one, and `source.ts` spells every published href
 * with `encodeURIComponent` per segment. Recording the author's raw text made
 * that comparison spelling-sensitive: `/docs/café` and `/docs/caf%C3%A9` are the
 * same page, and only the second matched, so the human-readable form every
 * editor produces failed the build with "no such page exists" for a page that
 * plainly exists. Decoding and re-encoding puts both on the canonical spelling.
 *
 * `.`/`..` are folded for the same reason: `/docs/api/../guide` is a route a
 * browser resolves happily and `knownRoutes` has never heard of.
 */
function normalizeInternalRoute(
  href: string,
  basePath: string,
): string | undefined {
  const { rawPath, query, hash } = splitHref(href);

  const base = basePath.replace(/\/+$/, '');
  const rest = rawPath.slice(base.length);

  const segments = foldSegments([], decodePath(rest, href));
  if (segments === undefined) {
    return undefined;
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
 * An asset href, folded against the page's directory.
 *
 * ⚠️ ASSETS USED TO BE RETURNED UNTOUCHED, which made `./schema.json` mean two
 * different files: the browser resolves a relative href against the ROUTE, so
 * `guide/index.md` requested `/docs/guide/schema.json` and `guide/setup.md`
 * requested `/docs/guide/setup/schema.json` — from byte-identical markdown that
 * previews correctly in both places. Folding to a route-absolute path is what
 * every link in this file already does, and there is no reason a download is
 * the exception.
 */
function resolveAssetLink(
  href: string,
  fromDir: readonly string[],
  basePath: string,
): string | undefined {
  const { path, query, hash } = splitHref(href);

  const segments = foldSegments(fromDir, path);
  if (segments === undefined) {
    return undefined;
  }
  return `${toRoute(basePath, segments)}${query}${hash}`;
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
      throw docsError(
        'internal',
        `@waveso/docs: remarkDocLinks ran without file.data.docLinkContext${
          file.path === undefined ? '' : ` (file: ${file.path})`
        }. Set it before running the processor.`,
      );
    }

    const refs: DocLinkRef[] = file.data.docLinks ?? [];
    file.data.docLinks = refs;

    /*
     * ⚠️ A `definition` CANNOT TELL YOU WHAT REFERS TO IT. `[l]: ./logo.png`
     * is a link target for `[text][l]` and an image source for `![alt][l]`, and
     * the node is identical in both cases. Treated as a link it either fails
     * the build with a message about a link that is not a link, or — with a
     * custom resolver — quietly rewrites an image `src` to a page route, which
     * nothing downstream can undo: the leading `/` makes the image folder pass
     * it straight through and the `imageResolver` never sees it.
     *
     * So the identifiers are collected first, in the same walk, and an image's
     * definition is left for the image path in `render.ts` to fold.
     */
    const imageIdentifiers = new Set<string>();
    const targets: Array<Link | Definition> = [];
    visit(tree, (node) => {
      if (node.type === 'imageReference') {
        imageIdentifiers.add(node.identifier);
      } else if (node.type === 'link' || node.type === 'definition') {
        // `definition` covers reference-style links (`[a]: ./b.md`), which
        // break exactly as inline ones do and are easy to forget.
        targets.push(node);
      }
    });

    for (const node of targets) {
      const raw = node.url;
      if (node.type === 'definition' && imageIdentifiers.has(node.identifier)) {
        continue;
      }

      const line = node.position?.start.line;
      const record = (
        href: string | undefined,
        flags: { asset?: true; unverifiable?: true } = {},
      ): void => {
        const ref: DocLinkRef = { raw, href };
        if (line !== undefined) {
          ref.line = line;
        }
        if (flags.asset !== undefined) {
          ref.asset = flags.asset;
        }
        if (flags.unverifiable !== undefined) {
          ref.unverifiable = flags.unverifiable;
        }
        refs.push(ref);
        if (href !== undefined) {
          node.url = href;
        }
      };

      /*
       * One guard around every branch, because all four can decode a
       * percent-escape and so all four can raise `URIError`. Only the last used
       * to be wrapped: `[a](./100%-faster.json)` escaped as a bare `URIError`
       * with no code, no file and no line, past the very check that exists to
       * make failures locatable.
       */
      try {
        if (!isRelativeLink(raw)) {
          // Already a route; recorded so a typo in it is caught, not rewritten
          // — but respelled first, so the comparison is like-for-like.
          if (isInternalAbsoluteLink(raw, basePath) && !isAssetLink(raw)) {
            record(normalizeInternalRoute(raw, basePath));
            continue;
          }
          /*
           * At a root mount there is no prefix to test against, so an absolute
           * link cannot be proved to be a documentation route — nor proved not
           * to be. Recorded and marked rather than dropped, so
           * `onUnverifiableLinks` has something to act on for a site that knows
           * the answer. `//host` is another origin and never ours.
           */
          if (
            isRootMount(basePath) &&
            raw.startsWith('/') &&
            !raw.startsWith('//') &&
            !isAssetLink(raw)
          ) {
            record(normalizeInternalRoute(raw, basePath), {
              unverifiable: true,
            });
          }
          continue;
        }

        // A custom resolver owns every relative link, assets included; the
        // built-in one only claims pages.
        if (resolve === undefined && isAssetLink(raw)) {
          record(resolveAssetLink(raw, context.dirSegments, basePath), {
            asset: true,
          });
          continue;
        }

        /*
         * ⚠️ THE WHOLE CONTEXT, NOT `context.segments`. This used to hand a
         * custom resolver the ROUTE segments while the built-in one below took
         * the DIRECTORY segments — so a consumer replacing the resolver got
         * strictly less than it needed, and `./sibling.md` resolved wrongly on
         * every directory index page. The comment on `DocLinkContext` is the
         * diagnosis; this line was the bug it described.
         */
        if (resolve) {
          record(resolve(raw, context));
          continue;
        }

        record(resolveMarkdownLink(raw, context.dirSegments, basePath));
      } catch (error) {
        if (!(error instanceof URIError)) {
          throw error;
        }
        const at = line === undefined ? '' : `:${line}`;
        throw docsError(
          'broken-link',
          `@waveso/docs: ${context.relativePath}${at} links to '${raw}', ` +
            'whose percent-encoding is malformed. Write %25 for a literal ' +
            'percent sign, or link to the file by its real name.',
          { cause: error },
        );
      }
    }

    return undefined;
  };
};
