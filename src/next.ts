/**
 * The Next.js App Router adapter.
 *
 * Wires a content directory to a catch-all route in five lines, with the
 * details that separate a docs site Google indexes from one it does not:
 * `dynamicParams: false`, a real index route, awaited `params`, and a canonical
 * URL on every page.
 *
 * Two route files are required — see {@link DocsRoute.IndexPage} for why:
 *
 * ```tsx
 * // app/docs/[...slug]/page.tsx
 * import { createDocsRoute } from '@waveso/docs/next';
 *
 * const docs = createDocsRoute({ contentDir: 'content/docs' });
 *
 * export default docs.Page;
 * export const generateStaticParams = docs.generateStaticParams;
 * export const generateMetadata = docs.generateMetadata;
 * export const dynamicParams = false; // must be a literal, see `DocsRoute`
 * ```
 *
 * ```tsx
 * // app/docs/page.tsx
 * import { createDocsRoute } from '@waveso/docs/next';
 *
 * const docs = createDocsRoute({ contentDir: 'content/docs' });
 *
 * export default docs.IndexPage;
 * export const generateMetadata = docs.generateMetadata;
 * ```
 *
 * `next` is an *optional* peer dependency, so **Next's own modules** are
 * imported lazily and only from the code paths that render. That is what lets
 * {@link createDocsSitemap} and {@link createDocsRedirects} be called from
 * `next.config.ts` — which Node loads outside the Next runtime — without
 * dragging Next's client runtime into the config load.
 *
 * React itself is *not* excluded: this module statically imports `react` and
 * the package's own React layer, so importing it from `next.config.ts` costs
 * around 210 ms and ~870 modules (measured against 24 ms for an empty config).
 * That is a startup cost, not a correctness problem, and it is stated here
 * rather than claimed away — an earlier version of this note said React stayed
 * out of the config load, which was never true.
 */

import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import type { Options as MiniSearchOptions } from 'minisearch';
import type { PluggableList } from 'unified';
import type { ComponentType, ReactNode } from 'react';
import { Fragment, cache, createElement } from 'react';

import { mapPooled } from './map-pooled.js';
import { assertAnchors } from './anchors.js';
import { describeSuggestion } from './link-suggestion.js';
import type { SerializableSearchOptions } from './search-options.js';
import { findFunctionValuedOptions } from './search-options.js';
import type {
  DocsHighlighter,
  DocsLang,
  DocsTheme,
  DocsThemes,
} from './highlighter.js';
import { DocContent } from './react/doc-content.js';
import { DocsHero } from './react/hero.js';
import { neighbours } from './nav-order.js';
import { DocsPager } from './react/pager.js';
import type { DocsLinkComponent } from './react/markdown-components.js';
/*
 * Type-only because only the type is wanted here; the erasure is not doing
 * anything clever.
 *
 * ⚠️ THIS COMMENT USED TO CALL `layout.tsx` A `'use client'` MODULE. It is not
 * one — its own docstring opens "Private, and a Server Component", and it ships
 * no JavaScript of its own. What it does do is statically import `next-nav` and
 * `next-search`, which are client modules and which reach `next/navigation` and
 * `next/link`. That, and not a directive on this file, is why `Layout` takes the
 * value through a dynamic `import()`: a static one would put both Next modules
 * on the graph of `next.config.ts`, which loads this entry point for
 * `createDocsSitemap` and `createDocsRedirects` outside the Next runtime.
 */
import type { DocsLayoutSearchProps } from './react/layout.js';
import type { DocsIconMap } from './react/sidebar.js';
import type { DocsLabels } from './react/shell-labels.js';
import { DocsToc } from './react/toc.js';
import type {
  DocsImageComponent,
  DocsImageProps,
  MarkdownComponents,
} from './react/markdown-components.js';
import type { MarkdownLabels } from './react/markdown-components.js';
import { createMarkdownComponents } from './react/markdown-components.js';
import { DOCS_CONTENT_ID } from './docs-content-id.js';
import type { NextLinkComponent } from './react/link-adapter.js';
import { wrapNextLink } from './react/link-adapter.js';
import type { DocsRenderer } from './render.js';
import { createDocsRenderer } from './render.js';
import type { DocsSource } from './source.js';
import { createDocsSource, resolveDocsConfig } from './source.js';
import { toAliasRoute } from './route-path.js';
import { sitemapLimitWarning } from './sitemap-limit.js';
import type {
  DocFile,
  DocFrontmatter,
  DocsConfig,
  ImageResolver,
  LinkResolver,
  RenderedDoc,
  SearchRecord,
} from './types.js';
import { docsError } from './docs-error.js';

/**
 * Re-exported so a consumer can name the accepted grammar and theme sets
 * without importing the Node-only highlighter entry point.
 */
export type { DocsLang, DocsTheme, DocsThemes };
/*
 * Named, not merely reachable. Both appear in `DocsLayoutProps.search`, and
 * until this line a consumer writing a helper that returns one had no way to
 * spell its type — the modules they live in are private, deliberately.
 */
export type { DocsLayoutSearchProps, SerializableSearchOptions };

/**
 * Pages rendered at once by {@link DocsRoute.renderAll}.
 *
 * High enough that the pipeline — CPU-bound and effectively synchronous — never
 * idles, low enough that an async `imageResolver` cannot put an entire site's
 * worth of trees and network calls in flight simultaneously.
 */
const RENDER_CONCURRENCY = 16;

/* -------------------------------------------------------------------------
 * Lazily-loaded `next` modules
 * ---------------------------------------------------------------------- */

/** The part of `next/image` this adapter uses. */
type NextImageComponent = ComponentType<{
  src: string;
  alt: string;
  width: number;
  height: number;
  title?: string | undefined;
  className?: string | undefined;
  sizes?: string | undefined;
  loading?: 'eager' | 'lazy' | undefined;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * A React component type: a function, or an object tagged with `$$typeof`
 * (`forwardRef`, `memo`, lazy…). Anything else that reaches `createElement`
 * throws four frames inside React.
 */
function isComponentLike(value: unknown): boolean {
  return (
    typeof value === 'function' || (isRecord(value) && '$$typeof' in value)
  );
}

/**
 * Pull the default export out of a lazily-imported module.
 *
 * This is the one place a cast is unavoidable — the import crosses a boundary
 * the compiler cannot see. It is guarded by a runtime check so a missing or
 * mis-shaped `next` surfaces as an error naming the package to install, rather
 * than as `undefined is not a function` four frames inside React.
 */
function readDefaultExport<T>(mod: unknown, specifier: string): T {
  let value = isRecord(mod) && 'default' in mod ? mod.default : mod;

  /*
   * CJS interop can leave the namespace nested one level deeper. Verified
   * against Next 16.3.0 under Node ESM: `next/image`'s default is the plain
   * object `{ default, getImageProps }` with no `$$typeof`, so the real
   * component is at `.default.default` — while `next/link`'s default IS the
   * component (`$$typeof: Symbol(react.forward_ref)`) and must not be
   * unwrapped. Testing for the component shape rather than counting levels
   * handles both, and any future interop that changes the nesting again.
   */
  if (!isComponentLike(value) && isRecord(value) && 'default' in value) {
    value = value.default;
  }

  if (typeof value !== 'function' && !isRecord(value)) {
    throw docsError(
      'missing-peer',
      `@waveso/docs: '${specifier}' has no usable default export. ` +
        'The `@waveso/docs/next` entry point requires Next.js 16 — install ' +
        '`next`, or build your pages from `@waveso/docs/react/*` instead.',
    );
  }
  return value as T;
}

/**
 * Import a `next` module, or explain what is missing.
 *
 * Node's own `ERR_MODULE_NOT_FOUND` for `next/navigation` names a file inside
 * this package, which reads as our bug rather than a missing peer — and the
 * most likely way to reach it is importing `@waveso/docs/next` from a non-Next
 * app, where the fix is to use `@waveso/docs/react/*` with your own loader.
 */
async function importNext(
  load: () => Promise<unknown>,
  specifier: string,
): Promise<unknown> {
  try {
    return await load();
  } catch (error) {
    throw docsError(
      'missing-peer',
      `@waveso/docs: could not load '${specifier}'. The ` +
        '`@waveso/docs/next` entry point needs Next.js 16, which is an ' +
        'optional peer dependency — install `next`. Outside Next, build your ' +
        'pages from `@waveso/docs/react/*` and load content yourself with ' +
        '`@waveso/docs/source` and `@waveso/docs/render`.',
      { cause: error },
    );
  }
}

async function loadNotFound(): Promise<() => never> {
  // The specifier stays a literal so a consumer's bundler resolves it
  // statically, while the dynamic `import()` keeps `next` off the module graph
  // of anyone who never touches this entry point.
  const mod = await importNext(
    () => import('next/navigation'),
    'next/navigation',
  );
  const value = isRecord(mod) ? mod.notFound : undefined;
  if (typeof value !== 'function') {
    throw docsError(
      'missing-peer',
      "@waveso/docs: 'next/navigation' has no `notFound` export. The " +
        '`@waveso/docs/next` entry point requires Next.js 16.',
    );
  }
  return value as () => never;
}

/**
 * Adapt `next/image` to {@link DocsImageProps}.
 *
 * Every prop is named rather than spread. `next/image` types `width`/`height`
 * as `number | \`${number}\``, and spreading a `ComponentProps<'img'>`-shaped
 * object into it fails with TS2322 because the DOM types allow a bare `string`.
 * The build-time {@link ImageResolver} has already produced real numbers here.
 *
 * ⚠️ SO THE LIST IS THE CONTRACT, AND IT HAS TO MATCH `DocsImageProps`. A prop
 * added there and forgotten here is dropped silently — which is what happened to
 * `decoding` and `fetchPriority`, under a comment in `createImage` promising
 * they survived.
 */
function wrapNextImage(NextImage: NextImageComponent): DocsImageComponent {
  return function DocsNextImage({
    src,
    alt,
    width,
    height,
    title,
    className,
    sizes,
    loading,
    decoding,
    fetchPriority,
  }: DocsImageProps): ReactNode {
    return createElement(NextImage, {
      src,
      alt,
      width,
      height,
      ...(title === undefined ? {} : { title }),
      ...(className === undefined ? {} : { className }),
      ...(sizes === undefined ? {} : { sizes }),
      ...(loading === undefined ? {} : { loading }),
      ...(decoding === undefined ? {} : { decoding }),
      ...(fetchPriority === undefined ? {} : { fetchPriority }),
    });
  };
}

/**
 * A memo for the component map, one per route.
 *
 * `createMarkdownComponents` returns fresh component identities on every call,
 * and a new identity for `a` remounts every link in the document on every
 * render — so this memo is correctness, not micro-optimisation.
 *
 * ⚠️ PER ROUTE, NOT PER PROCESS, SINCE THE MAP CLOSES OVER THE ROUTE'S LABELS.
 * A single process-wide memo would hand the second route the first route's
 * language. Nothing is lost: `import()` caches the `next/link` and `next/image`
 * modules itself, so all a second route pays for is two wrapper identities —
 * and a route's identities only ever have to be stable against themselves,
 * because the pages that use them come from that same route.
 */
function createComponentsMemo(
  labels: MarkdownLabels | undefined,
): () => Promise<NextRenderComponents> {
  let memo: Promise<NextRenderComponents> | null = null;
  return () => {
    if (memo === null) {
      memo = buildNextComponents(labels).catch((error: unknown) => {
        // Evicted on failure so one transient import error does not poison
        // every later render in the process.
        memo = null;
        throw error;
      });
    }
    return memo;
  };
}

/**
 * The map the markdown renderer needs, plus the one component something outside
 * it needs too.
 *
 * ⚠️ `link` IS THE SAME IDENTITY THE MAP HOLDS, AND THAT IS THE REASON IT IS
 * HERE RATHER THAN BUILT AGAIN. `wrapNextLink` returns a fresh function every
 * call, and a fresh identity remounts what it renders on every pass — which is
 * exactly the bug this memo exists to prevent for `a`. The hero's actions are
 * links on the page's most-clicked element; they get the memoised one.
 */
interface NextRenderComponents {
  components: MarkdownComponents;
  link: DocsLinkComponent;
}

async function buildNextComponents(
  labels: MarkdownLabels | undefined,
): Promise<NextRenderComponents> {
  const [linkMod, imageMod] = await Promise.all([
    importNext(() => import('next/link'), 'next/link'),
    importNext(() => import('next/image'), 'next/image'),
  ]);

  const NextLink = readDefaultExport<NextLinkComponent>(linkMod, 'next/link');
  const NextImage = readDefaultExport<NextImageComponent>(
    imageMod,
    'next/image',
  );

  const link = wrapNextLink(NextLink);

  return {
    components: createMarkdownComponents({
      Link: link,
      Image: wrapNextImage(NextImage),
      ...(labels === undefined ? {} : { labels }),
    }),
    link,
  };
}

/* -------------------------------------------------------------------------
 * Route
 * ---------------------------------------------------------------------- */

export interface DocsRouteOptions<
  TFrontmatter extends DocFrontmatter = DocFrontmatter,
> extends DocsConfig<TFrontmatter> {
  /** Overrides merged over the Next-flavoured defaults (`next/link` + `next/image`). */
  components?: MarkdownComponents | undefined;
  /**
   * Links to the pages either side of this one, under every page. Default on.
   *
   * The order is the navigation's, so it cannot disagree with the sidebar —
   * see `nav-order.ts`. Nothing is authored: a page gets a pager by being in
   * the tree, and a page outside it gets none.
   *
   * `false` omits it, for a host whose own layout already ends a page.
   */
  pager?: boolean | undefined;
  /** Reuse an existing Shiki highlighter. */
  highlighter?: DocsHighlighter | Promise<DocsHighlighter> | undefined;
  /** Grammars to load, when building the default highlighter. */
  langs?: readonly DocsLang[] | undefined;
  /** Theme pair. */
  themes?: DocsThemes | undefined;
  /**
   * Fence languages Shiki must not touch, e.g. `['mermaid']`.
   *
   * The `<pre><code class="language-mermaid">` then reaches your `pre`/`code`
   * component untouched, which is what lets you render a diagram instead of a
   * monochrome block of DSL.
   */
  excludeLangs?: readonly string[] | undefined;
  /**
   * Prepend an `<h1>` from `frontmatter.title` when the markdown has none.
   * Defaults to `true`; turn it off if your layout renders the title itself.
   */
  titleHeading?: boolean | undefined;
  /**
   * Extra remark plugins, attached after `remarkGfm` and before link
   * resolution — so anything they emit is folded, contained and asserted like
   * authored markdown.
   */
  remarkPlugins?: PluggableList | undefined;
  /**
   * Extra rehype plugins, attached after heading ids and permalinks exist and
   * before the code steps — so a `<pre>` is still the author's text rather
   * than Shiki's token spans.
   */
  rehypePlugins?: PluggableList | undefined;
  /** Replaces the built-in markdown-link resolution. */
  linkResolver?: LinkResolver | undefined;
  /**
   * Resolves image `src` to a public URL and intrinsic dimensions. Without one,
   * markdown images render as a plain `<img>`: `next/image` refuses to render
   * without dimensions, and markdown carries none.
   */
  imageResolver?: ImageResolver | undefined;
  /**
   * Absolute site origin, e.g. `'https://example.com'`.
   *
   * When set, `alternates.canonical` is an absolute URL. When omitted it is a
   * root-relative path, which Next resolves against `metadataBase` — so if you
   * set neither, you ship pages with no usable canonical.
   */
  siteUrl?: string | undefined;
  /**
   * MiniSearch overrides for the index {@link DocsRoute.searchIndex} builds.
   *
   * ⚠️ THE IDENTICAL OBJECT MUST REACH THE DIALOG. MiniSearch reads `tokenize`
   * and `processTerm` both when indexing and when querying, so applying one
   * here and not there produces an index whose terms no query can spell: zero
   * results, no error, nothing in the console.
   *
   * {@link DocsRoute.Layout} forwards this for you, which covers every
   * serialisable override — `storeFields`, `boost`, `searchOptions.fuzzy`. It
   * cannot forward a **function**: the dialog is a Client Component and props
   * crossing that boundary are serialised, so `tokenize`, `processTerm` and
   * their kind make `next build` fail. Rather than drop them silently — which
   * is the zero-results failure above, with the warning turned off — `Layout`
   * throws `invalid-config` and names the remedy: pass `search={false}`, render
   * `DocsSearch` from a `'use client'` module of your own, and import the same
   * function there. See {@link SerializableSearchOptions}.
   */
  miniSearchOptions?: Partial<MiniSearchOptions<SearchRecord>> | undefined;
  /**
   * Every string this package renders that is not your content.
   *
   * ⚠️ THE ROUTE IS WHERE THEY BELONG, BECAUSE THEY DO NOT ALL LIVE IN ONE
   * RUNTIME. Four are rendered by the shell, two by the table of contents, nine
   * by the markdown component map, two by a client-side copy runtime — and two
   * are baked into the HTML by a rehype plugin at build time. `docs.Layout` can
   * reach the first four and no more, which is exactly why its own `labels` prop
   * documented itself as the whole set and covered less than a fifth of it.
   *
   * `docs.Layout` forwards these for you, and its `labels` prop still overrides
   * them per-layout. Set them once here.
   */
  labels?: DocsLabels | undefined;
}

/**
 * Props for {@link DocsRoute.Layout}.
 *
 * Three, and one of them is `children`. Everything else a docs shell is asked
 * for turned out to be reachable already: an announcement banner renders
 * *above* `<docs.Layout>` in your own `layout.tsx`, because this does not own
 * `<body>`; a content footer goes inside `children`; and sidebar links, social
 * icons and separators are `DocNavNode`s authored in `meta.json`. A theme
 * toggle and a repository link go in the layout you write around this one — the
 * host wraps `docs.Layout` exactly as it already wraps `<html>` and `<body>`,
 * so there is no region only this package can reach.
 *
 * The one region a host cannot reach through `docs.Layout` is *inside* the
 * sidebar, and the exported primitives are the answer for that: `DocsSidebar`,
 * `DocsToc`, `DocContent` and `SkipLink` compose into a layout of your own.
 *
 * A `slots` map was the alternative, and shipping none is the reversible half —
 * a map can be added the day something needs one, a map that shipped cannot be
 * taken back.
 */
export interface DocsLayoutProps {
  children: ReactNode;
  /*
   * ⚠️ `title` AND `actions` WERE HERE, AND BOTH WENT WITH THE HEADER THEY
   * LIVED IN.
   *
   * `title` was a brand slot. A brand belongs to the index page's own title,
   * which is content — authored, translatable, part of what a reader came for.
   * `actions` was a theme toggle, a repository link, a version switcher; all
   * three belong to the host's layout, which wraps this one exactly as it
   * already does for `<html>` and `<body>`.
   *
   * The argument that justified `actions` was that the header bar was the one
   * region nothing else could reach. There is no header bar.
   */
  /**
   * The search trigger. Defaults to on, and the URL is always derived.
   *
   * `false` omits it. An object configures the dialog — `placeholder`,
   * `pageSize`, `minQueryLength`, the state messages and the rest of
   * `DocsSearch`'s surface, minus `indexUrl`.
   *
   * (It used to say `hotkey`. There is no such prop and there never was: the
   * shortcut is ⌘K / Ctrl-K and is not configurable. A docstring naming an
   * option that does not exist is worse than one naming none.)
   *
   * You do not need to pass `miniSearchOptions` here to match what
   * `createDocsRoute` was given: the route's own value is forwarded, so the
   * object that built the index is the object that queries it. Pass one only
   * to override that.
   *
   * Serialisable overrides only, in both directions. This is a Server
   * Component handing props to a Client one, so a `tokenize` or a
   * `processTerm` here does not compile and one on the route throws rather
   * than being quietly dropped — {@link SerializableSearchOptions} has the
   * `'use client'` recipe for those.
   */
  search?: boolean | DocsLayoutSearchProps | undefined;
  /**
   * Overrides for the strings the shell renders, over the route's.
   *
   * ⚠️ THIS DOCSTRING USED TO CLAIM TO BE "THE WHOLE OF WHAT A NON-ENGLISH SITE
   * HAS TO SAY" AND REACHED FOUR STRINGS OF TWENTY-TWO. It could not have
   * reached the rest: the table of contents is rendered by `docs.Page`, the
   * callout headings by a component map built when the route is created, and the
   * copy button is baked into the HTML by a rehype plugin at build time. None of
   * those is downstream of a layout prop.
   *
   * So the set lives on {@link DocsRouteOptions.labels}, which is upstream of
   * all four runtimes, and this overrides it key by key — for a site with two
   * shells, or a section in another language. Whole-object replacement would
   * mean naming one string cost you the other twenty-one.
   */
  labels?: DocsLabels | undefined;
  /**
   * The sidebar's marker column: `true` (default), `false`, or your own icons
   * keyed by the `icon` names your content authors in frontmatter and
   * `meta.json`. See `DocsSidebarProps.icons`.
   *
   * ⚠️ EVERY COMPONENT IN THE MAP MUST BE A CLIENT COMPONENT — the same
   * boundary `search` documents at length. This is a Server Component handing
   * props to a Client one, so React serialises a *reference* to a client
   * component and cannot serialise a server one. Icons imported from a library
   * already satisfy this; one defined inline in a server file fails the build
   * at the boundary.
   */
  icons?: boolean | DocsIconMap | undefined;
}

/** Props Next hands a page in the App Router. */
export interface DocsPageProps {
  /**
   * Next 16 passes route params as a promise, and reading it without awaiting
   * yields a `Promise` object where a string array was expected.
   *
   * `slug` is optional so one signature serves both the catch-all route and
   * the index route, which has no params at all.
   */
  params: Promise<{ slug?: string[] }>;
}

/**
 * Page metadata, shaped to be assignable to Next's `Metadata`.
 *
 * Structural rather than imported for the same reason as
 * {@link NextLinkComponent}: `next` is optional, and our published types must
 * not require it.
 */
export interface DocsPageMetadata {
  title?: string;
  description?: string;
  alternates?: { canonical: string };
  openGraph?: {
    type: 'article';
    title: string;
    description?: string;
    url: string;
  };
}

/**
 * What {@link createDocsRoute} returns.
 *
 * The type parameter comes from `frontmatterSchema` on the options, so
 * `docs.getPage(...)` and `docs.source.all()` hand back your own frontmatter
 * fields without a type argument anywhere in the route file.
 */
export interface DocsRoute<
  TFrontmatter extends DocFrontmatter = DocFrontmatter,
> {
  /**
   * Default export for `app/<basePath>/[...slug]/page.tsx`.
   *
   * The catch-all is required — see {@link DocsRoute.IndexPage}.
   */
  Page: (props: DocsPageProps) => Promise<ReactNode>;
  /**
   * Default export for `app/<basePath>/page.tsx`. Renders the content root's
   * `index.md`.
   *
   * This second file is not optional, and leaving it out is the most common way
   * to ship this broken. `[...slug]` does not match `/docs` itself: the route
   * table emits `/docs/index`, and `/docs` returns 404.
   *
   * The fix is a sibling `page.tsx`, *not* an optional catch-all `[[...slug]]`.
   * The optional form does match `/docs`, but it also leaves `/docs/index` live
   * and serving byte-identical HTML — a duplicate-content pair with no
   * canonical between them — and it makes `params.slug` possibly `undefined`
   * for every page.
   */
  IndexPage: () => Promise<ReactNode>;
  /**
   * `generateStaticParams` for the catch-all route.
   *
   * The root `index.md` is deliberately absent: its segments are `[]`, and a
   * catch-all cannot render an empty parameter list. It is served by
   * {@link DocsRoute.IndexPage}.
   */
  generateStaticParams: () => Promise<Array<{ slug: string[] }>>;
  /** `generateMetadata` for either route file. Sets `alternates.canonical`. */
  generateMetadata: (props: DocsPageProps) => Promise<DocsPageMetadata>;
  /**
   * The value your route file must declare. Read it, do not re-export it.
   *
   * ```ts
   * export const dynamicParams = false; // ✅ a literal
   * export const dynamicParams = docs.dynamicParams; // ❌ fails the build
   * ```
   *
   * Route segment config is statically parsed out of the module by the
   * compiler, before any of it runs, so it has to be a literal. A member
   * expression fails `next build` outright with "Next.js can't recognize the
   * exported `dynamicParams` field in route. It needs to be a static boolean."
   * (verified against Next 16.3.0 / Turbopack). This field exists so the value
   * is documented in one place and typed as `false`, not so it can be
   * forwarded.
   *
   * Declaring it is not optional. Next defaults `dynamicParams` to `true`, so
   * a URL `generateStaticParams` never listed is still invoked on demand: the
   * route runs on a server at request time to produce a 404 that was already
   * knowable at build time. `output: 'export'` refuses to build without it at
   * all. With the full page set known ahead of time there is nothing to render
   * on demand anyway, and a prerendered 404 is both faster and cacheable.
   *
   * (An earlier version of this note claimed an unlisted URL reached
   * `fs.readFile` and returned HTTP 500. It does not: `find()` is a lookup in
   * the map built by the directory walk, so a miss is just `undefined`. The
   * export is still required, for the reasons above.)
   */
  dynamicParams: false;
  /**
   * The underlying source, for layouts: `docs.source.nav()` feeds
   * `DocsSidebar`.
   */
  source: DocsSource<TFrontmatter>;
  /**
   * Render one page yourself, for a custom layout that needs the TOC or the
   * frontmatter alongside the content. Resolves to `undefined` when no such
   * page exists, or when it is a draft and `includeDrafts` is off.
   */
  getPage: (
    segments: string[],
  ) => Promise<RenderedDoc<TFrontmatter> | undefined>;
  /**
   * Every published page, rendered. The escape hatch behind
   * {@link DocsRoute.searchIndex}, for anyone building their own artifact out
   * of `extractSearchRecords`.
   */
  renderAll: () => Promise<Array<RenderedDoc<TFrontmatter>>>;
  /**
   * `GET` handler for `app/<basePath>/search-index.json/route.ts`, serving the
   * MiniSearch index the dialog fetches.
   *
   * ```ts
   * // app/docs/search-index.json/route.ts — the whole file
   * import { docs } from '@/lib/docs';
   *
   * export const GET = docs.searchIndex;
   * export const dynamic = 'force-static'; // a literal, see below
   * ```
   *
   * **`dynamic = 'force-static'` is not optional and must be a literal**, for
   * the same reason as {@link DocsRoute.dynamicParams}: route segment config is
   * parsed out of the module before any of it runs. Without it Next marks the
   * route `ƒ` (Dynamic) and re-renders your entire corpus on every request —
   * from markdown that output tracing did not put in the deployment bundle, so
   * on a serverless host it does not merely get slow, it throws, at the reader,
   * inside the search dialog. The build prints no warning for this, so the
   * handler detects it at runtime and throws with `code:
   * 'search-index-dynamic'` instead of failing quietly.
   *
   * The index is built from the same `renderAll()` → `extractSearchRecords` →
   * `buildSearchIndex` pipeline you could write by hand, with the `charset`-free
   * `application/json` content type, a strong `ETag` and
   * `cache-control: public, max-age=0, must-revalidate` — Next's default for a
   * prerendered route is a year of `s-maxage` with no validator, which on a
   * stable URL means a CDN serving last year's index until someone purges it.
   */
  searchIndex: () => Promise<Response>;
  /**
   * Default export for `app/<basePath>/layout.tsx` — the entire docs shell.
   *
   * ```tsx
   * // app/docs/layout.tsx — the whole file
   * import '@waveso/docs/styles.css';
   * import { docs } from '@/lib/docs';
   *
   * export default docs.Layout;
   * ```
   *
   * Or, with your own chrome *around* it — the same layout file `<html>` and
   * `<body>` live in, and `SiteHeader` is yours:
   *
   * ```tsx
   * export default function DocsLayout({ children }: { children: ReactNode }) {
   *   return (
   *     <>
   *       <SiteHeader />
   *       <docs.Layout search={{ placeholder: 'Search the docs' }}>
   *         {children}
   *       </docs.Layout>
   *     </>
   *   );
   * }
   * ```
   *
   * If that header of yours is sticky, say how tall it is once —
   * `--wave-docs-chrome-offset: 4rem` — and our sticky columns start below it.
   *
   * It owns the skip link, the sidebar — one shell at every width, holding the
   * navigation and the 44px strip that moves it — the search trigger and the
   * grid.
   * It reads `source.nav()` and `searchIndexUrl` itself, so there is no nav to
   * fetch and no URL to pass. It does **not** own the table of contents: a Next
   * layout receives `{children, params}` and cannot know which page is
   * rendering, so `docs.Page` emits the TOC as its second child and the grid
   * places it.
   *
   * Your `layout.tsx` stays a Server Component. The two pieces that need a
   * client — the nav's `usePathname`, the search dialog — carry their own
   * `'use client'` boundaries inside the package.
   *
   * Next passes `{ children, params }`; the extra `params` is ignored, which is
   * why `export default docs.Layout` type-checks as a layout.
   */
  Layout: (props: DocsLayoutProps) => Promise<ReactNode>;
  /**
   * `${basePath}/search-index.json` — hand it to `DocsSearch`'s `indexUrl`.
   *
   * Derived from the route's own `basePath`, so it is right when the docs are
   * mounted at `/`, at `/docs`, or under a nested prefix. It is *not* prefixed
   * with Next's `basePath` config, which Next applies to `<Link>` and to
   * navigation but never to a client `fetch()` — on a site setting that, prefix
   * it yourself.
   */
  searchIndexUrl: string;
}

/**
 * The named subset of `labels`, or `undefined` when none of it is set.
 *
 * `undefined` rather than `{}` is the point: every forwarding site here spreads
 * with `...(x === undefined ? {} : { x })`, so an empty object would still add a
 * prop — and for the two groups that cross a client boundary that is a prop in
 * every page's payload, forever, saying nothing.
 *
 * `map` goes target-key → `DocsLabels` key, so the rename is visible at the call
 * site rather than hidden in a component.
 */
function pickLabels<TKey extends string>(
  labels: DocsLabels | undefined,
  map: Record<TKey, keyof DocsLabels>,
): Record<TKey, string> | undefined {
  if (labels === undefined) return undefined;

  const picked: Partial<Record<TKey, string>> = {};
  let found = false;
  for (const [target, source] of Object.entries(map) as Array<
    [TKey, keyof DocsLabels]
  >) {
    const value = labels[source];
    if (value !== undefined) {
      picked[target] = value;
      found = true;
    }
  }
  return found ? (picked as Record<TKey, string>) : undefined;
}

/**
 * `candidate`, once it is known to hold no functions.
 *
 * The cast at the end is the whole point of the function, and
 * {@link findFunctionValuedOptions} is what earns it: a structural walk over
 * the values, so it answers for options MiniSearch has not shipped yet as well
 * as the five it has. `SerializableSearchOptions` narrows the same thing at
 * compile time, which is friendlier and strictly weaker — a JavaScript caller
 * has no types at all, and an `Omit` list goes stale the minor MiniSearch adds
 * a callback.
 *
 * Throwing beats dropping. Silently forwarding the serialisable half would
 * rebuild the original defect this channel exists to close — an index built
 * with a `processTerm` the query does not share returns nothing, reports
 * nothing, and looks like an empty corpus.
 */
function serializableSearchOptions(
  candidate: Partial<MiniSearchOptions<SearchRecord>>,
): SerializableSearchOptions {
  const functions = findFunctionValuedOptions(candidate);
  if (functions.length > 0) {
    throw docsError(
      'invalid-config',
      'the search dialog cannot be given MiniSearch functions from a server ' +
        `component: ${functions
          .map((name) => `\`miniSearchOptions.${name}\``)
          .join(', ')}. \`docs.Layout\` renders the dialog as a client ` +
        'component, so its props are serialised on the way across and React ' +
        'rejects a function with "Functions cannot be passed directly to ' +
        'Client Components" while prerendering. Keep the function on ' +
        '`createDocsRoute` so the index is still built with it, pass ' +
        '`search={false}` to `docs.Layout`, and render the dialog yourself ' +
        "from a `'use client'` module that imports the same function — " +
        '`<DocsSearch indexUrl={docs.searchIndexUrl} miniSearchOptions={{ ' +
        'processTerm }} />` in your own layout. ' +
        'Serialisable overrides (`storeFields`, `boost`, ' +
        '`searchOptions.fuzzy`) need none of this and are forwarded as before.',
    );
  }
  return candidate as SerializableSearchOptions;
}

/**
 * Create the route handlers for a documentation tree.
 *
 * Call it once at module scope in each of the two route files. The filesystem
 * scan, the highlighter and the component map are all shared per process, so
 * the second call is free.
 */
export function createDocsRoute<
  TFrontmatter extends DocFrontmatter = DocFrontmatter,
>(options: DocsRouteOptions<TFrontmatter>): DocsRoute<TFrontmatter> {
  const config = resolveDocsConfig(options);
  const source = createDocsSource(options);
  const siteUrl = normalizeSiteUrl(options.siteUrl);
  // Re-read the content directory on every request outside a production
  // build. Markdown is not in Next's module graph, so nothing re-evaluates a
  // route module when a file changes: without this, `next dev` serves what it
  // read on the first request until the server restarts, and a file added
  // afterwards is never found. It was an option; nobody should have turned it
  // off, and `docs.source.invalidate()` is the escape hatch if anyone must.
  const rescanPerRequest = process.env.NODE_ENV !== 'production';

  /*
   * The route's labels, split by the runtime that renders them.
   *
   * Four groups, because they cannot share a channel: the code-frame strings are
   * baked into the HTML by a rehype plugin, the content strings are closed over
   * by the component map, the copy-status strings cross into a client runtime,
   * and the shell's four are resolved by `DocsLayoutShell`. A single `labels`
   * prop on `docs.Layout` could only ever reach the last group — which is why
   * that prop's docstring claimed the whole set and delivered four of
   * twenty-two.
   *
   * Each group is `undefined` when nothing in it is set, so an unconfigured site
   * passes no extra props anywhere and its payload is byte-identical.
   */
  /*
   * `routeLabels`, not `labels`: `Layout` destructures a `labels` prop of its
   * own, and a binding of the same name at this scope is shadowed inside it —
   * silently, and in the one function where confusing the host's labels with the
   * route's would be a bug nothing catches.
   */
  const routeLabels = options.labels;
  const codeLabels = pickLabels(routeLabels, {
    copyLabel: 'copyCode',
    copyFromLabel: 'copyCodeFrom',
  });
  const contentLabels = pickLabels(routeLabels, {
    externalLink: 'externalLink',
    table: 'table',
    calloutNote: 'calloutNote',
    calloutTip: 'calloutTip',
    calloutImportant: 'calloutImportant',
    calloutWarning: 'calloutWarning',
    calloutCaution: 'calloutCaution',
    youtubeTitle: 'youtubeTitle',
    youtubePlay: 'youtubePlay',
    youtubeHide: 'youtubeHide',
  });
  const copyLabels = pickLabels(routeLabels, {
    copied: 'copied',
    copyFailed: 'copyFailed',
  });
  const loadComponents = createComponentsMemo(contentLabels);

  // Built on first render, not on import: `generateStaticParams` runs in its
  // own pass and has no use for a syntax highlighter.
  let renderer: DocsRenderer | null = null;
  // Populated from the source walk; `createDocsRenderer` reads it at render
  // time, which is what lets one live set serve every page.
  const knownRoutes = new Set<string>();
  // The routes `knownRoutes` deliberately omits. Diagnostic only: the renderer
  // reads it after `knownRoutes` has already missed, purely to tell an author
  // linking a draft from an author linking a typo.
  const draftRoutes = new Set<string>();
  // Alias route → the href it redirects to. Also diagnostic, and also
  // deliberately not merged into `knownRoutes`: see `collectRoutes`.
  const aliasRoutes = new Map<string, string>();
  let routesLoaded: Promise<void> | null = null;

  /**
   * Drop the cached scan so the next query reads the disk again — at most once
   * per request.
   *
   * `React.cache` is doing real work here, not memoising for speed. Next runs
   * `generateMetadata` and `Page` concurrently, and a layout calling
   * `source.nav()` is a third caller; each used to invalidate independently,
   * so each discarded the others' in-flight scan. Measured on a 401-file tree:
   * 22 readdir + 824 readFile per request, against 11 + 412 for a single scan,
   * at 39 ms — which is also why the old docstring's "single-digit
   * milliseconds" was wrong. Inside a request the first caller invalidates and
   * the rest see the memo; outside one (a sitemap built from `next.config.ts`,
   * a script) `cache` does not memoise at all, so those callers keep the old
   * invalidate-every-time behaviour, which is what they want.
   *
   * `knownRoutes` is added to, never cleared: it is shared with the renderer,
   * and emptying it while a concurrent render is asserting links would fail
   * that page for a link that is perfectly valid. A route left behind by a
   * deleted page only makes dev *more* permissive than the production build,
   * which is the right direction to be wrong in.
   */
  const invalidate = cache((): void => {
    source.invalidate();
    routesLoaded = null;
  });

  /**
   * Record each page's own route in `into`, and each of its aliases in
   * `aliasRoutes`.
   *
   * The two are kept apart on purpose. An alias used to be added to
   * `knownRoutes` on the reasoning that a permanent redirect resolves — but it
   * only resolves once `createDocsRedirects` is wired into `next.config.ts`,
   * which the quick start never does, and `generateStaticParams` does not emit
   * it either. So a page linking a sibling's alias built green and 404'd for
   * every reader, with `dynamicParams = false` making it a hard 404. The
   * renderer now names the alias's target instead, which is better advice than
   * the acceptance ever was: the author gets told where the page actually is.
   */
  const collectRoutes = (
    into: Set<string>,
    files: ReadonlyArray<DocFile<TFrontmatter>>,
  ): void => {
    for (const file of files) {
      into.add(file.href);
      for (const alias of file.frontmatter.aliases ?? []) {
        aliasRoutes.set(
          toAliasRoute(alias, config.basePath, file.relativePath),
          file.href,
        );
      }
    }
  };

  const loadRoutes = (): Promise<void> =>
    (routesLoaded ??= Promise.all([source.all(), source.drafts()]).then(
      ([published, drafts]) => {
        collectRoutes(knownRoutes, published);
        collectRoutes(draftRoutes, drafts);
      },
    ));

  const loadRenderer = (): DocsRenderer =>
    (renderer ??= createDocsRenderer({
      config,
      knownRoutes,
      draftRoutes,
      aliasRoutes,
      ...(options.highlighter === undefined
        ? {}
        : { highlighter: options.highlighter }),
      ...(options.langs === undefined ? {} : { langs: options.langs }),
      ...(options.themes === undefined ? {} : { themes: options.themes }),
      ...(options.excludeLangs === undefined
        ? {}
        : { excludeLangs: options.excludeLangs }),
      ...(codeLabels === undefined ? {} : { codeLabels }),
      ...(options.titleHeading === undefined
        ? {}
        : { titleHeading: options.titleHeading }),
      ...(options.remarkPlugins === undefined
        ? {}
        : { remarkPlugins: options.remarkPlugins }),
      ...(options.rehypePlugins === undefined
        ? {}
        : { rehypePlugins: options.rehypePlugins }),
      ...(options.linkResolver === undefined
        ? {}
        : { linkResolver: options.linkResolver }),
      ...(options.imageResolver === undefined
        ? {}
        : { imageResolver: options.imageResolver }),
    }));

  /** Re-read the disk on the route's schedule before delegating. */
  const rescanned = <TArgs extends unknown[], TResult>(
    read: (...args: TArgs) => Promise<TResult>,
  ): ((...args: TArgs) => Promise<TResult>) => {
    return (...args: TArgs) => {
      if (rescanPerRequest) {
        invalidate();
      }
      return read(...args);
    };
  };

  /**
   * The source handed to layouts.
   *
   * `docs.source.nav()` is the documented way to feed `DocsSidebar`, and it was
   * the one reader that never invalidated — so in dev, the request after adding
   * or renaming a page rendered the *new* body beside the *old* sidebar, and
   * only the request after that agreed with itself. Everything else on the
   * route already rescanned; this closes the last hole.
   */
  const requestScopedSource: DocsSource<TFrontmatter> = {
    config: source.config,
    all: rescanned(() => source.all()),
    drafts: rescanned(() => source.drafts()),
    find: rescanned((segments: string[]) => source.find(segments)),
    nav: rescanned(() => source.nav()),
    slugs: rescanned(() => source.slugs()),
    invalidate: () => {
      source.invalidate();
      routesLoaded = null;
    },
  };

  /**
   * `find` returns drafts regardless of config so a preview route can opt in;
   * a public route must not.
   */
  const findVisible = async (
    segments: string[],
  ): Promise<DocFile<TFrontmatter> | undefined> => {
    if (rescanPerRequest) {
      invalidate();
    }
    const file = await source.find(segments);
    if (file === undefined) {
      return undefined;
    }
    if (!config.includeDrafts && file.frontmatter.draft === true) {
      return undefined;
    }
    return file;
  };

  const getPage = async (
    segments: string[],
  ): Promise<RenderedDoc<TFrontmatter> | undefined> => {
    const file = await findVisible(segments);
    if (file === undefined) {
      return undefined;
    }
    await loadRoutes();
    return loadRenderer().render(file);
  };

  const renderAll = async (): Promise<Array<RenderedDoc<TFrontmatter>>> => {
    if (rescanPerRequest) {
      invalidate();
    }
    const files = await source.all();
    await loadRoutes();
    const renderer = loadRenderer();
    const rendered = await mapPooled(files, RENDER_CONCURRENCY, (file) =>
      renderer.render(file),
    );

    /*
     * ⚠️ CROSS-PAGE ANCHORS CAN ONLY BE CHECKED HERE, AND THIS IS THE FIRST
     * MOMENT THEY CAN. `render` sees one page, so it can prove `#setup` exists
     * on the page being rendered and nothing about `./other.md#setup` — the ids
     * of `other` do not exist until `other` has been rendered. Once every page
     * is in hand they all do.
     *
     * `renderAll` runs in every build that serves search: the index route is
     * `force-static`, so Next prerenders it, so this pass happens. A consumer
     * who renders pages by hand and never calls it gets the same-page half,
     * which is the half with line numbers anyway.
     */
    assertAnchors(rendered, (from, link, known) => {
      reportAnchor(
        `@waveso/docs: ${from} links to '${link.href}', and '${link.route}' ` +
          `has no '#${link.fragment}'.${describeSuggestion(
            link.fragment,
            known,
          )} Heading ids come from the heading text, so renaming a heading ` +
          'renames its anchor.',
      );
    });

    return rendered;
  };

  /**
   * A cross-page anchor failure, at the configured severity.
   *
   * No line number, unlike the same-page check: positions are stripped from a
   * returned tree, so the page and the link are what there is to name. Both
   * halves share `onBrokenAnchors`, because to an author they are one mistake.
   */
  const reportAnchor = (message: string): void => {
    if (config.onBrokenAnchors === 'ignore') return;
    if (config.onBrokenAnchors === 'throw') {
      throw docsError('broken-anchor', message);
    }
    console.warn(message);
  };

  const searchIndexUrl = `${config.basePath}/search-index.json`;

  /**
   * Fail loudly when the search-index route was not frozen at build time.
   *
   * The signal is `NEXT_PHASE`, which Next sets to `phase-production-build`
   * while prerendering — verified in both output modes, and `undefined` under
   * `next start`. It is internal and undocumented, which is why the CI smoke
   * build asserts the prerendered body exists: if this ever changes meaning it
   * fails there, in this repository, rather than in a consumer's deploy.
   *
   * The alternative was a `console.error`, and it is not one. A warning in a
   * serverless log is unread, and the observable symptom — a search dialog
   * stuck on "could not load the index" — arrives days later with nothing
   * connecting it to a missing line in a route file.
   */
  const assertPrerendered = (): void => {
    if (
      process.env.NODE_ENV === 'production' &&
      process.env.NEXT_PHASE !== 'phase-production-build'
    ) {
      throw docsError(
        'search-index-dynamic',
        'the search index was requested at runtime instead of being built ' +
          `into your deployment. Add \`export const dynamic = 'force-static'\` ` +
          `to app${searchIndexUrl}/route.ts — it has to be a literal, like ` +
          '`dynamicParams`. Without it Next re-renders every page of your ' +
          'corpus per request, from markdown that is not in the deployment ' +
          'bundle. (Building the index somewhere else on purpose? Use ' +
          '`docs.renderAll()` with `extractSearchRecords` and ' +
          '`buildSearchIndex` from `@waveso/docs/search-index` instead of ' +
          'calling this handler.)',
      );
    }
  };

  const searchIndex = async (): Promise<Response> => {
    assertPrerendered();
    // Lazy so MiniSearch stays off the module graph of `next.config.ts`, which
    // loads this entry point for `createDocsSitemap`/`createDocsRedirects`.
    const { buildSearchIndex, extractSearchRecords } = await import(
      './search-index.js'
    );
    const rendered = await renderAll();
    const json = buildSearchIndex(
      rendered.flatMap((doc) => extractSearchRecords(doc)),
      options.miniSearchOptions ?? {},
    );

    return new Response(json, {
      headers: {
        // No `charset`: JSON is UTF-8 by definition and the parameter is not
        // defined for this media type (RFC 8259 §11).
        'content-type': 'application/json',
        // Next's default for a `force-static` route is
        // `s-maxage=31536000` with no validator, so a CDN in front of a
        // self-hosted `next start` pins a year-old index to a URL that never
        // changes. `must-revalidate` on a stable URL with a strong ETag is
        // the shape a docs index actually wants: revalidation is a 304.
        'cache-control': 'public, max-age=0, must-revalidate',
        // Strong, not weak: the body is byte-stable for a given corpus, which
        // `buildSearchIndex` guarantees, so byte equality is the real
        // equivalence here and a `W/` prefix would understate it.
        etag: `"${createHash('sha1').update(json).digest('hex')}"`,
      },
    });
  };

  async function renderRoute(segments: string[]): Promise<ReactNode> {
    const doc = await getPage(segments);
    if (doc === undefined) {
      const notFound = await loadNotFound();
      return notFound();
    }

    const { components, link } = await loadComponents();

    /*
     * TWO CHILDREN, AND THEY MUST STAY DIRECT CHILDREN OF THE GRID.
     *
     * `docs.Layout` renders `{children}` straight into `.wave-docs-layout`
     * without a wrapper, so the article and the TOC land in their own
     * `grid-template-columns` tracks. Next inserts nothing around a page's
     * output, which is what makes that hold — wrap these two in a `<div>` here
     * and the TOC moves inside the article's column while the third track
     * sits empty at every width above 80rem.
     *
     * The TOC is emitted here rather than by the layout because a Next layout
     * receives `{children, params}` and has no way to know which page is
     * rendering, and `doc.toc` comes from the render `getPage` just did.
     * Recovering it client-side would mean a second slugging pass over the
     * DOM, which is the thing `DocContent` refuses to do.
     */
    return createElement(
      Fragment,
      null,
      createElement(
        /*
         * ⚠️ `main`, NOT `article`. This is the page's main landmark, and it
         * was an `<article>` — which gave the shell a `banner`, a `navigation`
         * and a `complementary` and no `main` at all. A screen-reader user
         * navigating by landmark, which is how they skip a hundred-link
         * sidebar without tabbing, had nothing to jump to; the skip link
         * covered the keyboard case and hid the missing landmark behind it.
         *
         * One `<main>` per document is the constraint, and this satisfies it:
         * `docs.Layout` renders a navigation landmark and nothing else that
         * competes for the role, and `docs.Page` is the only thing inside it.
         */
        'main',
        {
          // `wave-docs-prose` is NOT here: `DocContent` owns it, so the one
          // hand-rolled path in the README cannot forget it.
          className: 'wave-docs-layout__main',
          // The target `SkipLink` points at by default. `tabIndex` with it: a
          // fragment link moves the scroll position but not always the focus,
          // so an unfocusable target leaves a keyboard user stranded at the
          // top of the sidebar they were trying to skip.
          id: DOCS_CONTENT_ID,
          tabIndex: -1,
        },
        /*
         * The hero, when the page asked for one. `null` otherwise, and `null`
         * renders nothing — so an ordinary page pays no markup for a feature
         * it did not opt into.
         */
        (doc.frontmatter.actions?.length ?? 0) === 0
          ? null
          : createElement(DocsHero, {
              title: doc.frontmatter.title,
              ...(doc.frontmatter.description === undefined
                ? {}
                : { description: doc.frontmatter.description }),
              ...(doc.frontmatter.actions === undefined
                ? {}
                : { actions: doc.frontmatter.actions }),
              Link: link,
              ...(routeLabels?.externalLink === undefined
                ? {}
                : { externalLabel: routeLabels.externalLink }),
            }),
        createElement(DocContent, {
          hast: doc.hast,
          components: { ...components, ...options.components },
          ...(copyLabels === undefined ? {} : { labels: copyLabels }),
        }),
        /*
         * The pager, inside `<main>` and after the prose.
         *
         * ⚠️ THE NAV TREE, NOT THE SLUG LIST. `generateStaticParams` has every
         * route in it and no opinion about their order; the sidebar's order is
         * the one the author wrote, and the one the reader is looking at. Two
         * orderings of the same pages is two answers to one question, and they
         * drift the first time a `meta.json` moves.
         *
         * `null` when the page has no neighbour either side — see `DocsPager`.
         */
        options.pager === false
          ? null
          : createElement(DocsPager, {
              ...neighbours(await requestScopedSource.nav(), doc.href),
              Link: link,
              ...(routeLabels?.previousPage === undefined
                ? {}
                : { previousLabel: routeLabels.previousPage }),
              ...(routeLabels?.nextPage === undefined
                ? {}
                : { nextLabel: routeLabels.nextPage }),
              ...(routeLabels?.pagination === undefined
                ? {}
                : { label: routeLabels.pagination }),
            }),
      ),
      /*
       * NO ELEMENT AT ALL when there are no headings, rather than an empty
       * one. The grid reserves its TOC track with
       * `.wave-docs-layout:has(.wave-docs-layout__toc)`, and `:has()` matches
       * an empty aside exactly as well as a full one — so an untitled page
       * would give up 15rem to nothing. The same defect V-4 measured.
       */
      doc.toc.length === 0
        ? null
        : createElement(
            'aside',
            { className: 'wave-docs-layout__toc' },
            createElement(DocsToc, {
              entries: doc.toc,
              ...(routeLabels?.toc === undefined
                ? {}
                : { label: routeLabels.toc }),
              ...(routeLabels?.backToTop === undefined
                ? {}
                : { topLabel: routeLabels.backToTop }),
            }),
          ),
    );
  }

  return {
    source: requestScopedSource,
    getPage,
    renderAll,
    searchIndex,
    searchIndexUrl,
    dynamicParams: false,

    async Page({ params }: DocsPageProps): Promise<ReactNode> {
      const { slug } = await params;
      return renderRoute(slug ?? []);
    },

    async IndexPage(): Promise<ReactNode> {
      return renderRoute([]);
    },

    async Layout({
      children,
      search,
      labels,
      icons,
    }: DocsLayoutProps): Promise<ReactNode> {
      /*
       * Lazy, and load-bearing. `layout.tsx` is itself a Server Component, but
       * it statically imports `next-nav` and `next-search` — which are client
       * modules, and which reach `next/navigation` and `next/link`. A static
       * import here would put both on the module graph of `next.config.ts`,
       * which loads this entry point for `createDocsSitemap` and
       * `createDocsRedirects` outside the Next runtime entirely.
       */
      const { DocsLayoutShell } = await import('./react/layout.js');

      /*
       * ⚠️ THE ROUTE'S `miniSearchOptions` GO TO THE DIALOG FROM HERE, and this
       * is the only place they can. MiniSearch reads `tokenize` and
       * `processTerm` when indexing *and* when querying, so the object that
       * built the index has to be the object that queries it — the warning on
       * the option itself. While `search` was a bare boolean there was no
       * channel, so configuring the route and rendering `docs.Layout` (the two
       * things the README tells you to do) produced an index whose terms no
       * query could spell: zero results, no error, nothing in the console.
       *
       * A host object wins over the route's, because a host that passes one
       * has said something more specific than the route's default.
       *
       * ⚠️ AND IT IS A SERVER→CLIENT PROP, WHICH THE FIRST VERSION OF THIS
       * FORGOT. React serialises what a Client Component is given, so the
       * moment the forwarded object held the very functions the warning above
       * is about, `next build` died with "Functions cannot be passed directly
       * to Client Components" — a silent wrong answer traded for a hard crash
       * in exactly the case the option exists for. It shipped in 0.3.0 and
       * 0.4.0 under a test that asserted on `element.props.search` and
       * therefore never crossed the boundary it was testing.
       *
       * `search === false` short-circuits before the check on purpose: that is
       * the supported route for function tuning — the route keeps building the
       * index with them and the host renders its own client dialog — so it must
       * not be the path that throws.
       */
      const host =
        search === true || search === undefined || search === false
          ? undefined
          : search;

      /*
       * `??`, so an explicit `miniSearchOptions: undefined` falls back to the
       * route's rather than blanking it — the same reading of `undefined` as
       * every other optional the shell forwards below.
       */
      const requestedOptions =
        host?.miniSearchOptions ?? options.miniSearchOptions;

      const searchProps: boolean | DocsLayoutSearchProps =
        search === false
          ? false
          : {
              ...host,
              ...(requestedOptions === undefined
                ? {}
                : {
                    miniSearchOptions:
                      serializableSearchOptions(requestedOptions),
                  }),
            };

      /*
       * `requestScopedSource`, not `source`: outside a production build this
       * rescans, so adding a page in `next dev` shows up in the sidebar. Next
       * does not re-run a layout on every client navigation, so a stale read
       * here survives longer than a stale read anywhere else on the route.
       */
      /*
       * The route's labels under the layout's, key by key. Same rule as
       * `miniSearchOptions`: a host that names one has said something more
       * specific than the route's default, and a host that names three should not
       * lose the other nineteen by doing so — which a whole-object override
       * would do.
       */
      const shellLabels =
        options.labels === undefined && labels === undefined
          ? undefined
          : { ...options.labels, ...labels };

      return createElement(DocsLayoutShell, {
        children,
        nav: await requestScopedSource.nav(),
        searchIndexUrl,
        search: searchProps,
        ...(shellLabels === undefined ? {} : { labels: shellLabels }),
        ...(icons === undefined ? {} : { icons }),
      });
    },

    async generateStaticParams(): Promise<Array<{ slug: string[] }>> {
      if (rescanPerRequest) {
        invalidate();
      }
      const slugs = await source.slugs();
      return slugs
        .filter((segments) => segments.length > 0)
        .map((segments) => ({ slug: segments }));
    },

    async generateMetadata({ params }: DocsPageProps) {
      const { slug } = await params;
      const file = await findVisible(slug ?? []);
      if (file === undefined) {
        return {};
      }

      const { title, description } = file.frontmatter;
      const canonical =
        siteUrl === undefined
          ? file.href
          : new URL(file.href, siteUrl).toString();

      return {
        title,
        ...(description === undefined ? {} : { description }),
        alternates: { canonical },
        openGraph: {
          type: 'article',
          title,
          ...(description === undefined ? {} : { description }),
          url: canonical,
        },
      };
    },
  };
}

/* -------------------------------------------------------------------------
 * Sitemap
 * ---------------------------------------------------------------------- */

/** One entry of Next's `MetadataRoute.Sitemap`. */
export interface DocsSitemapEntry {
  url: string;
  lastModified?: Date;
  changeFrequency?:
    | 'always'
    | 'hourly'
    | 'daily'
    | 'weekly'
    | 'monthly'
    | 'yearly'
    | 'never';
  priority?: number;
}

export interface DocsSitemapOptions<
  TFrontmatter extends DocFrontmatter = DocFrontmatter,
> extends DocsConfig<TFrontmatter> {
  /**
   * Absolute site origin, e.g. `'https://example.com'`. Required: sitemap
   * URLs must be absolute, and a relative one makes the whole file invalid.
   */
  siteUrl: string;
  /** Applied to every entry. Omitted by default — Google ignores it anyway. */
  changeFrequency?: DocsSitemapEntry['changeFrequency'] | undefined;
  /** Applied to every entry. Omitted by default. */
  priority?: number | undefined;
  /**
   * Override the last-modified date per page.
   *
   * The default is the file's mtime, which on a CI runner is the *checkout*
   * time — every page then claims to have changed today, and `lastmod` becomes
   * noise. Wire this to your git history if the dates are load-bearing.
   */
  lastModified?: (
    file: DocFile<TFrontmatter>,
  ) => Date | undefined | Promise<Date | undefined>;
}

/**
 * Sitemap entries for every published page, for `app/sitemap.ts`.
 *
 * Drafts are excluded, as are aliases — an alias is a redirect, and listing a
 * redirect in a sitemap is a crawl error.
 *
 * ```ts
 * // app/sitemap.ts
 * import { createDocsSitemap } from '@waveso/docs/next';
 *
 * export default async function sitemap() {
 *   return createDocsSitemap({
 *     contentDir: 'content/docs',
 *     siteUrl: 'https://example.com',
 *   });
 * }
 * ```
 */
export async function createDocsSitemap<
  TFrontmatter extends DocFrontmatter = DocFrontmatter,
>(options: DocsSitemapOptions<TFrontmatter>): Promise<DocsSitemapEntry[]> {
  const siteUrl = requireSiteUrl(options.siteUrl);
  const source = createDocsSource(options);
  if (process.env.NODE_ENV !== 'production') {
    source.invalidate();
  }
  const files = await source.all();

  // Google rejects a sitemap above 50,000 URLs or 50 MB uncompressed, and Next
  // neither chunks nor warns. The wording and the arithmetic live in
  // `sitemap-limit.ts` so they are reachable without writing 50,001 files.
  const oversized = sitemapLimitWarning(files.length);
  if (oversized !== undefined) console.warn(oversized);
  // Annotated because the two branches have different parameter types, and a
  // union of signatures is not callable: `readMtime` reads nothing outside
  // `DocFrontmatter`, so it accepts the narrower file too.
  const readDate: (
    file: DocFile<TFrontmatter>,
  ) => Date | undefined | Promise<Date | undefined> =
    options.lastModified ?? readMtime;

  return Promise.all(
    files.map(async (file): Promise<DocsSitemapEntry> => {
      const lastModified = await readDate(file);
      return {
        url: new URL(file.href, siteUrl).toString(),
        ...(lastModified === undefined ? {} : { lastModified }),
        ...(options.changeFrequency === undefined
          ? {}
          : { changeFrequency: options.changeFrequency }),
        ...(options.priority === undefined
          ? {}
          : { priority: options.priority }),
      };
    }),
  );
}

/** Best-effort mtime. A sitemap is not worth failing a build over. */
async function readMtime(file: DocFile): Promise<Date | undefined> {
  try {
    return (await stat(file.filePath)).mtime;
  } catch {
    return undefined;
  }
}

/* -------------------------------------------------------------------------
 * Redirects
 * ---------------------------------------------------------------------- */

/** One entry of `next.config`'s `redirects()`. */
export interface DocsRedirect {
  source: string;
  destination: string;
  /** Always `true`: a renamed page is not coming back to its old URL. */
  permanent: true;
}

/**
 * Permanent redirects from every page's `aliases` frontmatter.
 *
 * Renaming a documentation page otherwise breaks every inbound link that ever
 * pointed at it — search results, blog posts, Stack Overflow answers, other
 * people's bookmarks. Adding one line of frontmatter should be the whole cost
 * of a rename.
 *
 * ```ts
 * // next.config.ts
 * import { createDocsRedirects } from '@waveso/docs/next';
 *
 * export default {
 *   redirects: () => createDocsRedirects({ contentDir: 'content/docs' }),
 * };
 * ```
 *
 * Aliases are resolved against the docs base path, so `aliases: ['quickstart']`
 * on `/docs/getting-started` redirects `/docs/quickstart`. Throws when two
 * pages claim the same alias, or when an alias collides with a real page —
 * both silently lose a page otherwise, and both are typos.
 */
export async function createDocsRedirects(
  config: DocsConfig,
): Promise<DocsRedirect[]> {
  const resolved = resolveDocsConfig(config);
  const files = await createDocsSource(config).all();

  const routes = new Map(files.map((file) => [file.href, file]));
  const claimed = new Map<string, DocFile>();
  const redirects: DocsRedirect[] = [];

  for (const file of files) {
    for (const alias of file.frontmatter.aliases ?? []) {
      const route = toAliasRoute(alias, resolved.basePath, file.relativePath);

      const page = routes.get(route);
      if (page !== undefined) {
        throw docsError(
          'alias-collision',
          `@waveso/docs: the alias '${alias}' in ${file.relativePath} ` +
            `redirects '${route}', which is already the route of ` +
            `${page.relativePath}. Remove the alias, or rename the page it ` +
            'collides with.',
        );
      }

      const other = claimed.get(route);
      if (other !== undefined) {
        throw docsError(
          'alias-collision',
          `@waveso/docs: '${route}' is claimed as an alias by both ` +
            `${other.relativePath} and ${file.relativePath}. An alias can ` +
            'only redirect to one page.',
        );
      }

      claimed.set(route, file);
      redirects.push({
        source: route,
        destination: file.href,
        permanent: true,
      });
    }
  }

  return redirects;
}

/* -------------------------------------------------------------------------
 * Shared helpers
 * ---------------------------------------------------------------------- */

function normalizeSiteUrl(siteUrl: string | undefined): string | undefined {
  return siteUrl === undefined ? undefined : requireSiteUrl(siteUrl);
}

/** Fail at config time, not with a malformed `<link rel="canonical">`. */
function requireSiteUrl(siteUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(siteUrl);
  } catch {
    throw docsError(
      'invalid-config',
      `@waveso/docs: '${siteUrl}' is not an absolute URL. Pass an origin ` +
        "such as 'https://example.com'.",
    );
  }

  // Every canonical and every sitemap entry is built with `new URL(href,
  // siteUrl)`, and that throws a base *path* away: resolving '/docs/x' against
  // 'https://example.com/product-docs' yields 'https://example.com/docs/x'. The
  // whole site would then publish canonicals and a sitemap pointing at URLs
  // that 404 — and Google reads a canonical aimed at a 404 as a reason to drop
  // the page. Rejecting here is the only place the mistake is still visible.
  if (parsed.pathname !== '/') {
    throw docsError(
      'invalid-config',
      `@waveso/docs: '${siteUrl}' has a path ('${parsed.pathname}'), and a ` +
        'site URL must be a bare origin — canonical and sitemap URLs are ' +
        'resolved against it, which discards the path. Pass ' +
        `'${parsed.origin}' and move '${parsed.pathname}' into \`basePath\`, ` +
        'which does accept multiple segments.',
    );
  }

  return parsed.toString();
}
