---
'@waveso/docs': minor
---

A docs site is now four files and a folder of markdown. Search works out of the box, there is a real shell with a mobile drawer, and the public surface is frozen. Several changes are breaking; those come first.

**The page's content is a `main` landmark.** It was an `<article>`, so the shell rendered a banner, a navigation and a complementary and no `main` at all — a screen-reader user navigating by landmark, which is how you skip a hundred-link sidebar without tabbing, had nothing to jump to. **Breaking in rendered output:** a selector or an assertion targeting `article.wave-docs-layout__main` needs to say `main`.

**`docs.Layout` renders the whole shell**, as one line in your layout file:

```tsx
// app/docs/layout.tsx
import '@waveso/docs/styles.css';
import { docs } from '@/lib/docs';

export default docs.Layout;
```

Skip link, sticky header, sidebar column, mobile drawer and the grid that arranges them. It is a Server Component and your layout stays one — the two pieces that need a client carry their own boundaries inside the package — and it reads the navigation tree and the search index URL itself, so there is nothing to fetch and nothing to pass. It replaces four files every consumer used to write by hand, including a `'use client'` wrapper around `usePathname` that the README shipped as a recipe. Four props: `title`, `actions`, `search`, `children`. `search` takes the dialog's own props as well as a boolean, which is what makes `miniSearchOptions` reachable at all — MiniSearch reads `tokenize` and `processTerm` when indexing *and* when querying, so an index built with one and queried with another matches nothing, and while `search` was a bare boolean there was no channel for it. The route's own `miniSearchOptions` are forwarded by default, so the object that built the index is the object that queries it without anyone having to know that.

**There is a mobile navigation drawer**, which there was not before: on a 390px viewport a reader could previously reach exactly one other page. It is one `<dialog closedby="any">` opened by a server-rendered `<button command="show-modal">`, so it works on the first tap — before hydration, and with JavaScript disabled. Focus moves inside and Tab stays there, Escape closes and restores focus, the backdrop dismisses it, and the page behind does not scroll; all of that is the browser's. At 64rem the same element becomes the sticky sidebar column via `display: contents`, so one navigation serves both breakpoints — one landmark, one copy of the links in the payload.

**`docs.Page` returns two children now**, the `<article>` and the table of contents, rather than one. They land as direct children of the grid, which is what puts them in separate columns. If you wrapped `docs.Page` in an element expecting a single child, that wrapper needs to go. A page with no headings emits no `<aside>` at all rather than an empty one, because the grid reserves that column with `:has()` and would otherwise give 15rem to nothing.

**The pipeline has plugin slots**, which it did not before — it was frozen end to end, and both apparent escape hatches are useless (`frozen.use()` throws; `frozen().use(p)` appends, so a plugin runs after Shiki and sees token spans where the author's code was):

```ts
createDocsRoute({
  contentDir: 'content/docs',
  remarkPlugins: [remarkMath],
  rehypePlugins: [rehypeKatex],
});
```

`remarkPlugins` run before link resolution, so what they emit is folded, contained and asserted exactly like authored markdown. `rehypePlugins` run after heading ids exist and before Shiki, so a fence is still the author's text. **The table of contents is now captured last**, after your plugins and everything else, so it describes the same document the search index does — a plugin that adds or removes a heading changes both together, and there is no validation pass because there is nothing left to validate.

**Every size and speed claim is now measured and budgeted — including the README's own table.** The figures there are ceilings rather than snapshots, and `pnpm size` fails when a measurement passes one, when one promises better than `size-budget.json` enforces, or when a row goes missing. That axis exists because the table had already rotted: it published the sidebar at 1.24 KB against a real 1.67 KB, and a budget raised two commits earlier, under a sentence promising every number was one a build fails over.

 `pnpm size` runs in CI and in `prepublishOnly` across three axes — client bytes per `'use client'` entry, hast-over-the-wire against HTML as a brotli ratio, and highlighting cost against the same corpus unhighlighted. A "What it costs" table sits above the quick start with a budget entry behind every figure. Three numbers in the tree were wrong and are fixed by measuring rather than by picking a side: positions are 33% of the JSON, not the 38% one comment claimed or the 44% the README claimed, and the documented Node floor was 20.19.0 against a real floor of 22.12.0.

**The shell is translatable.** `docs.Layout` takes a `labels` object with the four strings it renders itself — the navigation landmark's name, the drawer's open and close buttons, the skip link — each falling back on its own, so a partial map is not a half-English shell. `DocsNav` had declared `label` and `closeLabel` props, documented them and defaulted them, while the layout that is the only thing rendering it passed neither and `DocsLayoutProps` had no way to say them: configuration that could not be configured.

**The search dialog sizes to its results.** It was 32rem tall in every state — measured 514px with no query, 514px with eight results, 514px with none, of which 392px was an empty results area, so a reader typed into a box floating at the top of a large blank rectangle. A flex container defaults to `align-items: stretch`, so the dialog stretched to the viewport and `max-height` capped it at a constant rather than acting as the ceiling it was written to be. It is content-height now and starts scrolling at the same 32rem.

**Every result row says where it goes, in the same words.** The second line used to be a breadcrumb of page and heading names — except on a page's own record, whose heading *is* its page title, which got no second line at all rather than repeat itself. On a six-page site that is six of twenty-nine records, so the list came out ragged and the barest rows said the least: a row reading only "Wave Docs" told a reader nothing about what it opened.

Every row now shows the page it lands on — the route without its anchor, which is slugged from the heading printed directly above it and so spent the line restating line one. The link keeps the anchor, so a hit still deep-links to its section. One slot, one meaning — the intermediate repair, which gave page rows the route and left the trail on the others, was worse than either: "Styling" under one row was a page and "/docs/styling" under the next was an address. **Breaking:** `.wave-docs-search-result-breadcrumb`, `.wave-docs-search-result-crumb` and `.wave-docs-search-result-crumb-separator` are replaced by a single `.wave-docs-search-result-location`, because a breadcrumb it is not. The words are still what a screen reader hears — a route read aloud is punctuation — so the option's `aria-label` carries "Layout tokens, Styling" while the visible line carries the address.

**A query is at least two characters.** Measured on this package's own documentation: `a` matches 100% of the corpus, `i` 97%, `s` 93%. One character is not a query, it is a reader halfway through typing one, and answering it with everything teaches them that search returns noise. Below the floor nothing runs and the dialog says "Keep typing — 2 characters or more" rather than looking broken.

Two rather than three, and the difference matters on a docs site: three would refuse `ts`, `js`, `id`, `h1` and `px`, each of them a real query here and each selective — 10%, 17%, 14%, 3%, 0%. The noise is at one character, so that is where the floor goes. `minQueryLength` moves it.

**There is no result cap any more.** `maxResults` was a hard ceiling of 8: on a *six-page* site "docs" matches 18, so ten results simply could not be reached, and the live region announced "8 results" — not a smaller truth but a false one.

The ceiling was justified by a claim nobody had measured, and measuring it did not support the claim. On a 300-page corpus (2,100 records) a MiniSearch query costs **1.3–3.0 ms**, and rendering *every* matching row costs **40 ms**, 128 ms at 4× CPU throttle. The search was never the problem, and the DOM only becomes one in the thousands.

So the list pages instead. **`maxResults` is replaced by `pageSize`** (default 20): twenty rows render, and another twenty each time the reader scrolls near the end — the DOM stays bounded and nothing is withheld. The keyboard widens the window too, or `aria-activedescendant` would point at an option that is not in the DOM. `aria-setsize` carries the real total on every option, because a listbox rendering 20 of 2,100 that says "20 of 20" tells a reader they have reached the end when they have not.

**Two rendering defects that only a screenshot could find.** A code frame's title bar drops its bottom border to join the code below it, and a `<pre>`'s user-agent margin then pushed the two 14px apart — a caption hovering over a gap, and a copy button mis-seated on untitled fences. And the shell painted its own containers but not the grid between them, so in dark mode the sidebar and the table of contents rendered as lighter panels floating on a darker page; light mode hid it because both were white. Both are fixed, both are now pinned by browser tests, and the README carries screenshots taken from a real build so the next one is visible in review.

**Smaller repairs a reader would notice.** The video facade asks the player to start, so watching a video is one click rather than two — it is still not an autoplaying embed, because the iframe does not exist until the `<details>` opens. A failed copy now *looks* failed: `data-copied="false"` was written from the beginning and had no rule in the stylesheet, so a screen-reader user was told and a sighted user watched a button do nothing, on the ordinary path of `next dev` opened from a phone over http. The table's horizontal-scroll shadow was hardcoded black and therefore invisible in dark mode. An excluded fence had no `tabindex`, making it the one code block on a page a keyboard could not scroll sideways.

**The sidebar scrolls the current page into view** — properly. The first version measured the item with `offsetTop - port.offsetTop`, and the navigation column is `position: sticky`, which makes it the `offsetParent`: the offset was already relative to it, so the subtraction removed the header height twice and parked the current page below the fold. Measured in Chromium and fixed with rectangles, and a browser test now asserts the item is inside the visible box rather than that something scrolled. A back-to-top link ends the table of contents. Both move focus rather than only the viewport, and neither uses `scrollIntoView` — which scrolls every scrollable ancestor including the document, so it would jump the article a reader just navigated to. External links in the navigation carry a small icon.

**Errors are branchable, at `@waveso/docs/errors`.** Every failure already carried a `code` from a 19-member union, and the module documenting that taxonomy also declared itself private — so there was no supported way to use it, and nothing in the README mentioned it. `DocsErrorCode`, `DocsError` and `isDocsError` are exported now, with a troubleshooting table carrying one row per code, and a test that keeps the union, the table and the call sites in step.

**The YouTube embed ships no JavaScript, and the default component map is now provably server-only.** It was a `'use client'` component mapped unconditionally, so every page of every consumer carried a reference to it whether or not it embedded a video. It is a `<details>` with a lazy iframe now — measured: a closed one issues no request, an open one does — which keeps the click-to-load facade, gains native keyboard support, and removes the hydration root. `src/server-boundary.test.ts` fails the build if anything reachable from the markdown map ever carries the directive again. **Breaking in rendered output:** the facade is a `<details>`/`<summary>` rather than a `<button>`, so styles or assertions targeting the button change with it. The open state hides that summary, which cost the keyboard reader their focus indicator entirely — it comes back on `:focus-visible` as a real control, and its label reads "Hide video" once activating it would hide the video.

**Sidebar links near the reader prefetch now.** Every link carried `prefetch={false}`, on Pages-Router reasoning that does not hold in the App Router — there it disables the hover and touch paths as well as the viewport one, so the most-clicked control in a docs site made every navigation a cold round-trip. The list holding the current page and the heading of the group around it are warm; the rest of the tree stays off.

**The table of contents stops at `h3`.** Measured on a synthetic API reference — 8 methods, 3 overloads, 3 subsections each — capturing h2–h6 gave 104 entries against 32. Deeper headings keep their ids and permalinks, so they are still deep-linkable and still open their own sections in search; only the rail entry is dropped. If you want them back, `rehypePlugins` is the escape hatch. **`RenderedDoc.toc` therefore contains less data than before** — if you render it yourself and relied on h4+, that is the change.

**`gray-matter` is gone**, replaced by `vfile-matter`. It did a bare `require('fs')` for a method this package never calls — the only gratuitous Node requirement in the whole tree — dragged a second copy of js-yaml, and memoised every file body it ever saw in a cache that is never evicted. Frontmatter parsing is unchanged in behaviour, including the UTF-8 BOM, which this package now strips itself.

**Runtime requirements are documented and asserted.** `render`, `frontmatter`, `highlighter`, `search-index` and the React layer require **no Node builtins at all** — the markdown pipeline runs wherever JavaScript does, and Shiki is loaded through its JavaScript regex engine rather than WASM deliberately. `source` needs `node:fs/promises` and `node:path`; `next` adds `node:crypto`. Every one of those is asserted as an exact set, so a new builtin three modules deep fails CI instead of silently ruling out a runtime.

**Code blocks have a frame, a title bar and a copy button**, which they did not before — a live render was a bare `<pre>` with no wrapper and no control of any kind:

````md
```ts title="app/page.tsx"
export default function Page() {}
```
````

The title becomes the caption, the button's accessible name (`Copy code from app/page.tsx`, not eight controls called "Copy code"), and a search hit. Anything else in the meta string passes through to Shiki untouched, so `{1,3-5}` keeps working when transformers land; a `title=` without double quotes now fails the build naming the document, rather than silently truncating at the first space. Copy is **one delegated listener for the page**, mounted by `DocContent` and only when the page has a fence — not a client component per code block — and the button is `visibility: hidden` until that listener attaches, so a reader with JavaScript off sees no button and finds no dead tab stop.

**`excludeLangs` stops shipping as half a feature.** An excluded fence had no background, border, padding or horizontal scroll anywhere in the stylesheet, so it rendered as UA-default text bleeding out of the reading column. It now gets the same surface as a highlighted block, is deliberately left unframed, and the README carries the Mermaid recipe — including the trap that its `<code>` className is an array where Shiki's is a string.

**`DocContent` now carries `wave-docs-prose` itself.** Nearly every rule in the stylesheet is scoped under that class, and the hand-rolled route in the README made you type it; forgetting it left a page whose code blocks kept their syntax colours and lost everything else. If you were putting the class on your own `<article>`, drop it — it is emitted once, by the component.

**Search is on by default, and the quick start includes its route.** `docs.Layout` renders the trigger, so leaving the route file out gave a reader a control that opened onto "Search is unavailable" — a broken box on the flagship path, under a release note promising search out of the box. The route is one of the three files in the quick start now, and a 404 on the index no longer reads as a transient failure: it names the file to create.

**Search is two files now, and neither is a build script.** The index is a prerendered route handler on the object you already hold, so it is rebuilt by the same `next build` that builds your pages — and in `next dev` it re-reads the disk per request, so a page you add is searchable on the next keystroke instead of at the next time you remember to run a script:

```ts
// app/docs/search-index.json/route.ts — the whole file
import { docs } from '@/lib/docs';

export const GET = docs.searchIndex;
export const dynamic = 'force-static';
```

`docs.searchIndexUrl` is derived from your `basePath`, so it is right at `/`, at `/docs`, and under a nested prefix. **`writeSearchIndex` is removed** — it was the only documented way to build an index, and this replaces it; `buildSearchIndex` and `renderAll()` remain for an artifact the route cannot express, and `docs.searchIndex` is asserted byte-identical to them. Verified against a real `next build`: the body prerenders in both output modes and is byte-identical between them, response headers survive into the prerender manifest, and CI now runs that build on every pull request.

**`export const dynamic = 'force-static'` is not optional, and the handler enforces it.** Without it Next re-renders your entire corpus per request, from markdown that output tracing did not put in the deployment bundle — on a serverless host that throws, at the reader, inside the search dialog, and the build prints no warning. It now fails loudly with `code: 'search-index-dynamic'`, naming the file to edit.

**`DocsSearch`, at `@waveso/docs/react/next-search`**, is the `'use client'` wrapper around `useRouter()` and `next/link` that every consumer was writing by hand — and skipping `Link` silently cost hover prefetching on every result. `SearchDialog` is unchanged and still host-agnostic.

**`SearchDialog`'s `searchOptions` prop is now `miniSearchOptions`**, and `createDocsRoute` takes the same name for the same object. MiniSearch's own name for the query defaults is `searchOptions`, so the old prop produced `searchOptions={{ searchOptions: { fuzzy: 0.1 } }}` — a stutter nobody writes, which is why both README examples were written flat, did not compile, and would not have errored at runtime either.

**Your project is no longer traced into your server bundle.** `contentDir` is a string this package cannot resolve statically, so Turbopack fell back to tracing the whole project — every source file, your entire `public/` folder, your last build's output — into the server output for every docs route. Measured at 332 traced files for a three-page site, of which 39 were the project's own. Nothing here reads markdown at request time, so nothing needs tracing, and now nothing is.

**Six names are gone**, all pre-1.0. Three are subpaths: the `./react/*` wildcard is enumerated as explicit subpaths, and `./markdown-links` and `./search-options` are no longer exported. Three are options and exports that changed shape, and each needs an edit rather than a rename:

| Gone | What to do |
| --- | --- |
| `createDocsRoute({ contentId })` | Nothing. The main element always carries `id="docs-content"`, which is what `SkipLink` targets by default. The option could point the skip link at nothing, silently, because `SkipLink` had no matching option to follow it with |
| `createDocsRoute({ rescanPerRequest })` · `createDocsSitemap({ rescanPerRequest })` | Nothing, if you left it at its default: the content directory is re-scanned per request outside `NODE_ENV=production`, exactly as before. **If you set it to `false`, delete it and measure** — you will now pay a scan per non-production request, and `docs.source.invalidate()` is the explicit tool |
| `toAliasRoute` from `@waveso/docs/source` | Private. It is one line of string handling and was never documented |

Every subpath in `exports` is listed in the README, and so is every runtime name each one exports — `manifest.test.ts` enumerates both against the built output and fails the build on a name this README does not mention. That test is new in this release, and writing it immediately found five: `DOCS_ERROR_PREFIX`, `DEFAULT_DOCS_THEMES`, `CALLOUT_TYPES`, `defaultMarkdownComponents` and `DOCS_CONTENT_ID` were all public and documented nowhere.

**The default page is worth looking at.** A 46rem measure and a system font stack, a 1.2 minor-third type scale, tables that scroll instead of shredding the layout, one focus `outline` in place of five `box-shadow` rings (which also deletes the forced-colors block that existed to patch them), and a responsive shell with breakpoints at 64/80/100rem. The element tree, the five layout tokens and the breakpoints are frozen in `docs/adr/001-shell-contract.md`.

**Three new harnesses, because the old ones could not see these failures.** A browser tier running real Chromium — jsdom reports every width as `0`, so the measure, the type scale, reflow and the table floor were unassertable. A smoke build of a real Next application against the published `exports` map, in both output modes. And `pnpm check:readme`, which type-checks every example in this README as one project: it immediately found `app/docs/layout.tsx` defined twice with different bodies, and an `imageResolver` example calling `imageSize(path)` when `image-size` v2 takes a `Uint8Array`.
