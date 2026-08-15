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

import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Element, ElementContent, RootContent } from 'hast';
import MiniSearch, { type Options as MiniSearchOptions } from 'minisearch';
import { mergeSearchOptions } from './search-options.js';
import { isFootnotes, isTransparentContainer } from './section-boundary.js';
import type { RenderedDoc, SearchRecord } from './types.js';

/* -------------------------------------------------------------------------
 * Record extraction
 * ---------------------------------------------------------------------- */

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
 * `text` is the section's PROSE IN FULL. It used to be cut to 300 characters
 * before indexing, which on a normal corpus (200 pages × 6 sections, ~1,686
 * characters of prose each) dropped 82% of the words from the index — and
 * `combineWith: 'AND'` compounds it, since every term of a query then has to
 * land inside the surviving prefix of the same section. The cap bought nothing
 * back: `storeFields` does not carry `text`, so not one character of the kept
 * prefix was ever rendered. Truncate for display, in the layer that displays.
 *
 * Not generic over the frontmatter type, deliberately: `frontmatter.title` is
 * the only field read, and a `RenderedDoc` carrying a project's own fields is
 * assignable to this signature already. A type parameter here would appear in
 * every call site and constrain nothing.
 */
export function extractSearchRecords(doc: RenderedDoc): SearchRecord[] {
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
      text: collapseWhitespace(section.parts.join(' ')),
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
    if (node.type === 'element' && isTransparentContainer(node)) {
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

/* -------------------------------------------------------------------------
 * Index construction
 * ---------------------------------------------------------------------- */

/**
 * Build a serialised MiniSearch index from extracted records.
 *
 * The return value is JSON, ready for `MiniSearch.loadJSON` on the client or
 * for {@link writeSearchIndex} to put on disk. The output is byte-stable for a
 * given record list, so an index committed to the repository does not dirty
 * the diff on every build.
 *
 * ⚠️ `options` MUST ALSO REACH THE DIALOG — pass the identical object to
 * `SearchDialog`'s `searchOptions`. Both sides feed it through
 * `mergeSearchOptions`, and a `tokenize` or `processTerm` applied to the
 * documents but not to the query produces an index whose terms no query can
 * spell: zero results, no error, nothing in the console.
 */
export function buildSearchIndex(
  records: SearchRecord[],
  options: Partial<MiniSearchOptions<SearchRecord>> = {},
): string {
  const index = new MiniSearch<SearchRecord>(mergeSearchOptions(options));
  index.addAll(records);
  return JSON.stringify(index);
}

/**
 * Write the serialised index to `outFile`, creating parent directories.
 *
 * Returns the byte size written, so a build step can log it or assert a
 * budget — a docs index that quietly crosses a megabyte is a regression
 * nobody notices until the dialog takes a second to open.
 *
 * ⚠️ WRITTEN BESIDE THE TARGET AND RENAMED OVER IT, NEVER INTO IT. The target
 * is normally `public/search-index.json`, a live static asset: writing in
 * place truncates it to zero and grows it back in 1 MiB chunks, and a fetch
 * landing in that window gets a 200 with a half-written body. `response.ok`
 * passes, the parse throws, and the dialog is stuck in its error state —
 * *"Try reloading the page"* — for every visitor, reloading forever, until
 * someone redeploys content that did not change. `rename` is atomic within a
 * filesystem, so a reader sees either the whole old file or the whole new one;
 * it also makes two concurrent builds safe.
 */
export async function writeSearchIndex(
  records: SearchRecord[],
  outFile: string,
  options: Partial<MiniSearchOptions<SearchRecord>> = {},
): Promise<number> {
  const json = buildSearchIndex(records, options);
  const absolute = path.resolve(outFile);
  // The pid keeps two concurrent builds from renaming each other's half-file.
  const temporary = `${absolute}.tmp-${process.pid}`;
  await mkdir(path.dirname(absolute), { recursive: true });
  try {
    await writeFile(temporary, json, 'utf8');
    await rename(temporary, absolute);
  } catch (error) {
    // Otherwise a failed build leaves a stray artifact in `public/`, which the
    // next successful one happily serves.
    await rm(temporary, { force: true });
    throw error;
  }
  return Buffer.byteLength(json, 'utf8');
}
