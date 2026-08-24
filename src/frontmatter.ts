/**
 * Frontmatter validation.
 *
 * The base schema lives here rather than inline in the filesystem walk because
 * consumers extend {@link docFrontmatterSchema} with their own fields and hand
 * the result back through `DocsConfig.frontmatterSchema`, so it has to be a
 * first-class export rather than an implementation detail.
 *
 * Validation itself goes through [Standard Schema](https://standardschema.dev)
 * and not through Zod's own API, so a consumer may hand over a Valibot or
 * ArkType schema instead — and so the schema they hand over is never re-wrapped
 * by whichever copy of Zod resolved inside this package.
 */

import type { StandardSchemaV1 } from '@standard-schema/spec';
import { z } from 'zod';

import { isSafeHref } from './safe-href.js';
import type { DocFrontmatter } from './types.js';
import { docsError } from './docs-error.js';

/**
 * The Zod instance {@link docFrontmatterSchema} is built from.
 *
 * `.extend()` composes shapes across copies of Zod, but the resulting schema is
 * only ever as trustworthy as the instance that made it — and a consumer with
 * their own Zod has no way to know whether it is the same one. Re-exporting
 * ours removes the question: `import { z } from '@waveso/docs/frontmatter'` and
 * the extension is built from the same module object, by construction.
 *
 * It also removes the need to install anything. Zod is a dependency of this
 * package, not a peer, because it is imported at module scope here and in
 * `meta.ts` — which is what a dependency is. As a peer it blocked `npm install`
 * outright for the ~47% of the ecosystem still on Zod 3, and for anyone on a
 * Zod 4 below 4.4.3, over a range most of them would never touch.
 */
export { z };

/**
 * The frontmatter fields the package itself understands, as a Zod schema.
 *
 * Optional fields use `.exactOptional()` rather than `.optional()` so the
 * inferred type is `{ description?: string }`: absent stays absent, which is
 * the only thing YAML can express — there is no way to author an explicit
 * `undefined` in a frontmatter block. A consumer's schema may still use plain
 * `.optional()`; {@link DocFrontmatter} accepts both.
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
  /* A name the consumer resolves, not a path or an import — see
   * `DocFrontmatter.icon`. `min(1)` so `icon: ""` is a build error rather than
   * a marker that silently falls back. */
  icon: z.string().min(1).exactOptional(),
  /*
   * ⚠️ `isSafeHref` HERE AND NOT IN THE COMPONENT. Every other href this
   * package renders arrives through markdown and is checked on the way in;
   * these arrive through frontmatter, which is the one door that bypassed it.
   * A `javascript:` action would otherwise be rendered verbatim into an
   * `<a href>`.
   */
  actions: z
    .array(
      z.object({
        label: z.string().min(1),
        href: z
          .string()
          .min(1)
          .refine(isSafeHref, 'must be a safe URL (no javascript: or data:)'),
        variant: z.enum(['primary', 'secondary']).exactOptional(),
      }),
    )
    .exactOptional(),
});

/**
 * The package's own fields, every one of them optional, for the overlay pass
 * in {@link parseFrontmatter}.
 *
 * `title` is optional here too, even though the package requires it: a custom
 * schema may legitimately produce a title the YAML does not carry (a
 * `.default()`), and demanding one of the raw block would fail that file. The
 * check after the merge reads the merged title instead, so both routes to a
 * title are accepted and no route to a missing one is.
 */
const builtInFields = docFrontmatterSchema.partial();

/**
 * Validate one file's frontmatter, or throw an error that names the file.
 *
 * `raw` is whatever the YAML parser produced — `unknown` by construction, so
 * every field is checked rather than trusted.
 *
 * The six fields this package reads are always parsed from the raw block by
 * {@link docFrontmatterSchema} and laid back over the result, so a custom
 * `schema` can only ever *add* fields. It cannot drop `draft`, `aliases`,
 * `order`, `label`, `description` or `title` — which a bare
 * `z.object({ title, audience })` silently does — and it cannot redefine them
 * into a shape the sidebar, the redirects and the sitemap do not expect. The
 * price is that a `.default()`, `.transform()` or `.coerce` aimed at one of the
 * six is not honoured: the YAML wins. The return type intersects
 * {@link DocFrontmatter} for the same reason — the built-ins are there whether
 * or not the schema declared them.
 *
 * Async because `~standard.validate` is allowed to return a promise and some
 * validators do (any schema with an async refinement). The source layer is
 * already async, so awaiting here costs nothing and refusing promises would
 * have made a documented half of the spec silently unsupported.
 *
 * @param raw - Parsed YAML frontmatter block.
 * @param filePath - Path reported in the error. Pass the path the author
 *   would recognise (relative to the content root), not an absolute one.
 */
export function parseFrontmatter(
  raw: unknown,
  filePath: string,
): Promise<DocFrontmatter>;
/**
 * Validate one file's frontmatter against `schema`, or throw an error that
 * names the file. See the two-argument overload for the contract.
 *
 * `TFrontmatter` comes from the schema and must never be named at the call
 * site. That is what the two overloads buy: `parseFrontmatter<Mine>(raw, file)`
 * with no schema is a compile error, where before it type-checked and then lied
 * — nothing validated `Mine`, so its fields were `undefined` at runtime while
 * typed as present.
 *
 * `undefined` is accepted here rather than the schema being optional so that a
 * `DocsConfig<T>`'s own optional schema passes straight through. An earlier
 * attempt made it required and broke exactly that, at `createDocsRoute` and at
 * any consumer holding a typed config.
 *
 * @param raw - Parsed YAML frontmatter block.
 * @param filePath - Path reported in the error. Pass the path the author
 *   would recognise (relative to the content root), not an absolute one.
 * @param schema - Replacement schema, normally
 *   `docFrontmatterSchema.extend(...)`. Any Standard Schema validator works.
 *   `undefined` selects {@link docFrontmatterSchema}.
 */
export function parseFrontmatter<TFrontmatter extends DocFrontmatter>(
  raw: unknown,
  filePath: string,
  schema: StandardSchemaV1<unknown, TFrontmatter> | undefined,
): Promise<TFrontmatter & DocFrontmatter>;
export async function parseFrontmatter<
  TFrontmatter extends DocFrontmatter = DocFrontmatter,
>(
  raw: unknown,
  filePath: string,
  schema?: StandardSchemaV1<unknown, TFrontmatter>,
): Promise<TFrontmatter & DocFrontmatter> {
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
    throw docsError(
      'invalid-frontmatter',
      `Invalid frontmatter in ${filePath}: the schema threw while validating ` +
        'it. This is a bug in the schema, not in the YAML — check any ' +
        '`refine`/`transform`/`check` it declares.',
      { cause: error },
    );
  }

  if (result.issues === undefined) {
    // The default schema already *is* the built-in contract, so the overlay
    // would only re-derive what this pass just produced.
    return active === docFrontmatterSchema
      ? result.value
      : applyBuiltIns(result.value, raw, filePath);
  }

  // An empty issue list means "rejected, but I won't say why". Reporting a
  // failure with no details is worse than useless, so name it as the schema's
  // fault rather than printing an empty bullet list under the file name.
  if (result.issues.length === 0) {
    throw docsError(
      'invalid-frontmatter',
      `Invalid frontmatter in ${filePath}: the schema rejected it but ` +
        'reported no issues, so there is nothing to act on. This is a bug in ' +
        'the schema.',
    );
  }

  // Which schema rejected the file is the first thing the author needs: a
  // complaint about `audience` is unintelligible until you know it came from
  // your own `frontmatterSchema` and not from this package.
  const source =
    schema === undefined
      ? 'Fix the YAML block at the top of that file.'
      : 'Fix the YAML block at the top of that file, or the ' +
        '`frontmatterSchema` in your docs config.';

  throw docsError(
    'invalid-frontmatter',
    `Invalid frontmatter in ${filePath}:\n${formatIssues(
      result.issues,
    )}\n${source}`,
  );
}

/**
 * Re-read the package's own fields from the raw block and lay them back over a
 * custom schema's output.
 *
 * Without this, the guarantee that a `frontmatterSchema` keeps the built-ins
 * rests on `TFrontmatter extends DocFrontmatter` — which constrains `title` and
 * nothing else, because the other five fields are optional. So
 * `z.object({ title, audience })`, written from scratch instead of as
 * `docFrontmatterSchema.extend(...)`, type-checks and then strips `draft`,
 * `aliases`, `order` and `label` on the way through. The package reads the
 * absence as "not a draft, no redirects, no order": an unpublished page ships,
 * is linked from the sidebar and is submitted to Google in the sitemap, and
 * every renamed page 404s. `tsc` reports nothing, at either end.
 *
 * The overlay runs after the custom schema rather than instead of it, so a
 * stricter rule on a built-in (`title: z.string().max(60)`) still fails the
 * build — it just cannot change the value the package then reads.
 */
async function applyBuiltIns<TFrontmatter extends DocFrontmatter>(
  value: TFrontmatter,
  raw: unknown,
  filePath: string,
): Promise<TFrontmatter & DocFrontmatter> {
  const result = await builtInFields['~standard'].validate(raw ?? {});

  if (result.issues !== undefined) {
    throw docsError(
      'invalid-frontmatter',
      `Invalid frontmatter in ${filePath}:\n${formatIssues(result.issues)}\n` +
        '@waveso/docs reads these fields itself, so they are validated even ' +
        'when your `frontmatterSchema` does not declare them. Fix the YAML ' +
        'block at the top of that file.',
    );
  }

  // Zod omits an absent optional key rather than setting it to `undefined`, so
  // spreading cannot resurrect a field the YAML does not carry.
  const merged = { ...value, ...result.value };

  // Reachable only through a schema that dropped `title` *and* a file that has
  // none: the overlay restores an authored title, and a custom `.default()`
  // survives into `merged`. Unchecked, every reader of `frontmatter.title` —
  // `<h1>`, `<title>`, the sidebar, the search index — gets `undefined` while
  // the type says `string`.
  if (typeof merged.title !== 'string' || merged.title.length === 0) {
    throw docsError(
      'invalid-frontmatter',
      `Invalid frontmatter in ${filePath}: no \`title\`. Every page needs ` +
        'one — it drives the `<h1>` fallback, `<title>`, the sidebar and ' +
        'search. Add `title:` to the YAML block at the top of that file, or ' +
        'give your `frontmatterSchema` a title it can supply.',
    );
  }

  return merged;
}

/** Render a validator's issues as the bullet list under the file name. */
function formatIssues(issues: ReadonlyArray<StandardSchemaV1.Issue>): string {
  return issues
    .map((issue) => `  - ${formatIssuePath(issue.path)}: ${issue.message}`)
    .join('\n');
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
