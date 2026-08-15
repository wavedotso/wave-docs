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
import type { PluggableList } from 'unified';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { VFile } from 'vfile';
import type { DocsHighlighter, DocsLang, DocsThemes } from './highlighter.js';
import { createDocsHighlighter, DEFAULT_DOCS_THEMES } from './highlighter.js';
import { rehypeCaptureToc } from './plugins/rehype-capture-toc.js';
import { rehypeCodeFrame } from './plugins/rehype-code-frame.js';
import {
  rehypeNormalizeCodeLanguage,
  rehypeRestoreExcludedCode,
} from './plugins/rehype-code-language.js';
import { rehypeFallbackHeadingIds } from './plugins/rehype-fallback-heading-ids.js';
import { rehypeFlattenRoots } from './plugins/rehype-flatten-roots.js';
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
import { docsError } from './docs-error.js';

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
 * Re-exported because writing a {@link LinkResolver} without it is a trap.
 *
 * `./markdown-links` used to expose six names — the plugin, its options, two
 * types and two helpers — to make this one reachable. The plugin among them
 * throws `docsError('internal')` unless the caller sets an undocumented vfile
 * field, so five of the six were surface with no use, frozen by semver.
 *
 * This one earns its place: a resolver author has to fold `../` without
 * escaping the content root, strip `.md`, collapse `/index`, and NFC-normalise
 * each segment — and getting any of them wrong fails the build on a link that
 * is spelled correctly. Reusing it is what keeps a custom resolver and the
 * source layer agreeing about which routes exist.
 */
export { resolveMarkdownLink } from './plugins/remark-doc-links.js';

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
  highlighter?: DocsHighlighter | Promise<DocsHighlighter> | undefined;
  /** Grammars to load, when building the default highlighter. */
  langs?: readonly DocsLang[] | undefined;
  /** Theme pair. Defaults to {@link DEFAULT_DOCS_THEMES}. */
  themes?: DocsThemes | undefined;
  /**
   * Prepend an `<h1>` built from `frontmatter.title` when the markdown body
   * has none. Defaults to `true`.
   *
   * Turn it off only if your layout renders the page title itself: a document
   * with no `h1` fails `page-has-heading-one` and leaves the heading outline
   * starting at `h2`, and markdown that repeats the frontmatter title as `# `
   * is a duplication authors forget to keep in step.
   */
  titleHeading?: boolean | undefined;
  /**
   * Extra remark plugins, attached **after `remarkGfm` and before
   * `remarkDocLinks`**.
   *
   * Which is to say: while links are still mdast `url` strings, so anything
   * you emit is folded, contained and asserted exactly like authored markdown.
   * A plugin emitting `[x](../other/page.md)` gets the same resolution an
   * author would; one emitting `![i](./x.png)` throws `invalid-image` without
   * a resolver, for the same reason.
   *
   * ⚠️ ATTACHED ONCE, TO A PROCESSOR SHARED BY EVERY FILE. The pipeline is
   * built and frozen a single time, so a plugin holding state accumulates it
   * across the whole build rather than per document. Keep them pure, or key
   * whatever they hold on the vfile.
   */
  remarkPlugins?: PluggableList | undefined;
  /**
   * Extra rehype plugins, attached **after `rehypeAutolinkHeadings` and before
   * the code frame and Shiki**.
   *
   * The position is the useful one and it is not negotiable: after slugging
   * and autolinking, so heading ids exist; before Shiki, so a `<pre>` is still
   * `<pre><code class="language-ts">` with the author's text inside rather
   * than several hundred token spans. Fences excluded by `excludeLangs` are
   * not yet disguised at this point either, so a plugin sees every code block
   * the same way.
   *
   * Code-block internals are Shiki's `transformers`, not this. There is no
   * after-Shiki slot, because the honest documentation for one would be a list
   * of things you must not do.
   */
  rehypePlugins?: PluggableList | undefined;
  /** Replaces the built-in markdown-link resolution. */
  linkResolver?: LinkResolver | undefined;
  /**
   * Resolves image `src` to a public URL and intrinsic dimensions, so
   * `next/image` can render without `fill`.
   *
   * Required as soon as any page writes a relative `![](./diagram.png)`: there
   * is no correct output for one without it, so it throws rather than shipping
   * a src the browser resolves against the route. Absolute (`/logo.png`) and
   * external sources need no resolver, and a resolver returning `undefined`
   * keeps the folded — not the authored — src.
   */
  imageResolver?: ImageResolver | undefined;
  /**
   * Every route the site publishes, used by `assertLinks`. Read at render
   * time, so a host may pass a set it populates during the source walk.
   *
   * Without it only unresolvable links can be caught; with it, links to pages
   * that simply do not exist are caught too.
   */
  knownRoutes?: ReadonlySet<string> | undefined;
  /**
   * Routes of pages excluded from {@link DocsRendererOptions.knownRoutes}
   * because they are `draft: true`.
   *
   * Purely diagnostic, and it earns its place: a link to a draft is a link to a
   * file plainly sitting on disk, and the generic "no such page exists — add an
   * `aliases` entry" is advice that cannot be followed. Failing the build is
   * still right; naming the reason is what makes it fixable.
   */
  draftRoutes?: ReadonlySet<string> | undefined;
  /**
   * Alias route → the canonical `href` it redirects to.
   *
   * Deliberately not folded into {@link DocsRendererOptions.knownRoutes}. An
   * alias is only a live URL once `createDocsRedirects` is wired into
   * `next.config.ts`, which the quick start does not do — so treating one as
   * publishable produced a green build and a hard 404 for every reader who
   * clicked, which is the exact failure `assertLinks` exists to prevent.
   * Knowing the target lets the error name the page to link instead.
   */
  aliasRoutes?: ReadonlyMap<string, string> | undefined;
  /**
   * Fence languages Shiki must not touch, e.g. `['mermaid']`.
   *
   * The `<pre><code class="language-mermaid">` reaches your `pre`/`code`
   * component untouched, which is what lets a consumer render a diagram rather
   * than a monochrome block of DSL.
   */
  excludeLangs?: readonly string[] | undefined;
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
 * Is this src already a URL a browser can fetch from any page?
 *
 * `/logo.png`, `//cdn/…` and `https://…` are; everything else is relative to
 * the markdown file and means nothing once the file has become a route.
 */
function isPublicImageSrc(src: string): boolean {
  return src.startsWith('/') || IMAGE_HAS_SCHEME.test(src);
}

/** What an {@link ImageResolver} promises to return. */
type ResolvedImage = NonNullable<Awaited<ReturnType<ImageResolver>>>;

/**
 * Check what the resolver actually returned.
 *
 * `ImageResolver` is a type, and a type stops at the JavaScript boundary: a
 * host reading dimensions from a manifest hands back `{ src, width: '1200' }`
 * or a bare string, and the only symptom is `width="undefined"` in the HTML —
 * on one page, at build time, with nothing naming the image or the document.
 */
function assertResolvedImage(
  value: unknown,
  src: string,
  relativePath: string,
): asserts value is ResolvedImage {
  const blame = `for image "${src}" in ${relativePath}`;

  if (typeof value !== 'object' || value === null) {
    throw docsError(
      'invalid-image',
      `@waveso/docs: the imageResolver returned ${typeof value} ${blame}. ` +
        'Return `{ src, width?, height? }`, or `undefined` to leave the src alone.',
    );
  }

  const resolved: Partial<Record<'src' | 'width' | 'height', unknown>> = value;

  if (typeof resolved.src !== 'string' || resolved.src === '') {
    throw docsError(
      'invalid-image',
      `@waveso/docs: the imageResolver returned no \`src\` ${blame}. ` +
        'Return `{ src, width?, height? }`, or `undefined` to leave the src alone.',
    );
  }

  for (const key of ['width', 'height'] as const) {
    const dimension = resolved[key];
    if (dimension === undefined) {
      continue;
    }
    if (typeof dimension !== 'number' || !Number.isFinite(dimension)) {
      throw docsError(
        'invalid-image',
        `@waveso/docs: the imageResolver returned a non-numeric \`${key}\` ` +
          `${blame}. \`next/image\` needs intrinsic pixel dimensions; parse ` +
          'the value before returning it.',
      );
    }
  }
}

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
  if (isPublicImageSrc(src)) {
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

/**
 * Does the document already open on a page title?
 *
 * ⚠️ TOP-LEVEL CHILDREN ONLY, DELIBERATELY. A whole-tree walk counted an `h1`
 * anywhere — including `> [!NOTE]\n> # Callout title` — and suppressed the
 * frontmatter heading, so the page title appeared nowhere in the body and the
 * document's only `h1` was buried inside a callout. That is precisely the
 * `page-has-heading-one` failure this option's docstring says it prevents.
 */
function hasHeadingOne(tree: HastRoot): boolean {
  return tree.children.some(
    (child) => child.type === 'element' && child.tagName === 'h1',
  );
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
 *  8. `rehypeFallbackHeadingIds` — before slugging, so an emoji-only heading
 *                             never seeds the collision counter with `''`.
 *  9. `rehypeSlug`          — assigns heading ids.
 * 10. `rehypeAutolinkHeadings` — appends the permalink.
 * 11. `rehypePlugins`      — the consumer's, after slugging and autolinking so
 *                             heading ids exist, and before the code steps so
 *                             a `<pre>` is still the author's text.
 * 12. `rehypeNormalizeCodeLanguage` — immediately before Shiki, which is the
 *                             last moment `class="language-JSON"` exists.
 * 13. `rehypeCodeFrame`    — the one step wide window: after 12, which folds
 *                             the language and disguises excluded fences, and
 *                             before Shiki, which destroys `code.data.meta`
 *                             and with it the fence's `title="…"`.
 * 14. `rehypeShikiFromHighlighter` — near-last: it replaces `<pre><code>`
 *                             wholesale, and anything walking code blocks
 *                             afterwards would be walking Shiki's token spans.
 * 15. `rehypeRestoreExcludedCode` — the other side of step 12's disguise.
 * 16. `rehypeFlattenRoots` — because Shiki is what splices a `root` into
 *                             `root.children` and the published
 *                             `RenderedDoc.hast` type says that cannot happen.
 *                             Step 13 is the first thing to put a `root`
 *                             inside an *element* rather than at the top, so
 *                             this recursing into element children is now
 *                             load-bearing rather than defensive.
 * 17. `rehypeCaptureToc`    — DEAD LAST, and that is the design rather than an
 *                             ordering detail. The TOC is then read off the
 *                             identical tree `extractSearchRecords` walks, so
 *                             a consumer plugin cannot put the two out of step
 *                             — and no validation pass or error has to exist
 *                             to notice when it does. Measured both drifts
 *                             before the move: a plugin deleting a heading id
 *                             left `toc` pointing at an id no longer in the
 *                             DOM while search silently dropped the section;
 *                             one adding an `<h2>` produced a search record
 *                             with no TOC entry. Both silent.
 */
async function buildProcessor(
  options: DocsRendererOptions,
  themes: DocsThemes,
  highlighterPromise: DocsHighlighter | Promise<DocsHighlighter>,
) {
  const highlighter = await highlighterPromise;

  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(options.remarkPlugins ?? [])
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
    .use(rehypeFallbackHeadingIds)
    .use(rehypeSlug)
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
    .use(options.rehypePlugins ?? [])
    .use(rehypeNormalizeCodeLanguage, {
      ...(options.excludeLangs === undefined
        ? {}
        : { exclude: options.excludeLangs }),
    })
    .use(rehypeCodeFrame)
    .use(rehypeShikiFromHighlighter, highlighter as ShikiHighlighter, {
      themes,
      /*
       * ⚠️ WITHOUT THIS, EVERY `<pre>` CARRIES AN INLINE
       * `background-color:#fff;color:#24292e`, taken from whichever theme is
       * "default". Inline styles beat every stylesheet rule that is not
       * `!important`, so the light theme's background was painted onto code
       * blocks in dark mode and the stylesheet had to fight its way out with
       * `!important` and an unlayered block. `false` emits only the
       * `--shiki-light` / `--shiki-dark` custom properties, and CSS decides.
       */
      defaultColor: false,
      // An unloaded grammar does not throw — it ships an unhighlighted block
      // to production. Naming the fallback makes that outcome deliberate
      // instead of accidental.
      fallbackLanguage: 'text',
      defaultLanguage: 'text',
      // Shiki throws the fence language away, and it is destroyed in Node, so
      // there is no client-side workaround: without this a consumer's `pre`
      // override cannot tell a diagram from a shell snippet, add a language
      // badge, or label a copy button with the file type.
      addLanguageClass: true,
    })
    .use(rehypeRestoreExcludedCode)
    .use(rehypeFlattenRoots)
    .use(rehypeCaptureToc)
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
  const themes = options.themes ?? DEFAULT_DOCS_THEMES;
  /*
   * ⚠️ BUILT HERE, SYNCHRONOUSLY, SO A BAD NAME THROWS FROM THE CONSTRUCTOR.
   * `createDocsHighlighter` validates themes and languages synchronously, but
   * doing it inside the async `buildProcessor` turned that throw into a
   * rejection on a promise nobody was awaiting yet — and an unhandled rejection
   * terminates the Next.js build worker before a `try`/`catch` around either
   * this call or `render()` can see it. A typo in config deserves a stack
   * trace, not a dead worker.
   */
  const highlighter =
    options.highlighter ??
    createDocsHighlighter({
      themes,
      ...(options.langs === undefined ? {} : { langs: options.langs }),
    });

  const processorPromise = buildProcessor(options, themes, highlighter);
  // A grammar import that fails at runtime rejects this promise before the
  // first `render()` awaits it. Marking it handled keeps the process alive so
  // the rejection surfaces from `render()`, where a caller can catch it.
  processorPromise.catch(() => undefined);

  const { config, imageResolver, knownRoutes, draftRoutes, aliasRoutes } =
    options;
  const titleHeading = options.titleHeading ?? true;

  /**
   * Fold every `<img src>`, then hand it to the resolver if there is one.
   *
   * ⚠️ THIS RUNS FOR EVERY DOCUMENT, RESOLVER OR NOT, AND THAT IS THE POINT.
   * It used to be gated on `imageResolver`, which is the option nobody sets
   * first — so under the quickstart config `![d](./diagram.png)` shipped
   * byte-for-byte as authored and the BROWSER resolved it, against the route:
   * `/docs/guide` asked for `/docs/diagram.png` and `/docs/guide/setup` asked
   * for `/docs/guide/diagram.png`, from identical markdown. `assertLinks` could
   * not see it either — `remarkDocLinks` visits `link` and `definition`, never
   * `image` — so the build stayed green and the containment throw below was
   * dead code in the only configuration most sites run.
   *
   * A relative src has no correct output without a resolver, so it throws.
   * Absolute (`/logo.png`) and schemed srcs are already public URLs and are
   * passed through untouched — but still offered to the resolver, so a host can
   * rewrite them onto a CDN.
   */
  async function resolveImages(
    tree: HastRoot,
    file: DocFile,
    resolve: ImageResolver | undefined,
  ): Promise<void> {
    const images: Element[] = [];
    visit(tree, 'element', (node) => {
      if (node.tagName === 'img') {
        images.push(node);
      }
    });
    if (images.length === 0) {
      return;
    }

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
          throw docsError(
            'invalid-image',
            `@waveso/docs: image "${src}" in ${file.relativePath} climbs above the content root.`,
          );
        }

        if (resolve === undefined) {
          if (isPublicImageSrc(src)) {
            return;
          }
          throw docsError(
            'invalid-image',
            `@waveso/docs: image "${src}" in ${file.relativePath} is relative ` +
              'to the markdown file, and nothing can serve it: the browser ' +
              'would resolve it against the page route, so the same markdown ' +
              'would request a different file from every page. Pass an ' +
              '`imageResolver`, or move the image under `public/` and write ' +
              'an absolute src such as "/diagram.png".',
          );
        }

        let resolved: Awaited<ReturnType<ImageResolver>>;
        try {
          resolved = await resolve(folded, context);
        } catch (error) {
          // A resolver typically reads the file to measure it, and `ENOENT:
          // no such file 'architecture.png'` names neither the document nor
          // the line that asked for it.
          throw docsError(
            'invalid-image',
            `@waveso/docs: the imageResolver threw on image "${src}" in ` +
              `${file.relativePath}.`,
            { cause: error },
          );
        }

        if (resolved === undefined) {
          // ⚠️ THE FOLD SURVIVES. Returning `undefined` means "I have no public
          // URL for this", not "put the author's `../` back".
          node.properties.src = folded;
          return;
        }

        assertResolvedImage(resolved, src, file.relativePath);
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
        throw docsError(
          'broken-link',
          `@waveso/docs: ${describeLink(file, ref)} links to '${ref.raw}', ` +
            'which does not resolve to a documentation page. Use a path ' +
            'relative to this file, or an absolute URL for external links.',
        );
      }
      // An asset is a download served beside the docs, never a route, so the
      // published-route set has nothing to say about it. It is still recorded,
      // and the `href === undefined` check above still contains it.
      if (knownRoutes === undefined || ref.asset) {
        continue;
      }
      const route = toRouteKey(ref.href);
      if (knownRoutes.has(route)) {
        continue;
      }
      /*
       * A draft is the one missing page whose file is plainly on disk, so the
       * generic message below sends the author looking for a typo in a link
       * that is spelled correctly, and offers an `aliases` entry on a page that
       * has no alias to give. Same throw, different diagnosis.
       */
      if (draftRoutes?.has(route)) {
        throw docsError(
          'draft-link',
          `@waveso/docs: ${describeLink(file, ref)} links to '${ref.raw}', ` +
            `which resolves to '${route}' — a page marked \`draft: true\`, ` +
            'so it is not published and the link would 404. Publish the page, ' +
            'remove the link, or build with `includeDrafts`.',
        );
      }
      /*
       * An alias is a redirect, not a page: `generateStaticParams` never emits
       * it, so with `dynamicParams = false` the link is a hard 404 — and it is
       * only a working URL at all once `createDocsRedirects` is wired up. The
       * author already told us where the page went, so say so rather than
       * accepting the link and breaking it at runtime.
       */
      const aliasTarget = aliasRoutes?.get(route);
      if (aliasTarget !== undefined) {
        throw docsError(
          'alias-link',
          `@waveso/docs: ${describeLink(file, ref)} links to '${ref.raw}', ` +
            `which resolves to '${route}' — an alias that redirects to ` +
            `'${aliasTarget}'. An alias is not a page: it 404s unless ` +
            '`createDocsRedirects` is wired into `next.config.ts`, and it is ' +
            `never prerendered. Link to '${aliasTarget}' directly.`,
        );
      }
      throw docsError(
        'broken-link',
        `@waveso/docs: ${describeLink(file, ref)} links to '${ref.raw}', ` +
          `which resolves to '${route}' — no such page exists. Fix the ` +
          'link, or add an `aliases` entry to the page it used to point at.',
      );
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
      await resolveImages(hast, file, imageResolver);
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
