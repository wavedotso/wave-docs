/**
 * Shared types for `@waveso/docs`.
 *
 * This module is type-only by design: it compiles to an empty JavaScript file
 * and can therefore be imported from a Node-only module, a React Server
 * Component or a browser bundle without dragging anything with it. Every
 * other entry point in the package agrees on the shapes declared
 * here — treat it as the contract, and change it deliberately.
 */

import type { Root as HastRoot } from 'hast';

/* -------------------------------------------------------------------------
 * Frontmatter
 * ---------------------------------------------------------------------- */

/**
 * The frontmatter fields the package itself understands.
 *
 * Consumers may extend this with their own Zod schema (see
 * `@waveso/docs/source`); the extra fields flow through the generic parameter
 * on {@link DocFile} and friends rather than widening this interface.
 */
export interface DocFrontmatter {
  /** Page title. Used for `<h1>` fallbacks, `<title>`, and search. */
  title: string;
  /** One-line summary. Used for `<meta name="description">` and search. */
  description?: string;
  /**
   * Sidebar label, when it should differ from {@link DocFrontmatter.title}.
   * Sidebars are narrow; page titles are not.
   */
  label?: string;
  /**
   * Excluded from navigation, search and `generateStaticParams`.
   *
   * Deliberately not tied to `NODE_ENV`: Vercel preview deployments are
   * production builds, so branching on it would hide drafts in exactly the
   * place reviewers look. Gate on an explicit config flag instead.
   */
  draft?: boolean;
  /**
   * Previous URLs for this page, relative to the docs base path
   * (e.g. `['old-name', 'legacy/old-name']`). The Next adapter turns these
   * into permanent redirects so a rename never becomes a silent 404.
   */
  aliases?: string[];
  /**
   * Sort weight within its directory, for directories without a `meta.json`.
   * Lower sorts first; pages without an order sort last, alphabetically.
   */
  order?: number;
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
  href?: string;
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
  title?: string;
  /** Ordered entries. Omit to sort by frontmatter `order`, then alphabetically. */
  pages?: Array<string | { title: string; href: string }>;
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
  /** Heading level, 2–6. `h1` is the page title and is never in the TOC. */
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
  /** Stable id, `slug#anchor`. */
  id: string;
  /** Page title. */
  title: string;
  /** Heading text for this section; equals `title` for the lead section. */
  heading: string;
  /** Ancestor headings, outermost first, for breadcrumbed results. */
  titles: string[];
  /** Route including the anchor, e.g. `/docs/api/auth#bearer-token`. */
  href: string;
  /** Plain text of the section, truncated to the configured excerpt length. */
  text: string;
}

/* -------------------------------------------------------------------------
 * Configuration
 * ---------------------------------------------------------------------- */

/**
 * Resolve an internal markdown link target to a route.
 *
 * Called for every relative link found in the source. Returning `undefined`
 * signals "not a documentation page", which — with `assertLinks` on — fails
 * the build rather than shipping a 404 that was valid on GitHub.
 */
export type LinkResolver = (
  /** The raw href as authored, e.g. `'./api/auth.md'`. */
  href: string,
  /** Segments of the document containing the link. */
  from: string[],
) => string | undefined;

/**
 * Resolve an image `src` to a public URL and its intrinsic dimensions.
 *
 * Dimensions are read at build time because markdown carries none and
 * `next/image` refuses to render without them (short of `fill`).
 */
export type ImageResolver = (
  src: string,
  from: string[],
) =>
  | Promise<{ src: string; width?: number; height?: number } | undefined>
  | { src: string; width?: number; height?: number }
  | undefined;

export interface DocsConfig {
  /**
   * Content root. Relative paths resolve against `process.cwd()`, which is
   * the project root during both `next build` and `vite build`.
   */
  contentDir: string;
  /** URL prefix the docs are mounted at. Defaults to `'/docs'`. */
  basePath?: string;
  /**
   * Include pages marked `draft: true`. Defaults to `false`.
   *
   * Drive this from your own env check — deliberately not `NODE_ENV`.
   */
  includeDrafts?: boolean;
  /**
   * Fail the build when an internal link resolves to a page that does not
   * exist. Defaults to `true`; there is no good reason to turn it off.
   */
  assertLinks?: boolean;
}

/** {@link DocsConfig} with defaults applied. */
export interface ResolvedDocsConfig {
  contentDir: string;
  basePath: string;
  includeDrafts: boolean;
  assertLinks: boolean;
}
