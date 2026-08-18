/**
 * Turning route segments into a URL path.
 *
 * Private — deliberately not an entry point in `package.json`. `toAliasRoute`
 * was exported from `./source` and therefore public, which froze both its
 * signature and the wording of three error messages under semver, for a
 * function no README mentions and only this package calls. It lives here with
 * `encodeSegments` because the two have to agree: an alias and a link that
 * spell the same page differently produce a redirect no request can match.
 */

import { decodePath, foldSegments } from './plugins/remark-doc-links.js';
import { docsError } from './docs-error.js';

/**
 * Percent-encode the segments, and only here.
 *
 * `segments` and `slug` stay raw on purpose: Next decodes route params before
 * they reach `find()`, so an encoded slug would match nothing. Unencoded, a
 * `#`, `?` or `%` in a filename stops being part of the path — the sitemap
 * emitted `https://example.com/docs/c#%20guide`, and `alternates.canonical`
 * and `og:url` are built by the same call — while a space produced a URL that
 * only works until something re-encodes it.
 */
export function encodeSegments(segments: readonly string[]): string {
  return segments.map(encodeURIComponent).join('/');
}

const ALIAS_PATTERN_CHARS = /[:()+*?{}]/;

/**
 * A former URL from `aliases` frontmatter, as a route.
 *
 * `'quickstart'` on a site mounted at `/docs` becomes `/docs/quickstart`.
 * Leading and trailing slashes are tolerated because authors write them, but
 * the value is always relative to the base path — an alias of `'/docs/old'` on
 * a `/docs` site would produce `/docs/docs/old`.
 *
 * Shared by both adapters so they agree on which routes exist: an alias is a
 * redirect the host installs, so a link to one resolves, and a link that
 * builds under Next must build under Vite. The source scan calls it too, so
 * every rejection below names the markdown file at the moment it is read.
 */
export function toAliasRoute(
  alias: string,
  basePath: string,
  /**
   * The source path, for the error. A STRING rather than the whole `DocFile`
   * it used to take: this function dereferenced exactly one property of it, and
   * demanding the object meant a cache reader or a manifest-driven redirect
   * table had to fabricate a `DocFile` to agree with the package about which
   * routes exist. That is the reason it is exported at all.
   */
  sourceLabel: string,
): string {
  /*
   * ⚠️ DECODED FIRST, AND THAT ORDER IS THE FIX. An alias is a former URL, so it
   * arrives percent-encoded — `aliases: [getting%20started]`, copied straight
   * out of the address bar, is the ordinary case — and `encodeSegments` below
   * then encoded it a second time. The redirect's source became
   * `/docs/getting%2520started`, which no request can ever match: the page
   * moved, the alias was written, and the old URL still 404'd.
   *
   * Round-tripping is the property that matters, and it holds both ways.
   * `getting%20started` decodes to a space and re-encodes to `%20`; `c# guide`
   * has no escapes to decode and still encodes to `c%23%20guide`. So an author
   * who pastes a URL and an author who writes the readable name both get the
   * route they meant.
   *
   * `decodePath` rather than `splitHref`: an alias may carry a literal `#` or
   * `?`, and splitting at those would silently truncate the name to `c`.
   *
   * Both checks below run on the decoded value for the same reason the decode
   * comes before the fold — `%2E%2E` is `..` in disguise and `%28` is `(`, so
   * checking the raw text passes exactly the inputs the checks exist to catch.
   */
  let trimmed: string;
  try {
    trimmed = decodePath(alias.trim(), alias);
  } catch (error) {
    throw docsError(
      'invalid-alias',
      `@waveso/docs: the alias '${alias}' in ${sourceLabel} is not valid ` +
        'percent-encoding. Write %25 for a literal percent sign, or write the ' +
        'former URL as its readable form.',
      { cause: error },
    );
  }

  if (trimmed.split('/').some((part) => part === '.' || part === '..')) {
    throw docsError(
      'invalid-alias',
      `@waveso/docs: the alias '${alias}' in ${sourceLabel} has a '.' or ` +
        "'..' segment. An alias is a former URL relative to the docs base " +
        'path, not a path on disk: write `aliases: [legacy/old-name]`.',
    );
  }

  const pattern = ALIAS_PATTERN_CHARS.exec(trimmed);
  if (pattern !== null) {
    throw docsError(
      'invalid-alias',
      `@waveso/docs: the alias '${alias}' in ${sourceLabel} contains ` +
        `'${pattern[0]}', which Next compiles as redirect pattern syntax ` +
        'rather than as part of the URL — the redirect then swallows every ' +
        'page whose route the pattern happens to match, or fails the build. ' +
        'Remove the character; an alias is a literal former URL.',
    );
  }

  // The same fold the link resolver uses, so an alias and a link can never
  // disagree about the route they spell. With `.`/`..` already rejected it
  // collapses the repeated slashes of `old//name` — a redirect source Next
  // accepts and no request can ever match.
  const segments = foldSegments([], trimmed);
  if (segments === undefined || segments.length === 0) {
    throw docsError(
      'invalid-alias',
      `@waveso/docs: ${sourceLabel} has an empty entry in its ` +
        '`aliases` frontmatter. Each alias is a former URL for this page, ' +
        'relative to the docs base path — e.g. `aliases: [quickstart]`.',
    );
  }

  return `${basePath}/${encodeSegments(segments)}`;
}
