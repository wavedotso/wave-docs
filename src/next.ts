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
 * `next` is an *optional* peer dependency, so its modules are imported lazily
 * and only from the code paths that render. That is what lets
 * {@link createDocsSitemap} and {@link createDocsRedirects} be called from
 * `next.config.ts` — which Node loads outside the Next runtime — without
 * dragging React and Next's client runtime into the config load.
 */

import { stat } from 'node:fs/promises';
import type { ComponentProps, ComponentType, ReactNode } from 'react';
import { createElement } from 'react';

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
  DocsLinkComponent,
  DocsLinkProps,
  MarkdownComponents,
} from './react/markdown-components.js';
import { createMarkdownComponents } from './react/markdown-components.js';
import { DOCS_CONTENT_ID } from './react/skip-link.js';
import type { DocsRenderer } from './render.js';
import { createDocsRenderer } from './render.js';
import type { DocsSource } from './source.js';
import { createDocsSource, resolveDocsConfig, toAliasRoute } from './source.js';
import type {
  DocFile,
  DocFrontmatter,
  DocsConfig,
  ImageResolver,
  LinkResolver,
  RenderedDoc,
} from './types.js';

/**
 * Re-exported so a consumer can name the accepted grammar and theme sets
 * without importing the Node-only highlighter entry point.
 */
export type { DocsLang, DocsTheme, DocsThemes };

/* -------------------------------------------------------------------------
 * Lazily-loaded `next` modules
 * ---------------------------------------------------------------------- */

/**
 * The part of `next/link` this adapter uses.
 *
 * Declared locally rather than imported: `next` is an optional peer, and a
 * type-only import of it would still be a hard resolution requirement for
 * anyone type-checking against our `.d.ts`.
 */
type NextLinkComponent = ComponentType<
  Omit<ComponentProps<'a'>, 'href' | 'ref'> & {
    href: string;
    prefetch?: boolean | null | undefined;
  }
>;

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
 * Pull the default export out of a lazily-imported module.
 *
 * This is the one place a cast is unavoidable — the import crosses a boundary
 * the compiler cannot see. It is guarded by a runtime check so a missing or
 * mis-shaped `next` surfaces as an error naming the package to install, rather
 * than as `undefined is not a function` four frames inside React.
 */
function readDefaultExport<T>(mod: unknown, specifier: string): T {
  const value = isRecord(mod) && 'default' in mod ? mod.default : mod;
  if (typeof value !== 'function' && !isRecord(value)) {
    throw new Error(
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
    throw new Error(
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
    throw new Error(
      "@waveso/docs: 'next/navigation' has no `notFound` export. The " +
        '`@waveso/docs/next` entry point requires Next.js 16.',
    );
  }
  return value as () => never;
}

/**
 * Adapt `next/link` to {@link DocsLinkProps}.
 *
 * `next/link` widens `href` to `string | UrlObject` and `prefetch` to
 * `boolean | null`; the React layer promises neither, because it must also run
 * with a plain `<a>`. One wrapper keeps that mismatch in a single
 * place instead of at every call site.
 */
function wrapNextLink(NextLink: NextLinkComponent): DocsLinkComponent {
  return function DocsNextLink({
    href,
    prefetch,
    children,
    ...rest
  }: DocsLinkProps): ReactNode {
    return createElement(
      NextLink,
      {
        ...rest,
        href,
        // `exactOptionalPropertyTypes`: absent, never explicitly `undefined`.
        ...(prefetch === undefined ? {} : { prefetch }),
      },
      children,
    );
  };
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
  components?: MarkdownComponents;
  /** Reuse an existing Shiki highlighter. */
  highlighter?: DocsHighlighter | Promise<DocsHighlighter>;
  /** Grammars to load, when building the default highlighter. */
  langs?: readonly DocsLang[];
  /** Theme pair. */
  themes?: DocsThemes;
  /**
   * Prepend an `<h1>` from `frontmatter.title` when the markdown has none.
   * Defaults to `true`; turn it off if your layout renders the title itself.
   */
  titleHeading?: boolean;
  /**
   * `id` of the rendered `<article>`, which is also what
   * `@waveso/docs/react/skip-link` targets by default. Defaults to
   * `'docs-content'`. Pass `false` to render no id at all.
   */
  contentId?: string | false;
  /**
   * Re-read the content directory on every request.
   *
   * Defaults to `true` outside `NODE_ENV=production`. Markdown files are not in
   * Next's module graph, so nothing re-evaluates a route module when one
   * changes: without this, `next dev` serves whatever it read on the first
   * request until the server restarts, and a file added afterwards is never
   * found. A rescan of a few hundred small files costs single-digit
   * milliseconds; a production build reads the tree once, as it should.
   */
  rescanPerRequest?: boolean;
  /** Replaces the built-in markdown-link resolution. */
  linkResolver?: LinkResolver;
  /**
   * Resolves image `src` to a public URL and intrinsic dimensions. Without one,
   * markdown images render as a plain `<img>`: `next/image` refuses to render
   * without dimensions, and markdown carries none.
   */
  imageResolver?: ImageResolver;
  /**
   * Absolute site origin, e.g. `'https://example.com'`.
   *
   * When set, `alternates.canonical` is an absolute URL. When omitted it is a
   * root-relative path, which Next resolves against `metadataBase` — so if you
   * set neither, you ship pages with no usable canonical.
   */
  siteUrl?: string;
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
   * Declaring it is not optional. Next defaults `dynamicParams` to `true`,
   * which means a URL that `generateStaticParams` never listed is still
   * rendered on demand — so `/docs/typo` reaches the source layer,
   * `fs.readFile` throws `ENOENT`, and Next answers **HTTP 500**. Google
   * treats a 5xx as a crawl failure and retries it; it treats a 404 as an
   * answer. With the full page set known at build time there is nothing to
   * render on demand anyway.
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
   * Every published page, rendered. The input to
   * `extractSearchRecords`/`writeSearchIndex` — nothing builds the search index
   * for you.
   */
  renderAll: () => Promise<Array<RenderedDoc<TFrontmatter>>>;
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
  const contentId = options.contentId ?? DOCS_CONTENT_ID;
  const rescanPerRequest =
    options.rescanPerRequest ?? process.env.NODE_ENV !== 'production';

  // Built on first render, not on import: `generateStaticParams` runs in its
  // own pass and has no use for a syntax highlighter.
  let renderer: DocsRenderer | null = null;
  // Populated from the source walk; `createDocsRenderer` reads it at render
  // time, which is what lets one live set serve every page.
  const knownRoutes = new Set<string>();
  let routesLoaded: Promise<void> | null = null;

  /**
   * Drop the cached scan so the next query reads the disk again.
   *
   * `knownRoutes` is added to, never cleared: it is shared with the renderer,
   * and emptying it while a concurrent render is asserting links would fail
   * that page for a link that is perfectly valid. A route left behind by a
   * deleted page only makes dev *more* permissive than the production build,
   * which is the right direction to be wrong in.
   */
  const invalidate = (): void => {
    source.invalidate();
    routesLoaded = null;
  };

  const loadRoutes = (): Promise<void> =>
    (routesLoaded ??= source.all().then((files) => {
      for (const file of files) {
        knownRoutes.add(file.href);
        // An alias is a permanent redirect, so a link to one resolves. Without
        // this, moving a page would fail the build on every link that still
        // points at its old name — the exact case `aliases` exists to survive.
        for (const alias of file.frontmatter.aliases ?? []) {
          knownRoutes.add(
            toAliasRoute(alias, config.basePath, file.relativePath),
          );
        }
      }
    }));

  const loadRenderer = (): DocsRenderer =>
    (renderer ??= createDocsRenderer({
      config,
      knownRoutes,
      ...(options.highlighter === undefined
        ? {}
        : { highlighter: options.highlighter }),
      ...(options.langs === undefined ? {} : { langs: options.langs }),
      ...(options.themes === undefined ? {} : { themes: options.themes }),
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
    return Promise.all(files.map((file) => renderer.render(file)));
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
        ...(contentId === false ? {} : { id: contentId, tabIndex: -1 }),
      },
      createElement(DocContent, {
        hast: doc.hast,
        components: { ...components, ...options.components },
      }),
    );
  }

  return {
    source,
    getPage,
    renderAll,
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
  changeFrequency?: DocsSitemapEntry['changeFrequency'];
  /** Applied to every entry. Omitted by default. */
  priority?: number;
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
  const files = await createDocsSource(options).all();
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
        throw new Error(
          `@waveso/docs: the alias '${alias}' in ${file.relativePath} ` +
            `redirects '${route}', which is already the route of ` +
            `${page.relativePath}. Remove the alias, or rename the page it ` +
            'collides with.',
        );
      }

      const other = claimed.get(route);
      if (other !== undefined) {
        throw new Error(
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
  try {
    return new URL(siteUrl).toString();
  } catch {
    throw new Error(
      `@waveso/docs: '${siteUrl}' is not an absolute URL. Pass an origin ` +
        "such as 'https://example.com'.",
    );
  }
}
