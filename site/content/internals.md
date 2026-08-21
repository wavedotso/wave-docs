---
title: Internals
description: The decisions that are hard to reverse, and why they went that way.
---

Notes for anyone reading the source, or deciding whether to depend on it.

## Why not MDX

**MDX is not markdown; it is a JavaScript module that looks like markdown.** That
buys arbitrary components in prose, and costs the thing this package exists to
protect: the output is code, so it must be compiled and bundled per page, it
cannot be cached as JSON, it cannot cross the RSC boundary as data, and a
non-engineer can no longer safely edit a page. An author can also break the build
with a stray `<`.

Here the extension points are the `components` map and the `callout` element —
[Plugins](./guides/plugins.md) and [Components](./reference/components.md) cover
both. More component freedom in prose than that allows is a requirement for MDX.
Use it, and accept the bundle.

## Why not react-markdown

**`react-markdown` parses in the browser.** `unified` + `remark-parse` +
`remark-gfm` is roughly 60 KB gzipped shipped to every reader, plus Shiki if you
want highlighting, to do work that could have happened once at build time.

**It also hardcodes `passNode: true`, with no opt-out.** Any component you map
that spreads its props then renders `node="[object Object]"` into production
HTML — with no type error, because `node` is a legal prop on the component and an
unknown attribute on the element. `DocContent` leaves `passNode` off, and a test
asserts the output contains neither `node=` nor `object Object`.

## Why stop at hast rather than an HTML string

**An HTML string is a dead end.** It renders only through
`dangerouslySetInnerHTML`, which forfeits component mapping, makes every element
unstyleable except through descendant selectors, and puts the burden of trusting
the content on you.

**A hast tree is data.** It survives `JSON.stringify`, crosses the RSC boundary,
caches to disk, and renders through `hast-util-to-jsx-runtime` with your
components substituted for whichever elements you care about. The cost is
payload, so positions are stripped before it ships — line and column offsets into
a markdown file the browser does not have and cannot fetch. That is roughly a
third of the JSON: measured at 33% on a mixed page, higher on short ones, where
the offsets are a larger share of a smaller tree. Two figures in this repository
disagreed about it — 38% in a comment, 44% in the README — until somebody
measured.

## Two page files, not `[[...slug]]`

An optional catch-all matches `/docs` as well as `/docs/anything`, which looks
like it saves a file. It leaves `/docs/index` live and serving byte-identical
HTML with no canonical between them — the duplicate-content problem, shipped by
default and invisible until a search console mentions it. It also makes
`params.slug` possibly `undefined` for every page, which is a narrowing check in
a route file that can never actually be hit. `[...slug]` does not match the
index, so the index gets its own `page.tsx` and `docs.IndexPage`. See
the [quick start](./getting-started/quick-start.md).

## The search index is a route

Not a build script. `docs.searchIndex` is a route handler, so the index is
built by the same `next build` that builds the pages.
[Search](./guides/search.md) has the route file, the `force-static` line it
must carry, and the throw when it is missing.

**The throw is deliberate.** A `console.error` was the alternative and is not
one: a warning in a serverless log is unread, and the symptom — a search
dialog stuck on "could not load the index" — arrives days later with nothing
connecting it to a missing line in a route file.

## The search dialog navigates through a closure

`DocsSearch` hands the dialog `(href) => router.push(href)` rather than
`router.push`. In Next 16.3.0 `push` is an arrow function on a module-level
singleton, so the bare reference is safe today — but that is an implementation
detail of an optional peer, and the day it becomes a method shorthand, `this` is
`undefined` and selecting a result throws inside the dialog.

Every component here takes data as props for the same reason, and the two
modules that cannot are named for the hook they import —
[Components](./reference/components.md) maps all of them.

## The content directory is re-scanned per request outside production

Markdown files are not in Next's module graph, so nothing recompiles a route
module when one changes. `createDocsRoute` re-scans on every request outside
`NODE_ENV=production`: edits appear on reload, new files are found without a
restart, and the sidebar from `docs.source.nav()` agrees with the page body on
the *same* request. It was an option; nobody should have turned it off, and
`docs.source.invalidate()` is the escape hatch for anyone who must.

**The rescan is shared.** Next runs `generateMetadata` and the page concurrently,
and a layout calling `nav()` is a third reader; each used to invalidate
independently, so each discarded the others' scan in flight. Invalidation is
wrapped in `React.cache`, so the first caller re-reads the disk and the rest see
that scan — measured at 22 `readdir` + 824 `readFile` per request on a 401-file
tree, against 11 + 412 and 39 ms for one scan. Outside a request — a sitemap
built from `next.config.ts`, a script — `cache` does not memoise at all, so those
callers keep invalidating every time, which is what they want.

**The scan caches the promise, not the resolved value.** Next prerenders
concurrently, so a value cache lets every caller race past the null check before
the first `await` resolves: 29 full filesystem scans for a 44-page build, against
3, one per worker.

**Filesystem calls are bounded at 64 in flight, process-wide.** The scan used to
open every markdown file at once — on a 1,201-page corpus and the common
1,024-descriptor soft limit, `next build` died with a bare `EMFILE: too many
open files`, no error code and no mention that this was the docs scan.

**64 is chosen against the tightest default soft limit, not for speed**, because
above it there is no speed left to buy. Medians of nine runs over those 1,201
pages in 49 directories:

| Bound | Median |
| --- | --- |
| ungated | 88 ms |
| 16 | 106 ms |
| 64 | 102 ms |
| 128 | 101 ms |
| 256 | 101 ms |

Flat from 64 upwards, which says the ~14 ms is the gate's own per-call overhead
rather than the reduced parallelism — libuv's filesystem pool is four threads by
default, so there was never 1,201-way parallelism to lose.
[`descriptor-limit`](./reference/errors.md) says what to raise when a process
cannot spare 64.

## The mobile drawer is a `<dialog>`

One `<dialog closedby="any">` opened by a server-rendered
`<button command="show-modal">`, so it works on the first tap — before
hydration, and with JavaScript disabled. Focus moves inside and Tab never
escapes, Escape closes and restores focus to the trigger, the backdrop paints
and light-dismisses — that is `closedby="any"` — and the rest of the page
is inert. All of that is the browser's, and it is why this is not
`popover="auto"` or a `<details>`.

At 64rem the same element becomes the sticky sidebar column via
`display: contents`, which removes the dialog box from layout *and* from the
accessibility tree. One navigation serves both breakpoints: one landmark, one
copy of the links in the payload, nothing to keep in step. The client component
adds only what native does not give — closing on navigation, since a link click
inside routes without a document load, and `command` on a browser older than
its December 2025 Baseline, where the fallback is eight lines installed only
where it is missing. [Layout](./guides/layout.md) has the `id` binding and
the `:not(:modal)` scope.

## The copy button is not a component

About nine hundred bytes of delegated listener, not a client component per code
block. It sits behind a module-level ref count, so two `DocContent`s on a page
copy once and announce once. [Code blocks](./guides/code-blocks.md) has the
mechanics.

## The video facade ships no JavaScript

An eager `<iframe>` costs ~137 KB of embed document plus ~580 KB gzipped of
player JavaScript per page view, pressed or not — ~717 KB against one ~15 KB
JPEG.

**A `<details>`, not a `useState`.** An `<iframe loading="lazy">` inside a
closed `<details>` issues no request at all and issues one the moment it
opens, so the facade defers the player with no state hook and no hydration
root. That is measured in Chromium rather than assumed.

This was a `'use client'` component, which made it the one entry in
`defaultMarkdownComponents` that crossed the client boundary, so its chunk was
referenced from the prerendered HTML and the flight payload of *every* page, on a
corpus containing no YouTube URL anywhere. The tempting number is the wrong one:
total client JavaScript went 610.8 KB to 609.2 KB raw. The win is a hydration
root removed from the path every consumer renders, not bytes.

## Nothing is `scrollIntoView`

`element.scrollIntoView({ block: 'nearest' })` reads as exactly the right call
and scrolls **every** scrollable ancestor, the document included. On a docs page
that means opening a deep link scrolls the sidebar *and* jumps the article the
reader came to read — on the one navigation where they know precisely what they
asked for. The sidebar finds its own scrollport and assigns `scrollTop`, and the
geometry lives in a pure module, because jsdom reports every rectangle as zero
and a test driving the effect would assert nothing. A test spies on
`scrollIntoView` and asserts it is never called.

## This site is the harness

Twenty markdown pages in three sections, four `meta.json` files, and the five
files the quick start prints — `[...slug]/page.tsx`, `page.tsx`,
`search-index.json/route.ts`, `layout.tsx` and `lib/docs.ts` — mounted at
`basePath: '/'` and built with `output: 'export'`, the mode where a route
that quietly went dynamic fails the build instead of costing money on a
serverless host.

It ships **no stylesheet at all**, and `site-budget.test.ts` fails the build if
one appears, or if a route file declares a layout property inline. Not "no layout
rules in the site's CSS" but "no site CSS": a file that exists is a file someone
adds a `max-width` to at 2am, and the reviewer sees one line rather than the
contract it breaks. The same test asserts that nothing sits between
[`docs.Layout`](./guides/layout.md) and `{children}`, that every page is ordered
by hand in a `meta.json`, that no link is absolute and every internal one is
written as a relative `.md` path, and that no relative image appears — one
would throw without an `imageResolver`. A floor guards the guards: under
fifteen pages, or none of them nested, and the harness is a fixture rather
than a documentation site.

**A page that needs a rule the package does not provide is a defect in the
package rather than something to patch locally.** What the site *may* do is
look like itself — colour, type and background are a host's business, as
[Theming](./guides/theming.md) covers. Placing a box is not.
