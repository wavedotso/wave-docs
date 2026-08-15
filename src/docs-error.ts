/**
 * One error shape for the whole package.
 *
 * Private — deliberately not an entry point in `package.json`. Consumers get
 * the `code` off the error they already catch; they do not import a class and
 * they cannot `instanceof` against a copy of this module resolved twice.
 */

/** Prefix every message carries, so a stack trace names the culprit package. */
const PREFIX = '@waveso/docs: ';

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
  /** A plugin ran without the context this package always supplies. */
  | 'internal';

/** An {@link Error} carrying a {@link DocsErrorCode}. */
export interface DocsError extends Error {
  readonly code: DocsErrorCode;
}

/**
 * Build an error that names this package and says what class of thing failed.
 *
 * The message is passed through untouched apart from the prefix, which is added
 * only when absent — the wording at each throw site is the part a human reads,
 * and several of them took real effort to get right.
 *
 * `code` is attached non-enumerably so it does not appear in `JSON.stringify`
 * or a spread, which keeps error objects looking exactly as they did while
 * still being branchable.
 *
 * The stack is left alone. Flattening it would hide the `dist/` frames a
 * consumer does not care about, and also the ones a maintainer needs.
 */
export function docsError(
  code: DocsErrorCode,
  message: string,
  options?: ErrorOptions,
): DocsError {
  const error = new Error(
    message.startsWith(PREFIX) ? message : `${PREFIX}${message}`,
    options,
  );
  Object.defineProperty(error, 'code', {
    value: code,
    enumerable: false,
    writable: false,
    configurable: true,
  });
  return error as DocsError;
}

/** Narrow an unknown caught value to one of this package's errors. */
export function isDocsError(value: unknown): value is DocsError {
  return (
    value instanceof Error &&
    typeof (value as { code?: unknown }).code === 'string' &&
    value.message.startsWith(PREFIX)
  );
}
