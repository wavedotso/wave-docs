/**
 * The Vite plugin.
 *
 * Vite has no routing, so this is deliberately **not** an adapter in the sense
 * `@waveso/docs/next` is one: it owns no routes, renders no pages and decides
 * no URLs. It does the build-time half — read the markdown, render it once,
 * check every link and anchor, and write out the four artifacts a docs site
 * needs — and hands your app a navigation tree and a loader. You keep your own
 * router.
 *
 * ```ts
 * // vite.config.ts
 * import { waveDocs } from '@waveso/docs/vite';
 *
 * export default {
 *   plugins: [waveDocs({ contentDir: 'content/docs' })],
 * };
 * ```
 *
 * ```tsx
 * import { nav, loadPage, searchIndexUrl } from 'virtual:wave-docs';
 * ```
 *
 * ⚠️ IN A VITE SPA THE MARKDOWN RENDERER RUNS IN THE BROWSER, AND THAT IS A
 * REAL COST THIS PACKAGE OTHERWISE DOES NOT HAVE. Under Next, `hast` becomes
 * React on the server and the browser receives HTML; a client-rendered Vite app
 * has no server render to do it in, so `hast-util-to-jsx-runtime` ships — about
 * 13.6 KB gzipped via `DocContent`. The alternative is to emit HTML strings and
 * inject them, which this package will not do: `dangerouslySetInnerHTML` is
 * banned here, and the `components` map that makes callouts and code frames
 * work is the reason the hast tree exists at all. What is *not* shipped is the
 * markdown parser or Shiki — the parse and the highlight still happen here, at
 * build time, exactly as they do under Next.
 *
 * ⚠️ THE THREE SHARED ARTIFACT PATHS MATCH THE NEXT ADAPTER EXACTLY —
 * `search-index.json`, `llms-full.txt` and `llms.txt` under `basePath`. That is
 * not tidiness: `SearchDialog`'s `indexUrl` and `DocsCopyPage`'s `corpusUrl`
 * default to those paths, so a component moved between the two adapters keeps
 * working without a prop change.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Options as MiniSearchOptions } from 'minisearch';

import type { DocsBuildRenderOptions } from './docs-build.js';
import {
  collectDocRoutes,
  docsRendererOptions,
  renderDocs,
  reportBrokenAnchor,
} from './docs-build.js';
import { buildLlmsFullTxt, buildLlmsTxt } from './llms-txt.js';
import { createDocsRenderer } from './render.js';
import { buildSearchIndex, extractSearchRecords } from './search-index.js';
import { createDocsSource } from './source.js';
import type {
  DocFrontmatter,
  DocNavNode,
  DocsConfig,
  RenderedDoc,
  SearchRecord,
} from './types.js';

/** The module specifier the plugin answers. */
export const WAVE_DOCS_MODULE_ID = 'virtual:wave-docs';

/*
 * Rollup's convention: a resolved id starting with `\0` is virtual, which keeps
 * it out of the filesystem and out of source maps.
 */
const RESOLVED_ID = `\0${WAVE_DOCS_MODULE_ID}`;

/** Where the per-page trees are written, under `basePath`. */
const PAGES_DIR = 'wave-docs';

/**
 * `llms.txt` and `llms-full.txt` configuration.
 *
 * Shaped like the Next adapter's `llms` option so a site moving between them
 * does not rewrite its config. `title` is required for the same reason it is
 * there: a corpus whose heading is a placeholder tells every agent that reads
 * it the wrong name for your product.
 */
export interface DocsViteLlmsOptions {
  title: string;
  description?: string | undefined;
  details?: string | undefined;
  /**
   * Absolute origin, so the corpus carries real URLs.
   *
   * Without it the `<!-- source: … -->` markers and the index's links are
   * root-relative — correct, and less useful to an agent that found the file
   * on its own.
   */
  siteUrl?: string | undefined;
  /**
   * Emit `llms.txt`, the one-line-per-page index. Defaults to `true`.
   *
   * The corpus is the file that earns its place — it carries every page *and*
   * its URL — so the index is a convenience, and turning it off costs an agent
   * nothing it cannot get from `llms-full.txt`.
   */
  index?: boolean | undefined;
}

/** Search index generation. `false` emits nothing. */
export interface DocsViteSearchOptions {
  /**
   * MiniSearch options, which must match what the dialog is constructed with.
   *
   * ⚠️ THE INDEX AND THE READER MUST AGREE. MiniSearch serialises the options
   * it was built with, and a dialog constructed with different `fields` or a
   * different tokenizer will either throw on load or silently return nothing.
   */
  options?: Partial<MiniSearchOptions<SearchRecord>> | undefined;
}

export interface DocsVitePluginOptions<
  TFrontmatter extends DocFrontmatter = DocFrontmatter,
> extends DocsConfig<TFrontmatter>,
    DocsBuildRenderOptions {
  /** Search index generation. Defaults to on; `false` emits nothing. */
  search?: DocsViteSearchOptions | false | undefined;
  /** `llms.txt` / `llms-full.txt` generation. Omitted emits neither. */
  llms?: DocsViteLlmsOptions | undefined;
}

/** One page, as the virtual module lists it. */
export interface DocsVitePage {
  slug: string;
  href: string;
  segments: string[];
  title: string | undefined;
  description: string | undefined;
}

/**
 * The minimum of Rollup's plugin context this plugin uses.
 *
 * Declared structurally rather than imported, for the same reason
 * `NextLinkComponent` is: `vite` is an optional peer, and a type-only import of
 * it would still be a hard resolution requirement for anyone type-checking
 * against our `.d.ts`.
 */
interface EmitFileContext {
  emitFile(file: { type: 'asset'; fileName: string; source: string }): void;
}

/** The part of a Vite dev server this plugin uses. */
interface DocsViteDevServer {
  middlewares: {
    use(
      handler: (
        req: IncomingMessage,
        res: ServerResponse,
        next: (err?: unknown) => void,
      ) => void,
    ): void;
  };
  watcher: {
    on(event: 'all', handler: (event: string, file: string) => void): void;
  };
  ws: { send(payload: { type: 'full-reload'; path: string }): void };
}

/** The shape this plugin satisfies, structurally rather than by import. */
export interface DocsVitePlugin {
  name: string;
  enforce: 'pre';
  resolveId(id: string): string | undefined;
  load(id: string): Promise<string | undefined>;
  configureServer(server: DocsViteDevServer): void;
  buildStart(): Promise<void>;
  generateBundle(this: EmitFileContext): Promise<void>;
}

/** Everything one content scan produces. */
interface DocsViteArtifacts {
  nav: DocNavNode[];
  pages: DocsVitePage[];
  /** Emitted path, relative and without a leading slash → contents. */
  assets: Map<string, string>;
  basePath: string;
}

/** `/docs` → `docs/`; `''` → `''`. The prefix an emitted path starts with. */
function assetPrefix(basePath: string): string {
  const trimmed = basePath.replace(/^\/+/, '');
  return trimmed === '' ? '' : `${trimmed}/`;
}

/** A page's own file name. The index page has an empty slug. */
function pageFileName(slug: string): string {
  return `${slug === '' ? 'index' : slug}.json`;
}

async function buildArtifacts<TFrontmatter extends DocFrontmatter>(
  options: DocsVitePluginOptions<TFrontmatter>,
): Promise<DocsViteArtifacts> {
  const source = createDocsSource(options);
  const config = source.config;

  const [published, drafts] = await Promise.all([
    source.all(),
    source.drafts(),
  ]);

  const knownRoutes = new Set<string>();
  const draftRoutes = new Set<string>();
  const aliasRoutes = new Map<string, string>();
  collectDocRoutes(knownRoutes, aliasRoutes, published, config.basePath);
  collectDocRoutes(draftRoutes, aliasRoutes, drafts, config.basePath);

  const renderer = createDocsRenderer(
    docsRendererOptions(
      config,
      { knownRoutes, draftRoutes, aliasRoutes },
      options,
    ),
  );

  const rendered = await renderDocs(published, renderer, (message) => {
    reportBrokenAnchor(config.onBrokenAnchors, message);
  });

  const nav = await source.nav();
  const prefix = assetPrefix(config.basePath);
  const assets = new Map<string, string>();

  for (const doc of rendered) {
    const slug = doc.segments.join('/');
    assets.set(
      `${prefix}${PAGES_DIR}/${pageFileName(slug)}`,
      JSON.stringify(doc),
    );
  }

  if (options.search !== false) {
    assets.set(
      `${prefix}search-index.json`,
      buildSearchIndex(
        rendered.flatMap((doc: RenderedDoc<TFrontmatter>) =>
          extractSearchRecords(doc),
        ),
        options.search?.options ?? {},
      ),
    );
  }

  const llms = options.llms;
  if (llms !== undefined) {
    const shared = llms.siteUrl === undefined ? {} : { siteUrl: llms.siteUrl };
    assets.set(`${prefix}llms-full.txt`, buildLlmsFullTxt(published, shared));
    if (llms.index !== false) {
      assets.set(
        `${prefix}llms.txt`,
        buildLlmsTxt(published, {
          ...shared,
          title: llms.title,
          ...(llms.description === undefined
            ? {}
            : { description: llms.description }),
          ...(llms.details === undefined ? {} : { details: llms.details }),
        }),
      );
    }
  }

  const pages: DocsVitePage[] = published.map((file) => ({
    slug: file.slug,
    href: file.href,
    segments: file.segments,
    title: file.frontmatter.title,
    description: file.frontmatter.description,
  }));

  return { nav, pages, assets, basePath: config.basePath };
}

/**
 * The `virtual:wave-docs` module.
 *
 * ⚠️ THE PAGE TREES ARE FETCHED, NOT INLINED, AND THAT IS THE WHOLE POINT OF
 * THE SPLIT. Embedding every rendered page here would put the entire corpus in
 * the entry chunk — a 200-page site's worth of hast in the bundle a reader
 * downloads to see one page. The navigation and the page list *are* inlined,
 * because the sidebar needs both on every route anyway.
 */
function moduleSource(artifacts: DocsViteArtifacts): string {
  const pagesBase = `${artifacts.basePath}/${PAGES_DIR}`;
  return `export const basePath = ${JSON.stringify(artifacts.basePath)};
export const nav = ${JSON.stringify(artifacts.nav)};
export const pages = ${JSON.stringify(artifacts.pages)};
export const searchIndexUrl = ${JSON.stringify(`${artifacts.basePath}/search-index.json`)};
export const corpusUrl = ${JSON.stringify(`${artifacts.basePath}/llms-full.txt`)};

export function pageUrl(slug) {
  const segments = Array.isArray(slug) ? slug.join('/') : String(slug ?? '');
  const name = segments === '' ? 'index' : segments;
  return ${JSON.stringify(pagesBase)} + '/' + name + '.json';
}

export async function loadPage(slug) {
  const response = await fetch(pageUrl(slug));
  if (!response.ok) return undefined;
  return response.json();
}
`;
}

/**
 * Read a content tree at build time and emit what a docs site serves.
 *
 * Returns a Vite plugin. Nothing about it is Next-aware and nothing about it
 * decides a URL: every artifact is written under `basePath`, and your router
 * decides which page to ask {@link DocsVitePage} for.
 */
export function waveDocs<TFrontmatter extends DocFrontmatter = DocFrontmatter>(
  options: DocsVitePluginOptions<TFrontmatter>,
): DocsVitePlugin {
  /*
   * One scan per build, and one per dev-server content change. Held as the
   * promise rather than the value so concurrent `load` calls and dev requests
   * share a single walk instead of racing three of them — the same reason the
   * Next adapter memoises its scan, by a mechanism it cannot borrow here
   * because `React.cache` needs a request scope.
   */
  let pending: Promise<DocsViteArtifacts> | null = null;

  const artifacts = (): Promise<DocsViteArtifacts> =>
    (pending ??= buildArtifacts(options));

  return {
    name: 'wave-docs',
    enforce: 'pre',

    resolveId(id: string): string | undefined {
      return id === WAVE_DOCS_MODULE_ID ? RESOLVED_ID : undefined;
    },

    async load(id: string): Promise<string | undefined> {
      if (id !== RESOLVED_ID) return undefined;
      return moduleSource(await artifacts());
    },

    /*
     * Built eagerly rather than on first `load`, so a broken link or a bad
     * theme name fails the build at the start instead of in the middle of a
     * module graph traversal.
     */
    async buildStart(): Promise<void> {
      await artifacts();
    },

    async generateBundle(this: EmitFileContext): Promise<void> {
      const built = await artifacts();
      for (const [fileName, source] of built.assets) {
        this.emitFile({ type: 'asset', fileName, source });
      }
    },

    configureServer(server: DocsViteDevServer): void {
      /*
       * ⚠️ SERVED FROM MEMORY RATHER THAN WRITTEN TO `public/`. A generated file
       * in `public/` is a file in the consumer's repository that their next
       * `git status` asks about and their editor offers to commit — and one that
       * goes stale the moment the dev server is not running. Nothing is written
       * to disk in dev.
       */
      server.middlewares.use((req, res, next) => {
        const url = req.url;
        if (url === undefined) {
          next();
          return;
        }
        const pathname = url.split('?')[0] ?? '';
        const wanted = decodeURIComponent(pathname).replace(/^\/+/, '');

        artifacts()
          .then((built) => {
            const source = built.assets.get(wanted);
            if (source === undefined) {
              next();
              return;
            }
            res.setHeader(
              'Content-Type',
              wanted.endsWith('.json')
                ? 'application/json; charset=utf-8'
                : 'text/plain; charset=utf-8',
            );
            /*
             * The dev server holds the only copy and it is dropped on every
             * content change, so a cached response is a response that outlives
             * the file it describes.
             */
            res.setHeader('Cache-Control', 'no-store');
            res.end(source);
          })
          .catch(next);
      });

      const contentRoot = options.contentDir;
      server.watcher.on('all', (_event, file) => {
        /*
         * A substring test, not a resolved-path one: the watcher reports
         * absolute paths and `contentDir` may be relative, so resolving both
         * would mean reproducing the source's own root resolution here. The
         * cost of being wrong is a rebuild that was not needed.
         */
        if (!file.includes(contentRoot)) return;
        pending = null;
        server.ws.send({ type: 'full-reload', path: '*' });
      });
    },
  };
}
