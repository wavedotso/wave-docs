/**
 * The MiniSearch field configuration, in one place.
 *
 * Both halves of search need the identical object: the build-time index
 * (`@waveso/docs/search-index`) decides what gets stored, and the client dialog
 * (`@waveso/docs/react/search-dialog`) has to hand `loadJSON` the same shape it
 * was built with. This module exists so that is one constant rather than two
 * copies drifting apart — it imports nothing from Node, so it is safe on both
 * sides of the bundle boundary.
 */

import type { Options as MiniSearchOptions } from 'minisearch';
import type { SearchRecord } from './types.js';

/**
 * Fields, stored fields and query defaults for the docs index.
 *
 * `storeFields` MUST be applied at build time. It decides what
 * `MiniSearch.toJSON()` carries; passing it to `loadJSON` on the client cannot
 * recover fields the serialised index never stored, and the failure is silent
 * — results arrive with an id and a score and nothing to render.
 *
 * `combineWith: 'AND'` is not MiniSearch's default and is not optional here.
 * The default OR returned 68–131 hits on real queries where AND returned a
 * usable handful.
 */
export const SEARCH_INDEX_OPTIONS: MiniSearchOptions<SearchRecord> = {
  fields: ['title', 'heading', 'text', 'titles'],
  storeFields: ['title', 'heading', 'titles', 'href'],
  searchOptions: {
    prefix: true,
    fuzzy: 0.2,
    combineWith: 'AND',
    boost: { title: 4, heading: 3, text: 2, titles: 1 },
  },
};
