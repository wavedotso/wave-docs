/**
 * The source layer: a content directory on disk becomes `DocFile[]` plus a
 * navigation tree.
 *
 * Node-only, and the only module that touches the filesystem. Everything it
 * produces is plain data, so the result crosses the RSC boundary, a Vite
 * virtual module or a JSON cache file without ceremony.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { parseFrontmatter } from './frontmatter.js';
import type { MetaDirEntry } from './meta.js';
import { orderNavEntries, readDocsMeta } from './meta.js';
import type {
  DocFile,
  DocFrontmatter,
  DocNavGroup,
  DocNavNode,
  DocNavPage,
  DocsConfig,
  DocsMeta,
  ResolvedDocsConfig,
} from './types.js';

/** Markdown only. MDX is deliberately out of scope for this package. */
const PAGE_EXTENSION = '.md';

/** A directory whose `index.md` is the directory's own route. */
const INDEX_NAME = 'index';

/**
 * A content directory, scanned once and queried many times.
 *
 * Every method is async because the first one to be called performs the scan;
 * subsequent calls resolve from the same in-flight promise.
 */
export interface DocsSource<
  TFrontmatter extends DocFrontmatter = DocFrontmatter,
> {
  /** Every page, drafts excluded unless `includeDrafts`. */
  all(): Promise<Array<DocFile<TFrontmatter>>>;
  /**
   * One page by route segments. Returns drafts regardless of config, so a
   * preview route can opt into them without a second source.
   */
  find(segments: string[]): Promise<DocFile<TFrontmatter> | undefined>;
  /** The navigation tree for the content root. */
  nav(): Promise<DocNavNode[]>;
  /** Route segments for `generateStaticParams`, drafts excluded. */
  slugs(): Promise<string[][]>;
  /**
   * Discard the cached scan, so the next query reads the disk again.
   *
   * A one-shot `next build` never needs this — the tree cannot change while it
   * runs, and caching is the whole point. A long-lived Vite dev server does:
   * without it, a markdown file created after startup could never appear, and
   * the source would be permanently wrong for the rest of the session.
   */
  invalidate(): void;
  config: ResolvedDocsConfig<TFrontmatter>;
}

/**
 * Apply {@link DocsConfig} defaults and resolve `contentDir` against
 * `process.cwd()` — the project root under both `next build` and `vite build`.
 *
 * `basePath` is normalised to have a leading slash and no trailing one, so
 * href construction is a plain concatenation everywhere else. Mounting docs at
 * the site root (`'/'`) normalises to `''`, matching the Next.js convention.
 */
export function resolveDocsConfig<
  TFrontmatter extends DocFrontmatter = DocFrontmatter,
>(config: DocsConfig<TFrontmatter>): ResolvedDocsConfig<TFrontmatter> {
  return {
    contentDir: path.resolve(process.cwd(), config.contentDir),
    basePath: normalizeBasePath(config.basePath ?? '/docs'),
    includeDrafts: config.includeDrafts ?? false,
    assertLinks: config.assertLinks ?? true,
    // `exactOptionalPropertyTypes`: the key is absent, never `undefined`, so
    // `parseFrontmatter` stays the single place the default is applied.
    ...(config.frontmatterSchema === undefined
      ? {}
      : { frontmatterSchema: config.frontmatterSchema }),
  };
}

/**
 * Sources are memoised by resolved config so that the twenty route files of a
 * docs site share one filesystem scan instead of each starting their own.
 *
 * The values are heterogeneous in `TFrontmatter`, which no `Map` type can
 * express; the read in {@link createDocsSource} is a cast justified by
 * {@link schemaKey} — a key only matches an entry built from the very same
 * schema object, and therefore from the very same `TFrontmatter`.
 */
const sources = new Map<string, DocsSource<DocFrontmatter>>();

/** Schema identities, assigned on first sight. */
const schemaIds = new WeakMap<object, number>();
let schemaIdCount = 0;

/**
 * A key fragment identifying a `frontmatterSchema`, by reference.
 *
 * Two configs that differ only by schema must not share a source: the cached
 * `DocFile.frontmatter` was parsed by whichever schema arrived first, so
 * sharing would hand one caller the other's fields — silently, and only for the
 * fields the two schemas disagree about. Identity is the only comparison a
 * Standard Schema supports; a validator has no stable serialisation.
 */
function schemaKey(schema: object | undefined): string {
  if (schema === undefined) {
    return 'default-schema';
  }
  const existing = schemaIds.get(schema);
  if (existing !== undefined) {
    return `schema-${existing}`;
  }
  schemaIdCount += 1;
  schemaIds.set(schema, schemaIdCount);
  return `schema-${schemaIdCount}`;
}

/**
 * Create (or reuse) the source for a content directory.
 */
export function createDocsSource<
  TFrontmatter extends DocFrontmatter = DocFrontmatter,
>(config: DocsConfig<TFrontmatter>): DocsSource<TFrontmatter> {
  const resolved = resolveDocsConfig(config);
  // The fragments are joined on a NUL, written as an escape rather than as the
  // raw byte it used to be: no path, base path or key fragment can contain one,
  // so two different configs cannot join to the same key — and a literal NUL
  // makes the file binary to grep, diff and every review tool.
  const key = [
    resolved.contentDir,
    resolved.basePath,
    resolved.includeDrafts,
    resolved.assertLinks,
    schemaKey(resolved.frontmatterSchema),
  ].join('\0');

  const existing = sources.get(key);
  if (existing) {
    return existing as DocsSource<TFrontmatter>;
  }

  const created = buildSource(resolved);
  sources.set(key, created);
  return created;
}

/* -------------------------------------------------------------------------
 * Internals
 * ---------------------------------------------------------------------- */

/** The scan result, shared by every query method. */
interface Scan<TFrontmatter extends DocFrontmatter> {
  /** Every page found, drafts included, in stable path order. */
  files: Array<DocFile<TFrontmatter>>;
  /** By `slug`, for `find`. Includes drafts. */
  bySlug: Map<string, DocFile<TFrontmatter>>;
  /** Navigation for the content root, drafts already applied. */
  nav: DocNavNode[];
}

/**
 * One directory, as read off disk.
 *
 * Generic only because it carries {@link DocFile}s: nothing that walks a
 * `DirScan` to build navigation reads a field outside {@link DocFrontmatter},
 * so those helpers take the default instantiation and a custom one flows in
 * unchanged.
 */
interface DirScan<TFrontmatter extends DocFrontmatter = DocFrontmatter> {
  /** Directory name; `''` for the content root. */
  name: string;
  absPath: string;
  /** Route segments of the directory itself. */
  segments: string[];
  meta: DocsMeta | undefined;
  metaPath: string;
  index: DocFile<TFrontmatter> | undefined;
  /** Pages in this directory, `index.md` excluded. */
  pages: Array<DocFile<TFrontmatter>>;
  dirs: Array<DirScan<TFrontmatter>>;
}

function buildSource<TFrontmatter extends DocFrontmatter>(
  config: ResolvedDocsConfig<TFrontmatter>,
): DocsSource<TFrontmatter> {
  // Cache the PROMISE, not the resolved value. Next prerenders pages
  // concurrently, so with `let cached: Scan | null` every caller races past
  // the null check before the first `await` resolves — measured at 29 full
  // filesystem scans for a 44-page build, versus 3 (one per worker) here.
  // Do not "simplify" this into a value cache.
  let cached: Promise<Scan<TFrontmatter>> | null = null;
  const load = (): Promise<Scan<TFrontmatter>> => (cached ??= scan(config));

  const isVisible = (file: DocFile): boolean =>
    config.includeDrafts || file.frontmatter.draft !== true;

  return {
    config,
    invalidate() {
      cached = null;
    },
    async all() {
      const { files } = await load();
      return files.filter(isVisible);
    },
    async find(segments) {
      const { bySlug } = await load();
      return bySlug.get(segments.join('/'));
    },
    async nav() {
      const result = await load();
      return result.nav;
    },
    async slugs() {
      const { files } = await load();
      return files.filter(isVisible).map((file) => file.segments);
    },
  };
}

async function scan<TFrontmatter extends DocFrontmatter>(
  config: ResolvedDocsConfig<TFrontmatter>,
): Promise<Scan<TFrontmatter>> {
  await assertContentDir(config.contentDir);

  const root = await scanDir(config.contentDir, [], '', config);
  const files: Array<DocFile<TFrontmatter>> = [];
  const bySlug = new Map<string, DocFile<TFrontmatter>>();

  collect(root, files, bySlug);

  return { files, bySlug, nav: buildNav(root, config) };
}

async function assertContentDir(contentDir: string): Promise<void> {
  try {
    const stats = await stat(contentDir);
    if (stats.isDirectory()) {
      return;
    }
  } catch {
    // Fall through to the shared, actionable error below.
  }
  throw new Error(
    `Docs content directory not found: ${contentDir}\n` +
      'Set `contentDir` to a directory of markdown files; relative paths ' +
      `resolve against the working directory (${process.cwd()}).`,
  );
}

async function scanDir<TFrontmatter extends DocFrontmatter>(
  absPath: string,
  segments: string[],
  name: string,
  config: ResolvedDocsConfig<TFrontmatter>,
): Promise<DirScan<TFrontmatter>> {
  const [meta, entries] = await Promise.all([
    readDocsMeta(absPath),
    readdir(absPath, { withFileTypes: true }),
  ]);

  // readdir order is filesystem-dependent; sort so the build is reproducible.
  const sorted = [...entries].sort((a, b) =>
    a.name.localeCompare(b.name, 'en'),
  );

  const pageEntries = sorted.filter(
    (entry) => entry.isFile() && isPageFile(entry.name),
  );
  const dirEntries = sorted.filter(
    (entry) => entry.isDirectory() && !isIgnoredDir(entry.name),
  );

  const [pages, dirs] = await Promise.all([
    Promise.all(
      pageEntries.map((entry) =>
        readPage(path.join(absPath, entry.name), segments, config),
      ),
    ),
    Promise.all(
      dirEntries.map((entry) =>
        scanDir(
          path.join(absPath, entry.name),
          [...segments, entry.name],
          entry.name,
          config,
        ),
      ),
    ),
  ]);

  const index = pages.find((page) => baseName(page.filePath) === INDEX_NAME);

  return {
    name,
    absPath,
    segments,
    meta,
    metaPath: path.join(absPath, 'meta.json'),
    index,
    pages: pages.filter((page) => page !== index),
    dirs,
  };
}

async function readPage<TFrontmatter extends DocFrontmatter>(
  filePath: string,
  dirSegments: string[],
  config: ResolvedDocsConfig<TFrontmatter>,
): Promise<DocFile<TFrontmatter>> {
  const raw = await readFile(filePath, 'utf8');
  const relativePath = toPosix(path.relative(config.contentDir, filePath));

  let data: unknown;
  let content: string;
  try {
    // The options object is load-bearing: called with none, `gray-matter`
    // memoises every distinct file body it has ever seen in a module-level
    // cache that is never evicted, so a dev server rescanning on each save
    // retains one full copy per revision for the life of the process.
    const parsed = matter(raw, { language: 'yaml' });
    data = parsed.data;
    content = parsed.content;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not parse the frontmatter block in ${relativePath}: ${reason}`,
    );
  }

  const name = baseName(filePath);
  const segments =
    name === INDEX_NAME ? [...dirSegments] : [...dirSegments, name];

  return {
    segments,
    slug: segments.join('/'),
    href: toHref(config.basePath, segments),
    filePath,
    relativePath,
    // The type argument is explicit: inference from an absent optional argument
    // would pick the default rather than the caller's type.
    frontmatter: await parseFrontmatter<TFrontmatter>(
      data,
      relativePath,
      config.frontmatterSchema,
    ),
    content,
  };
}

function collect<TFrontmatter extends DocFrontmatter>(
  dir: DirScan<TFrontmatter>,
  files: Array<DocFile<TFrontmatter>>,
  bySlug: Map<string, DocFile<TFrontmatter>>,
): void {
  const own = dir.index ? [dir.index, ...dir.pages] : dir.pages;
  for (const file of own) {
    const clash = bySlug.get(file.slug);
    if (clash) {
      throw new Error(
        `Two files claim the route "${file.href}": ${clash.relativePath} ` +
          `and ${file.relativePath}. Rename one, or delete the other — ` +
          'a directory index and a same-named sibling file collide.',
      );
    }
    bySlug.set(file.slug, file);
    files.push(file);
  }
  for (const child of dir.dirs) {
    collect(child, files, bySlug);
  }
}

/* -------------------------------------------------------------------------
 * Navigation
 * ---------------------------------------------------------------------- */

function buildNav(dir: DirScan, config: ResolvedDocsConfig): DocNavNode[] {
  const entries: MetaDirEntry[] = [];

  /**
   * `guides.md` beside a `guides/` that has no `index.md` is that directory's
   * own page: both answer to the name `meta.json` addresses them by, and both
   * contribute a nav entry. Merged into one group whose heading links to the
   * page, rather than left to collide — an ambiguous name is how a published
   * route ends up reachable from no link in the sidebar.
   *
   * When the directory *does* have an `index.md`, the two claim the same route
   * and `collect` has already failed the build.
   */
  const mergeable = new Set(
    dir.dirs
      .filter((child) => child.index === undefined)
      .map((child) => child.name),
  );
  const dirPages = new Map<string, DocFile>();

  for (const page of dir.pages) {
    const name = baseName(page.filePath);
    if (mergeable.has(name)) {
      dirPages.set(name, page);
      continue;
    }
    entries.push(toPageEntry(page, config));
  }

  if (dir.index) {
    entries.push({ ...toPageEntry(dir.index, config), isIndex: true });
  }

  for (const child of dir.dirs) {
    const children = buildNav(child, config);
    const index = child.index ?? dirPages.get(child.name);
    const title = groupTitle(child, index);
    const href = index && isVisibleIn(index, config) ? index.href : undefined;

    const group: DocNavGroup = {
      type: 'group',
      title,
      children,
      // `exactOptionalPropertyTypes`: the key is absent, never `undefined`.
      ...(href !== undefined ? { href } : {}),
    };

    // A directory with a page of its own and nothing under it is a link, not a
    // disclosure: the group form would render an expand control that opens an
    // empty list. (With no page of its own either, `dropEmptyGroups` removes
    // it entirely.)
    const node: DocNavNode =
      children.length === 0 && index !== undefined && href !== undefined
        ? { type: 'page', title, href, slug: index.slug }
        : group;

    const order = index?.frontmatter.order;
    entries.push({
      name: child.name,
      title,
      node,
      inlineChildren: children,
      ...(index !== undefined && href !== undefined
        ? {
            indexNode: {
              type: 'page',
              title: navTitle(index),
              href,
              slug: index.slug,
            } satisfies DocNavPage,
          }
        : {}),
      ...(order !== undefined ? { order } : {}),
    });
  }

  return orderNavEntries(entries, dir.meta, dir.metaPath);
}

function toPageEntry(page: DocFile, config: ResolvedDocsConfig): MetaDirEntry {
  const title = navTitle(page);
  const { order } = page.frontmatter;
  return {
    name: baseName(page.filePath),
    title,
    node: { type: 'page', title, href: page.href, slug: page.slug },
    ...(order !== undefined ? { order } : {}),
    ...(isVisibleIn(page, config) ? {} : { hidden: true }),
  };
}

/** Sidebars are narrow: `label` wins over `title` when the author set one. */
function navTitle(page: DocFile): string {
  return page.frontmatter.label ?? page.frontmatter.title;
}

/**
 * A group heading: its own `meta.json` title, else the title of the page that
 * *is* the directory (`index.md`, or a merged same-named sibling), else the
 * directory name humanised.
 */
function groupTitle(dir: DirScan, index: DocFile | undefined): string {
  const fromMeta = dir.meta?.title;
  if (fromMeta !== undefined) {
    return fromMeta;
  }
  if (index) {
    return navTitle(index);
  }
  return humanize(dir.name);
}

function isVisibleIn(file: DocFile, config: ResolvedDocsConfig): boolean {
  return config.includeDrafts || file.frontmatter.draft !== true;
}

/* -------------------------------------------------------------------------
 * Aliases
 * ---------------------------------------------------------------------- */

/**
 * A former URL from `aliases` frontmatter, as a route.
 *
 * `'quickstart'` on a site mounted at `/docs` becomes `/docs/quickstart`.
 * Leading and trailing slashes are tolerated because authors write them, but
 * the value is always relative to the base path — an alias of `'/docs/old'` on
 * a `/docs` site would produce `/docs/docs/old`.
 *
 * Shared by both adapters so they agree on which routes exist: an alias is a
 * redirect the host installs, so a link to one resolves, and a link that
 * builds under Next must build under Vite.
 */
export function toAliasRoute(
  alias: string,
  basePath: string,
  /**
   * The source path, for the error. A STRING rather than the whole `DocFile`
   * it used to take: this function dereferenced exactly one property of it, and
   * demanding the object meant a cache reader or a manifest-driven redirect
   * table had to fabricate a `DocFile` to agree with the package about which
   * routes exist. That is the reason it is exported at all.
   */
  sourceLabel: string,
): string {
  const trimmed = alias.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (trimmed === '') {
    throw new Error(
      `@waveso/docs: ${sourceLabel} has an empty entry in its ` +
        '`aliases` frontmatter. Each alias is a former URL for this page, ' +
        'relative to the docs base path — e.g. `aliases: [quickstart]`.',
    );
  }
  return `${basePath}/${trimmed}`;
}

/* -------------------------------------------------------------------------
 * Naming
 * ---------------------------------------------------------------------- */

/**
 * ⚠️ `_` AND `.` BOTH, MATCHING `isIgnoredDir` BELOW — which is what this did
 * NOT do. A leading dot was skipped and a leading underscore was not, so
 * `_drafts/` was excluded while `_notes.md` beside it was published: routed,
 * listed in the sidebar, written into the sitemap, indexed for search.
 *
 * The asymmetry cannot have been intentional. There is no `ignore` option in
 * `DocsConfig`, and `draft: true` still demands a valid `title`, so the
 * underscore is the ONLY way to keep a markdown file in the tree without
 * publishing it — and it silently did not work for the half people reach for
 * first. Docusaurus and Nextra skip both forms.
 */
function isPageFile(name: string): boolean {
  return (
    !name.startsWith('.') &&
    !name.startsWith('_') &&
    name.endsWith(PAGE_EXTENSION) &&
    name.length > PAGE_EXTENSION.length
  );
}

/** `_drafts/` and `.git/` are not content. */
function isIgnoredDir(name: string): boolean {
  return name.startsWith('.') || name.startsWith('_');
}

function baseName(filePath: string): string {
  return path.basename(filePath, PAGE_EXTENSION);
}

function toHref(basePath: string, segments: readonly string[]): string {
  if (segments.length === 0) {
    return basePath === '' ? '/' : basePath;
  }
  return `${basePath}/${segments.join('/')}`;
}

function normalizeBasePath(basePath: string): string {
  const trimmed = basePath.trim().replace(/\/+$/, '');
  if (trimmed === '') {
    return '';
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/** Windows separators never reach a URL or a `relativePath`. */
function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

/** `getting-started` -> `Getting Started`. */
function humanize(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter((word) => word !== '')
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}
