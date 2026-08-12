/**
 * Markdown to hast, in Node, at build time.
 *
 * The output is a plain hast tree — serialisable JSON. It crosses the RSC
 * boundary, survives a `JSON.stringify` into any build-time artifact, and
 * caches to disk, all without the markdown parser or Shiki following it into
 * the browser. That is the product claim of this package, and stopping at hast
 * (rather than stringifying to HTML, or shipping MDX) is what buys it.
 */

import rehypeShikiFromHighlighter from '@shikijs/rehype/core';
import type { Element, ElementContent, Root as HastRoot } from 'hast';
import type { DefaultBuildType } from 'rehype-github-alerts';
import { rehypeGithubAlerts } from 'rehype-github-alerts';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { CONTINUE, EXIT, visit } from 'unist-util-visit';
import { VFile } from 'vfile';
import type { DocsHighlighter, DocsLang, DocsThemes } from './highlighter.js';
import { createDocsHighlighter, DEFAULT_DOCS_THEMES } from './highlighter.js';
import { rehypeCaptureToc } from './plugins/rehype-capture-toc.js';
import type { DocLinkRef } from './plugins/remark-doc-links.js';
import { foldSegments, remarkDocLinks } from './plugins/remark-doc-links.js';
import { remarkUnwrapImages } from './plugins/remark-unwrap-images.js';
import { remarkYouTube } from './plugins/remark-youtube.js';
import type {
  DocFile,
  DocFrontmatter,
  DocLinkContext,
  ImageResolver,
  LinkResolver,
  RenderedDoc,
  ResolvedDocsConfig,
} from './types.js';

/*
 * `@shikijs/rehype` asks for `HighlighterGeneric<any, any>` while
 * `createHighlighterCore` returns `HighlighterGeneric<never, never>` — the
 * bundled-name generics are contravariant, so the two do not meet. The cast is
 * the wart, not a real mismatch; taking the parameter type from the function
 * itself at least keeps `any` out of this file and `@shikijs/types` out of our
 * declaration output.
 */
type ShikiHighlighter = Parameters<typeof rehypeShikiFromHighlighter>[0];

/**
 * The parts of {@link ResolvedDocsConfig} rendering actually depends on.
 *
 * Declared as a `Pick` so a full resolved config passes straight through: the
 * host resolves configuration once, with `resolveDocsConfig`, and hands the
 * same object to the source walk and to the renderer. Nothing here re-applies
 * defaults, so the two cannot drift.
 */
export type DocsRendererConfig = Pick<
  ResolvedDocsConfig,
  'basePath' | 'assertLinks'
>;

export interface DocsRendererOptions {
  config: DocsRendererConfig;
  /**
   * Reuse an existing highlighter — the escape hatch for grammars and themes
   * outside the curated set. Defaults to {@link createDocsHighlighter}.
   */
  highlighter?: DocsHighlighter | Promise<DocsHighlighter>;
  /** Grammars to load, when building the default highlighter. */
  langs?: readonly DocsLang[];
  /** Theme pair. Defaults to {@link DEFAULT_DOCS_THEMES}. */
  themes?: DocsThemes;
  /**
   * Prepend an `<h1>` built from `frontmatter.title` when the markdown body
   * has none. Defaults to `true`.
   *
   * Turn it off only if your layout renders the page title itself: a document
   * with no `h1` fails `page-has-heading-one` and leaves the heading outline
   * starting at `h2`, and markdown that repeats the frontmatter title as `# `
   * is a duplication authors forget to keep in step.
   */
  titleHeading?: boolean;
  /** Replaces the built-in markdown-link resolution. */
  linkResolver?: LinkResolver;
  /**
   * Resolves image `src` to a public URL and intrinsic dimensions, so
   * `next/image` can render without `fill`. Images are left untouched when
   * omitted, or when the resolver returns `undefined`.
   */
  imageResolver?: ImageResolver;
  /**
   * Every route the site publishes, used by `assertLinks`. Read at render
   * time, so a host may pass a set it populates during the source walk.
   *
   * Without it only unresolvable links can be caught; with it, links to pages
   * that simply do not exist are caught too.
   */
  knownRoutes?: ReadonlySet<string>;
}

/**
 * Renders {@link DocFile}s. Build one per process and reuse it.
 *
 * The frontmatter type parameter sits on `render`, not on the interface: the
 * renderer reads only `frontmatter.title` and passes the rest through, so one
 * renderer serves files parsed by any schema — which is what lets a host build
 * the processor and the highlighter once. A renderer-level parameter would
 * force a second highlighter per frontmatter shape and buy nothing.
 */
export interface DocsRenderer {
  render<TFrontmatter extends DocFrontmatter>(
    file: DocFile<TFrontmatter>,
  ): Promise<RenderedDoc<TFrontmatter>>;
}

/**
 * Emit a bare `<callout type="note">` instead of GitHub's markup.
 *
 * The default build ships octicon SVGs and `markdown-alert` classes, which
 * hardcodes an icon set and a stylesheet into the content tree. A single
 * element with a `type` is enough for the React layer to map onto a real
 * component that matches the rest of the site.
 */
const buildCallout: DefaultBuildType = (alert, children): Element => ({
  type: 'element',
  tagName: 'callout',
  properties: { type: alert.keyword.toLowerCase() },
  children,
});

/** The visible text of a heading permalink. Styling lives in the stylesheet. */
const HEADING_ANCHOR_CONTENT: ElementContent = { type: 'text', value: '#' };

/**
 * Directory of a content-relative path, as segments.
 *
 * Split on both separators: the contract spells `relativePath` with forward
 * slashes, but a host that builds it from `path.relative` on Windows will not.
 */
function toDirSegments(relativePath: string): string[] {
  return relativePath
    .split(/[/\\]+/)
    .slice(0, -1)
    .filter(Boolean);
}

/** `scheme:` — `https:`, `data:`, anything that is not ours to resolve. */
const IMAGE_HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * An image `src` folded against the page's directory, or `undefined` if it
 * climbs out of the content root.
 *
 * Absolute (`/logo.png`), protocol-relative and schemed sources are returned
 * UNCHANGED: they are already public URLs, and folding one would corrupt it.
 * Everything else is relative to the file that wrote it, which is what an
 * author means by `![](./diagram.png)` and what the link path has always done.
 */
function foldImageSrc(
  src: string,
  dirSegments: readonly string[],
): string | undefined {
  if (src.startsWith('/') || IMAGE_HAS_SCHEME.test(src)) {
    return src;
  }

  const segments = foldSegments(dirSegments, src);

  return segments === undefined ? undefined : segments.join('/');
}

/** Route without its `?query` / `#anchor`, for existence checks. */
function toRouteKey(href: string): string {
  const cut = href.search(/[?#]/);
  return cut === -1 ? href : href.slice(0, cut);
}

function describeLink(file: DocFile, ref: DocLinkRef): string {
  const at = ref.line === undefined ? '' : `:${ref.line}`;
  return `${file.relativePath}${at}`;
}

/** Does the document already open on a page title? */
function hasHeadingOne(tree: HastRoot): boolean {
  let found = false;
  visit(tree, 'element', (node) => {
    if (node.tagName !== 'h1') return CONTINUE;
    found = true;
    return EXIT;
  });
  return found;
}

/**
 * The `<h1>` a page gets when its markdown does not declare one.
 *
 * `DocFrontmatter.title` is documented as the `<h1>` fallback, and without it
 * a page whose body starts at `## ` ships with no `h1` at all: a broken
 * heading outline for anyone navigating by headings, and `page-has-heading-one`
 * for every accessibility audit. No id and no permalink — the page title is
 * addressable as the page.
 */
function titleHeadingNode(title: string): Element {
  return {
    type: 'element',
    tagName: 'h1',
    properties: {},
    children: [{ type: 'text', value: title }],
  };
}

/**
 * Drop the `position` unist attaches to every node.
 *
 * The tree is the payload: it crosses the RSC boundary, so every byte is
 * shipped to every reader.
 * Positions are 38% of that JSON on a typical page — line and column offsets
 * into a markdown file the browser does not have and cannot fetch. Nothing
 * downstream reads them: link errors are reported from positions captured
 * during the mdast phase, and the TOC works off ids.
 */
function stripPositions(tree: HastRoot): HastRoot {
  visit(tree, (node) => {
    delete node.position;
  });
  return tree;
}

/**
 * Build the processor once and reuse it for every file.
 *
 * The plugin order below is load-bearing and each step depends on the one
 * before it:
 *
 *  1. `remarkParse`         — markdown to mdast.
 *  2. `remarkGfm`           — tables, strikethrough, task lists, autolinks.
 *  3. `remarkDocLinks`      — rewrite links while paths are still mdast `url`
 *                             strings; after `remarkRehype` they are hast
 *                             properties and the source position is gone.
 *  4. `remarkUnwrapImages`  — must precede `remarkRehype` for the same reason:
 *                             the paragraph wrapper is created by the mdast to
 *                             hast conversion's phrasing rules.
 *  5. `remarkYouTube`       — after `remarkDocLinks`, which leaves an external
 *                             URL alone, and before `remarkRehype` on
 *                             `remarkUnwrapImages`'s reasoning: this replaces
 *                             the whole PARAGRAPH, because a block element left
 *                             inside the `<p>` markdown wraps a link in is
 *                             invalid HTML and hydrates as a mismatch.
 *  6. `remarkRehype`        — mdast to hast. `allowDangerousHtml` stays off:
 *                             raw HTML in the source is dropped rather than
 *                             passed through, because this package does not
 *                             run `rehype-raw`, and `rehype-raw` on its own
 *                             happily reparses `<script>` into the tree.
 *  7. `rehypeGithubAlerts`  — `> [!NOTE]` is still a blockquote at this point;
 *                             `remark-gfm` does not implement alerts at all.
 *                             Runs before slugging so a heading inside a
 *                             callout is slugged in its final position.
 *  8. `rehypeSlug`          — assigns heading ids.
 *  9. `rehypeCaptureToc`    — reads those ids. Before autolinking, so heading
 *                             text is captured without the appended `#`.
 * 10. `rehypeAutolinkHeadings` — appends the permalink.
 * 11. `rehypeShikiFromHighlighter` — last: it replaces `<pre><code>` wholesale,
 *                             and anything walking code blocks afterwards
 *                             would be walking Shiki's token spans instead.
 */
async function buildProcessor(options: DocsRendererOptions) {
  const themes = options.themes ?? DEFAULT_DOCS_THEMES;
  const highlighter = await (options.highlighter ??
    createDocsHighlighter({
      themes,
      ...(options.langs === undefined ? {} : { langs: options.langs }),
    }));

  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkDocLinks, {
      basePath: options.config.basePath,
      ...(options.linkResolver === undefined
        ? {}
        : { resolve: options.linkResolver }),
    })
    .use(remarkUnwrapImages)
    .use(remarkYouTube)
    .use(remarkRehype, {
      allowDangerousHtml: false,
      // The generated footnote label is `class="sr-only"` by default — a class
      // this package deliberately does not define (Tailwind is optional here),
      // so it would render as a visible, unstyled "Footnotes" heading. Point it
      // at ours, which hides it as the default intended.
      footnoteLabelProperties: { className: ['wave-docs-sr-only'] },
    })
    .use(rehypeGithubAlerts, { build: buildCallout })
    .use(rehypeSlug)
    .use(rehypeCaptureToc)
    .use(rehypeAutolinkHeadings, {
      behavior: 'append',
      // Zero config renders an *empty* anchor — a focusable element with no
      // accessible name, invisible in every stylesheet. Give it content, hide
      // it from assistive tech (the heading beside it says the same thing),
      // and keep it out of the tab order.
      content: HEADING_ANCHOR_CONTENT,
      properties: {
        className: ['heading-anchor'],
        // The string, not the boolean: `@types/hast` models `aria-*` as
        // strings, and both serialise to `aria-hidden="true"` anyway.
        ariaHidden: 'true',
        tabIndex: -1,
      },
    })
    .use(rehypeShikiFromHighlighter, highlighter as ShikiHighlighter, {
      themes,
      // An unloaded grammar does not throw — it ships an unhighlighted block
      // to production. Naming the fallback makes that outcome deliberate
      // instead of accidental.
      fallbackLanguage: 'text',
      defaultLanguage: 'text',
    })
    .freeze();
}

/**
 * Create a renderer.
 *
 * The processor and the highlighter are built once, eagerly, and shared by
 * every call to `render`. Constructing them per file is the difference between
 * a docs build that takes a second and one that takes a minute.
 */
export function createDocsRenderer(options: DocsRendererOptions): DocsRenderer {
  const processorPromise = buildProcessor(options);
  const { config, imageResolver, knownRoutes } = options;
  const titleHeading = options.titleHeading ?? true;

  /**
   * Hand every `<img>` to the resolver, FOLDED AND CONTAINED.
   *
   * ⚠️ IMAGES USED TO SKIP FOLDING ENTIRELY. `remarkDocLinks` visits `link` and
   * `definition` and never `image`, so an image `src` reached the resolver
   * exactly as authored — `../../../../.env` included — while every LINK on the
   * same page went through `foldSegments`, which refuses a chain that climbs
   * out of the content root. Two paths into the same kind of consumer code,
   * one of them guarded.
   *
   * That is a containment hole rather than a formatting bug: the resolver's
   * documented job is to turn a src into a public URL, and a reasonable
   * implementation joins it onto a directory. So the fold happens HERE, before
   * the call, and an escape throws with the file named — the same treatment
   * `assertLinks` gives a link that climbs out.
   *
   * Absolute and external srcs are passed through untouched: `/logo.png` is
   * already a public URL and `https://…` belongs to someone else.
   */
  async function resolveImages(
    tree: HastRoot,
    file: DocFile,
    resolve: ImageResolver,
  ): Promise<void> {
    const images: Element[] = [];
    visit(tree, 'element', (node) => {
      if (node.tagName === 'img') {
        images.push(node);
      }
    });

    const context: DocLinkContext = {
      segments: file.segments,
      dirSegments: toDirSegments(file.relativePath),
      relativePath: file.relativePath,
    };

    await Promise.all(
      images.map(async (node) => {
        const src = node.properties.src;
        if (typeof src !== 'string' || src === '') {
          return;
        }

        const folded = foldImageSrc(src, context.dirSegments);

        if (folded === undefined) {
          throw new Error(
            `@waveso/docs: image "${src}" in ${file.relativePath} climbs above the content root.`,
          );
        }

        const resolved = await resolve(folded, context);
        if (resolved === undefined) {
          return;
        }
        node.properties.src = resolved.src;
        if (resolved.width !== undefined) {
          node.properties.width = resolved.width;
        }
        if (resolved.height !== undefined) {
          node.properties.height = resolved.height;
        }
      }),
    );
  }

  /**
   * Fail the build on a link that would have 404'd.
   *
   * Deliberately a throw and not a warning: the link was valid in the editor
   * and on GitHub, so a warning in a build log is a warning nobody reads.
   */
  function assertLinks(file: DocFile, refs: readonly DocLinkRef[]): void {
    for (const ref of refs) {
      if (ref.href === undefined) {
        throw new Error(
          `@waveso/docs: ${describeLink(file, ref)} links to '${ref.raw}', ` +
            'which does not resolve to a documentation page. Use a path ' +
            'relative to this file, or an absolute URL for external links.',
        );
      }
      if (knownRoutes === undefined) {
        continue;
      }
      const route = toRouteKey(ref.href);
      if (!knownRoutes.has(route)) {
        throw new Error(
          `@waveso/docs: ${describeLink(file, ref)} links to '${ref.raw}', ` +
            `which resolves to '${route}' — no such page exists. Fix the ` +
            'link, or add an `aliases` entry to the page it used to point at.',
        );
      }
    }
  }

  return {
    async render<TFrontmatter extends DocFrontmatter>(
      file: DocFile<TFrontmatter>,
    ): Promise<RenderedDoc<TFrontmatter>> {
      const processor = await processorPromise;

      // The document's identity travels on the vfile, not in plugin options,
      // so one frozen processor serves every page.
      const vfile = new VFile({ value: file.content, path: file.filePath });
      vfile.data.docLinkContext = {
        segments: file.segments,
        dirSegments: toDirSegments(file.relativePath),
        relativePath: file.relativePath,
      };

      const hast = await processor.run(processor.parse(vfile), vfile);

      if (titleHeading && !hasHeadingOne(hast)) {
        hast.children.unshift(titleHeadingNode(file.frontmatter.title));
      }
      if (imageResolver !== undefined) {
        await resolveImages(hast, file, imageResolver);
      }
      if (config.assertLinks) {
        assertLinks(file, vfile.data.docLinks ?? []);
      }

      return {
        frontmatter: file.frontmatter,
        hast: stripPositions(hast),
        toc: vfile.data.toc ?? [],
        segments: file.segments,
        href: file.href,
      };
    },
  };
}
