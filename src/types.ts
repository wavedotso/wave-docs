/**
 * Shared types for `@waveso/docs`.
 *
 * This module is type-only by design: it compiles to an empty JavaScript file
 * and can therefore be imported from a Node-only module, a React Server
 * Component or a browser bundle without dragging anything with it. Every
 * other entry point in the package agrees on the shapes declared
 * here — treat it as the contract, and change it deliberately.
 */

import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Root as HastRoot } from 'hast';

/* -------------------------------------------------------------------------
 * Frontmatter
 * ---------------------------------------------------------------------- */

/**
 * The frontmatter fields the package itself understands.
 *
 * Consumers extend this with their own schema — {@link DocsConfig.frontmatterSchema} —
 * and the extra fields flow through the generic parameter on {@link DocFile}
 * and friends rather than widening this interface.
 *
 * The optionals are spelled `?: T | undefined` because a schema written with
 * `.optional()` instead of `.exactOptional()` infers exactly that shape, and
 * under `exactOptionalPropertyTypes` the narrow spelling rejects it — as a
 * nine-line error through Standard Schema's internals at the config, plus a
 * `Property 'audience' does not exist on type 'DocFrontmatter'` at every read
 * site, because the inference then collapses to this default.
 */
export interface DocFrontmatter {
  /** Page title. Used for `<h1>` fallbacks, `<title>`, and search. */
  title: string;
  /** One-line summary. Used for `<meta name="description">` and search. */
  description?: string | undefined;
  /**
   * Sidebar label, when it should differ from {@link DocFrontmatter.title}.
   * Sidebars are narrow; page ancestors are not.
   */
  label?: string | undefined;
  /**
   * Excluded from navigation, search and `generateStaticParams`.
   *
   * Deliberately not tied to `NODE_ENV`: Vercel preview deployments are
   * production builds, so branching on it would hide drafts in exactly the
   * place reviewers look. Gate on an explicit config flag instead.
   */
  draft?: boolean | undefined;
  /**
   * Previous URLs for this page, relative to the docs base path
   * (e.g. `['old-name', 'legacy/old-name']`). The Next adapter turns these
   * into permanent redirects so a rename never becomes a silent 404.
   */
  aliases?: string[] | undefined;
  /**
   * Sort weight within its directory, for directories without a `meta.json`.
   * Lower sorts first; pages without an order sort last, alphabetically.
   */
  order?: number | undefined;
}

/* -------------------------------------------------------------------------
 * Source — what the filesystem walk produces
 * ---------------------------------------------------------------------- */

/**
 * A single documentation page discovered on disk.
 *
 * `segments` is the canonical identity; `slug` and `href` are derived and
 * cached for convenience. An `index.md` at the content root has an empty
 * `segments` array and maps to the base path itself.
 */
export interface DocFile<TFrontmatter extends DocFrontmatter = DocFrontmatter> {
  /** Route segments, e.g. `['api', 'auth']`. Empty for the root index page. */
  segments: string[];
  /** `segments.join('/')`, e.g. `'api/auth'`. Empty string for the index. */
  slug: string;
  /** Fully-qualified route, e.g. `'/docs/api/auth'`. */
  href: string;
  /** Absolute path on disk. */
  filePath: string;
  /** Path relative to the content root, e.g. `'api/auth.md'`. */
  relativePath: string;
  /** Validated frontmatter. */
  frontmatter: TFrontmatter;
  /** Markdown body with the frontmatter block removed. */
  content: string;
  /**
   * How many lines the frontmatter block took up, so an error can name the line
   * in the file rather than in the body.
   *
   * ⚠️ WITHOUT IT, EVERY LINK ERROR POINTED INTO THE FRONTMATTER. `content` has
   * the block removed, so remark counts `node.position.start.line` from the
   * first line of the *body* — and `broken-link`, `draft-link` and `alias-link`
   * all report `relativePath:line`, the exact `file:line` form a terminal and an
   * editor turn into a jump. A page with four frontmatter fields is six lines
   * out: a link on line 10 was reported at line 4, which is the middle of the
   * block that was deleted.
   *
   * Set by `@waveso/docs/source`. Optional and treated as `0` when absent,
   * because a host loading content itself — the documented reason `./render` is
   * an entry point — hands over a body with no block in front of it and has
   * nothing to offset.
   */
  frontmatterLines?: number | undefined;
}

/* -------------------------------------------------------------------------
 * Navigation
 * ---------------------------------------------------------------------- */

/** A link to a documentation page. */
export interface DocNavPage {
  type: 'page';
  title: string;
  href: string;
  slug: string;
}

/**
 * A directory. `href` is present when the directory has an `index.md`, in
 * which case the group heading is itself a link.
 */
export interface DocNavGroup {
  type: 'group';
  title: string;
  href?: string | undefined;
  children: DocNavNode[];
}

/** A non-interactive heading between groups, from `"---Label---"` in meta.json. */
export interface DocNavSeparator {
  type: 'separator';
  title: string;
}

/** An arbitrary external link, from an object entry in meta.json. */
export interface DocNavLink {
  type: 'link';
  title: string;
  href: string;
  external: boolean;
}

export type DocNavNode =
  | DocNavPage
  | DocNavGroup
  | DocNavSeparator
  | DocNavLink;

/**
 * Per-directory ordering and labelling, read from `meta.json`.
 *
 * Chosen over numeric filename prefixes because a filename cannot express
 * separators, external links, or a directory title — all of which a real
 * docs sidebar needs — and because `01_mental_model.md` violates kebab-case
 * twice over.
 *
 * `pages` accepts:
 *  - `"getting-started"` — a file or subdirectory in this directory
 *  - `"---Reference---"` — a separator with the enclosed label
 *  - `"..."`             — everything not named explicitly, alphabetically
 *  - `"...api"`          — expand the `api` subdirectory inline
 *  - `{ title, href }`   — an arbitrary link
 */
export interface DocsMeta {
  /** Directory title, shown as the group heading. Defaults to the dirname. */
  title?: string | undefined;
  /** Ordered entries. Omit to sort by frontmatter `order`, then alphabetically. */
  pages?: Array<string | { title: string; href: string }> | undefined;
}

/* -------------------------------------------------------------------------
 * Table of contents
 * ---------------------------------------------------------------------- */

/**
 * A heading captured from the rendered tree.
 *
 * These ids come from the same `rehype-slug` pass that annotated the document,
 * so anchors match by construction rather than by a second parse with a
 * separately-seeded slugger — which drifts precisely where it hurts, on
 * duplicate headings that get `-1` collision suffixes.
 */
export interface TocEntry {
  id: string;
  text: string;
  /**
   * Heading level. `h1` is the page title and is never in the TOC.
   *
   * In practice **2 or 3**: the capture stops at `h3`, measured on a synthetic
   * API reference where taking `h2`–`h6` gave 104 entries against 32. Deeper
   * headings keep their ids and permalinks, so they stay deep-linkable and
   * still open their own sections in search — only the rail entry is dropped.
   * `number` rather than `2 | 3` because `rehypePlugins` is the escape hatch
   * for putting them back, and a literal union would make that a type error.
   */
  depth: number;
  children: TocEntry[];
}

/* -------------------------------------------------------------------------
 * Render output
 * ---------------------------------------------------------------------- */

/**
 * A parsed, highlighted document, ready to be turned into React elements.
 *
 * `hast` is a plain serialisable tree — it survives the RSC boundary, a
 * `JSON.stringify` round-trip through any build-time artifact — a cache file,
 * a bundler virtual module — equally well. Rendering it is the consumer's
 * business.
 */
export interface RenderedDoc<
  TFrontmatter extends DocFrontmatter = DocFrontmatter,
> {
  frontmatter: TFrontmatter;
  hast: HastRoot;
  toc: TocEntry[];
  /** Route segments of the document this was rendered from. */
  segments: string[];
  href: string;
}

/* -------------------------------------------------------------------------
 * Search
 * ---------------------------------------------------------------------- */

/**
 * One indexable unit: a heading and the prose beneath it.
 *
 * Section-scoped rather than page-scoped so a hit can deep-link to the right
 * heading instead of dropping the reader at the top of a 2,000-word page.
 * The byte saving over full-page records is real but modest (~1.4x) — the
 * deep link is the point.
 */
export interface SearchRecord {
  /**
   * Stable id: `slug#anchor`, or the bare slug for a page's lead section.
   *
   * ⚠️ NOT THE `href`, WHICH IS WHAT IT USED TO BE. Two reasons, and both are
   * about the shipped `search-index.json` rather than about tidiness. It
   * carried the whole route twice per record, on the one artifact the README
   * sells on download size. And an href embeds `basePath`, so a site moving
   * from `/docs` to `/reference` changed the identity of every record for no
   * reason. A slug survives that.
   */
  id: string;
  /** Page title. */
  title: string;
  /** Heading text for this section; equals `title` for the lead section. */
  heading: string;
  /**
   * Ancestor headings, outermost first.
   *
   * NAMED FOR WHAT IT IS, not for what the dialog does with it. This was
   * `titles`, which sat between `title` and `heading` and meant neither — three
   * fields whose names differed by a plural. The UI turning these into
   * breadcrumbs is the UI's decision; the record is data.
   */
  ancestors: string[];
  /** Route including the anchor, e.g. `/docs/api/auth#bearer-token`. */
  href: string;
  /** Plain text of the section, truncated to the configured excerpt length. */
  text: string;
}

/* -------------------------------------------------------------------------
 * Configuration
 * ---------------------------------------------------------------------- */

/**
 * Where a link or an image was authored: the route AND the directory.
 *
 * ⚠️ BOTH, AND THE DIFFERENCE IS THE ENTIRE REASON THIS IS AN OBJECT. `api.md`
 * and `api/index.md` produce IDENTICAL route segments — `['api']` — and resolve
 * `./auth.md` to different pages, because one folds against the content root
 * and the other against `api/`. Only the on-disk path separates them.
 *
 * The resolvers used to receive route segments alone, so a custom resolver was
 * handed strictly less than the built-in one had and could not get
 * `./sibling.md` right on any directory index page. No rule recovers the
 * directory from the route, which is why the fix had to be the argument rather
 * than a note in the docs.
 */
export interface DocLinkContext {
  /** Route segments of the containing document, e.g. `['api', 'auth']`. */
  segments: string[];
  /**
   * Directory segments of the SOURCE FILE, relative to the content root:
   * `['api']` for both `api/auth.md` and `api/auth/index.md`. This is what a
   * relative href folds against.
   */
  dirSegments: string[];
  /** The source path, e.g. `'api/auth.md'`. For error messages. */
  relativePath: string;
}

/**
 * What a link problem should do to a build.
 *
 * The three Docusaurus settled on, and for the same reason: the tool cannot
 * know how much a given site cares, and guessing produces either a build that
 * fails on someone's legitimate URL or one that ships a dead link quietly.
 *
 * `'warn'` writes to `console.warn` and continues, which on a docs site is a
 * line in a build log — useful during a migration, not a substitute for
 * `'throw'`.
 */
export type DocsLinkSeverity = 'throw' | 'warn' | 'ignore';

/**
 * Resolve an internal markdown link target to a route.
 *
 * Called for every relative link found in the source. Returning `undefined`
 * signals "not a documentation page", which — under the default
 * `onBrokenLinks: 'throw'` — fails
 * the build rather than shipping a 404 that was valid on GitHub.
 */
export type LinkResolver = (
  /** The raw href as authored, e.g. `'./api/auth.md'`. */
  href: string,
  from: DocLinkContext,
) => string | undefined;

/**
 * Resolve an image `src` to a public URL and its intrinsic dimensions.
 *
 * Dimensions are read at build time because markdown carries none and
 * `next/image` refuses to render without them (short of `fill`).
 *
 * ⚠️ `src` ARRIVES FOLDED AND CONTAINED. A `../` chain is resolved against
 * `from.dirSegments` before this is called, and one that climbs above the
 * content root throws instead of reaching you — so an implementation that joins
 * this onto a filesystem path is not handing a document author a way to read
 * `../../../../.env`. That was not true before: images skipped folding
 * entirely and arrived exactly as authored.
 *
 * Two shapes are the exception, and they still reach you: an absolute
 * `/logo.png` and a schemed `https://…` are passed through UNFOLDED, because the
 * first is already a public URL and the second belongs to someone else. Folding
 * them would be meaningless, but they are not filtered out — a host that wants
 * to rewrite `/logo.png` onto a CDN needs the call. So an implementation that
 * blindly prefixes what it is handed produces `/cdn//logo.png` and
 * `/cdn/https://example.com/a.png`. Branch on them, or return `undefined` to
 * leave the src as authored.
 *
 * ⚠️ IT IS A FILE PATH, NOT AN HREF. `src` is percent-decoded, so
 * `./getting%20started.png` — what GitHub's editor writes when you drag in a
 * file whose name has a space — arrives as `getting started.png`, the name that
 * is actually on disk. Any `?query` and `#fragment` are split off before the
 * call and re-attached to whatever you return, so `./diagram.png?v=2` arrives
 * as `diagram.png` and the reader still gets the `?v=2`. Return a src carrying
 * a query or a fragment of your own and yours is kept instead, because two `?`
 * in one URL is not a URL.
 *
 * All three used to be handed over raw, and `readFile(join(dir, src))` — the
 * implementation the README gives — threw `ENOENT` on every one of them.
 */
export type ImageResolver = (
  src: string,
  from: DocLinkContext,
) =>
  | Promise<
      | { src: string; width?: number | undefined; height?: number | undefined }
      | undefined
    >
  | { src: string; width?: number | undefined; height?: number | undefined }
  | undefined;

/**
 * How a documentation tree is read.
 *
 * The type parameter is inferred from
 * {@link DocsConfig.frontmatterSchema} — pass one and every `DocFile` and
 * `RenderedDoc` the host hands back carries your fields, with no explicit type
 * argument anywhere. Omit it and the parameter defaults to
 * {@link DocFrontmatter}, which is what every existing call site gets.
 */
export interface DocsConfig<
  TFrontmatter extends DocFrontmatter = DocFrontmatter,
> {
  /**
   * Content root. Relative paths resolve against `process.cwd()`, which is
   * the project root during both `next build` and `vite build`.
   */
  contentDir: string;
  /** URL prefix the docs are mounted at. Defaults to `'/docs'`. */
  basePath?: string | undefined;
  /**
   * Include pages marked `draft: true`. Defaults to `false`.
   *
   * Drive this from your own env check — deliberately not `NODE_ENV`.
   */
  includeDrafts?: boolean | undefined;
  /**
   * What to do about an internal link that resolves to no published page.
   * Defaults to `'throw'`.
   *
   * A link that 404s was valid in the editor and on GitHub, so it is the kind
   * of mistake nobody finds by reading. Throwing is the default for that
   * reason, and there is rarely a good reason to lower it — `'warn'` exists
   * for a migration where the corpus is knowingly incomplete for a while.
   *
   * The error names the file and the line, and offers the closest published
   * route when the link looks like a typo of one.
   */
  onBrokenLinks?: DocsLinkSeverity | undefined;
  /**
   * What to do about an absolute link this package cannot verify.
   * Defaults to `'ignore'`.
   *
   * ⚠️ ONLY EVER NON-EMPTY AT A ROOT MOUNT, AND THAT IS THE WHOLE REASON IT
   * EXISTS. To check `[x](/setup)` the package must first know it is a
   * documentation link, and under `basePath: '/docs'` it plainly is — the
   * prefix says so. Under `basePath: '/'` there is no prefix: `/setup` may be a
   * page of yours, and `/login` almost certainly is. The package cannot tell,
   * so by default it says nothing.
   *
   * You can tell it. On a domain that serves nothing but documentation —
   * `docs.example.com` with the docs at its root — every absolute link IS a
   * documentation link, so an unknown one is always a bug and `'throw'` is
   * correct. On a root mount inside a larger application, leave it alone.
   *
   * Relative links (`./other.md`) are unaffected: they are resolved against the
   * content tree, so they are always verifiable and always governed by
   * {@link DocsConfig.onBrokenLinks}.
   */
  onUnverifiableLinks?: DocsLinkSeverity | undefined;
  /**
   * Validates every page's frontmatter. Defaults to `docFrontmatterSchema`
   * from `@waveso/docs/frontmatter`.
   *
   * Any [Standard Schema](https://standardschema.dev) validator is accepted —
   * Zod, Valibot, ArkType — rather than a Zod type specifically. That keeps the
   * package from dictating a validator, and a schema handed over through the
   * spec interface cannot hit the cross-instance mismatch two copies of Zod in
   * one `node_modules` otherwise produce.
   *
   * ```ts
   * // content/docs-schema.ts — one module, imported by every route file
   * import { docFrontmatterSchema } from '@waveso/docs/frontmatter';
   * import { z } from 'zod';
   *
   * export const frontmatterSchema = docFrontmatterSchema.extend({
   *   audience: z.enum(['user', 'operator']).exactOptional(),
   * });
   * ```
   *
   * Three things are worth knowing before you write one:
   *
   *  - **The package's fields are not yours to drop.** `title` drives the
   *    `<h1>` fallback and `<title>`, `draft` the visibility filter, `aliases`
   *    the redirects, `order`/`label` the sidebar — so all six are re-read from
   *    the YAML by `docFrontmatterSchema` and laid back over your output. A
   *    bare `z.object({ title, audience })` therefore cannot publish a draft or
   *    lose a redirect; it only costs you the six in the inferred type. Nothing
   *    in the type system could have caught that: `TFrontmatter extends
   *    DocFrontmatter` constrains `title` and nothing else, because the other
   *    five are optional. The price is that a `.default()`, `.transform()` or
   *    `.coerce` aimed at one of the six is not honoured — the YAML wins.
   *  - **Unknown keys are stripped, by every validator worth using.** The
   *    parsed frontmatter is exactly what the schema declares plus the six, so
   *    declare every field you intend to read — extending
   *    `docFrontmatterSchema` is the shortest way to get the built-ins back in
   *    the type as well.
   *  - **Identity is load-bearing.** The filesystem scan is memoised per
   *    resolved config, and two schema objects are only "the same schema" when
   *    they are the same object. Export one from a shared module (as above)
   *    rather than building it inline in each route file, or each file pays for
   *    its own scan.
   */
  frontmatterSchema?: StandardSchemaV1<unknown, TFrontmatter> | undefined;
}

/** {@link DocsConfig} with defaults applied. */
export interface ResolvedDocsConfig<
  TFrontmatter extends DocFrontmatter = DocFrontmatter,
> {
  contentDir: string;
  basePath: string;
  includeDrafts: boolean;
  onBrokenLinks: DocsLinkSeverity;
  onUnverifiableLinks: DocsLinkSeverity;
  /**
   * As supplied. `resolveDocsConfig` omits the key rather than setting it to
   * `undefined` when the built-in `docFrontmatterSchema` applies, so the
   * default lives in exactly one place: `parseFrontmatter`.
   */
  frontmatterSchema?: StandardSchemaV1<unknown, TFrontmatter> | undefined;
}
