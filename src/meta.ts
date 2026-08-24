/**
 * `meta.json` — per-directory ordering, labelling and hand-written nav entries.
 *
 * The ordering algorithm is kept free of filesystem access on purpose: it
 * takes a description of a directory's children ({@link MetaDirEntry}) and
 * returns nav nodes, so it can be tested exhaustively without a fixture tree
 * and reused by anything that can describe a directory.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { DocNavNode, DocsMeta } from './types.js';
import { docsError } from './docs-error.js';
import { isSafeHref, opensInNewTab } from './safe-href.js';

/** A `"---Label---"` separator entry. */
const SEPARATOR_PATTERN = /^---(.+)---$/;

/** The rest wildcard: everything not named explicitly, in place. */
const REST = '...';

/**
 * Zod mirror of {@link DocsMeta}.
 *
 * Strict on purpose: `meta.json` is hand-written and unvalidated keys are
 * almost always typos (`page`, `order`, `items`) that would otherwise fail
 * silently as a sidebar that quietly ignores half the file.
 */
export const docsMetaSchema = z.strictObject({
  title: z.string().exactOptional(),
  /*
   * A name, resolved by the consumer — never a path, a URL or an import. This
   * package ships three markers and no icon set, so the art comes from whoever
   * is rendering. An unmapped name is not an error: it falls back to the
   * default marker, because one typo should not knock a hole in the column.
   */
  icon: z.string().min(1).exactOptional(),
  pages: z
    .array(
      z.union([
        z.string(),
        z.strictObject({
          title: z.string(),
          /*
           * ⚠️ THE SAME ALLOWLIST THE MARKDOWN PATH USES, AND `meta.json` WENT
           * ROUND IT. A hand-written entry reached `<a href>` through
           * `DocsSidebar` with nothing checking its scheme, while a
           * `javascript:` link in the markdown beside it was dropped by a check
           * whose own comment calls it load-bearing. Both end at the same
           * anchor.
           *
           * Refused at parse time rather than dropped at render, because this
           * file is authored: a nav entry that silently vanishes is the
           * quietest possible failure, and the author is right there.
           */
          href: z.string().refine(isSafeHref, {
            message:
              'that is not a scheme this package will put in a link. Use ' +
              'http(s), mailto, tel, sms, ftp, irc, xmpp, news, feed, git or ' +
              'matrix — or a path, which needs no scheme at all.',
          }),
          icon: z.string().min(1).exactOptional(),
        }),
      ]),
    )
    .exactOptional(),
});

/**
 * One child of a directory, as the ordering algorithm sees it.
 *
 * Drafts arrive as `hidden` entries rather than being filtered out by the
 * caller, so that naming a draft in `meta.json` is not a build error that
 * appears and disappears with `includeDrafts`.
 */
export interface MetaDirEntry {
  /** Name as written in `pages`: filename without `.md`, or directory name. */
  name: string;
  /** Title used for alphabetical ordering. */
  title: string;
  /** Frontmatter `order`, when the page (or a directory's index) sets one. */
  order?: number;
  /** The node this entry contributes when it appears in the nav. */
  node: DocNavNode;
  /** Directories only: the children `"...name"` splices in at its position. */
  inlineChildren?: DocNavNode[];
  /**
   * Directories only: a link to the directory's own page, spliced in ahead of
   * {@link MetaDirEntry.inlineChildren}.
   *
   * Inline expansion drops the group node, and the group node is the only
   * carrier of the directory's `href` — without this, `"...api"` publishes
   * `/docs/api` as a route that no sidebar link reaches.
   */
  indexNode?: DocNavNode;
  /** The directory's own `index.md`: listed only when named explicitly. */
  isIndex?: boolean;
  /** Excluded from output, but still resolvable by name (i.e. a draft). */
  hidden?: boolean;
}

/**
 * Validate a parsed `meta.json`, or throw an error that names the file.
 */
export function parseDocsMeta(raw: unknown, filePath: string): DocsMeta {
  const result = docsMetaSchema.safeParse(raw);
  if (result.success) {
    return result.data;
  }

  const details = result.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');

  throw docsError(
    'invalid-meta',
    `Invalid meta.json at ${filePath}:\n${details}`,
  );
}

/**
 * Read and validate `<dirPath>/meta.json`. Resolves to `undefined` when the
 * file does not exist — most directories do not need one.
 */
export async function readDocsMeta(
  dirPath: string,
): Promise<DocsMeta | undefined> {
  const filePath = path.join(dirPath, 'meta.json');
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (err) {
    if (isNotFound(err)) {
      return undefined;
    }
    throw err;
  }

  let parsed: unknown;
  try {
    /*
     * ⚠️ THE BOM IS OURS TO STRIP HERE TOO. `readFile(…, 'utf8')` leaves it in
     * and `JSON.parse` refuses it — `Unexpected token '', ...` — so a `meta.json`
     * saved by an editor that emits one failed the build on a character nobody
     * can see, in a file the reader is looking straight at. `readPage` learned
     * this for markdown; this is the same line for the same reason.
     */
    parsed = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw docsError(
      'invalid-meta',
      `Could not parse ${filePath} as JSON: ${reason}`,
      // `JSON.parse` reports a byte offset the message keeps but the wrapper
      // would otherwise strip from anything programmatic.
      { cause: err },
    );
  }

  return parseDocsMeta(parsed, filePath);
}

/**
 * Order a directory's children into nav nodes.
 *
 * With no `pages` list, entries sort by frontmatter `order` ascending and then
 * by title; entries without an order sort after those with one. With a `pages`
 * list, entries appear exactly where they are named, and anything unnamed is
 * dropped unless a `"..."` entry says where to put it.
 *
 * @param entries - The directory's children.
 * @param meta - Its validated `meta.json`, if any.
 * @param metaPath - Path to that `meta.json`, used in error messages.
 * @param depth - How far this directory sits below the content root, which
 *   decides whether its own `index.md` is listed by default. See
 *   {@link isListedByDefault}.
 * @throws When `pages` names a child that does not exist, or names one twice —
 *   always a typo, and catching it here is the entire reason `meta.json` is
 *   validated at build.
 */
export function orderNavEntries(
  entries: readonly MetaDirEntry[],
  meta: DocsMeta | undefined,
  metaPath: string,
  depth: number,
): DocNavNode[] {
  const pages = meta?.pages;
  if (pages === undefined) {
    return dropEmptyGroups(
      sortEntries(
        entries.filter((entry) => isListedByDefault(entry, depth)),
      ).map((entry) => entry.node),
    );
  }

  const byName = indexByName(entries, metaPath);
  const used = new Set<string>();
  const nodes: DocNavNode[] = [];
  let restAt = -1;

  for (const raw of pages) {
    /*
     * ⚠️ NFC, BECAUSE THE NAMES IT IS MATCHED AGAINST ARE. `source.ts`
     * normalises every filename at the `readdir` boundary — macOS hands back
     * decomposed forms — so `entries[].name` is NFC while a `meta.json` written
     * on a Mac and saved by an editor that preserves the composition is not.
     * Two spellings of `café.md`, one in the file listing and one in the
     * ordering file, and `byName.get` missed: the build failed with
     * `lists "café", which does not exist` beside a listing of available names
     * that contains a visually identical `café`.
     *
     * Applied to the whole entry rather than only to the name, so the `"..."`
     * wildcard and a `"---Label---"` separator are compared on the same footing.
     */
    const page = typeof raw === 'string' ? raw.normalize('NFC') : raw;

    if (typeof page !== 'string') {
      nodes.push({
        type: 'link',
        title: page.title,
        href: page.href,
        /*
         * ⚠️ NOT "HAS A SCHEME", WHICH IS WHAT THIS USED TO TEST. `external` is
         * what makes the sidebar render `target="_blank"` and announce "(opens
         * in a new tab)", and a `mailto:` entry opens no tab at all — so the
         * announcement described something that did not happen, to precisely
         * the reader who cannot see that it did not.
         */
        external: opensInNewTab(page.href),
        // `exactOptionalPropertyTypes`: absent, never an explicit `undefined`.
        ...(page.icon !== undefined ? { icon: page.icon } : {}),
      });
      continue;
    }

    const separator = SEPARATOR_PATTERN.exec(page);
    if (separator) {
      nodes.push({
        type: 'separator',
        title: (separator[1] ?? '').trim(),
      });
      continue;
    }

    if (page === REST) {
      if (restAt !== -1) {
        throw docsError(
          'invalid-meta',
          `${metaPath} has more than one "..." entry. ` +
            'A directory has a single set of unnamed pages, so only one ' +
            'wildcard can be honoured — remove the extra.',
        );
      }
      restAt = nodes.length;
      continue;
    }

    if (page.startsWith(REST)) {
      const name = page.slice(REST.length);
      const target = byName.get(name);
      if (!target?.inlineChildren) {
        throw docsError(
          'invalid-meta',
          `${metaPath} entry "${page}" expands a directory named ` +
            `"${name}", which is not a subdirectory here. ` +
            `${describeAvailable(entries, true)}`,
        );
      }
      assertUnused(used, name, page, metaPath);
      used.add(name);
      // The group wrapper is what `"...name"` discards; its `href` is not.
      if (target.indexNode !== undefined) {
        nodes.push(target.indexNode);
      }
      nodes.push(...target.inlineChildren);
      continue;
    }

    const target = byName.get(page);
    if (!target) {
      throw docsError(
        'invalid-meta',
        `${metaPath} lists "${page}", which does not exist. ` +
          `${describeAvailable(entries, false)}`,
      );
    }
    assertUnused(used, page, page, metaPath);
    used.add(page);
    if (!target.hidden) {
      nodes.push(target.node);
    }
  }

  if (restAt !== -1) {
    const rest = sortEntries(
      entries.filter(
        (entry) => isListedByDefault(entry, depth) && !used.has(entry.name),
      ),
    ).map((entry) => entry.node);
    nodes.splice(restAt, 0, ...rest);
  }

  return dropDanglingSeparators(dropEmptyGroups(nodes));
}

/**
 * A child named twice is a typo, not an instruction.
 *
 * It renders the page twice, both copies highlighted on the page they link to,
 * and the sidebar keys its items positionally — so there is no duplicate-key
 * warning either. Every other ambiguity in this file is a build error; this
 * one only looked deliberate because nothing checked for it.
 */
function assertUnused(
  used: ReadonlySet<string>,
  name: string,
  written: string,
  metaPath: string,
): void {
  if (used.has(name)) {
    throw docsError(
      'invalid-meta',
      `${metaPath} lists "${written}" more than once. It would appear twice ` +
        'in the sidebar, both copies marked as the current page. Remove the ' +
        'duplicate.',
    );
  }
}

/**
 * Index the directory's children by the name `pages` addresses them with.
 *
 * A plain `new Map(entries.map(…))` is last-wins, which turns an ambiguous
 * name into a page that silently disappears from the sidebar while remaining a
 * published route. The source layer merges the one ambiguity that has a sane
 * reading — `guides.md` beside a `guides/` with no `index.md` — so anything
 * still colliding here is a name no `meta.json` entry could address.
 */
function indexByName(
  entries: readonly MetaDirEntry[],
  metaPath: string,
): Map<string, MetaDirEntry> {
  const byName = new Map<string, MetaDirEntry>();
  for (const entry of entries) {
    const clash = byName.get(entry.name);
    if (clash !== undefined) {
      throw docsError(
        'invalid-meta',
        `${metaPath} cannot address "${entry.name}": ${describeEntry(clash)} ` +
          `and ${describeEntry(entry)} both claim that name. Rename one.`,
      );
    }
    byName.set(entry.name, entry);
  }
  return byName;
}

function describeEntry(entry: MetaDirEntry): string {
  // `inlineChildren`, not `node.type`: a directory with a page of its own and
  // no children contributes a `page` node, and it is still a directory.
  return entry.inlineChildren === undefined
    ? `${entry.name}.md`
    : `${entry.name}/`;
}

/**
 * Groups that turned out to hold nothing (every page a draft, or none of them
 * named in a child `meta.json`) are dropped here rather than earlier so that
 * naming such a directory in `meta.json` never fails the build.
 */
function dropEmptyGroups(nodes: readonly DocNavNode[]): DocNavNode[] {
  return nodes.filter(
    (node) =>
      node.type !== 'group' ||
      node.children.length > 0 ||
      node.href !== undefined,
  );
}

/**
 * A separator labels whatever follows it. When that turned out to be nothing —
 * every page in the next group a draft, or two separators in a row after one
 * of them emptied — the heading is left standing over nothing.
 *
 * Runs after {@link dropEmptyGroups}, which is what empties them, and cannot be
 * left to the author to notice: `includeDrafts` is how a docs site is
 * previewed, and it is exactly the mode where the group is not empty.
 */
function dropDanglingSeparators(nodes: readonly DocNavNode[]): DocNavNode[] {
  const kept: DocNavNode[] = [];
  // Backwards, because whether a separator survives depends on what follows it.
  for (const node of [...nodes].reverse()) {
    const next = kept.at(-1);
    if (
      node.type === 'separator' &&
      (next === undefined || next.type === 'separator')
    ) {
      continue;
    }
    kept.push(node);
  }
  return kept.reverse();
}

/**
 * An entry appears without being named: not a draft, and not the directory's
 * own `index.md` — which is the group heading's link, and would be a second
 * entry for a page the sidebar already shows.
 *
 * The content root is the exception, and the case the rule never considered:
 * nothing encloses it, so its `index.md` is the one page that has no heading
 * to carry its href. Without this, the site's landing page is missing from its
 * own sidebar — a reader who follows any link cannot get back — and every
 * install writes a `meta.json` whose only purpose is to undo the default.
 */
function isListedByDefault(entry: MetaDirEntry, depth: number): boolean {
  return entry.hidden !== true && (entry.isIndex !== true || depth === 0);
}

function sortEntries(entries: readonly MetaDirEntry[]): MetaDirEntry[] {
  return [...entries].sort(compareEntries);
}

function compareEntries(a: MetaDirEntry, b: MetaDirEntry): number {
  if (a.order !== undefined && b.order !== undefined) {
    if (a.order !== b.order) {
      return a.order - b.order;
    }
  } else if (a.order !== undefined) {
    return -1;
  } else if (b.order !== undefined) {
    return 1;
  }
  // Fixed locale: sidebar order must not depend on the build machine.
  return a.title.localeCompare(b.title, 'en');
}

function describeAvailable(
  entries: readonly MetaDirEntry[],
  directoriesOnly: boolean,
): string {
  const names = entries
    .filter((entry) => !directoriesOnly || entry.inlineChildren !== undefined)
    .map((entry) => entry.name)
    .sort();
  const label = directoriesOnly ? 'Subdirectories' : 'Available entries';
  return names.length === 0
    ? `${label}: (none).`
    : `${label}: ${names.join(', ')}.`;
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'ENOENT'
  );
}
