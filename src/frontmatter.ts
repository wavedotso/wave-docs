/**
 * Frontmatter validation.
 *
 * The base schema lives here rather than inline in the filesystem walk because
 * Zod is a *peer* dependency: consumers extend {@link docFrontmatterSchema}
 * with their own fields and hand the result back through
 * `DocsConfig.frontmatterSchema`, so the base schema has to be a first-class
 * export rather than an implementation detail.
 *
 * Validation itself goes through [Standard Schema](https://standardschema.dev)
 * and not through Zod's own API, so a consumer may hand over a Valibot or
 * ArkType schema instead — and so the schema they hand over is never re-wrapped
 * by whichever copy of Zod resolved inside this package.
 */

import type { StandardSchemaV1 } from '@standard-schema/spec';
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
 * Extend it for project-specific fields, then pass the result as
 * `frontmatterSchema`:
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
 * Async because `~standard.validate` is allowed to return a promise and some
 * validators do (any schema with an async refinement). The source layer is
 * already async, so awaiting here costs nothing and refusing promises would
 * have made a documented half of the spec silently unsupported.
 *
 * @param raw - Parsed YAML frontmatter block.
 * @param filePath - Path reported in the error. Pass the path the author
 *   would recognise (relative to the content root), not an absolute one.
 * @param schema - Optional replacement schema, normally
 *   `docFrontmatterSchema.extend(...)`. Any Standard Schema validator works.
 */
export async function parseFrontmatter<
  TFrontmatter extends DocFrontmatter = DocFrontmatter,
>(
  raw: unknown,
  filePath: string,
  schema?: StandardSchemaV1<unknown, TFrontmatter>,
): Promise<TFrontmatter> {
  // ⚠️ Sound only when `TFrontmatter` is inferred, which is the documented way
  // to call this. Naming it explicitly *and* omitting the schema —
  // `parseFrontmatter<Mine>(raw, file)` — type-checks and then lies: nothing
  // validates `Mine`, so its extra fields are `undefined` at runtime while
  // typed as present.
  //
  // Overloads that make that unexpressible were tried and reverted: requiring
  // the schema on the type-named overload also rejects passing a
  // `DocsConfig<T>` through generically, which both `createDocsRoute` and any
  // consumer holding a typed config variable legitimately do. Let the type be
  // inferred and this cannot bite; the README says so too.
  const active =
    schema ?? (docFrontmatterSchema as StandardSchemaV1<unknown, TFrontmatter>);

  // A validator is only *asked* to report problems as issues; nothing stops it
  // throwing instead, and a `.refine()` that does `JSON.parse` or dereferences
  // something absent will. Left unwrapped, that surfaces as a bare
  // `TypeError: Cannot read properties of undefined` with no file, no field and
  // no hint that frontmatter was involved — the exact opposite of the rule that
  // a build error names the markdown file that broke.
  let result: StandardSchemaV1.Result<TFrontmatter>;
  try {
    result = await active['~standard'].validate(raw ?? {});
  } catch (error) {
    throw new Error(
      `Invalid frontmatter in ${filePath}: the schema threw while validating ` +
        'it. This is a bug in the schema, not in the YAML — check any ' +
        '`refine`/`transform`/`check` it declares.',
      { cause: error },
    );
  }

  if (result.issues === undefined) {
    return result.value;
  }

  // An empty issue list means "rejected, but I won't say why". Reporting a
  // failure with no details is worse than useless, so name it as the schema's
  // fault rather than printing an empty bullet list under the file name.
  if (result.issues.length === 0) {
    throw new Error(
      `Invalid frontmatter in ${filePath}: the schema rejected it but ` +
        'reported no issues, so there is nothing to act on. This is a bug in ' +
        'the schema.',
    );
  }

  const details = result.issues
    .map((issue) => `  - ${formatIssuePath(issue.path)}: ${issue.message}`)
    .join('\n');

  // Which schema rejected the file is the first thing the author needs: a
  // complaint about `audience` is unintelligible until you know it came from
  // your own `frontmatterSchema` and not from this package.
  const source =
    schema === undefined
      ? 'Fix the YAML block at the top of that file.'
      : 'Fix the YAML block at the top of that file, or the ' +
        '`frontmatterSchema` in your docs config.';

  throw new Error(`Invalid frontmatter in ${filePath}:\n${details}\n${source}`);
}

/**
 * Render an issue path as `aliases[0]` / `title`, never as `""`.
 *
 * Standard Schema spells a path segment as either the key itself or an object
 * wrapping it, and a validator may use both forms in one issue list — so both
 * are handled here rather than at the call site.
 */
function formatIssuePath(
  path: ReadonlyArray<PropertyKey | StandardSchemaV1.PathSegment> | undefined,
): string {
  if (path === undefined || path.length === 0) {
    return '(document)';
  }
  return path.reduce<string>((acc, segment) => {
    const key =
      typeof segment === 'object' && segment !== null ? segment.key : segment;
    if (typeof key === 'number') {
      return `${acc}[${key}]`;
    }
    return acc === '' ? String(key) : `${acc}.${String(key)}`;
  }, '');
}
