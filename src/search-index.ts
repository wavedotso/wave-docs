/**
 * Build-time search index construction.
 *
 * Node-only, and deliberately so: the markdown parser, the hast walk and
 * MiniSearch's index builder all run once per build, and the browser receives
 * nothing but the serialised result. `src/react/search-dialog.tsx` is the
 * matching client half.
 *
 * MiniSearch over Fuse.js is a measured choice, not a taste one: on a 282-page
 * corpus Fuse ran 96.6 ms median / 298 ms max per query against MiniSearch's
 * 1.35 ms / 3.84 ms. Fuse is a fuzzy short-string matcher routinely
 * misapplied to full text.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Element, ElementContent, RootContent } from 'hast';
import MiniSearch from 'minisearch';
import { SEARCH_INDEX_OPTIONS } from './search-options.js';
import type { RenderedDoc, SearchRecord } from './types.js';

/* -------------------------------------------------------------------------
 * Record extraction
 * ---------------------------------------------------------------------- */

/** Default excerpt length, in characters, of {@link SearchRecord.text}. */
const DEFAULT_EXCERPT_LENGTH = 300;

/** `<h1>`…`<h6>` to their numeric depth. */
const HEADING_DEPTHS = new Map<string, number>([
  ['h1', 1],
  ['h2', 2],
  ['h3', 3],
  ['h4', 4],
  ['h5', 5],
  ['h6', 6],
]);

/**
 * Elements whose text never belongs in the index.
 *
 * `pre` is the important one: after Shiki, a code block is hundreds of
 * `<span class="line">` token wrappers whose text indexes as a bag of
 * punctuation and keyword fragments. It inflates the index and poisons
 * relevance. Inline `code` is kept — `useMemo` is exactly the sort of thing
 * people search for.
 */
const SKIPPED_TAGS = new Set(['pre', 'script', 'style', 'svg', 'template']);

/**
 * Containers that merely wrap content rather than nesting it semantically.
 *
 * Walking through them keeps heading detection working when a rehype plugin
 * (or a consumer's own) wraps the document body, without descending into
 * blockquotes or list items where a heading is not a section boundary.
 */
const TRANSPARENT_TAGS = new Set(['div', 'section', 'article', 'main']);

/**
 * The GFM footnote block `mdast-util-to-hast` appends, and everything in it.
 *
 * It is a `section` — so {@link TRANSPARENT_TAGS} would otherwise walk straight
 * into it — carrying a generated `<h2 id="footnote-label">Footnotes</h2>`. That
 * heading is machinery, not a section of the page: indexing it puts a
 * `Footnotes` hit in the dialog for every footnoted page, and the footnote text
 * itself is already indexed where it was written. `rehypeCaptureToc` skips the
 * same subtree, so the TOC and the index agree.
 */
function isFootnotes(node: Element): boolean {
  return node.properties.dataFootnotes !== undefined;
}

/** Tags after which extracted text needs a separator. */
const BLOCK_TAGS = new Set([
  'address',
  'blockquote',
  'br',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'li',
  'ol',
  'p',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
]);

/** Options for {@link extractSearchRecords}. */
export interface ExtractSearchRecordsOptions {
  /**
   * Maximum length of {@link SearchRecord.text}, in characters. Defaults to
   * 300 — long enough to carry a section's vocabulary into the index, short
   * enough that a 300-page corpus stays under a megabyte.
   */
  excerptLength?: number;
}

/** A section under construction while walking the tree. */
interface PendingSection {
  heading: string;
  /** Anchor id, or `undefined` for the lead section, which links to the top. */
  anchor: string | undefined;
  ancestors: string[];
  parts: string[];
}

/**
 * Split a rendered document into section-scoped {@link SearchRecord}s.
 *
 * One record per `h2`–`h6`, plus a lead record covering everything before the
 * first heading. The lead record is always emitted: it is what makes a page
 * findable by its title even when every section under it is empty.
 *
 * Anchors are read from the ids `rehype-slug` already put on the tree. They
 * are never recomputed — a second slugger seeded independently drifts exactly
 * where it hurts, on duplicate headings that carry `-1` collision suffixes.
 *
 * A heading with no usable id opens no section: `github-slugger` returns the
 * empty string for `## 🚀`, and there is nothing to deep-link to. Its text is
 * folded into the enclosing section instead, which is what `rehypeCaptureToc`
 * does with the same heading — the two must not disagree about which sections
 * exist.
 *
 * Not generic over the frontmatter type, deliberately: `frontmatter.title` is
 * the only field read, and a `RenderedDoc` carrying a project's own fields is
 * assignable to this signature already. A type parameter here would appear in
 * every call site and constrain nothing.
 */
export function extractSearchRecords(
  doc: RenderedDoc,
  options: ExtractSearchRecordsOptions = {},
): SearchRecord[] {
  const excerptLength = options.excerptLength ?? DEFAULT_EXCERPT_LENGTH;
  const title = doc.frontmatter.title;
  const records: SearchRecord[] = [];
  // `RenderedDoc` carries segments, not a slug; they are the same thing joined.
  const slug = doc.segments.join('/');

  /** Open headings, outermost first, that enclose the current section. */
  const ancestors: Array<{ depth: number; text: string }> = [];
  let section: PendingSection = {
    heading: title,
    anchor: undefined,
    ancestors: [],
    parts: [],
  };

  const flush = (): void => {
    const href =
      section.anchor === undefined ? doc.href : `${doc.href}#${section.anchor}`;

    /*
     * THE SLUG, NOT THE HREF. An href carries `basePath`, so moving a site from
     * `/docs` to `/reference` changed the identity of every record for no
     * reason — and storing it here put the whole route in the index twice, on
     * the one artifact whose download size is the reason this package exists.
     */
    const id =
      section.anchor === undefined ? slug : `${slug}#${section.anchor}`;

    records.push({
      id,
      title,
      heading: section.heading,
      ancestors: section.ancestors,
      href,
      text: truncateAtWordBoundary(
        collapseWhitespace(section.parts.join(' ')),
        excerptLength,
      ),
    });
  };

  for (const node of iterateBlocks(doc.hast.children)) {
    if (node.type === 'element') {
      const depth = HEADING_DEPTHS.get(node.tagName);

      // `h1` is the page title rendered into the body. It is already indexed
      // as `title`, and it opens no section of its own — everything after it
      // and before the first `h2` is the lead.
      if (depth === 1) continue;

      if (depth !== undefined) {
        const anchor = readHeadingId(node);
        const heading = extractHeadingText(node);

        // Unlinkable: keep the words, drop the section boundary.
        if (anchor === undefined) {
          if (heading !== '') section.parts.push(heading);
          continue;
        }

        flush();

        while (ancestors.length > 0) {
          const open = ancestors[ancestors.length - 1];
          if (open === undefined || open.depth < depth) break;
          ancestors.pop();
        }

        section = {
          heading,
          anchor,
          ancestors: ancestors.map((ancestor) => ancestor.text),
          parts: [],
        };
        ancestors.push({ depth, text: heading });
        continue;
      }
    }

    const text = collapseWhitespace(extractText(node));
    if (text !== '') section.parts.push(text);
  }

  flush();
  return records;
}

/**
 * Yield block-level nodes in document order, stepping through wrapper
 * elements so a heading inside one still reads as a section boundary.
 */
function* iterateBlocks(nodes: RootContent[]): Generator<RootContent> {
  for (const node of nodes) {
    if (node.type === 'element' && isFootnotes(node)) {
      continue;
    }
    if (node.type === 'element' && TRANSPARENT_TAGS.has(node.tagName)) {
      yield* iterateBlocks(node.children);
    } else {
      yield node;
    }
  }
}

/** Plain text of a node, minus code blocks and presentational cruft. */
function extractText(node: RootContent | ElementContent): string {
  const parts: string[] = [];
  collectText(node, parts);
  return parts.join('');
}

function collectText(node: RootContent | ElementContent, out: string[]): void {
  if (node.type === 'text') {
    out.push(node.value);
    return;
  }
  if (node.type !== 'element') return;
  if (SKIPPED_TAGS.has(node.tagName) || isPresentational(node)) return;

  for (const child of node.children) collectText(child, out);

  // Only block boundaries get a separator: emphasis mid-word (`re*al*ly`)
  // must not become three tokens.
  if (BLOCK_TAGS.has(node.tagName)) out.push(' ');
}

/**
 * `aria-hidden` / `hidden` elements are decoration — the anchor icon
 * `rehype-autolink-headings` appends, the alert icons `rehype-github-alerts`
 * injects — and none of it is text a reader would search for.
 */
function isPresentational(node: Element): boolean {
  const properties = node.properties;
  if (properties === undefined) return false;
  // hast carries `aria-hidden` as either the boolean or the string, depending
  // on how the plugin that set it spelled the value; `@types/hast` narrows
  // the field to `string`, so widen before comparing.
  const ariaHidden: unknown = properties.ariaHidden;
  const hidden: unknown = properties.hidden;
  return ariaHidden === true || ariaHidden === 'true' || hidden === true;
}

function extractHeadingText(node: RootContent): string {
  // A visible autolink marker (`behavior: 'append'` without `ariaHidden`)
  // otherwise trails every heading as " #". `C#` survives: the separating
  // whitespace is required.
  return collapseWhitespace(extractText(node)).replace(/\s+#+$/, '');
}

/** The heading's anchor, or `undefined` when nothing can link to it. */
function readHeadingId(node: Element): string | undefined {
  const id = node.properties?.id;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Cut `text` to at most `limit` characters, on a word boundary where one is
 * near enough to the cut to be worth honouring.
 */
function truncateAtWordBoundary(text: string, limit: number): string {
  if (limit <= 0) return '';
  if (text.length <= limit) return text;

  const slice = text.slice(0, limit);
  const lastSpace = slice.lastIndexOf(' ');
  // A single token longer than half the budget (a URL, a hash) has no useful
  // boundary; a hard cut beats returning almost nothing.
  const cut = lastSpace > limit / 2 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

/* -------------------------------------------------------------------------
 * Index construction
 * ---------------------------------------------------------------------- */

/**
 * Build a serialised MiniSearch index from extracted records.
 *
 * The return value is JSON, ready for `MiniSearch.loadJSON` on the client or
 * for {@link writeSearchIndex} to put on disk.
 */
export function buildSearchIndex(records: SearchRecord[]): string {
  const index = new MiniSearch<SearchRecord>(SEARCH_INDEX_OPTIONS);
  index.addAll(records);
  return JSON.stringify(index);
}

/**
 * Write the serialised index to `outFile`, creating parent directories.
 *
 * Returns the byte size written, so a build step can log it or assert a
 * budget — a docs index that quietly crosses a megabyte is a regression
 * nobody notices until the dialog takes a second to open.
 */
export async function writeSearchIndex(
  records: SearchRecord[],
  outFile: string,
): Promise<number> {
  const json = buildSearchIndex(records);
  const absolute = path.resolve(outFile);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, json, 'utf8');
  return Buffer.byteLength(json, 'utf8');
}
