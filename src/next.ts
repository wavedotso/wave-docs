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
import type { ComponentType, ReactNode } from 'react';
import { cache, createElement } from 'react';

import { mapPooled } from './map-pooled.js';
import type {
  DocsHighlighter,
  DocsLang,
  DocsTheme,
  DocsThemes,
} from './highlighter.js';
import { DocContent } from './react/doc-content.js';
import type {
  DocsImageComponent,
  DocsImageProps,
  MarkdownComponents,
} from './react/markdown-components.js';
import { createMarkdownComponents } from './react/markdown-components.js';
import { DOCS_CONTENT_ID } from './docs-content-id.js';
import type { NextLinkComponent } from './react/next-link.js';
import { wrapNextLink } from './react/next-link.js';
import type { DocsRenderer } from './render.js';
import { createDocsRenderer } from './render.js';
import type { DocsSource } from './source.js';
import { createDocsSource, resolveDocsConfig } from './source.js';
import { toAliasRoute } from './route-path.js';
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

/**
 * Pages rendered at once by {@link DocsRoute.renderAll}.
 *
 * High enough that the pipeline — CPU-bound and effectively synchronous — never
 * idles, low enough that an async `imageResolver` cannot put an entire site's
 * worth of trees and network calls in flight simultaneously.
 */
const RENDER_CONCURRENCY = 16;

/** Google's per-sitemap URL cap. */
const SITEMAP_URL_LIMIT = 50_000;

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
    });
  };
}

/**
 * The component map is built once per process.
 *
 * `createMarkdownComponents` returns fresh component identities on every call,
 * and a new identity for `a` remounts every link in the document on every
 * render — so this memo is correctness, not micro-optimisation.
 */
let nextComponents: Promise<MarkdownComponents> | null = null;

function loadNextComponents(): Promise<MarkdownComponents> {
  if (nextComponents === null) {
    nextComponents = buildNextComponents().catch((error: unknown) => {
      // Evicted on failure so one transient import error does not poison every
      // later render in the process.
      nextComponents = null;
      throw error;
    });
  }
  return nextComponents;
}

async function buildNextComponents(): Promise<MarkdownComponents> {
  const [linkMod, imageMod] = await Promise.all([
    importNext(() => import('next/link'), 'next/link'),
    importNext(() => import('next/image'), 'next/image'),
  ]);

  const NextLink = readDefaultExport<NextLinkComponent>(linkMod, 'next/link');
  const NextImage = readDefaultExport<NextImageComponent>(
    imageMod,
    'next/image',
  );

  return createMarkdownComponents({
    Link: wrapNextLink(NextLink),
    Image: wrapNextImage(NextImage),
  });
}

/* -------------------------------------------------------------------------
 * Route
 * ---------------------------------------------------------------------- */

export interface DocsRouteOptions<
  TFrontmatter extends DocFrontmatter = DocFrontmatter,
> extends DocsConfig<TFrontmatter> {
  /** Overrides merged over the Next-flavoured defaults (`next/link` + `next/image`). */
  components?: MarkdownComponents | undefined;
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
   * ⚠️ THE IDENTICAL OBJECT MUST REACH THE DIALOG — pass it to `DocsSearch`'s
   * (or `SearchDialog`'s) `miniSearchOptions`. MiniSearch reads `tokenize` and
   * `processTerm` both when indexing and when querying, so applying one here
   * and not there produces an index whose terms no query can spell: zero
   * results, no error, nothing in the console.
   */
  miniSearchOptions?: Partial<MiniSearchOptions<SearchRecord>> | undefined;
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
      ...(options.titleHeading === undefined
        ? {}
        : { titleHeading: options.titleHeading }),
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
    return mapPooled(files, RENDER_CONCURRENCY, (file) =>
      renderer.render(file),
    );
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

    const components = await loadNextComponents();
    return createElement(
      'article',
      {
        className: 'wave-docs-prose',
        // The target `SkipLink` points at by default. `tabIndex` with it: a
        // fragment link moves the scroll position but not always the focus, so
        // an unfocusable target leaves a keyboard user stranded at the top of
        // the sidebar they were trying to skip.
        id: DOCS_CONTENT_ID,
        tabIndex: -1,
      },
      createElement(DocContent, {
        hast: doc.hast,
        components: { ...components, ...options.components },
      }),
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
  // neither chunks nor warns. Splitting belongs to the caller — `generateSitemaps`
  // plus a slice of this array is three lines — but silently emitting a file
  // no crawler will read is not something to discover from Search Console.
  if (files.length > SITEMAP_URL_LIMIT) {
    console.warn(
      `@waveso/docs: this sitemap has ${files.length} URLs, above Google's ` +
        `limit of ${SITEMAP_URL_LIMIT}. Split it with Next's ` +
        '`generateSitemaps` and slice the array this returns.',
    );
  }
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
