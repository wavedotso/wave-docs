---
title: Search
description: A build-time MiniSearch index served as a route, and a dialog that fetches it on first hover.
---

Search is on by default: `docs.Layout` renders the trigger and the
`search-index.json` route file from the
[quick start](../getting-started/quick-start.md) serves the index. Nothing to
set up.

## Records are sections, not pages

**One record per `h2`–`h6`**, plus a lead record for everything above the first
heading, so a hit deep-links to the heading that matched rather than dropping
the reader at the top of a 2,000-word page. The anchors are the ids already on
the tree, never recomputed — [Plugins](./plugins.md) has the slugging step.

## The index is a route, not a build script

`docs.searchIndex` is a `GET` handler, so the index is rebuilt by the same
`next build` that builds the pages — no script to remember, nothing to commit.
In `next dev` it re-reads the disk per request: a page added is searchable on
the next keystroke, no restart.

```ts title="app/docs/search-index.json/route.ts"
import { docs } from '@/lib/docs';

export const GET = docs.searchIndex;
export const dynamic = 'force-static';
```

> [!WARNING]
> **`export const dynamic = 'force-static'` is not optional, and it has to be a
> literal** — route segment config is parsed out of the module before any of it
> runs, exactly like `dynamicParams`. Without it Next marks the route `ƒ`
> (Dynamic) and re-renders the whole corpus on every request, from markdown that
> output tracing did not put in the deployment bundle. On a serverless host that
> does not merely get slow: it throws, at the reader, inside the dialog. No
> warning is printed at build time, so the handler detects it at runtime and
> throws [`search-index-dynamic`](../reference/errors.md), naming the file.

**`docs.searchIndexUrl` is `${basePath}/search-index.json`**, derived from the
route's own `basePath` — `/docs/search-index.json` on the default mount,
`/search-index.json` on this site, whose `basePath: '/'` normalises to the empty
string. Pass the property to `DocsSearch`'s `indexUrl` rather than a literal.

`DocsSearch` carries its own `'use client'` boundary, so the layout around it
stays a Server Component. MiniSearch is `import()`ed inside the handler that
first needs it, and the index — 200–500 KB brotli for a real corpus — is fetched
on hover, focus or first open. Never on page load.

## Caching

The response carries `cache-control: public, max-age=0, must-revalidate` and a
strong `ETag`, replacing Next's default for a prerendered route: a year of
`s-maxage` with no validator, which on a URL that never changes is a CDN serving
a stale index until somebody purges it by hand. The `ETag` is strong because
`buildSearchIndex` is byte-stable. `next start` does not honour `If-None-Match`
itself — it answers 200 with the full body; a CDN in front of it does.

If the site sets Next's own `basePath` config, prefix `indexUrl` yourself: Next
applies that to `<Link>` and to navigation, never to a client `fetch()`.

## The dialog's props

`DocsSearch` takes everything `SearchDialog` does except `navigate` and `Link`,
which the Next adapter wires; `docs.Layout`'s `search={{ … }}` takes all of that
except `indexUrl`, which it derives.

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `indexUrl` | `string` | — | Where the index is served. Pass `docs.searchIndexUrl` |
| `pageSize` | `number` | `20` | Results rendered at a time. **Not a cap** — another page loads as the reader nears the end |
| `minQueryLength` | `number` | `2` | Shortest query that runs |
| `debounceMs` | `number` | `120` | Input debounce |
| `className` | `string` | — | Extra classes for the trigger button |
| `triggerLabel` | `string` | `'Search'` | The trigger's text |
| `placeholder` | `string` | `'Search documentation'` | The input's placeholder |
| `dialogLabel` | `string` | `'Search documentation'` | The dialog's accessible name |
| `hintLabel` | `string` | `'Start typing to search the documentation.'` | Before anything is typed |
| `shortQueryLabel` | `string` | `'Keep typing — {min} characters or more.'` | Below `minQueryLength`. `{min}` is that number |
| `loadingLabel` | `string` | `'Loading the search index…'` | While the index is fetched |
| `errorLabel` | `string` | `'Search is unavailable right now. Try reloading the page.'` | When it cannot be |
| `emptyLabel` | `string` | `'No results for “{query}”.'` | No matches. `{query}` is what was typed |
| `resultCountLabels` | `Partial<Record<Intl.LDMLPluralRule, string>>` | `{ one: '{count} result', other: '{count} results' }` | The live region, by plural category |
| `locale` | `string` | `<html lang>`, then `'en'` | Language tag for those plural rules |
| `miniSearchOptions` | `Partial<Options<SearchRecord>>` | — | See [Tuning](#tuning) |

**`pageSize` replaced `maxResults` in 0.4.0**, and the meaning changed with the
name. `maxResults` was a hard ceiling of 8: on a *six-page* site "docs" matches
18, so ten results could not be reached at all, and the live region announced
"8 results" — not a smaller truth but a false one. `pageSize` is a window: every
match is reachable by scrolling, the count announced is the real one, and the
DOM still stays bounded — on a 300-page corpus (2,100 records) a query costs
1.3–3.0 ms while rendering *every* row costs 40 ms.

`resultCountLabels` is keyed by plural category rather than by singular and
plural, because most languages are not English: Polish takes four forms and
Arabic six. `Intl.PluralRules` picks, and an unlisted category falls back to
`other`. The rest of the strings are on
[Translating the chrome](./translating.md).

There is no `hotkey` prop. The shortcut is ⌘K on Apple platforms and Ctrl K
elsewhere, exposed as `aria-keyshortcuts`, and it is not configurable.

## The trail under each result

A result's second line is where the hit lives — `Getting started › Installation`
— and those are the names from your navigation, not the slugs from the URL.

`docs.Layout` builds the lookup from the tree it already has and passes it to
the dialog as `crumbTitles`. **The titles are not in the search index**, which
matters: `search-index.json` is the artifact this package publishes a size for,
and a title on every record would grow it. One entry per directory, out of a
tree the page already carries, costs nothing extra.

A page at the site root has no trail, so it shows the name its navigation entry
carries — `Overview` on this site. That used to be a bare `/`, which was the one
row still speaking in URLs.

Composing the dialog by hand and passing no `crumbTitles` is fine: each segment
falls back to its own slug.

## What gets indexed

**The whole section, not a preview of it.** `extractSearchRecords` once
truncated `text` to 300 characters *before* indexing, which on a normal corpus —
200 pages × 6 sections, around 1,686 characters of prose each — dropped 82% of
the words. `combineWith: 'AND'` compounds that, since every term of a query then
has to land inside the surviving prefix of the same section: a two-word query
against a page that plainly contained both words returned nothing. The cap
bought nothing back either — `storeFields` does not carry `text`, so not one
character of the kept prefix was ever rendered.

Drafts are excluded unless `includeDrafts` is on, and code blocks are skipped:
after Shiki a fence is hundreds of token spans whose text indexes as a bag of
punctuation and keyword fragments, which inflates the index and poisons
relevance. Inline `code` is kept — `useMemo` is exactly the sort of thing
people search for.

Tokenisation uses `Intl.Segmenter` where available, so Chinese, Japanese and
Thai — which do not delimit words with spaces — index and query as words rather
than as whole clauses. Without it, `search('安装')` matched nothing on a page
entirely about 安装. Each segment is then split on everything that is not a
letter, a digit or a combining mark, so `wave.config.json` is three terms.

## Tuning

The shipped defaults: `fields: ['heading', 'text', 'ancestors']`,
`storeFields: ['title', 'heading', 'ancestors', 'href']`, and `searchOptions` of
`prefix: true`, `fuzzy: 0.2`, `combineWith: 'AND'`, `boost: { heading: 3,
text: 2, ancestors: 1 }`. That `combineWith` is not MiniSearch's default and is
not optional: the default OR returned 68–131 hits on real queries where AND
returned a usable handful.

> [!WARNING]
> **Both halves of the seam take the same overrides, and they must agree.** An
> index built with one `tokenize` and queried with another matches nothing at
> all, silently — its terms are ones no query can spell. So the option has one
> name on both sides: `miniSearchOptions`, on the dialog and on
> [`createDocsRoute`](../reference/configuration.md).

Set them once, on the route —
`miniSearchOptions: { searchOptions: { fuzzy: 0.1 } }` on `createDocsRoute`.
`docs.Layout` forwards that same value to the dialog, so a site using the
built-in trigger has one place to configure search.

`fuzzy`, `prefix`, `combineWith` and `boost` are MiniSearch *query* defaults,
so they nest under `searchOptions`; `fields`, `storeFields`, `tokenize` and
`processTerm` sit at the top level. The nesting is misread often, and wrong is
silent — a stray `fuzzy` at the top level is never read. `searchOptions`
merges one level deep, so `{ searchOptions: { fuzzy: 0 } }` keeps `combineWith:
'AND'` rather than reverting it to OR; a `boost` override replaces the map.

### Functions need a client boundary

`tokenize` and `processTerm` are functions, and `docs.Layout` cannot hand a
function to the dialog. The layout is a Server Component and the dialog a Client
Component, so props crossing between them are serialised — React refuses a
function outright and `next build` fails while prerendering, with *"Functions
cannot be passed directly to Client Components"*.

So the layout forwards the serialisable half — `fields`, `storeFields`, `boost`,
and everything under `searchOptions` that is not a callback — and refuses the
rest by name, with `invalid-config`. It does not quietly drop them: an index
built with a `processTerm` the query does not share matches nothing and says
nothing, the exact failure the forwarding exists to prevent.

Function tuning means taking the boundary yourself, so the function is a module
import on both sides rather than a prop between them:

```ts title="lib/search-terms.ts"
export function stripDashes(term: string): string {
  return term.replace(/-/g, '');
}
```

```tsx title="components/docs-search.tsx"
'use client';

import { DocsSearch } from '@waveso/docs/react/next-search';
import { stripDashes } from '@/lib/search-terms';

export function DocsSearchTrigger({ indexUrl }: { indexUrl: string }) {
  return (
    <DocsSearch indexUrl={indexUrl} miniSearchOptions={{ processTerm: stripDashes }} />
  );
}
```

Add the same function to `createDocsRoute` so the index is built with it, then
turn the built-in trigger off with `search={false}` and render yours in the
layout you write around `docs.Layout` — [Layout](./layout.md) has that shape.
That is why the refusal is scoped to the forward: the route keeps the function
for the index it builds on the server, and nothing crosses to the client but a
string. To put your trigger *inside* the sidebar rather than above it, compose
the shell yourself; `docs.Layout` has no slot for it, deliberately.
