/**
 * The corpus, as markdown a language model can read.
 *
 * Two artifacts, both from the same source the HTML is built from:
 *
 * - `llms.txt` — an index. Title, description, and one line per page.
 * - `llms-full.txt` — every page's body, concatenated.
 *
 * ⚠️ THIS IS A URL CONVENTION, NOT A BUTTON. A "copy page as markdown" control
 * is UI over these files; agents fetching the corpus, a reader piping a page
 * into a prompt, and an MCP server built later all want the *files*, and none
 * of them want a click. Shipping the control first builds the shallow half.
 *
 * ⚠️ AND THIS PACKAGE HAS AN ADVANTAGE A HOSTED RENDERER DOES NOT: the source
 * is still on disk. Mintlify and friends reconstruct markdown from what they
 * rendered, and lose whatever the render dropped; `DocFile.content` is the
 * author's own body with the frontmatter block removed. Nothing is
 * reconstructed here — the only edits are the two below, and both are
 * splices into the original string rather than a re-serialisation.
 *
 * Node only, like everything else that reads the content root. Not a byte of
 * this reaches a browser.
 */

import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

import type { DocFile, DocFrontmatter } from './types.js';

/**
 * A base for resolving relative links when no `siteUrl` was given.
 *
 * `.invalid` is reserved by RFC 2606 precisely so it can never resolve, so a
 * bug that leaks this origin into output is a dead link rather than a live
 * request to somebody else's host. It never survives: every caller strips it
 * back to a root-relative path.
 */
const RELATIVE_BASE = 'https://docs.invalid';

export interface PortableMarkdownOptions {
  /**
   * Absolute site origin, e.g. `'https://docs.example.com'`.
   *
   * With it, every link in the output is absolute — which is the point, since
   * the destination for this text is a chat window where a relative path has
   * nothing to resolve against. Without it links are rewritten to root-relative
   * paths, which is still better than `../../guides/links` but still needs a
   * reader to know the origin.
   */
  siteUrl?: string | undefined;
  /**
   * Prepend `# <title>` when the body has no level-one heading. Defaults to
   * `true`, matching `DocsRendererOptions.titleHeading` — a body whose title
   * lives only in frontmatter otherwise arrives as an untitled fragment.
   */
  titleHeading?: boolean | undefined;
}

/** One link destination found in a body, as an offset range to replace. */
interface Destination {
  start: number;
  end: number;
  url: string;
}

/** The parser, built once. Only `parse` is used — nothing is ever run. */
const parser = unified().use(remarkParse).use(remarkGfm);

/**
 * Every link, image and reference definition destination in a body.
 *
 * ⚠️ FOUND BY PARSING, SPLICED BY OFFSET — NOT REWRITTEN BY REGEX AND NOT
 * RE-SERIALISED. A regex over `](…)` matches inside fenced code, which is
 * where documentation keeps its example URLs; a `remark-stringify` round trip
 * is correct but reformats the entire document, and this package's claim is
 * that the markdown it hands back is the author's. Parsing locates, splicing
 * edits, and every byte outside a destination survives untouched.
 *
 * ⚠️ AND mdast DOES NOT CARRY THE DESTINATION'S OWN POSITION — only the whole
 * node's. So the destination is located inside the node's slice, searched from
 * the end, because the URL text can also occur in the link's *label*:
 * `[/guides/links](/guides/links)` is ordinary in a documentation corpus and a
 * forward search rewrites the visible text instead of the target. A node whose
 * `url` does not appear in its own source slice — a reference link, an
 * autolink, anything with character references in the destination — is left
 * exactly as written. Skipping is always safe; guessing is not.
 */
function findDestinations(body: string): Destination[] {
  const found: Destination[] = [];
  const tree = parser.parse(body);

  visit(tree, (node) => {
    if (
      node.type !== 'link' &&
      node.type !== 'image' &&
      node.type !== 'definition'
    ) {
      return;
    }
    const url: unknown = (node as { url?: unknown }).url;
    if (typeof url !== 'string' || url.length === 0) return;

    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (from === undefined || to === undefined) return;

    const slice = body.slice(from, to);
    const at = slice.lastIndexOf(url);
    if (at === -1) return;

    found.push({ start: from + at, end: from + at + url.length, url });
  });

  return found;
}

/**
 * One destination, resolved against the page it was written on.
 *
 * `new URL(url, base)` is the whole implementation and it is deliberate: it
 * already knows that `https://…` and `mailto:` are absolute and must not be
 * touched, that `#anchor` means *this* page, that `/x` is site-root relative
 * and `../x` is not. Hand-rolling those cases is how a rewriter ends up
 * mangling `mailto:` — which has no host for a path to be relative to.
 *
 * Returns `undefined` for anything `URL` refuses, so an unparseable
 * destination is left as the author wrote it.
 */
function resolveDestination(
  url: string,
  pageUrl: URL,
  absolute: boolean,
): string | undefined {
  let resolved: URL;
  try {
    resolved = new URL(url, pageUrl);
  } catch {
    return undefined;
  }
  /*
   * ⚠️ THE MARKDOWN EXTENSION COMES OFF, BECAUSE THE TARGET IS A PAGE. Authors
   * write `[auth](./api/auth.md)` so the link resolves on GitHub and in an
   * editor preview, and the HTML pipeline drops the extension for exactly the
   * same reason a reader needs — `/api/auth` is the route, `/api/auth.md` is
   * nothing. Resolving without this produced a corpus whose every internal
   * link 404ed, which is worse than leaving them relative: they look right.
   *
   * `index` collapses onto its directory's own page, matching `toHref`.
   */
  // ⚠️ ONLY FOR OUR OWN PAGES. A link to somebody else's `.md` — a raw file on
  // GitHub, a spec published as markdown — is a real URL that ends in `.md`,
  // and trimming it points at a page that does not exist on a host we do not
  // control.
  if (resolved.origin === pageUrl.origin) {
    resolved.pathname = resolved.pathname
      .replace(/\.mdx?$/, '')
      .replace(/\/index$/, '/');
  }

  if (absolute) return resolved.href;
  // No origin to publish, so hand back the root-relative form. A destination
  // that resolved to a *different* origin keeps its absolute form: stripping
  // the host off `https://example.com/x` would silently retarget it at us.
  if (resolved.origin !== pageUrl.origin) return resolved.href;
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

/** Does this body already open with a level-one heading? */
function hasTitleHeading(body: string): boolean {
  const tree = parser.parse(body);
  for (const child of tree.children) {
    if (child.type === 'heading') return child.depth === 1;
    // Anything else first means the h1 is not the opening element, which is
    // what `titleHeading` exists to fix.
    return false;
  }
  return false;
}

/**
 * One page's markdown, ready to be pasted somewhere with no other context.
 *
 * The author's body, with two edits: a title heading when the body has none,
 * and link destinations resolved against the page's own URL.
 */
export function toPortableMarkdown<TFrontmatter extends DocFrontmatter>(
  file: DocFile<TFrontmatter>,
  options: PortableMarkdownOptions = {},
): string {
  const absolute = options.siteUrl !== undefined;
  const pageUrl = new URL(file.href, options.siteUrl ?? RELATIVE_BASE);

  let body = file.content;

  // Applied back to front, so an earlier splice never shifts a later offset.
  const destinations = findDestinations(body);
  for (let i = destinations.length - 1; i >= 0; i -= 1) {
    const destination = destinations[i];
    if (destination === undefined) continue;
    const next = resolveDestination(destination.url, pageUrl, absolute);
    if (next === undefined || next === destination.url) continue;
    body =
      body.slice(0, destination.start) + next + body.slice(destination.end);
  }

  const title = file.frontmatter.title;
  if (
    options.titleHeading !== false &&
    typeof title === 'string' &&
    title.length > 0 &&
    !hasTitleHeading(body)
  ) {
    return `# ${title}\n\n${body.trimStart()}`;
  }
  return body;
}

export interface LlmsTxtOptions extends PortableMarkdownOptions {
  /** The `# ` line. Your product's name, not the word "documentation". */
  title: string;
  /** The `> ` line under it. One sentence on what this corpus covers. */
  description?: string | undefined;
  /** Free prose between the description and the first section. */
  details?: string | undefined;
}

/**
 * The `llms.txt` index.
 *
 * The format is llmstxt.org's: an `h1`, an optional blockquote summary,
 * optional prose, then `h2` sections of links. It is markdown on purpose —
 * the file is meant to be read by the same thing that reads the pages.
 *
 * ⚠️ ONE FLAT SECTION, DELIBERATELY, UNTIL THE NAV EARNS ITS WAY IN. Sections
 * should mirror the sidebar's groups, and that means threading `source.nav()`
 * through and deciding what an ungrouped page is called. A single `## Docs`
 * is valid per the spec and correct today; grouping is a change to this
 * function alone.
 */
export function buildLlmsTxt<TFrontmatter extends DocFrontmatter>(
  files: ReadonlyArray<DocFile<TFrontmatter>>,
  options: LlmsTxtOptions,
): string {
  const lines: string[] = [`# ${options.title}`];

  if (options.description !== undefined && options.description.length > 0) {
    lines.push('', `> ${options.description}`);
  }
  if (options.details !== undefined && options.details.length > 0) {
    lines.push('', options.details);
  }

  lines.push('', '## Docs', '');

  for (const file of files) {
    const url = new URL(file.href, options.siteUrl ?? RELATIVE_BASE);
    const href =
      options.siteUrl === undefined ? `${url.pathname}${url.hash}` : url.href;
    const title = file.frontmatter.title ?? file.slug;
    const description = file.frontmatter.description;
    lines.push(
      description === undefined || description.length === 0
        ? `- [${title}](${href})`
        : `- [${title}](${href}): ${description}`,
    );
  }

  return `${lines.join('\n')}\n`;
}

/**
 * The `llms-full.txt` corpus — every page's markdown, in one file.
 *
 * ⚠️ EACH PAGE CARRIES ITS OWN URL, WHICH IS THE ONLY REASON THIS IS USEFUL
 * RATHER THAN A BLOB. A model asked "where is this documented?" can answer
 * from the file itself instead of guessing, and a reader can follow it. The
 * `---` between pages is a thematic break in every markdown parser, so the
 * boundaries survive whatever reads this next.
 */
export function buildLlmsFullTxt<TFrontmatter extends DocFrontmatter>(
  files: ReadonlyArray<DocFile<TFrontmatter>>,
  options: PortableMarkdownOptions = {},
): string {
  const pages = files.map((file) => {
    const url = new URL(file.href, options.siteUrl ?? RELATIVE_BASE);
    const source =
      options.siteUrl === undefined ? `${url.pathname}${url.hash}` : url.href;
    return `<!-- source: ${source} -->\n\n${toPortableMarkdown(file, options)}`;
  });

  return `${pages.join('\n\n---\n\n').trimEnd()}\n`;
}
