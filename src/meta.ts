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

/** A `"---Label---"` separator entry. */
const SEPARATOR_PATTERN = /^---(.+)---$/;

/** The rest wildcard: everything not named explicitly, in place. */
const REST = '...';

/**
 * `<scheme>:` or protocol-relative `//host` — i.e. a URL that leaves the site.
 * Anything else (`/changelog`, `../pricing`) is internal.
 */
const ABSOLUTE_HREF_PATTERN = /^(?:[a-zA-Z][a-zA-Z\d+\-.]*:|\/\/)/;

/**
 * Zod mirror of {@link DocsMeta}.
 *
 * Strict on purpose: `meta.json` is hand-written and unvalidated keys are
 * almost always typos (`page`, `order`, `items`) that would otherwise fail
 * silently as a sidebar that quietly ignores half the file.
 */
export const docsMetaSchema = z.strictObject({
  title: z.string().exactOptional(),
  pages: z
    .array(
      z.union([
        z.string(),
        z.strictObject({ title: z.string(), href: z.string() }),
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

  throw new Error(`Invalid meta.json at ${filePath}:\n${details}`);
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
    parsed = JSON.parse(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not parse ${filePath} as JSON: ${reason}`);
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
 * @throws When `pages` names a child that does not exist — always a typo, and
 *   catching it here is the entire reason `meta.json` is validated at build.
 */
export function orderNavEntries(
  entries: readonly MetaDirEntry[],
  meta: DocsMeta | undefined,
  metaPath: string,
): DocNavNode[] {
  const pages = meta?.pages;
  if (pages === undefined) {
    return dropEmptyGroups(
      sortEntries(entries.filter((entry) => isListedByDefault(entry))).map(
        (entry) => entry.node,
      ),
    );
  }

  const byName = indexByName(entries, metaPath);
  const used = new Set<string>();
  const nodes: DocNavNode[] = [];
  let restAt = -1;

  for (const page of pages) {
    if (typeof page !== 'string') {
      nodes.push({
        type: 'link',
        title: page.title,
        href: page.href,
        external: ABSOLUTE_HREF_PATTERN.test(page.href),
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
        throw new Error(
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
        throw new Error(
          `${metaPath} entry "${page}" expands a directory named ` +
            `"${name}", which is not a subdirectory here. ` +
            `${describeAvailable(entries, true)}`,
        );
      }
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
      throw new Error(
        `${metaPath} lists "${page}", which does not exist. ` +
          `${describeAvailable(entries, false)}`,
      );
    }
    used.add(page);
    if (!target.hidden) {
      nodes.push(target.node);
    }
  }

  if (restAt !== -1) {
    const rest = sortEntries(
      entries.filter(
        (entry) => isListedByDefault(entry) && !used.has(entry.name),
      ),
    ).map((entry) => entry.node);
    nodes.splice(restAt, 0, ...rest);
  }

  return dropEmptyGroups(nodes);
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
      throw new Error(
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

/** An entry appears without being named: not the index, not a draft. */
function isListedByDefault(entry: MetaDirEntry): boolean {
  return entry.isIndex !== true && entry.hidden !== true;
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
