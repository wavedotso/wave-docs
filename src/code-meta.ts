/**
 * The bit after the language on a fence: ```` ```ts title="app/page.tsx" ````.
 *
 * Private — deliberately not an entry point. What a consumer sees is the
 * `<figcaption>` it produces; the grammar is ours to extend.
 *
 * ## Read, never mutate
 *
 * `parseCodeMeta` takes a string and returns a value. It does not rewrite
 * `code.data.meta`, and that restraint is the whole design: Shiki forwards the
 * raw meta string to its transformers as `meta.__raw`, which is how
 * `{1,3-5}` line highlighting and `showLineNumbers` will work when those land.
 * A parser that consumed what it recognised would silently disable every
 * feature it had not been taught about yet.
 *
 * ## Why `title=`
 *
 * Not a design question — a survey. Fumadocs, Starlight (via Expressive Code)
 * and Docusaurus all spell it `title="…"`. Nextra's `filename=` and VitePress's
 * `[filename]` are the minority, and `[…]` has nowhere to grow, so adopting it
 * would mean two grammars in one meta string. `title` collides with frontmatter
 * `title` as a word, which one comment fixes; making three of the five nearest
 * comparators' users learn a second spelling does not have a fix.
 *
 * ## Unknown keys are ignored, malformed ones are not
 *
 * Shiki's meta string is an open namespace shared with its own transformers, so
 * an author pasting `twoslash` or `{1,3}` from another site's documentation must
 * not fail the build. But `title=app/page.tsx` — unquoted — is a *malformed*
 * `title`, and ignoring it silently ships a caption reading `app/page.tsx` only
 * up to the first space, or no caption at all. That throws, naming the file.
 */

import { docsError } from './docs-error.js';

/** What a fence's meta string asked for. */
export interface CodeMeta {
  /** The `<figcaption>` text, and part of the copy button's accessible name. */
  title?: string | undefined;
}

/**
 * `title="…"`, anywhere in the string, with the value in double quotes.
 *
 * A filename containing a double quote is inexpressible, and gets no escape
 * mechanism: no real path has one, and an escape grammar is a permanent tax on
 * every reader of this regex to serve a case that does not occur.
 */
const TITLE = /(^|\s)title="([^"]*)"/;

/**
 * A `title=` at a word boundary, however it is spelled.
 *
 * Only consulted once {@link TITLE} has already failed, so reaching this means
 * the author wrote a title the one grammar cannot read — unquoted,
 * single-quoted, or opened and never closed. An earlier version excluded
 * anything followed by a quote, which let `title="a.ts` (no closing quote)
 * fall through and produce no caption at all, silently. That is the failure
 * this function exists to make loud.
 */
const MALFORMED_TITLE = /(^|\s)title=/;

/**
 * Read {@link CodeMeta} out of a fence's meta string.
 *
 * `path` is only ever used to name the offending document in an error. The
 * alternative — an error saying `title=` was malformed, on a site with four
 * hundred pages — is a grep.
 */
export function parseCodeMeta(
  meta: string | undefined,
  path: string,
): CodeMeta {
  if (meta === undefined || meta.trim() === '') {
    return {};
  }

  const matched = TITLE.exec(meta);
  if (matched === null) {
    if (MALFORMED_TITLE.test(meta)) {
      throw docsError(
        'invalid-code-meta',
        `${path}: a code fence has a malformed \`title\`. Write it as ` +
          '`title="app/page.tsx"`, with double quotes — an unquoted title ' +
          'stops at the first space, and a title containing a double quote ' +
          `cannot be expressed. Got: \`${meta.trim()}\``,
      );
    }
    return {};
  }

  const title = matched[2];
  // `title=""` is an author asking for no caption in a roundabout way; treat it
  // as absent rather than emitting an empty bar with a border and 0.5rem of
  // padding.
  return title === undefined || title === '' ? {} : { title };
}
