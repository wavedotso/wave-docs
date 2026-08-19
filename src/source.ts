/**
 * The source layer: a content directory on disk becomes `DocFile[]` plus a
 * navigation tree.
 *
 * Node-only, and the only module that touches the filesystem. Everything it
 * produces is plain data, so the result crosses the RSC boundary, a Vite
 * virtual module or a JSON cache file without ceremony.
 */

import type { Dirent, Stats } from 'node:fs';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { VFile } from 'vfile';
import { matter } from 'vfile-matter';
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
import { docsError } from './docs-error.js';
import { createSemaphore } from './semaphore.js';
import { encodeSegments, toAliasRoute } from './route-path.js';

/** Markdown only. MDX is deliberately out of scope for this package. */
const PAGE_EXTENSION = '.md';

/** A directory whose `index.md` is the directory's own route. */
const INDEX_NAME = 'index';

/**
 * Filesystem calls in flight across the whole process, at most.
 *
 * ⚠️ THE SCAN USED TO OPEN EVERY MARKDOWN FILE AT ONCE. `scanDir` recursed into
 * its subdirectories in parallel and read that directory's pages with a bare
 * `Promise.all`, so the number of `readFile` calls in flight equalled the number
 * of markdown files in the entire tree. On a 1,200-page corpus and the common
 * 1,024-descriptor soft limit, `next build` died with a bare `EMFILE: too many
 * open files` — no error code, no mention that this was the docs scan, and
 * nothing pointing at the fix. Exactly the large content set this package is
 * for, and the failure got worse as the site grew.
 *
 * 64 is far under every default soft limit — 1,024 on Linux and CI images, 256
 * on an unconfigured macOS shell — so the descriptors stop scaling with the
 * corpus while staying safe on the tightest of those.
 *
 * ⚠️ IT IS NOT FREE, AND THE COST IS NOT THE CONCURRENCY. Measured over 1,201
 * pages in 49 directories, nine runs, medians: **88 ms ungated, 106 ms at a
 * bound of 16, 102 ms at 64, 101 ms at 128 and at 256.** Flat from 64 upwards,
 * which says the ~14 ms is the gate's own per-call overhead — about 3,600
 * `run` closures — and not the reduced parallelism. libuv's filesystem pool is
 * four threads by default, so there was never 1,201-way parallelism to lose.
 *
 * So the number is chosen for the tightest descriptor limit rather than for
 * speed, because above 64 there is no speed left to buy. 14 ms sits against a
 * build that highlights those same 1,201 pages with Shiki, which is three
 * orders of magnitude more.
 */
const SCAN_CONCURRENCY = 64;

/**
 * The one gate, for the whole process.
 *
 * Module scope rather than per-scan, because descriptors are a process resource:
 * two routes scanning two content directories at once would each stay under a
 * per-scan bound and together exceed the only one that matters.
 *
 * ⚠️ LEAF CALLS ONLY — NEVER THE RECURSION. Gating `scanDir` itself deadlocks as
 * soon as every slot is held by a directory waiting for a slot to read its
 * children. Bounding the `readFile`/`readdir`/`stat`/`realpath` calls bounds the
 * descriptors exactly, and leaves the walk as parallel as it was.
 */
const fsGate = createSemaphore(SCAN_CONCURRENCY);

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
   * Every `draft: true` page, whatever `includeDrafts` says.
   *
   * A link to a draft resolves to a file plainly sitting on disk, so the
   * renderer's generic "no such page exists" sends the author hunting for a
   * typo in a link that is spelled correctly. `createDocsRoute` feeds this to
   * `DocsRendererOptions.draftRoutes` so the build still fails, but names the
   * reason. Unfiltered on purpose: under `includeDrafts` these routes are
   * published too, and the renderer checks `knownRoutes` first.
   */
  drafts(): Promise<Array<DocFile<TFrontmatter>>>;
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
    /*
     * ⚠️ `turbopackIgnore` IS LOAD-BEARING — IT IS NOT A WARNING SUPPRESSION.
     * `contentDir` comes from the consumer, so Turbopack's static analysis
     * cannot see what this reads — and its fallback is to trace *the entire
     * project* into the server output: every source file, the whole `public/`
     * folder, previous build output. Measured on the smoke app, that was 39
     * unrelated files traced into a route that needs none of them; on a real
     * docs site it is every image you ship, and on a serverless host it is how
     * you meet a bundle size limit for no reason. The build says so out loud
     * ("Dynamic filesystem access causes tracing of the whole project"), which
     * meant every consumer got a warning we had no answer for.
     *
     * Nothing needs tracing here, because nothing reads markdown at request
     * time: `dynamicParams = false` prerenders every page, and the search
     * index is `force-static` with a guard that throws if it is not. Both are
     * required, so there is no supported configuration this takes anything
     * away from. `smoke/check.ts` asserts no `.md` is traced, so if that ever
     * stops being true it fails there rather than in someone's deploy.
     */
    contentDir: path.resolve(
      /*turbopackIgnore: true*/ process.cwd(),
      config.contentDir,
    ),
    basePath: normalizeBasePath(config.basePath ?? '/docs'),
    includeDrafts: config.includeDrafts ?? false,
    onBrokenLinks: config.onBrokenLinks ?? 'throw',
    onUnverifiableLinks: config.onUnverifiableLinks ?? 'ignore',
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
    resolved.onBrokenLinks,
    resolved.onUnverifiableLinks,
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
 * A page, plus the name that addresses it: the filename without its extension,
 * NFC-normalised.
 *
 * Carried rather than re-derived from `filePath`, which deliberately keeps the
 * raw on-disk bytes — a macOS zip yields NFD filenames, and a route segment
 * spelled in NFD matches no link anyone types.
 */
interface ScannedPage<TFrontmatter extends DocFrontmatter = DocFrontmatter> {
  name: string;
  doc: DocFile<TFrontmatter>;
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
  index: ScannedPage<TFrontmatter> | undefined;
  /** Pages in this directory, `index.md` excluded. */
  pages: Array<ScannedPage<TFrontmatter>>;
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
  const load = (): Promise<Scan<TFrontmatter>> => {
    // Evict on rejection. A cached REJECTED promise makes one transient
    // failure — a file half-written by an editor, a `meta.json` mid-save —
    // permanent for the life of the process: every later query replays the
    // same error and the disk is never read again, so a dev server can only
    // be fixed by restarting it. `next.ts` evicts its component cache for
    // exactly this reason.
    cached ??= scan(config).catch((err: unknown) => {
      cached = null;
      throw describeScanFailure(err, config.contentDir);
    });
    return cached;
  };

  const isVisible = (file: DocFile): boolean =>
    config.includeDrafts || file.frontmatter.draft !== true;

  return {
    config,
    /**
     * Throw the scan away. The next query reads the disk again.
     *
     * ⚠️ A STAT-WALK DIRTY CHECK WAS BUILT HERE AND MEASURED AND REMOVED. The
     * idea is obvious and the roadmap called for it: mark dirty, then compare
     * a stat-only fingerprint of the tree against the cached one and skip the
     * re-read when nothing changed. It rests on stat being much cheaper than
     * read, and on this corpus it is not — the fingerprint has to `readdir`
     * every directory and `stat` every file, which is nearly everything the
     * scan does apart from the read and the parse.
     *
     * Measured over 501 pages, median of six, against a full rescan:
     *
     *   ~1.4 KB pages   28.3 ms vs 26.8 ms   0.95x  (slower)
     *   ~20 KB pages    28.8 ms vs 27.4 ms   0.95x  (slower)
     *   ~120 KB pages   39.1 ms vs 45.1 ms   1.15x  (faster)
     *
     * Documentation pages are the first two rows. So it is a small regression
     * plus a new class of invalidation bug, in exchange for a win on a corpus
     * nobody has. There is no cheaper correct fingerprint either: statting
     * only directories catches an added or renamed file but not an edited one,
     * which is the common case in a dev server.
     *
     * If this is ever revisited, the thing to change is the *scan*, not the
     * check — patch only the files whose mtime moved and re-derive the nav in
     * memory, which is a different item with a much harder correctness story.
     */
    invalidate() {
      cached = null;
    },
    async all() {
      const { files } = await load();
      return files.filter(isVisible);
    },
    async drafts() {
      const { files } = await load();
      return files.filter((file) => file.frontmatter.draft === true);
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

/**
 * Say that a descriptor exhaustion happened here, and that it was not us.
 *
 * `EMFILE`/`ENFILE` arrive from Node as a bare `Error` with no hint of what was
 * being read, and the message a reader used to get was
 * `EMFILE: too many open files, open '<contentDir>/p829.md'` and nothing else.
 * That is a filename out of a corpus of a thousand, from a stack of `dist/`
 * frames, during a `next build` that mentions no package.
 *
 * The scan itself is bounded at {@link SCAN_CONCURRENCY} now, so reaching this
 * means the limit is lower than that or something else in the process has the
 * descriptors — which is the useful thing to be told, and the opposite of what a
 * reader concludes from an error naming one of their own markdown files.
 *
 * Only these two codes, and only when the failure is not already ours: a
 * `broken-symlink` or an `invalid-frontmatter` that came out of the scan is
 * already a better message than anything this could add.
 */
function describeScanFailure(err: unknown, contentDir: string): unknown {
  const code = (err as { code?: unknown } | null)?.code;
  if (code !== 'EMFILE' && code !== 'ENFILE') {
    return err;
  }
  return docsError(
    'descriptor-limit',
    `the process ran out of file descriptors while scanning ${contentDir}. ` +
      `The scan holds at most ${String(SCAN_CONCURRENCY)} open at a time, so ` +
      'something else has them — raise the limit (`ulimit -n`, or ' +
      '`LimitNOFILE` under systemd) rather than shrinking the corpus. If it ' +
      'persists with a limit well above that, it is a bug in this package: ' +
      'https://github.com/wavedotso/wave-docs/issues',
    { cause: err },
  );
}

async function scan<TFrontmatter extends DocFrontmatter>(
  config: ResolvedDocsConfig<TFrontmatter>,
): Promise<Scan<TFrontmatter>> {
  await assertContentDir(config.contentDir);

  const root = await scanDir(
    config.contentDir,
    [],
    '',
    config,
    // Seeded with the content root so a symlink pointing back at it is caught
    // on the first descent rather than one level down.
    new Set([await fsGate.run(() => realpath(config.contentDir))]),
  );
  const files: Array<DocFile<TFrontmatter>> = [];
  const bySlug = new Map<string, DocFile<TFrontmatter>>();

  collect(root, files, bySlug);

  return { files, bySlug, nav: buildNav(root, config) };
}

async function assertContentDir(contentDir: string): Promise<void> {
  try {
    const stats = await fsGate.run(() => stat(contentDir));
    if (stats.isDirectory()) {
      return;
    }
  } catch {
    // Fall through to the shared, actionable error below.
  }
  throw docsError(
    'missing-content-dir',
    `Docs content directory not found: ${contentDir}\n` +
      'Set `contentDir` to a directory of markdown files; relative paths ' +
      `resolve against the working directory (${process.cwd()}).`,
  );
}

/**
 * A directory entry, once its kind is known.
 *
 * `absPath` keeps the raw on-disk filename; `name` is the NFC form, which is
 * the route segment and the name `meta.json` addresses the entry by.
 */
type ClassifiedEntry =
  | { kind: 'skip' }
  | { kind: 'page'; absPath: string; name: string }
  | { kind: 'dir'; absPath: string; name: string; realPath: string };

const SKIP: ClassifiedEntry = { kind: 'skip' };

async function scanDir<TFrontmatter extends DocFrontmatter>(
  absPath: string,
  segments: string[],
  name: string,
  config: ResolvedDocsConfig<TFrontmatter>,
  /** Resolved paths of this directory and every one above it. */
  ancestors: ReadonlySet<string>,
): Promise<DirScan<TFrontmatter>> {
  const [meta, entries] = await Promise.all([
    fsGate.run(() => readDocsMeta(absPath)),
    fsGate.run(() => readdir(absPath, { withFileTypes: true })),
  ]);

  const classified = await Promise.all(
    entries
      // Normalised here and nowhere else. `path.join(absPath, entry.name)`
      // keeps the bytes the filesystem reported, so the file still opens.
      .map((entry) => ({ entry, name: entry.name.normalize('NFC') }))
      // readdir order is filesystem-dependent; sort so the build is
      // reproducible.
      .sort((a, b) => a.name.localeCompare(b.name, 'en'))
      .map((listed) => classifyEntry(absPath, listed.entry, listed.name)),
  );

  const pageEntries: Array<{ absPath: string; name: string }> = [];
  const dirEntries: Array<{ absPath: string; name: string; realPath: string }> =
    [];
  for (const entry of classified) {
    if (entry.kind === 'page') {
      pageEntries.push(entry);
    } else if (entry.kind === 'dir' && !ancestors.has(entry.realPath)) {
      // Ancestors only, never siblings: two symlinks to one directory are two
      // legitimate sections, while a link to a directory that contains it is a
      // walk that never ends. It is skipped rather than reported — the pages
      // under it are already published at their real routes.
      dirEntries.push(entry);
    }
  }

  const [pages, dirs] = await Promise.all([
    Promise.all(
      pageEntries.map((entry) =>
        readPage(entry.absPath, entry.name, segments, config),
      ),
    ),
    Promise.all(
      dirEntries.map((entry) =>
        scanDir(
          entry.absPath,
          [...segments, entry.name],
          entry.name,
          config,
          new Set(ancestors).add(entry.realPath),
        ),
      ),
    ),
  ]);

  const index = pages.find((page) => page.name === INDEX_NAME);

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

/**
 * What kind of content is this directory entry?
 *
 * ⚠️ `isFile()` AND `isDirectory()` ARE BOTH FALSE FOR A SYMBOLIC LINK, and
 * `readdir` has no follow option — so a symlinked page, or a whole symlinked
 * section, was absent from `all()`, `nav()`, the sitemap and the search index
 * without a word. The cascade is worse than the omission: the first link to
 * the missing page fails the build with `no such page exists`, which sends the
 * author after a link that is perfectly correct.
 *
 * `stat` follows the link, so the target's kind decides — and the name filters
 * still apply to the link's own name, which is what the URL is built from.
 */
async function classifyEntry(
  dirPath: string,
  entry: Dirent,
  name: string,
): Promise<ClassifiedEntry> {
  const absPath = path.join(dirPath, entry.name);
  let isFile = entry.isFile();
  let isDir = entry.isDirectory();

  if (!isFile && !isDir) {
    if (!entry.isSymbolicLink()) {
      // A socket, a FIFO or a device file is not content.
      return SKIP;
    }
    let target: Stats;
    try {
      target = await fsGate.run(() => stat(absPath));
    } catch {
      if (!isPageFile(name)) {
        return SKIP;
      }
      throw docsError(
        'broken-symlink',
        `@waveso/docs: ${absPath} is a broken symbolic link, and it names a ` +
          'markdown page — so skipping it would delete a route nobody asked ' +
          'to delete. Point it at an existing file, or remove the link.',
      );
    }
    isFile = target.isFile();
    isDir = target.isDirectory();
  }

  if (isFile) {
    return isPageFile(name)
      ? { kind: 'page', absPath, name: stripExtension(name) }
      : SKIP;
  }
  if (isDir && !isIgnoredDir(name)) {
    // Resolved, not joined: only a symlink can put a directory inside itself,
    // and `ancestors` can only catch that if both sides are resolved.
    return {
      kind: 'dir',
      absPath,
      name,
      realPath: await fsGate.run(() => realpath(absPath)),
    };
  }
  return SKIP;
}

async function readPage<TFrontmatter extends DocFrontmatter>(
  filePath: string,
  /** Filename without its extension, NFC-normalised. */
  name: string,
  dirSegments: string[],
  config: ResolvedDocsConfig<TFrontmatter>,
): Promise<ScannedPage<TFrontmatter>> {
  const raw = await fsGate.run(() => readFile(filePath, 'utf8'));
  const relativePath = toPosix(path.relative(config.contentDir, filePath));

  let data: unknown;
  let content: string;
  let frontmatterLines = 0;
  try {
    /*
     * `vfile-matter` mutates the file: it strips the block from `file.value`
     * and puts the parsed object on `file.data.matter`. That is why this is
     * two statements rather than a destructure, and it is also the whole
     * reason for the swap — `gray-matter` reached for a bare `require('fs')`
     * (for a `matter.read()` this package never calls), which was the only
     * gratuitous Node requirement in the tree, and memoised every distinct
     * file body it had ever seen in a module-level cache that is never
     * evicted. A dev server rescanning on each save kept one full copy per
     * revision for the life of the process; the eleven-line comment that used
     * to sit here worked around it with an options object.
     */
    /*
     * ⚠️ THE BOM IS OURS TO STRIP NOW. `gray-matter` did it; `vfile-matter`
     * does not, and `readFile(…, 'utf8')` does not either. Left in place the
     * parser sees `\uFEFF---`, which is not a delimiter, so the whole block
     * becomes body text and the page has no title — a failure that reproduces
     * only on files written by editors that emit one, which is most of them
     * on Windows. Caught by the byte-level cases written green against the old
     * parser before the swap, which is the only reason it is not shipped.
     */
    const source = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    const file = new VFile({ value: source });
    matter(file, { strip: true });
    data = file.data.matter;
    content = String(file);

    /*
     * ⚠️ THE STRIPPED LINES HAVE TO BE COUNTED HERE OR THEY CANNOT BE RECOVERED.
     * `strip: true` deletes the block from the value, so every position remark
     * reports afterwards counts from the first line of the body — and the three
     * link errors print `relativePath:line`, which a terminal and an editor turn
     * into a jump. A page with `title`, `description`, `label` and `order` is
     * six lines out, so a link on line 10 was reported at line 4, inside the
     * block that is no longer there.
     *
     * Measured off the value rather than off the parsed object: `vfile-matter`
     * leaves the body as an exact tail of what it was given, so the prefix it
     * removed is the difference in length and its newline count is the offset.
     * The `endsWith` guard is there because that is an implementation detail of
     * a dependency — if it ever stops holding, the offset goes to zero and the
     * errors are merely as wrong as they used to be, rather than wrong in a new
     * direction that nobody would think to check.
     */
    if (source.endsWith(content)) {
      const stripped = source.slice(0, source.length - content.length);
      frontmatterLines = stripped.split('\n').length - 1;
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw docsError(
      'invalid-frontmatter',
      `Could not parse the frontmatter block in ${relativePath}: ${reason}`,
      // The YAML parser's own error carries the line and column inside the
      // block, which
      // `reason` flattens away; the cause keeps it for anyone who unwraps.
      { cause: err },
    );
  }

  const segments =
    name === INDEX_NAME ? [...dirSegments] : [...dirSegments, name];

  // The type argument is explicit: inference from an absent optional argument
  // would pick the default rather than the caller's type.
  const frontmatter = await parseFrontmatter<TFrontmatter>(
    data,
    relativePath,
    config.frontmatterSchema,
  );

  // Aliases are validated here, with the file that declares them in hand.
  // Their only other caller is the adapter that installs the redirects, long
  // after the scan: an alias Next reads as a pattern would fail there naming a
  // string nobody wrote, or install a wildcard and name nothing at all.
  for (const alias of frontmatter.aliases ?? []) {
    toAliasRoute(alias, config.basePath, relativePath);
  }

  return {
    name,
    doc: {
      segments,
      slug: segments.join('/'),
      href: toHref(config.basePath, segments),
      filePath,
      relativePath,
      frontmatter,
      content,
      frontmatterLines,
    },
  };
}

function collect<TFrontmatter extends DocFrontmatter>(
  dir: DirScan<TFrontmatter>,
  files: Array<DocFile<TFrontmatter>>,
  bySlug: Map<string, DocFile<TFrontmatter>>,
): void {
  const own = dir.index ? [dir.index, ...dir.pages] : dir.pages;
  for (const { doc: file } of own) {
    const clash = bySlug.get(file.slug);
    if (clash) {
      throw docsError(
        'route-collision',
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
  const dirPages = new Map<string, ScannedPage>();

  for (const page of dir.pages) {
    if (mergeable.has(page.name)) {
      dirPages.set(page.name, page);
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
    /**
     * ⚠️ A DRAFT INDEX IS NOT A PUBLIC PAGE, AND ITS TITLE IS NOT EITHER.
     *
     * Only `href` used to be gated on visibility, so `secret/index.md` with
     * `draft: true` still supplied the group heading — an unreleased codename
     * rendered into the sidebar of a production build, with no link on it, so
     * no click reveals it and only view-source shows it at all. Its `order`
     * also still positioned the group among published ones.
     */
    const visible = index && isVisibleIn(index.doc, config) ? index : undefined;
    const title = groupTitle(child, visible?.doc);
    const href = visible?.doc.href;

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
      children.length === 0 && visible !== undefined && href !== undefined
        ? { type: 'page', title, href, slug: visible.doc.slug }
        : group;

    const order = visible?.doc.frontmatter.order;
    entries.push({
      name: child.name,
      title,
      node,
      inlineChildren: children,
      ...(visible !== undefined && href !== undefined
        ? {
            indexNode: {
              type: 'page',
              title: navTitle(visible.doc),
              href,
              slug: visible.doc.slug,
            } satisfies DocNavPage,
          }
        : {}),
      ...(order !== undefined ? { order } : {}),
    });
  }

  return orderNavEntries(entries, dir.meta, dir.metaPath, dir.segments.length);
}

function toPageEntry(
  page: ScannedPage,
  config: ResolvedDocsConfig,
): MetaDirEntry {
  const title = navTitle(page.doc);
  const { order } = page.doc.frontmatter;
  return {
    name: page.name,
    title,
    node: { type: 'page', title, href: page.doc.href, slug: page.doc.slug },
    ...(order !== undefined ? { order } : {}),
    ...(isVisibleIn(page.doc, config) ? {} : { hidden: true }),
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
 * ⚠️ CHARACTERS `path-to-regexp` READS AS PATTERN SYNTAX.
 *
 * Next compiles every `redirects()` source with it, so an alias is not the
 * literal URL it looks like. `v1:beta` compiles to `/docs/v1([^/]+?)`, which
 * `next build` accepts without a word and which then 308s the genuinely
 * prerendered `/docs/v1-guide` away — config redirects run before filesystem
 * routes, so the real page is unreachable in production and nothing reports
 * it. `c++` is the loud sibling: the build aborts with `Unexpected MODIFIER at
 * 7`, naming an offset into a string the author never wrote and no file.
 */
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
    // Case-insensitively: a `README.MD` off a Windows checkout or a zip is a
    // markdown page everywhere else in the toolchain, and skipping it puts the
    // build's failure ("no such page exists", at the first link to it) two
    // steps away from its cause. `path.extname('.md')` is `''`, so a file
    // named only for the extension is still not a page.
    path.extname(name).toLowerCase() === PAGE_EXTENSION
  );
}

/** `_drafts/` and `.git/` are not content. */
function isIgnoredDir(name: string): boolean {
  return name.startsWith('.') || name.startsWith('_');
}

/** `getting-started.MD` -> `getting-started`. */
function stripExtension(name: string): string {
  return name.slice(0, name.length - path.extname(name).length);
}

function toHref(basePath: string, segments: readonly string[]): string {
  if (segments.length === 0) {
    return basePath === '' ? '/' : basePath;
  }
  return `${basePath}/${encodeSegments(segments)}`;
}

function normalizeBasePath(basePath: string): string {
  /*
   * ⚠️ RUNS OF SLASHES COLLAPSE, AND A LEADING PAIR IS THE ONE THAT MATTERS.
   * `basePath: '//docs'` — a typo, or a join that already had a leading slash —
   * used to survive intact, and `//docs/setup` is not a path at all: a browser
   * reads a leading `//` as scheme-relative and goes to the host `docs`. Every
   * canonical, every `og:url` and every sitemap entry on the site pointed off
   * it, and the build said nothing.
   */
  const trimmed = basePath
    .trim()
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '');
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
