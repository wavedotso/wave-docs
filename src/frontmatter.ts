/**
 * Frontmatter validation.
 *
 * The schema lives here rather than inline in the filesystem walk because Zod
 * is a *peer* dependency: consumers extend {@link docFrontmatterSchema} with
 * their own fields and hand the result back, so the base schema has to be a
 * first-class export rather than an implementation detail.
 */

import { z } from 'zod';
import type { DocFrontmatter } from './types.js';

/**
 * The frontmatter fields the package itself understands, as a Zod schema.
 *
 * Optional fields use `.exactOptional()` rather than `.optional()` so the
 * inferred type is `{ description?: string }` and not
 * `{ description?: string | undefined }` — the latter is not assignable to
 * {@link DocFrontmatter} under `exactOptionalPropertyTypes`, and an explicit
 * `undefined` cannot come out of YAML anyway.
 *
 * `description` is deliberately not length-capped. The 155–160 character
 * advice for `<meta name="description">` is a pixel-width heuristic about
 * where Google truncates a snippet, not a limit — enforcing it here would
 * fail a build over prose that renders fine.
 *
 * Extend it for project-specific fields:
 *
 * ```ts
 * const schema = docFrontmatterSchema.extend({
 *   audience: z.enum(['user', 'operator']).exactOptional(),
 * });
 * ```
 */
export const docFrontmatterSchema = z.object({
  title: z.string().min(1),
  description: z.string().exactOptional(),
  label: z.string().exactOptional(),
  draft: z.boolean().exactOptional(),
  aliases: z.array(z.string()).exactOptional(),
  order: z.number().exactOptional(),
});

/**
 * Validate one file's frontmatter, or throw an error that names the file.
 *
 * `raw` is whatever the YAML parser produced — `unknown` by construction, so
 * every field is checked rather than trusted.
 *
 * @param raw - Parsed YAML frontmatter block.
 * @param filePath - Path reported in the error. Pass the path the author
 *   would recognise (relative to the content root), not an absolute one.
 * @param schema - Optional replacement schema, normally
 *   `docFrontmatterSchema.extend(...)`.
 */
export function parseFrontmatter<T extends DocFrontmatter = DocFrontmatter>(
  raw: unknown,
  filePath: string,
  schema?: z.ZodType<T>,
): T {
  // Sound whenever the caller omits `schema`, which pins `T` to its default.
  // A caller that names `T` explicitly and omits the schema gets what it
  // asked for.
  const active = schema ?? (docFrontmatterSchema as unknown as z.ZodType<T>);
  const result = active.safeParse(raw ?? {});
  if (result.success) {
    return result.data;
  }

  const details = result.error.issues
    .map((issue) => `  - ${formatIssuePath(issue.path)}: ${issue.message}`)
    .join('\n');

  throw new Error(
    `Invalid frontmatter in ${filePath}:\n${details}\n` +
      'Fix the YAML block at the top of that file.',
  );
}

/** Render a Zod issue path as `aliases[0]` / `title`, never as `""`. */
function formatIssuePath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) {
    return '(document)';
  }
  return path.reduce<string>((acc, key) => {
    if (typeof key === 'number') {
      return `${acc}[${key}]`;
    }
    return acc === '' ? String(key) : `${acc}.${String(key)}`;
  }, '');
}
