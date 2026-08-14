/**
 * The MiniSearch field configuration, in one place.
 *
 * Both halves of search need the identical object: the build-time index
 * (`@waveso/docs/search-index`) decides what gets stored, and the client dialog
 * (`@waveso/docs/react/search-dialog`) has to hand `loadJSON` the same shape it
 * was built with. This module exists so that is one constant rather than two
 * copies drifting apart — it imports nothing from Node, and nothing from
 * MiniSearch but a type, so it is safe on both sides of the bundle boundary and
 * cannot drag the search engine into the client's initial bundle.
 */

import type { Options as MiniSearchOptions } from 'minisearch';
import type { SearchRecord } from './types.js';

/* -------------------------------------------------------------------------
 * Tokenisation
 * ---------------------------------------------------------------------- */

/**
 * Everything that is not a letter, a digit or a combining mark.
 *
 * Applied to each segment the word breaker returns, so `wave.config.json`
 * indexes as three terms rather than one. UAX #29 treats a full stop between
 * letters as part of the word, which is right for `e.g.` in prose and wrong
 * for every dotted identifier in a technical document.
 */
const NON_WORD = /[^\p{L}\p{N}\p{M}]+/u;

/**
 * Locale-pinned deliberately. The word breaker's output is baked into the
 * shipped index at build time and re-derived from the query in the reader's
 * browser; if the two disagree by so much as one boundary, search returns
 * nothing and says nothing. A locale read from the environment would make the
 * index a function of the machine that built it.
 *
 * `'en'` does not mean "English text only": CJK segmentation is driven by the
 * script's dictionary, not by the requested locale.
 */
const SEGMENTER_LOCALE = 'en';

/**
 * Absent on browsers older than Firefox 125; Node has had it since 16.
 * Without it CJK falls back to whitespace splitting, which is how this package
 * shipped before: Chinese, Japanese and Thai prose has no spaces, so a whole
 * clause became one term and every query returned zero results.
 */
const WORD_SEGMENTER =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(SEGMENTER_LOCALE, { granularity: 'word' })
    : undefined;

/**
 * Split text into index terms.
 *
 * ⚠️ THE SAME FUNCTION MUST TOKENISE THE DOCUMENTS AND THE QUERY. It is part of
 * {@link SEARCH_INDEX_OPTIONS} rather than a separate argument for exactly that
 * reason — MiniSearch reads `tokenize` both when indexing and when searching,
 * and a build-time tokeniser the client does not share fails silently, with an
 * index full of terms no query can ever spell.
 */
export function tokenizeSearchText(text: string): string[] {
  if (WORD_SEGMENTER === undefined) {
    return text.split(NON_WORD).filter((token) => token !== '');
  }

  const tokens: string[] = [];
  for (const { segment, isWordLike } of WORD_SEGMENTER.segment(text)) {
    // Punctuation and whitespace segments carry no term.
    if (isWordLike !== true) continue;
    for (const token of segment.split(NON_WORD)) {
      if (token !== '') tokens.push(token);
    }
  }
  return tokens;
}

/* -------------------------------------------------------------------------
 * Field configuration
 * ---------------------------------------------------------------------- */

/**
 * Fields, stored fields and query defaults for the docs index.
 *
 * `storeFields` MUST be applied at build time. It decides what
 * `MiniSearch.toJSON()` carries; passing it to `loadJSON` on the client cannot
 * recover fields the serialised index never stored, and the failure is silent
 * — results arrive with an id and a score and nothing to render.
 *
 * `title` is stored but NOT indexed, and the asymmetry is the whole point. A
 * record exists per section, and every one of them carries its page's title, so
 * indexing it scored all N sections of one page on a single title match: a
 * query for `configuration` filled seven of the dialog's eight rows with the
 * same page and pushed every other page's matches off the list entirely. The
 * page title is still searchable — the lead record's `heading` IS the title, so
 * it matches exactly once per page, which is what the reader wanted from it.
 *
 * `combineWith: 'AND'` is not MiniSearch's default and is not optional here.
 * The default OR returned 68–131 hits on real queries where AND returned a
 * usable handful.
 */
export const SEARCH_INDEX_OPTIONS: MiniSearchOptions<SearchRecord> = {
  fields: ['heading', 'text', 'ancestors'],
  storeFields: ['title', 'heading', 'ancestors', 'href'],
  tokenize: tokenizeSearchText,
  searchOptions: {
    prefix: true,
    fuzzy: 0.2,
    combineWith: 'AND',
    boost: { heading: 3, text: 2, ancestors: 1 },
  },
};

/**
 * {@link SEARCH_INDEX_OPTIONS} with `overrides` applied over it.
 *
 * The one supported way to customise search, and it exists so both halves can
 * customise it identically: `buildSearchIndex` takes the same overrides the
 * dialog does, and an index built with one `tokenize` and queried with another
 * returns nothing at all.
 *
 * `searchOptions` merges one level deep, so `{ searchOptions: { fuzzy: 0 } }`
 * keeps `combineWith: 'AND'` instead of silently reverting it to MiniSearch's
 * OR. Nothing below that merges: a `boost` override replaces the whole map.
 */
export function mergeSearchOptions(
  overrides: Partial<MiniSearchOptions<SearchRecord>> = {},
): MiniSearchOptions<SearchRecord> {
  return {
    ...SEARCH_INDEX_OPTIONS,
    ...overrides,
    searchOptions: {
      ...SEARCH_INDEX_OPTIONS.searchOptions,
      ...overrides.searchOptions,
    },
  };
}
