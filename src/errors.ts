/**
 * The error taxonomy, as public API.
 *
 * Every failure this package raises is an `Error` whose message names the
 * package and which carries a `code` off this union. That exists so a host can
 * branch — downgrade broken-link failures in a preview build, say, or report
 * `invalid-frontmatter` differently from `missing-peer` — and until this
 * module was an entry point there was no supported way to do it. The taxonomy
 * said "branch on this" while the module said "you cannot import me", and the
 * two paragraphs contradicted each other for nineteen codes and forty-five
 * call sites.
 *
 * ```ts
 * import { isDocsError } from '@waveso/docs/errors';
 *
 * try {
 *   await docs.renderAll();
 * } catch (error) {
 *   if (isDocsError(error) && error.code === 'draft-link') {
 *     console.warn(error.message);
 *   } else {
 *     throw error;
 *   }
 * }
 * ```
 *
 * No class is exported, and that is deliberate: `instanceof` against a copy of
 * this module resolved twice — a monorepo with two versions installed, a
 * bundler that duplicates it — silently answers `false`. A string `code` and a
 * structural guard have no such failure mode.
 */

/** Prefix every message carries, so a stack trace names the culprit package. */
export const DOCS_ERROR_PREFIX = '@waveso/docs: ';

/**
 * What went wrong, as something a consumer can branch on.
 *
 * Before this existed, every failure was a bare `Error` and roughly half the
 * messages omitted the package prefix, so a host wanting to downgrade (say)
 * broken-link failures in dev had nothing to test but the message text — and
 * `message.startsWith('@waveso/docs:')` was not even a reliable filter.
 */
export type DocsErrorCode =
  /** A link resolves to a route no published page owns. */
  | 'broken-link'
  /** A link resolves to a page that exists but is `draft: true`. */
  | 'draft-link'
  /** A link resolves to an alias, which is a redirect and not a page. */
  | 'alias-link'
  /** A `#fragment` that no heading on the target page owns. */
  | 'broken-anchor'
  /** An `aliases` entry is empty, escapes the root, or is not URL-safe. */
  | 'invalid-alias'
  /** Two pages claim one alias, or an alias shadows a real route. */
  | 'alias-collision'
  /** Two files resolve to the same route. */
  | 'route-collision'
  /** A page's frontmatter is missing, malformed, or rejected by the schema. */
  | 'invalid-frontmatter'
  /** A `meta.json` is malformed, or names something that is not there. */
  | 'invalid-meta'
  /** An option passed to this package cannot be used as given. */
  | 'invalid-config'
  /** `contentDir` does not point at a readable directory. */
  | 'missing-content-dir'
  /** A markdown page is reachable only through a broken symbolic link. */
  | 'broken-symlink'
  /** The process ran out of file descriptors while scanning the content. */
  | 'descriptor-limit'
  /** An `imageResolver` returned an unusable shape, threw, or was needed. */
  | 'invalid-image'
  /** A theme name outside the supported set. */
  | 'unknown-theme'
  /** A fence language outside the loaded set. */
  | 'unknown-language'
  /** An optional peer (`next`) is absent or not the expected shape. */
  | 'missing-peer'
  /** The search index could not be fetched or parsed. */
  | 'search-index-unavailable'
  /** The search-index route ran at request time instead of being prerendered. */
  | 'search-index-dynamic'
  /** A code fence's meta string has a `title` that cannot be read. */
  | 'invalid-code-meta'
  /** A plugin ran without the context this package always supplies. */
  | 'internal';

/** An {@link Error} carrying a {@link DocsErrorCode}. */
export interface DocsError extends Error {
  readonly code: DocsErrorCode;
}

/**
 * Narrow an unknown caught value to one of this package's errors.
 *
 * Checks the prefix as well as the shape, so an unrelated `Error` that happens
 * to carry a `code` — Node's own `ENOENT`, for one — is not mistaken for ours.
 */
export function isDocsError(value: unknown): value is DocsError {
  return (
    value instanceof Error &&
    typeof (value as { code?: unknown }).code === 'string' &&
    value.message.startsWith(DOCS_ERROR_PREFIX)
  );
}
