<div align="center">

# @waveso/docs

<p><strong>Markdown documentation for Next.js.<br />Parsed in Node at build time, so the parser never reaches the browser.</strong></p>

[![npm](https://img.shields.io/npm/v/@waveso/docs)](https://www.npmjs.com/package/@waveso/docs)
[![license](https://img.shields.io/npm/l/@waveso/docs)](./LICENSE)
![React 19](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)
![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)

</div>

<br />

<p align="center">
  <strong><a href="https://docs.wave.so">docs.wave.so</a></strong> — the documentation for this package, built with this package.
</p>

<p align="center"><em>Every page you see there is markdown in <code>site/content/</code>, rendered by <code>docs.Layout</code> with no layout CSS of its own. It is the acceptance harness and the showcase, and it is the same build CI runs on every commit — so it cannot drift from what this README claims.</em></p>

---

## Why Wave Docs

Point it at a folder of `.md` files and you get a documentation site: routing, navigation, a table of contents, syntax highlighting, search and redirects.

The design decision everything else follows from: **markdown becomes [hast](https://github.com/syntax-tree/hast) in Node, at build time.** A hast tree is plain serialisable JSON, so Next renders it inside a Server Component and the browser receives a tree of nodes and a component map — never `unified`, never `remark-parse`, never Shiki.

```
content/*.md ──▶ source ──▶ render ──▶ { hast, toc, frontmatter }
                 (Node)     (Node)              │
                                          RSC payload
                                                │
                                        <DocContent hast={…} />
```

Three things follow from that shape, and they are the reasons to choose this over the alternatives.

**Nothing is stringified to HTML.** The pipeline stops at hast, so the output stays *data*. You map `h2`, `a`, `img`, `pre` and `callout` onto your own components, and nothing is ever handed to `dangerouslySetInnerHTML`.

**Table-of-contents anchors cannot drift.** Heading ids are read off the same pass that annotated the document, rather than recomputed by a second parse. Two sections called "Install" get `#install` and `#install-1`, and the TOC links match — by construction, not by coincidence.

**Broken internal links fail the build.** `[auth](./api/auth.md)` is the right way to link between markdown files: it resolves on GitHub and in every editor preview, and it 404s once published. Those links are rewritten to routes and their targets checked, so the failure lands in CI instead of in production.

## Installation

```sh
pnpm add @waveso/docs
```

That is the whole installation. `react` and `react-dom` are required peers; `next` is optional, needed only by `@waveso/docs/next`.

**Zod is not a peer.** It ships as a dependency of this package, so your project's Zod — version 3, version 4, or none at all — is irrelevant and nothing conflicts. When you extend the built-in schema, take `z` from here rather than from your own install:

```ts
import { docFrontmatterSchema, z } from '@waveso/docs/frontmatter';
```

That is not a style preference. `.extend()` produces a schema only as trustworthy as the instance that built it, and re-exporting ours means the extension is built from the same module object by construction rather than by luck. Your own Zod stays yours, for everything else in your app.

**There is no `tailwindcss` peer and no Tailwind involved.** The stylesheet is plain CSS with `wave-docs-*` class names. It was declared as an optional peer once, which blocked `npm install` outright for any project on Tailwind 3 — npm still range-checks an optional peer that happens to be installed.

There is no `image-size` peer either. An `imageResolver` you write is welcome to read dimensions with it — but it is your dependency, in your own `package.json`. Declaring it here installed nothing and did not make `await import('image-size')` resolve for you; it only looked like it helped.

## What it costs

Every figure below is a **ceiling**, and `pnpm size` fails the build if the measurement passes it — in CI and again in `prepublishOnly`. So these are numbers this package is held to, not numbers somebody remembered to update.

| | At most |
| --- | --- |
| Everything the quick start ships, gzipped | 14.9 KB |
| Search dialog and router wiring | 9.9 KB |
| Navigation: one sidebar, open and closed | 3.1 KB |
| Table of contents | 1 KB |
| Copy-button runtime | 1.1 KB |
| hast over the wire vs HTML, prose page | 1.20× |
| hast over the wire vs HTML, code and tables | 1.12× |
| Highlighting vs no highlighting | 2.00× |

The first row is the honest total: a reader who lands on a page of your documentation downloads under 14.9 KB gzipped of JavaScript from this package, and that is the whole of it. No markdown parser and no syntax highlighter reach the browser at all — those run in Node at build time. Drop the search dialog and it is under 4 KB.

The one real cost is the middle pair: shipping a tree instead of a string is about 20% more brotli on a prose page, and about 12% on a page with code and tables, where Shiki's token spans dominate both representations equally. That is the price of never handing markup to `dangerouslySetInnerHTML`, and it is the first number a skeptical reviewer should ask for.

`size-budget.json` holds a second, looser ceiling per entry with a note explaining what to do when it is hit — and a build fails if the table above ever promises worse than that file enforces.

## Quick start

```bash
npx @waveso/docs init
```

That writes every file below into an existing Next application — the config, the layout, both page files, and the two route handlers. It never overwrites: anything already there is reported and left alone, so running it twice is safe and running it in a project that already has a `layout.tsx` cannot destroy one.

```
--app-dir <dir>       where the App Router lives            (app)
--config <file>       where createDocsRoute goes            (lib/docs.ts)
--content-dir <dir>   where your markdown lives             (content/docs)
--base-path <path>    where the docs are mounted            (/docs)
--site-url <url>      your origin, for canonicals and links
--llms-index          also write llms.txt, the agent index
```

Then put markdown in `content/docs/` and fill in `llms.title` and `siteUrl`.

**Why a scaffold at all, when it is six small files?** Because three of them fail *silently* when they are slightly wrong: a `dynamicParams` that is not a literal `false` builds green and then renders unlisted URLs on demand; a route handler missing `export const dynamic = 'force-static'` re-renders your whole corpus per request from markdown that is not in the deployment bundle; and an index page nobody created leaves the mount itself a 404. The file count is Next's floor — a route is a folder in *your* `app/`, and no package can add one — but the typing is not.

The rest of this section is what it writes, and why.

**Three route files, and each one earns its place.** `[...slug]` does not match `/docs` itself, so the index needs its own `page.tsx` — an optional catch-all (`[[...slug]]`) does match, but leaves `/docs/index` live and serving byte-identical HTML with no canonical between them. The third serves the search index, which the layout's search trigger reads.

Create the route once, in a module every route file imports:

```ts
// lib/docs.ts
import { createDocsRoute } from '@waveso/docs/next';

export const docs = createDocsRoute({ contentDir: 'content/docs' });
```

```tsx
// app/docs/[...slug]/page.tsx
import { docs } from '@/lib/docs';

export default docs.Page;
export const generateStaticParams = docs.generateStaticParams;
export const generateMetadata = docs.generateMetadata;
export const dynamicParams = false;
```

```tsx
// app/docs/page.tsx
import { docs } from '@/lib/docs';

export default docs.IndexPage;
export const generateMetadata = docs.generateMetadata;
```

```tsx
// app/docs/layout.tsx
import '@waveso/docs/styles.css';
import { docs } from '@/lib/docs';

export default docs.Layout;
```

```ts
// app/docs/search-index.json/route.ts
import { docs } from '@/lib/docs';

export const GET = docs.searchIndex;
export const dynamic = 'force-static';
```

```
content/docs/
  index.md
  getting-started.md
  api/
    meta.json
    authentication.md
```

That is a working documentation site: routing, a navigation sidebar that opens and closes, a table of contents, syntax highlighting, search and a skip link.

The search route is in the quick start rather than in a section further down because `docs.Layout` renders the search trigger by default — leave the route out and a reader gets a control that opens onto "Search is unavailable". If you genuinely do not want search, `export default function Layout(props) { return docs.Layout({ ...props, search: false }) }` drops both the trigger and this file. See [Search](#search) for tuning.

> [!IMPORTANT]
> `dynamicParams` must be written out as `false`. Route segment config is parsed statically before the module runs, so `export const dynamicParams = docs.dynamicParams` fails `next build`. Without it, Next invokes the route on a server at request time for every unlisted URL, to produce a 404 that was already knowable at build time — and `output: 'export'` refuses to build at all.

## Entry points

There is no root export. Every entry point is a subpath, so an import always names the file it came from.

| Subpath | Environment | Contents |
| --- | --- | --- |
| `@waveso/docs/next` | Node | `createDocsRoute`, `createDocsSitemap`, `createDocsRedirects` |
| `@waveso/docs/source` | Node | `createDocsSource`, `resolveDocsConfig` |
| `@waveso/docs/render` | Node | `createDocsRenderer`, `resolveMarkdownLink` |
| `@waveso/docs/highlighter` | Node | `createDocsHighlighter`, `DEFAULT_DOCS_LANGS`, `DEFAULT_DOCS_THEMES` |
| `@waveso/docs/search-index` | Node | `extractSearchRecords`, `buildSearchIndex` |
| `@waveso/docs/react/<name>` | Browser + RSC | Ten subpaths, one component each — see [Components](#components) |
| `@waveso/docs/frontmatter` | Any | `docFrontmatterSchema`, `parseFrontmatter`, `z` |
| `@waveso/docs/types` | Any | Every shared type. Type-only |
| `@waveso/docs/errors` | Any | `DocsErrorCode`, `DocsError`, `isDocsError`, `DOCS_ERROR_PREFIX` |
| `@waveso/docs/styles.css` | — | The stylesheet |

The Node-only subpaths carry `"browser": null`, so importing one from client code fails with a located *module not found* rather than resolving.

That is about **weight, not about `node:fs`** — and the distinction matters, because three of the five would bundle perfectly happily. `render`, `highlighter` and `search-index` require no Node builtins at all; the markdown pipeline runs wherever JavaScript does, and Shiki is loaded through its JavaScript regex engine rather than WASM on purpose. What a bundler would do with them is succeed, and ship `unified`, `remark-parse` and every Shiki grammar to a reader — the exact outcome this package exists to prevent, arriving with no error to notice. Only `source` and `next` genuinely need the filesystem.

`entry-runtime.test.ts` asserts each set exactly, so a new builtin three modules deep fails the build instead of silently ruling out a non-Node runtime.

### Layout tokens

Five custom properties size the shell, all layered so an unlayered `:root` of your own still wins. All six are public API: a name changes only in a release that carries the migration.

| Token | Default | Controls |
| --- | --- | --- |
| `--wave-docs-measure` | `46rem` | Prose column width. `none` opts out |
| `--wave-docs-sidebar-width` | `16rem` | The navigation's width |
| `--wave-docs-trigger-width` | `1.25rem` | The trigger's button. The strip around it is this plus 4px a side |
| `--wave-docs-toc-width` | `15rem` | Table-of-contents track |
| `--wave-docs-chrome-offset` | `0rem` | Where our sticky chrome starts, below a bar of yours |

**`--wave-docs-shell-width` was removed in 0.7.0, and it is the sidebar's edge that replaced it.** It capped the whole shell and centred it, which put the sidebar's inline start 480px in from the screen on a 2560px display — and, worse, left a *closed* navigation parked in the centring margin instead of off the page. The reading column is the thing that should not stretch, so `--wave-docs-measure` caps it and it centres itself in its track; the sidebar keeps the page's inline start edge at every width, which is what makes "closed" mean off the screen by construction.

**`--wave-docs-header-height` is gone in 0.7.0, and renaming it to one thing would have lost the other.** It sized the header *and* it was the offset both sticky columns parked below. The header is gone, and so is every shape that sat above the content, so the sizing half has nothing left to size. The offset half is the one that matters and it is `--wave-docs-chrome-offset`: `--wave-docs-chrome-offset: 4rem` starts our sidebar and our table of contents 4rem down, and feeds the scroll padding that keeps an anchored heading clear of your bar.

The default is `0rem` rather than `0`, and the unit is load-bearing: it is read inside `calc(100dvh - …)` on both sticky columns, and `calc(100dvh - 0)` is invalid at computed-value time — a unitless zero kills the `max-height` instead of resolving to no change.

The shell has three breakpoints, in `rem` so they scale with the reader's base font size: the sidebar appears at **64rem**, the table of contents at **80rem**, and the whole grid stops growing at **100rem**. 64rem is arithmetic rather than taste — a 16rem sidebar plus a 46rem measure plus two 1.5rem gutters is 65rem, so anything narrower introduces the sidebar exactly where it starts eating the measure it frames.

Set `--wave-docs-font-sans: inherit` to hand the whole package your own typeface.

Every subpath is enumerated in `exports` — there is no wildcard. A name that is not documented here is not importable, and that is a guarantee rather than an intention: `manifest.test.ts` enumerates the runtime exports of every built subpath and fails the build on one this README does not mention.

## Components

Every component takes data as props, and every module that imports from `next/*` is named for it — `next-nav` for `usePathname`, `next-search` for `useRouter`, `next-link` for `next/link` itself — so the exception is visible in the file list rather than three imports deep. Everything else has `next/link` and `next/image` injected. That keeps the renderer host-agnostic and testable without a router. `DocsSearch` is the one exception, and it exists precisely so that the exception is ours rather than yours: it is the fifteen-line wrapper you would otherwise write around `SearchDialog`.

| Component | Subpath | Notes |
| --- | --- | --- |
| `DocContent` | `react/doc-content` | Renders a hast tree, inside `.wave-docs-prose`. Server Component |
| `DocsHero` | `react/hero` | A landing page's header. `title`, `description`, `actions`, `Link`, `externalLabel`. Server Component |
| `DocsSidebar` | `react/sidebar` | Takes `pathname` as a prop, not from `next/navigation`. `icons` controls the marker column — see [Sidebar icons](#sidebar-icons) |
| `DocsExplore` | `react/explore` | "Where to go next": a question per row and the page that answers it. `docs.Page` renders it when a page declares `explore` |
| `DocsPager` | `react/pager` | Links to the pages either side of this one. `docs.Page` renders it; `pager: false` on the route omits it |
| `DocsToc` | `react/toc` | Scrollspy via `IntersectionObserver`. `label`, `topLabel`, `rootMargin`, `className` |
| `DocsSearch` | `react/next-search` | `SearchDialog`, wired to Next's router. What you want |
| `DocsLink` | `react/next-link` | `next/link`, adapted — pass it as `Link` when composing by hand |
| `SearchDialog` | `react/search-dialog` | ⌘K, arrow keys, focus trap. Host-agnostic |
| `Callout` | `react/callout` | Note · tip · important · warning · caution. `CALLOUT_TYPES` is the list |
| `YouTube` | `react/youtube` | Click-to-load facade. `title`, `playLabel`, `hideLabel` — `{title}` interpolates the first |
| `SkipLink` | `react/skip-link` | Targets `docs.Page`'s `<main>`; `DOCS_CONTENT_ID` is that id. `docs.Layout` renders one |
| `createMarkdownComponents` | `react/markdown-components` | The element → component map. `defaultMarkdownComponents` is the unwired one |

`DocsToc`'s `rootMargin` is the `IntersectionObserver` margin that decides how far above the viewport a heading counts as current; the default keeps the highlight on the section you are reading rather than the one about to arrive. `topLabel` is the back-to-top link at the end — it fades in once the reader is about a third of a screen down and fades out again on the way back, on a scroll timeline rather than a scroll listener, so the component ships no extra bytes to do it. Where that timeline cannot run — an engine without scroll-driven animations, a page too short to scroll, or a host that scrolls an inner pane rather than the document — the link is simply always there.

### Where to go next

A sidebar is a structure; this is a router. It says *why* a reader would go somewhere, which no tree of titles can. A page opts in from its frontmatter:

```yaml
---
title: How it fits together
explore:
  - question: How a person is recognised across servers
    href: ./identity.md
  - question: What happens when the network fails
    href: ./delivery.md
  - question: Where the source lives
    href: https://github.com/example/repo
    title: GitHub
---
```

| Field | Type | What it is |
| --- | --- | --- |
| `question` | `string` | What the reader might want to know. The row's left half |
| `href` | `string` | Where the answer is. Checked against the same allowlist as every other link |
| `title` | `string` | The link's text. Defaults to the destination's title **in the navigation** |

**The link text comes from the navigation**, so renaming a page updates every block pointing at it — the same source the sidebar and the pager read. Name a `title` only where the tree cannot answer: an external link, or a page kept out of the navigation. An `href` that resolves to neither stops the build and says which of the two fixes to reach for, rather than rendering a URL where a sentence should be.

It renders above the pager: this is the semantic answer, the pager is the linear one.

It wears **the panel** — a framed block with a header and an inset surface, styled by `.wave-docs-panel`, `.wave-docs-panel__header`, `.wave-docs-panel__title`, `.wave-docs-panel__actions` and `.wave-docs-panel__body`. That is a shared primitive rather than this component's furniture, so a code frame can wear it next without a second copy of the same rules. The two radii are not independent: the inner one is the outer minus the panel's padding, or the corners run at different curvatures and the surface reads as pasted onto the frame instead of set into it. `--wave-docs-radius-lg` is picked so the arithmetic lands on `--wave-docs-radius`.

The panel also exports `--wave-docs-panel-inset` for anything placed inside `__body`: the header's title sits at the frame's padding, but body content sits at that padding *plus the body's own border*, so the two columns miss each other by a pixel per border unless the inset is used.

`DocsExplore` takes `steps` (each with `question`, `href` and a resolved `title`), plus `heading`, `Link`, `externalLabel` and `className`. The heading defaults to `'Where to go next'` and is `explore` in `labels`. Under a 40rem container the question and its answer stack instead of sharing a row.

### The pager

`docs.Page` renders it under every page, so most sites never touch it. The order is the navigation's — flattened from the same tree `DocsSidebar` renders — so a pager that disagrees with the sidebar beside it is impossible. Nothing is authored: a page gets one by being in the tree, and a page outside it (a draft, or a route you render yourself) gets none.

Separators and external links are not stops. A separator is a label with nowhere to go, and a "next page" that lands on npm has ended the sequence rather than continued it. A directory with an `index.md` contributes its own page before its children, which is the order its rows appear in.

| Prop | Type | Default | What it is |
| --- | --- | --- | --- |
| `previous` | `NavStop` | — | The stop before this page. Omit at the beginning |
| `next` | `NavStop` | — | The stop after it. Omit at the end |
| `Link` | `DocsLinkComponent` | `<a>` | Client-side router link |
| `previousLabel` | `string` | `'Previous'` | Above the previous page's title |
| `nextLabel` | `string` | `'Next'` | Above the next page's title |
| `label` | `string` | `'Pagination'` | Accessible name for the landmark |
| `className` | `string` | — | Extra classes |

With neither neighbour it renders nothing at all, rather than an empty landmark. Set `pager: false` on `createDocsRoute` to omit it everywhere, and the three strings through `labels` — `previousPage`, `nextPage`, `pagination`.

### Sidebar icons

Every row in the sidebar carries a marker at its head: a folder on a group, a page on a page, an arrow on a link that leaves your site. Weight and a chevron were the only difference before, and where categories and pages interleave that is not enough to scan.

Three glyphs ship. **No icon set does**, and none ever will — this package is mounted inside applications that already have one, and a second vocabulary beside theirs is worse than none. Your own icons come in by name:

```yaml
# content/reference/index.md
---
title: Reference
icon: book
---
```

```json
// content/reference/meta.json — for a directory with no index page,
// and for hand-written links
{ "title": "Reference", "icon": "book", "pages": [{ "title": "npm", "href": "https://npmjs.com", "icon": "package" }] }
```

```tsx
import { DocsSidebar } from '@waveso/docs/react/sidebar';
import type { DocNavNode } from '@waveso/docs/types';

// Yours: `lucide-react`, your design system, or hand-written. Rendered with no
// props, in a 1rem box — `currentColor` and `100%` keep it in line with the
// built-ins and with the row it sits on.
const Book = () => (
  <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15Z" />
  </svg>
);

export function Nav({ nav, pathname }: { nav: DocNavNode[]; pathname: string }) {
  return <DocsSidebar nav={nav} pathname={pathname} icons={{ book: Book }} />;
}
```

A name with no entry in the map falls back to the built-in marker for that node's type — a typo in one file leaves a folder where a book should be, not a hole in the column. The component is rendered with no props, in a `1rem` box, and the built-ins use `currentColor`, so anything following those two conventions sits in line with them.

`icons={false}` removes the column entirely. The external-link mark moves back to the trailing edge there: turning off a decorative column is not consent to drop a warning that a link leaves your site.

The two components the adapter injects take a little more than an `<a>` and an `<img>`. `DocsLinkProps` adds `prefetch` — passed straight to `next/link`, where `false` disables the hover and viewport paths both, so it is a stronger switch in the App Router than the name suggests. `DocsImageProps` carries `src`, `alt`, `width` and `height` — the four `next/image` refuses to render without — and adds `sizes`, `loading`, `decoding` and `fetchPriority`, forwarded to it; markdown carries none of them, so they come from your `imageResolver` or from a `components` override. `decoding` defaults to `async`, and `loading` to `lazy` — except on an image the author marked `eager`, which is usually the page's largest element.

### Layout

`export default docs.Layout` — the one line from the [quick start](#quick-start) — is a Server Component that renders the whole shell: skip link, sidebar, search trigger, and the grid that arranges them. It reads the navigation tree and the search index URL itself, so there is nothing to fetch and nothing to pass.

**It renders no header, and that is deliberate.** Two kinds of site use this package: documentation mounted inside an application that already has a header, a navbar and its own search, and documentation that is the whole site. A full-width sticky bar of ours serves the second and fights the first — two stacked bars competing for the viewport's top edge, and two search boxes on one page, one of which knows nothing about the documentation.

So the sidebar is the chrome. It is a real grid item at every width, and it is the same shell on a phone and on a desktop.

**Nothing this package renders is anchored to the viewport.** The sidebar is a grid item, the trigger is a flex child of it, and the scrim is `position: absolute` inside `.wave-docs-layout` — so every one of them resolves against a box this package owns and *your* layout placed. `position: fixed` is the thing to avoid, and the reason is specific: a fixed element is anchored to the viewport you share with it, your navbar is in the same viewport, and neither can detect the other. The search dialog is the one exception and always was — top-layer, present only while open, and nothing collides with something that is not there.

Your layout stays a Server Component. The two pieces that need a client — the navigation's `usePathname`, the search dialog — carry their own `'use client'` boundaries inside the package.

Your own chrome goes *around* `docs.Layout`, in the layout file you already write — the same place `<html>` and `<body>` live. Call it instead of re-exporting it when you want to wrap it, configure it, or both:

```tsx
import type { ReactNode } from 'react';
import '@waveso/docs/styles.css';
import { docs } from '@/lib/docs';

/** Yours: the header, theme toggle and repository link the rest of the site has. */
declare function SiteHeader(): ReactNode;

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <docs.Layout search={{ placeholder: 'Search the docs' }}>
        {children}
      </docs.Layout>
    </>
  );
}
```

If that header of yours is sticky, say how tall it is once and the shell's sticky columns start below it:

```css
:root {
  --wave-docs-chrome-offset: 4rem;
}
```

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `children` | `ReactNode` | — | What `docs.Page` returns — the `<main>` and the TOC, as two siblings |
| `search` | `boolean \| DocsSearchProps` | `true` | The search trigger. An object configures the dialog |
| `labels` | `DocsLabels` | the route's | Overrides `createDocsRoute`'s labels, key by key |

Three props, and one of them is `children`. That is deliberate, and it is the difference between this and an eleven-slot layout: everything else a docs shell gets asked for is already reachable. An announcement banner goes *above* `<docs.Layout>` in your own layout, because this does not own `<body>`. A content footer goes inside `children`. Sidebar links, social icons and separators are `DocNavNode`s you author in `meta.json`. A theme toggle and a repository link go in the layout you write around this one.

**`title` and `actions` were removed in 0.7.0, with the header they lived in.** `title` was a brand slot, and a brand belongs to the index page's own title — content, authored and translatable, part of what the reader came for. The argument for `actions` was that the header bar was the one region nothing else could reach; there is no header bar, and the host wraps `docs.Layout` exactly as it already wraps `<html>` and `<body>`, so there is no region only this package can reach. The one place a host cannot reach through this prop list is *inside* the sidebar, and the answer to that is [composing the primitives yourself](#composing-it-yourself).

`search` takes anything `DocsSearch` takes except `indexUrl`, which stays derived from your `basePath`. You do not need to repeat `miniSearchOptions` here to match `createDocsRoute` — the route's own value is forwarded, so the object that built the index is the object that queries it.

`labels` belongs on `createDocsRoute` — see [Translating the chrome](#translating-the-chrome) — and this prop overrides it key by key, for a site with two shells or a section in another language.

#### One sidebar, open and closed

There is no mobile version. The sidebar is a shell holding two things in a row:

```
.wave-docs-shell                         the query container
└─ .wave-docs-layout                     the grid
   ├─ .wave-docs-layout__sidebar         paints nothing, and moves
   │  ├─ …__sidebar-nav                  the surface, and the one border
   │  └─ …__sidebar-trigger              the strip — paints nothing at rest
   ├─ .wave-docs-layout__sidebar-scrim
   ├─ .wave-docs-layout__main
   └─ .wave-docs-layout__toc
```

Pressing the trigger translates the shell by `calc(var(--wave-docs-trigger-width) - 100%)` — "minus all of me, plus the trigger back" — so the navigation goes entirely off the page and the trigger's outer edge lands exactly on the inline start edge. **The navigation's width appears nowhere in that expression**, so the two cannot drift apart. The trigger rides on the navigation's outer edge because it is the next flex item, not because a number says so.

One navigation in the DOM at every width: one landmark, one copy of the links in the payload, nothing to keep in step.

#### It adapts to its container, not to your screen

**There is not one width-based `@media` query in this package.** Every breakpoint is `@container`, and that is not a stylistic preference — it is the difference between a docs theme and a component you can mount inside something else.

`@media` asks how wide the *screen* is. If you put this in a 700px panel on a 1920px monitor, `@media` says "wide", the sidebar takes its 16rem column, and the reading column comes out around 60px. `@container` asks how wide the box you *gave* it is, which is the question with an answer.

Two shapes fall out of that:

- **Push**, in a container 64rem or wider: the navigation sits beside the article, and opening or closing it changes the article's width.
- **Cover**, below that: the navigation sits on top of the article behind a scrim, and the article's measure never changes when you toggle.

Same markup, same classes, same control, same translate. The only thing that differs is whether the article gets out of the way.

Cover mode is a real overlay, so it ships what an overlay owes a reader: `inert` on everything the navigation covers, Escape to close, click-the-scrim to dismiss, and focus moving into the navigation and back out again. Those five were the browser's while this was a `<dialog>`; they are hand-written now, and skipping them is how an overlay becomes a keyboard trap in the wrong direction.

`--wave-docs-sidebar-mode` is how the component knows which shape it is in: the stylesheet declares it, the component reads it back with `getComputedStyle`. `matchMedia` cannot answer a container query, and duplicating the breakpoint in JavaScript is how the two drift.

#### Three states, and no flash

The server renders no `data-state` at all. That absence means "nobody has chosen yet", and CSS resolves it per mode — closed where the navigation would cover the article, open where it would sit beside it. So the first paint is already right at both shapes, with no JavaScript and nothing to correct. Once a reader presses the trigger their choice is explicit and wins at every width.

**This replaced a `<dialog>` drawer in 0.7.0.** Below 64rem the navigation used to be a modal opened by a second control, with `display: contents` above it so the same DOM could serve as the desktop column. It bought focus trapping, Escape and a scroll lock from the browser, and it worked before hydration. It cost two controls for one piece of navigation, a drawer that painted over the tree it contained, and a scroll-into-view that could never run on a phone — a closed `<dialog>` has no layout, so the current page was always below the fold. A closed sidebar is *moved*, not hidden, so that last one is structurally impossible now.

#### Composing it yourself

`docs.Layout` is one opinion, not a tax. The components underneath are exported individually and take data as props, so a shell of your own is `DocsSidebar` + `DocsToc` + `SkipLink` + `DocsSearch` with your own CSS — and `docs.getPage(segments)` gives you the parts a custom page needs:

```tsx
// The catch-all page, written out instead of re-exporting `docs.Page`.
import { notFound } from 'next/navigation';
import { DocContent } from '@waveso/docs/react/doc-content';
import { DocsToc } from '@waveso/docs/react/toc';
import { docs } from '@/lib/docs';

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const doc = await docs.getPage(slug ?? []);
  if (!doc) notFound();

  return (
    <>
      <main className="wave-docs-layout__main" id="docs-content" tabIndex={-1}>
        <DocContent hast={doc.hast} />
      </main>
      {doc.toc.length === 0 ? null : (
        <aside className="wave-docs-layout__toc">
          <DocsToc entries={doc.toc} />
        </aside>
      )}
    </>
  );
}
```

`docs.Page` returns exactly this shape: the `<main>` and the table of contents as **two siblings**, not one wrapped element. They land as direct children of the grid, which is what puts them in separate columns — so if you compose your own page inside `docs.Layout`, return a fragment rather than a wrapper.

**The two class names are load-bearing**, and they are the part of this that is easy to leave off. `wave-docs-layout__main` carries `min-width: 0`, without which a wide table pushes the whole document into horizontal scroll (measured: 1048px of document inside a 1024px viewport). `wave-docs-layout__toc` is what the grid reserves its third track with, via `:has()` — unclassed, the table of contents auto-places into the next row underneath the sidebar above 80rem, and renders inline on a phone instead of being hidden. Both names are public API and change only in a release that carries the migration, so they are safe to write by hand.

The `null` is load-bearing too: `:has()` matches an empty `<aside>` exactly as well as a full one, so a page with no headings would give up 15rem to nothing.

## Frontmatter

```yaml
---
title: Authentication             # required
description: Bearer tokens.       # <meta name="description"> and search
label: Auth                       # sidebar label, when the title is too long
draft: true                       # excluded from nav, search and static params
order: 10                         # sort weight where there is no meta.json
aliases: [old-auth, legacy/auth]  # former URLs → permanent redirects
actions:                          # calls to action — and the opt-in for a hero
  - label: Quick start
    href: /getting-started
  - label: GitHub
    href: https://github.com/waveso/docs
    variant: secondary
---
```

`title` is required on every `.md` file in the tree. A file without one fails the build rather than shipping an untitled page.

`draft` is deliberately **not** tied to `NODE_ENV`. Preview deployments are production builds, so branching on it would hide drafts in exactly the place reviewers look — drive `includeDrafts` from your own environment check instead.

### The hero

`actions` is the only thing that turns a page into a landing page. Declare it and `title` and `description` become a page header — a large heading, the description as a tagline under it, and these links beneath that. Leave it off and the page is exactly what it was: `description` stays a `<meta>` tag and the title is the first thing in the prose.

Each action takes a `label`, an `href` and an optional `variant` of `primary` or `secondary`. Omit the variant and the first action is the primary and the rest are secondary, which is the shape every landing page has. An `href` that leaves the site gets `target="_blank"`, `rel="noreferrer"` and a screen-reader suffix; `mailto:` and `tel:` do not, because they open no tab. Unsafe hrefs fail the build rather than reaching an `<a>`.

**That is the whole of the adaptation for the two shapes this package serves.** Documentation that is the entire site puts a hero on its index. Documentation mounted at `/docs` inside an application that already has a marketing page leaves `actions` off and gets an ordinary page. There is no mode, no `standalone` flag and nothing to configure — the opt-in lives in the file that wants it.

⚠️ **A hero page must not also write its own `# Title`.** `render` normally prepends an `<h1>` from `frontmatter.title`; on a hero page the hero renders that heading instead, because the tagline and the actions have to sit beneath it. Writing one in the body as well ships two `h1`s — the same duplication `titleHeading` has always warned about.

The background is a rotated line grid under scrims painted in the page's own colour rather than behind a mask: a soft ellipse over the words, a bottom fade, and a vignette that closes at the corners. The vignette is an inset `box-shadow` rather than a gradient — a `radial-gradient` is only ever a circle or an ellipse, and this one needs a corner radius. `border-radius` is that knob, and `corner-shape: superellipse(3)` makes it a squircle where the browser supports it. Alpha compositing of a solid blends where mask layers multiply, so the falloff is smooth instead of compounding into a shoulder. It is drawn with `repeating-linear-gradient` rather than an inlined SVG — no data URI in the stylesheet. The lines are `--wave-docs-hero-grid` and `--wave-docs-hero-grid-strong`, which are Wave 200 and Wave 300 from `@waveso/ui` in the light theme and Wave 900 and Wave 800 in the dark one. They are tokens of their own rather than the border colours: the grid is decoration behind a mask that leaves it near-invisible where the words are, and a border is a boundary a reader has to be able to see.

### Your own fields

Pass a `frontmatterSchema` and every `DocFile` and `RenderedDoc` carries your fields, inferred, with no type argument anywhere:

```ts
// content/docs-schema.ts — one module, imported by every route file
import { docFrontmatterSchema, z } from '@waveso/docs/frontmatter';

export const frontmatterSchema = docFrontmatterSchema.extend({
  audience: z.enum(['user', 'operator']).exactOptional(),
});
```

```ts
import { createDocsRoute } from '@waveso/docs/next';
import { frontmatterSchema } from '@/content/docs-schema';

const docs = createDocsRoute({ contentDir: 'content/docs', frontmatterSchema });

const doc = await docs.getPage(['api', 'auth']);
doc?.frontmatter.audience; // 'user' | 'operator' | undefined
doc?.frontmatter.title; //    string
```

Any [Standard Schema](https://standardschema.dev) validator works — Zod, Valibot, ArkType. The field is typed `StandardSchemaV1<unknown, TFrontmatter>` rather than as a Zod type, so the package does not dictate your validator; a schema you hand over is never re-wrapped by the Zod in here. The `z` above is re-exported from this package precisely so that extending `docFrontmatterSchema` needs no install and no matching version.

Four things are worth knowing before you write one.

**Let the type be inferred — never name it.** Naming it explicitly *and* omitting the schema type-checks and then lies, because nothing validates the type you named:

<!-- typecheck: skip — the two lines are the point; imports would bury them -->
```ts
// ⚠️ Compiles. Every extra field is `undefined` at runtime, typed as present.
const docs = createDocsRoute<MyFrontmatter>({ contentDir: 'content/docs' });
```

**Unknown keys are stripped**, by Zod and by every other validator worth using. Declare every field you intend to read — under the base schema, a page with `audience: operator` parses fine and silently loses the value. `docFrontmatterSchema.extend(…)` keeps the built-ins; a `z.object({ … })` written from scratch does not.

**The package's own fields survive a schema that forgets them.** `title` drives the `<h1>` fallback and `<title>`, `draft` the visibility filter, `aliases` the redirects, `order` and `label` the sidebar. These are parsed from the raw YAML and merged over your schema's output, so a custom schema can only ever *add* fields — it cannot drop or corrupt the ones the package reads itself.

That is a runtime guarantee, not a compile-time one, and the difference matters: `TFrontmatter extends DocFrontmatter` constrains only `title`, because the rest are optional. A `z.object({ title, audience })` type-checks perfectly and used to strip `draft` and `aliases` on the way through — publishing every draft, submitting them to Google, and silently returning no redirects at all. Prefer `docFrontmatterSchema.extend(…)` anyway: you then get the built-in fields in *your* inferred type, rather than merely at runtime.

**Export the schema from one module.** The filesystem scan is memoised per resolved config, and two schema objects count as the same schema only when they are the same object. Build one inline in each route file and each file pays for its own scan.

A page the schema rejects fails the build, naming the file, every bad path, and whose schema rejected it:

```
Invalid frontmatter in api/auth.md:
  - audience: Invalid option: expected one of "user"|"operator"
Fix the YAML block at the top of that file, or the `frontmatterSchema` in your docs config.
```

## Navigation

One optional `meta.json` per directory controls order and labelling. Chosen over numeric filename prefixes because a filename cannot express separators, external links or a directory title.

```json
{
  "title": "API Reference",
  "pages": [
    "index",
    "authentication",
    "---Advanced---",
    "...webhooks",
    "...",
    { "title": "Status page", "href": "https://status.example.com" }
  ]
}
```

| Entry | Meaning |
| --- | --- |
| `"authentication"` | A file or subdirectory in this directory, in this position |
| `"---Advanced---"` | A non-interactive separator with the enclosed label |
| `"..."` | Everything not named explicitly. At most one per file |
| `"...webhooks"` | Expand the `webhooks` subdirectory inline, with no group wrapper |
| `{ "title", "href" }` | An arbitrary link. `external` is inferred from the href |

Omit `pages` entirely and the directory sorts by frontmatter `order`, then title — exactly what a lone `"..."` does. Naming an entry that resolves to nothing fails the build, with the `meta.json` path, the offending entry and the list of available names.

A group heading takes its `meta.json` `title`, else its `index.md` `label`, else its `index.md` `title`, else the directory name humanised.

## Markdown support

GFM (tables, strikethrough, task lists, autolinks), GitHub alert syntax (`> [!NOTE]` → `<callout type="note">`), heading ids and permalinks, dual-theme Shiki highlighting, and lone images unwrapped out of their paragraph.

Raw HTML in the source is **dropped**, not passed through. `rehype-raw` is not in the chain — on its own it happily reparses `<script>` back into the tree.

A bare YouTube URL on its own line becomes a click-to-load facade: one ~15 KB thumbnail instead of ~717 KB of embed and player JavaScript on page load. A labelled link keeps its label and stays a link.

Eighteen grammars load by default — what technical documentation actually contains:

```
typescript  tsx  javascript  jsx  json  shellscript  css  html
markdown    yaml  diff  sql  python  go  rust  prisma  ini  toml
```

A ```` ```cfg ```` fence (or ```` ```conf ````) uses the `ini` grammar, because
the fence an author types follows the filename — nobody writes ```` ```ini ````
above a file called `server.cfg`.

Anything outside that set falls back to plain text rather than throwing. Pass `langs` to change the set, or `highlighter` to supply your own. Fence languages are matched case-insensitively, so ```` ```JSON ```` and ```` ```Bash ```` highlight like their lowercase spellings rather than silently shipping monochrome.

### Code blocks

Every highlighted fence is wrapped in a `<figure>` with a copy button. Add a title and it gets a bar:

````md
```ts title="app/page.tsx"
export default function Page() {
  return <h1>Hello</h1>;
}
```
````

The title lands in three places at once — the caption, the button's accessible name (`Copy code from app/page.tsx`, rather than eight controls all called "Copy code"), and the search index.

Anything else in the meta string is left alone, so `{1,3-5}` and `showLineNumbers` pass through to Shiki untouched. A `title=` that is not double-quoted fails the build naming the document, because the alternative is a caption that silently truncates at the first space.

The copy button is one delegated listener for the whole page, mounted by `DocContent` — not a client component per code block. A page with no fences ships none of it. And it is `visibility: hidden` until that listener attaches, so a reader with JavaScript disabled sees no button and finds no dead tab stop where a control should be.

The `<figure>` carries `data-lang` (the folded language, so ```` ```JSON ```` gives `json`). No badge is rendered by default; one rule turns it on:

```css
.wave-docs-code[data-lang]::before {
  content: attr(data-lang);
}
```

Keeping it in CSS is deliberate — a real element would enter the search index and `textContent`, so every code block would pollute search results with its language name and the copy button would copy it.

#### Fences you render yourself

`excludeLangs` tells Shiki to leave a language alone, so the `<pre>` reaches your own component untouched — for diagrams, or anything that is not really code:

```ts
import { createDocsRoute } from '@waveso/docs/next';

// In `lib/docs.ts`, beside the rest of your configuration.
export const docs = createDocsRoute({
  contentDir: 'content/docs',
  excludeLangs: ['mermaid'],
});
```

Those fences are deliberately **not** framed: a copy button on a rendered diagram copies its source, which is not what the reader clicked. They still get the same background, border and horizontal scroll as a highlighted block, so `excludeLangs` on its own produces a page that looks deliberate rather than unstyled.

To render them, map `pre`:

```tsx
import { isValidElement, type ReactNode } from 'react';

/** Yours: a `'use client'` component wrapping whichever renderer you like. */
declare function Mermaid(props: { children: string }): ReactNode;

function textOf(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textOf(node.props.children);
  }
  return '';
}

export const components = {
  pre: (props: { children?: ReactNode }) => {
    const child = props.children;
    const className = isValidElement<{ className?: string | string[] }>(child)
      ? child.props.className
      : undefined;

    /*
     * ⚠️ AN ARRAY, NOT A STRING. An excluded fence never reached Shiki, so its
     * `<code>` still carries hast's `["language-mermaid"]` — Shiki's own
     * output is a string. A `className === 'language-mermaid'` check compiles,
     * reads correctly, and silently never matches, so every diagram renders as
     * its own source.
     */
    const languages = Array.isArray(className) ? className : [className];

    if (languages.includes('language-mermaid')) {
      return <Mermaid>{textOf(props.children)}</Mermaid>;
    }
    return <pre {...props} />;
  },
};
```

Pass it as `components` to `createDocsRoute`, or to `DocContent` directly.

`Mermaid` is yours — a `'use client'` component wrapping whichever renderer you like. This package deliberately does not ship one: several hundred kilobytes of client JavaScript with its own CVE history, behind an option most sites never set, in a package with three peer dependencies against Fumadocs' eighteen.

### Images

**Absolute and external sources just work.** Put the file in `public/` and write `![](/diagram.png)`.

```md
![Architecture](/diagram.png)          ✅ served from public/
![Logo](https://example.com/logo.png)  ✅ external
![Architecture](./diagram.png)         ⛔️ needs an imageResolver
```

A **relative** source is a different thing. Nothing in `public/` corresponds to it, and the browser would resolve it against the *route* — so `/docs/guide` and `/docs/guide/setup` request two different files from byte-identical markdown. Rather than ship that, a relative source with no `imageResolver` fails the build, naming the file and offering both fixes.

An `imageResolver` receives the source already folded against the markdown file's directory (`./diagram.png` in `guides/deploying.md` arrives as `guides/diagram.png`) and returns a public URL plus intrinsic dimensions — which `next/image` requires and markdown does not carry:

```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { imageSize } from 'image-size';
import { createDocsRoute } from '@waveso/docs/next';

createDocsRoute({
  contentDir: 'content/docs',
  imageResolver: async (src) => {
    const { width, height } = imageSize(
      await readFile(path.join('content/docs', src)),
    );
    return { src: `/docs-assets/${src}`, width, height };
  },
});
```

A source that climbs above the content root fails the build whether or not a resolver is configured.

## Theming

Every colour is a `--wave-docs-*` custom property. Redefine the ones you want in
your own `:root`, after the import:

```css
@import '@waveso/docs/styles.css';

:root {
  --wave-docs-accent: oklch(0.55 0.2 265);
  --wave-docs-bg-subtle: oklch(0.98 0.004 265);
}
```

### Corners

Three tiers, all derived from one root, so a box's radius is decided by what
*kind* of box it is rather than by how big it happens to be.

| Token | What takes it |
| --- | --- |
| `--wave-docs-radius-sm` | Inline chips, small controls, and focus rings drawn on those |
| `--wave-docs-radius` | Controls, overlays, and the panel's inset surface |
| `--wave-docs-radius-lg` | Every block in the reading flow, and the panel's outer edge |

**Retune all three from one line.** `--wave-docs-radius-base` is the root and
the other three are `calc()` off it, so a host already running `@waveso/ui`
points this package at their scale and every corner follows — including any
theme that moves it:

```css
:root {
  --wave-docs-radius-base: var(--radius);
}
```

The numbers are `@waveso/ui`'s to begin with. A page running both should not
show two radius scales a few pixels apart, and taking theirs is how that is
guaranteed rather than kept in step by hand.

⚠️ **`--wave-docs-radius-step` is not decoration.** The panel's inset surface
takes the base radius and its frame takes `--wave-docs-radius-lg`, which is the
base plus one step — so the two corners are concentric only while the frame's
*padding* is that same step, which is why it is paid out of the token rather
than written as `4px`. Move the root and both stay true; hard-code the padding
and they drift the first time anyone retunes the scale.

Where the browser supports `corner-shape`, every corner this package draws
becomes a squircle and the root moves up, because a squircle reads tighter than
a circular arc at the same radius. `@waveso/ui` makes the same move to the same
value. Elsewhere it is an ordinary rounded corner at the original scale — an
enhancement, never a dependency. The shaping is scoped to elements this package
owns rather than applied with `*`: this stylesheet is mounted inside somebody
else's page, and reshaping the host's corners is the same trespass as claiming
`html`.

That works because **everything this stylesheet declares lives in a `@layer`** —
`theme` for the tokens, `base` for element resets, `components` for the classes
— and unlayered CSS outranks every layer regardless of specificity.

The distinction matters. The dark tokens are declared as
`:root[data-theme='dark']`, which is specificity (0,2,0). Outside a layer, an
unlayered `:root` at (0,1,0) would lose *no matter where it was loaded* — the
cascade never reaches source order — and overriding would mean writing
`:root:root:root`. Layered, source order settles it and a plain `:root` is
enough.

### Dark mode is opt-in

| On `<html>` | Result |
| --- | --- |
| nothing | Light |
| `class="dark"` | Dark |
| `data-theme="dark"` | Dark |
| `data-theme="system"` | Follows `prefers-color-scheme` |

`.dark` is honoured because [next-themes](https://github.com/pacocoursey/next-themes)
defaults to `attribute="class"` and never sets `data-theme`.

**This is deliberate, and it is a change.** The tokens used to switch on
`prefers-color-scheme` alone. But the stylesheet styles the docs subtree, not
the page — so on a light-only site with a `/docs` section, a visitor whose OS
was in dark mode got the near-white foreground ramp on the host's white
background: **1.23:1**, i.e. invisible. A stylesheet cannot assume it owns the
page it is dropped into, so it now switches only when the host says to.

If your site really does follow the OS and has no theme toggle, say so once:

<!-- typecheck: skip — one tag, shown as markup rather than as a module -->
```tsx
<html lang="en" data-theme="system">
```

To restyle rather than retheme, override the classes — `.wave-docs-prose`,
`.wave-docs-skip-link`, and the rest — from your own unlayered CSS.

> [!NOTE]
> If you retheme, re-check contrast. `src/styles.test.ts` asserts every
> foreground/background pair the shipped tokens compose clears WCAG 1.4.3
> (4.5:1); none of the text here is "large" in the WCAG sense, so 3:1 is never
> enough.

## Search

Build-time index, client-side dialog, MiniSearch. Records are section-scoped — one per `h2`–`h6` — so a hit deep-links to the right heading instead of dropping the reader at the top of a 2,000-word page.

Nothing to set up: `docs.Layout` renders the trigger, and the [route file in the quick start](#quick-start) serves the index. The index is a route rather than a build script, so it is rebuilt by the same `next build` that builds your pages, and in `next dev` it re-reads the disk per request — a page you add is searchable on the next keystroke, with no restart and no script to remember.

Outside `docs.Layout`, `<DocsSearch indexUrl={docs.searchIndexUrl} />` puts the trigger wherever it belongs. `DocsSearch` carries its own `'use client'` boundary, so the layout around it stays a Server Component.

`docs.searchIndexUrl` is derived from your `basePath`, so it is right whether the docs are mounted at `/`, at `/docs` or under a nested prefix. Pass it rather than a literal.

MiniSearch is `import()`ed and the index fetched on hover, focus or first open — never on page load.

> [!WARNING]
> **`export const dynamic = 'force-static'` is not optional, and it has to be a literal** — route segment config is parsed out of the module before any of it runs, exactly like `dynamicParams`. Without it Next marks the route `ƒ` (Dynamic) and re-renders your whole corpus on every request, from markdown that output tracing did not put in the deployment bundle. On a serverless host that does not degrade, it throws — at the reader, inside the dialog. The build prints no warning, so the handler detects it and throws with `code: 'search-index-dynamic'`, naming the file to fix.

Under `output: 'export'` the same route is written out as a plain `docs/search-index.json`. Both modes are asserted by a real `next build` in this repository's CI.

### Caching

The response carries `cache-control: public, max-age=0, must-revalidate` and a strong `ETag`, replacing Next's default of a year of `s-maxage` with no validator — which, on a URL that never changes, is a CDN serving a stale index until someone purges it by hand. `next start` does not honour `If-None-Match` itself (it answers 200 with the full body); a CDN or reverse proxy in front of it does.

If your site sets Next's own `basePath` config, prefix `indexUrl` yourself: Next applies it to `<Link>` and to navigation, but never to a client `fetch()`.

### The dialog's props

`DocsSearch` takes everything `SearchDialog` does except `navigate` and `Link`, which the Next adapter wires. `docs.Layout`'s `search={{ … }}` takes all of it except `indexUrl`, which it derives.

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `indexUrl` | `string` | — | Where the index is served. Pass `docs.searchIndexUrl` |
| `pageSize` | `number` | `20` | Results rendered at a time. **Not a cap** — another page loads as the reader nears the end |
| `minQueryLength` | `number` | `2` | Shortest query that runs |
| `debounceMs` | `number` | `120` | Input debounce |
| `className` | `string` | — | Extra classes for the trigger button |
| `crumbTitles` | `Record<string, string>` | — | Route segment paths to display names, so a result's trail reads `Getting started › Installation` rather than `getting-started › installation`. `docs.Layout` builds it from the navigation and passes it; without it each segment falls back to its slug |
| `triggerLabel` | `string` | `'Search'` | The trigger's text |
| `placeholder` | `string` | `'Search documentation'` | The input's placeholder |
| `dialogLabel` | `string` | `'Search documentation'` | The dialog's accessible name |
| `hintLabel` | `string` | `'Start typing to search the documentation.'` | Before anything is typed |
| `shortQueryLabel` | `string` | `'Keep typing — {min} characters or more.'` | Below `minQueryLength`. `{min}` is that number |
| `loadingLabel` | `string` | `'Loading the search index…'` | While the index is fetched |
| `errorLabel` | `string` | `'Search is unavailable right now. Try reloading the page.'` | When it cannot be |
| `emptyLabel` | `string` | `'No results for “{query}”.'` | No matches. `{query}` is what was typed |
| `selectLabel` | `string` | `'Select'` | Footer hint beside `↑` `↓` |
| `openLabel` | `string` | `'Open'` | Footer hint beside `↵` |
| `closeLabel` | `string` | `'Close'` | The footer's dismiss button, beside `Esc` |
| `resultCountLabels` | `Partial<Record<Intl.LDMLPluralRule, string>>` | `{ one: '{count} result', other: '{count} results' }` | The live region, by plural category |
| `locale` | `string` | `<html lang>`, then `'en'` | Language tag for those plural rules |
| `miniSearchOptions` | `Partial<Options<SearchRecord>>` | — | See [Tuning](#tuning) |

The dialog's footer carries the three keyboard hints and the dismiss control. The key-caps beside them — `↑` `↓` `↵` `Esc` — are glyphs and are not translatable; the three props above are the verbs, which are.

Under `(hover: none) and (pointer: coarse)` the two hints are hidden, on the same reasoning as the trigger's `⌘K`: an instruction to press a key is one a reader on a phone cannot follow. `closeLabel`'s button is deliberately not hidden with them — on exactly those devices it is the only pointer route out of the dialog.

**`pageSize` replaced `maxResults` in 0.4.0**, and the meaning changed with the name: `maxResults` was a hard ceiling of 8 that made results unreachable on a six-page site, and the live region announced the slice as though it were the total. `pageSize` is a window — every match is reachable by scrolling, and the count announced is the real one.

`resultCountLabels` is keyed by plural category rather than being a singular and a plural, because most languages are not English: Polish takes four forms and Arabic six. `Intl.PluralRules` picks, and a category you do not list falls back to `other`.

There is no `hotkey` prop. The shortcut is ⌘K on Apple platforms and Ctrl-K elsewhere, and it is not configurable.

### What gets indexed

**The whole section**, not a preview of it. `extractSearchRecords` once truncated `text` to 300 characters *before* indexing, which dropped roughly 80% of a normal corpus — and because the default `combineWith: 'AND'` requires every term to land in the same record, a two-word query against a page that plainly contained both words returned nothing. Indexing and display are now separate concerns: the full text is searchable, and `storeFields` carries only what the dialog renders.

Drafts are excluded, and code blocks are skipped — after Shiki a fence is hundreds of token spans that index as a bag of punctuation. Inline `code` is kept, because `useMemo` is exactly the sort of thing people search for.

### CJK and other scripts

Tokenisation uses `Intl.Segmenter` where available, so Chinese, Japanese and Thai — which do not delimit words with spaces — index and query as words rather than as whole clauses. Without it, `search('安装')` matched nothing on a page that was entirely about 安装.

### Tuning

Both halves of the seam take the same overrides and **they must agree** — an index built with one `tokenize` and queried with another matches nothing at all, silently. So the option has one name on both sides:

```ts
import { createDocsRoute } from '@waveso/docs/next';

export const docs = createDocsRoute({
  contentDir: 'content/docs',
  miniSearchOptions: { searchOptions: { fuzzy: 0.1, prefix: true } },
});
```

```tsx
import { DocsSearch } from '@waveso/docs/react/next-search';
import { docs } from '@/lib/docs';

export function Search() {
  return (
    <DocsSearch
      indexUrl={docs.searchIndexUrl}
      miniSearchOptions={{ searchOptions: { fuzzy: 0.1, prefix: true } }}
    />
  );
}
```

`fuzzy`, `prefix`, `combineWith` and `boost` are MiniSearch *query* defaults, so they nest under `searchOptions`; `fields`, `storeFields`, `tokenize` and `processTerm` sit at the top level. The nesting is easy to get wrong and wrong is silent — a stray `fuzzy` at the top level is simply never read — so both examples above are type-checked in CI.

### Functions need a client boundary

`tokenize` and `processTerm` are functions, and `docs.Layout` cannot hand a function to the dialog. The layout is a Server Component and the dialog is a Client Component, so props crossing between them are serialised — React refuses a function outright and `next build` fails while prerendering, with *"Functions cannot be passed directly to Client Components"*.

So `docs.Layout` forwards the serialisable half of `miniSearchOptions` — `fields`, `storeFields`, `boost`, and everything under `searchOptions` that is not a callback — and refuses the rest by name. It does not quietly drop them: an index built with a `processTerm` the query does not share matches nothing at all and says nothing, which is the exact failure the forwarding exists to prevent.

Function tuning means taking the boundary yourself, so the function is a module import on both sides rather than a prop between them:

```ts
// lib/search-terms.ts — one function, imported by both halves
export function stripDashes(term: string): string {
  return term.replace(/-/g, '');
}
```

```tsx
// components/docs-search.tsx
'use client';

import { DocsSearch } from '@waveso/docs/react/next-search';
import { stripDashes } from '@/lib/search-terms';

export function DocsSearchTrigger({ indexUrl }: { indexUrl: string }) {
  return (
    <DocsSearch
      indexUrl={indexUrl}
      miniSearchOptions={{ processTerm: stripDashes }}
    />
  );
}
```

Add the same function to your `createDocsRoute` call — `miniSearchOptions: { processTerm: stripDashes }` — so the index is built with it. Then turn the built-in trigger off and render yours in the layout you write around `docs.Layout`, in `app/docs/layout.tsx`:

```tsx
import '@waveso/docs/styles.css';
import type { ReactNode } from 'react';
import { DocsSearchTrigger } from '@/components/docs-search';
import { docs } from '@/lib/docs';

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <DocsSearchTrigger indexUrl={docs.searchIndexUrl} />
      <docs.Layout search={false}>{children}</docs.Layout>
    </>
  );
}
```

`search={false}` omits the built-in trigger so yours is the only one, and it is also why the refusal is scoped to the forward: the route keeps the function for the index it builds on the server, and nothing crosses to the client but a string. To put your trigger *inside* the sidebar rather than above it, [compose the shell yourself](#composing-it-yourself) — `docs.Layout` has no slot for it, deliberately.

### Building the index yourself

Only if the route cannot express what you need — a second index per locale, say, or an artifact consumed by something other than the dialog:

```ts
import { buildSearchIndex, extractSearchRecords } from '@waveso/docs/search-index';
import { docs } from '@/lib/docs';

const rendered = await docs.renderAll();
const json = buildSearchIndex(rendered.flatMap((doc) => extractSearchRecords(doc)));
```

`docs.searchIndex` is exactly this, served — asserted byte-for-byte by a test, so the escape hatch cannot drift from the route.

## Plugins

Two slots, at the two positions that are actually useful:

```ts
import type { Plugin } from 'unified';
import { createDocsRoute } from '@waveso/docs/next';

// Whatever you install — `remark-math` and `rehype-katex` here.
declare const remarkMath: Plugin;
declare const rehypeKatex: Plugin;

export const mathDocs = createDocsRoute({
  contentDir: 'content/docs',
  remarkPlugins: [remarkMath],
  rehypePlugins: [rehypeKatex],
});
```

`remarkPlugins` attach after GFM and **before link resolution**, so anything they emit is folded, contained and asserted exactly like authored markdown — a plugin writing `[x](../other/page.md)` gets the same resolution an author would, and one writing `![i](./x.png)` throws without an `imageResolver` for the same reason.

`rehypePlugins` attach after heading ids and permalinks exist and **before Shiki**, so a code fence is still `<pre><code class="language-ts">` with the author's text in it rather than several hundred token spans. Fences named by `excludeLangs` are not disguised yet either, so a plugin sees every code block the same way.

There is no after-Shiki slot. Code-block internals belong to Shiki's own `transformers`, and the honest documentation for an after-Shiki hook would be a list of things you must not do.

The table of contents is captured **last**, after your plugins and after everything else, so it describes the same document the search index does. A plugin that adds or removes a heading changes both together; there is no validation pass because there is nothing to validate.

> [!NOTE]
> The pipeline is built and frozen once and shared by every file, so a plugin
> holding state accumulates it across the whole build rather than per document.
> Keep them pure, or key what they hold on the vfile.

## Configuration

<!-- typecheck: skip — a reference listing of the type, not a module -->
```ts
interface DocsConfig<TFrontmatter extends DocFrontmatter = DocFrontmatter> {
  contentDir: string;        // relative paths resolve against process.cwd()
  basePath?: string;         // default '/docs'; '/' normalises to ''
  includeDrafts?: boolean;   // default false
  onBrokenLinks?: DocsLinkSeverity;    // default 'throw'
  onBrokenAnchors?: DocsLinkSeverity;  // default 'throw'
  externalRoutes?: readonly string[];  // routes your app owns, not the docs
  frontmatterSchema?: StandardSchemaV1<unknown, TFrontmatter>;
}

type DocsLinkSeverity = 'throw' | 'warn' | 'ignore';
```

### Broken links

**`onBrokenLinks` defaults to `'throw'`, and should stay there.** A link that 404s was valid in your editor and on GitHub, so it is the kind of mistake nobody finds by reading — and a warning in a build log is a warning nobody reads. `'warn'` exists for a migration running knowingly against an incomplete corpus.

The error names the file, the line and the closest published route when the link looks like a typo of one:

```
@waveso/docs: guide.md:12 links to './instalation.md', which resolves to
'/docs/instalation' — no such page exists. Did you mean '/docs/installation'?
Fix the link, or add an `aliases` entry to the page it used to point at.
```

A suggestion is offered only for a genuine near-miss. `/docs/instructions` is five edits from `/docs/installation` — a different word, not a typo — and gets none, because a wrong suggestion sends you to rename a link that was correct.

### Broken anchors

**`onBrokenAnchors` defaults to `'throw'`.** A route used to be verified and its fragment thrown away, so `[setup](./install.md#setup)` built green with no `#setup` anywhere on the page. It is the more common of the two failures: headings get renamed constantly, and nothing renames the links into them.

```
@waveso/docs: guide.md:12 links to '#instalation', and this page has no
'#instalation'. Did you mean 'installation'? Heading ids come from the heading
text, so renaming a heading renames its anchor.
```

Checked against every `id` in the rendered page rather than against the table of contents — which captures `h2`–`h3` only, so a link to an `h4` is fine, and so is a link to an id one of your `rehypePlugins` added. Lower it to `'warn'` if a plugin of yours adds ids this package cannot see at render time.

Same-page anchors are checked as each page renders, so those errors carry the file and the line. Cross-page anchors need the target page's ids, which exist only once everything has been rendered — `docs.renderAll()` does that pass, and it runs in every build that serves search, because the index route is `force-static`.

### Routes your application owns

**`externalRoutes` only matters at a root mount.** Under `basePath: '/docs'` an absolute link either carries the prefix — so it is documentation and is checked — or it does not, and this package leaves it alone. Under `basePath: '/'` there is no prefix: `/setup` and `/login` look identical, and both are checked against the published pages.

That is the right default, because a root mount is what you choose when the origin serves documentation and nothing else. If yours serves something else too, name what is yours:

```ts
// lib/docs-root.ts
import { createDocsRoute } from '@waveso/docs/next';

export const docs = createDocsRoute({
  contentDir: 'content/docs',
  basePath: '/',
  externalRoutes: ['/login', '/dashboard', '/api/'],
});
```

A link is skipped when it equals one of these or begins with one followed by `/` — so `/api` covers `/api/keys` and not `/apiary`. It is a statement about your application, so nothing here infers it.

### Translating the chrome

Twenty-two strings, and every one of them is yours to set. They go on `createDocsRoute` rather than on `docs.Layout`, because they are not all rendered in the same place: four are the shell's, three the navigation tree's, two the table of contents', nine come from the markdown component map, two are baked into the HTML by a rehype plugin at build time, and two are announced by a client-side runtime after a copy. A layout prop is upstream of the first four and nothing else.

```ts
// lib/docs-pt.ts
import { createDocsRoute } from '@waveso/docs/next';

export const docs = createDocsRoute({
  contentDir: 'content/docs',
  labels: {
    // The shell
    nav: 'Documentação',
    openNav: 'Abrir navegação',
    closeNav: 'Fechar navegação',
    skipToContent: 'Ir para o conteúdo',
    // The navigation tree — `{title}` is the group's own name
    expandGroup: 'Abrir {title}',
    collapseGroup: 'Fechar {title}',
    externalLink: '(abre num novo separador)',
    // The table of contents
    toc: 'Nesta página',
    backToTop: 'Voltar ao topo',
    // Your content
    table: 'Tabela',
    calloutNote: 'Nota',
    calloutTip: 'Dica',
    calloutImportant: 'Importante',
    calloutWarning: 'Aviso',
    calloutCaution: 'Atenção',
    youtubeTitle: 'Vídeo do YouTube',
    youtubePlay: 'Reproduzir: {title}',
    youtubeHide: 'Esconder: {title}',
    // Code frames
    copyCode: 'Copiar código',
    copyCodeFrom: 'Copiar código de {title}',
    copied: 'Copiado para a área de transferência.',
    copyFailed: 'Falhou. Selecione o código e prima Control ou Command + C.',
  },
});
```

Each key falls back on its own, so a partial map is not a half-translated site. `{title}` is a placeholder rather than a function, because three of these cross from a Server Component to a Client one — and because a translator has to be able to move the name within the sentence, which concatenation forbids.

The search dialog's own strings are separate, and reachable through `search={{ … }}` — see [Search](#search).

> [!NOTE]
> These were hardcoded English until 0.5.0, under a `labels` prop on `docs.Layout` that documented itself as the whole of a site's translatable chrome and reached four strings of the twenty-two. A site built the documented way shipped `aria-label="On this page"`, a visible `Back to top`, `aria-label="Tip"` on every callout and `Copy code` on every fence, in English, whatever language it was written in.

### Redirects and sitemap

Separate calls, usable from `next.config.ts` and `app/sitemap.ts` — neither loads the Next runtime:

```ts
// next.config.ts
import { createDocsRedirects } from '@waveso/docs/next';

export default { redirects: () => createDocsRedirects({ contentDir: 'content/docs' }) };
```

```ts
// app/sitemap.ts
import { createDocsSitemap } from '@waveso/docs/next';

export default () =>
  createDocsSitemap({ contentDir: 'content/docs', siteUrl: 'https://example.com' });
```

`siteUrl` must be a bare origin. A path component (`https://example.com/product-docs`) is rejected, because `new URL(href, siteUrl)` discards it — every canonical and every sitemap entry would point somewhere that 404s. Put the path in `basePath`, which does take multiple segments.

**An alias is a redirect, not a page.** It is never prerendered, so linking one from your markdown fails the build and names the page to link instead. Aliases are also validated when the page is read:

| Alias | |
| --- | --- |
| `quickstart`, `guides/old-name` | ✅ |
| `v1:beta`, `c++`, `docs/(old)` | ⛔️ path-to-regexp metacharacters |
| `../escape`, `./here` | ⛔️ relative segments |
| `''` | ⛔️ empty |

The rejected spellings are not pedantry. Next compiles a redirect `source` as a path pattern, so `aliases: ['v1:beta']` installed a **wildcard** — it built green and then permanently 308'd `/docs/v1-guide`, a real prerendered page, away to somewhere else.

### Copy page

A button that puts the page's markdown on the reader's clipboard. **On by default once `llms` is configured**, and the corpus route below is the only thing it needs.

It reads `/llms-full.txt` and slices out the page it is on, so there is no per-page artifact, no build step and nothing to configure. `copyPage: false` turns it off; an object overrides `label`, `copiedLabel` and `failedLabel`.

```ts
import { createDocsRoute } from '@waveso/docs/next';

export const docs = createDocsRoute({
  contentDir: 'content/docs',
  siteUrl: 'https://example.com',
  copyPage: { label: 'Copy as Markdown' }, // optional — `true` is the default
});
```

It renders in a header row at the top of the article column, and that row is not emitted when `copyPage` is `false`.

**Any page can override it in frontmatter**, in either direction:

```yaml
---
title: Welcome
copyPage: false
---
```

That is for the page with nothing to copy — a landing page that is a hero and a row of cards has no prose behind it, so the button hands a reader a file of headings and link text. `true` turns it back on where the route turned it off.

**The default is "on if `llms` is set", not plain `true`.** The button reads the corpus, and `docs.llmsFullTxt` refuses to serve one without an `llms` option — so a site with no `llms` has nothing for the button to read, and rendering it there would produce a control whose only possible outcome is to remove itself. `copyPage: true` overrides that, for a host serving the corpus some other way.

**It still hides itself if the route file is absent** — the one case the server cannot see. Whether `/llms-full.txt` is being served is only knowable from the browser, so the button renders and the first click that 404s removes it — rather than a site that never added the route shipping a control which fails every press. A network failure is treated differently: the wiring is fine and the next press may work, so the button says so and stays.

**The cost is one download of the corpus on the first click**, cached for the rest of the visit — around 40 KB gzipped for twenty pages. It is on *click*, not on load, so page weight and first paint are untouched for every reader who never presses it.

`DocsCopyPage` is exported from `@waveso/docs/react/copy-page` for a hand-composed shell. It takes `href` — the page's route, so it can find that page in the corpus — plus the three labels and `corpusUrl`, which defaults to `/llms-full.txt` and only needs setting if the route lives somewhere else.

**Why not a `.md` URL per page?** That was the first design, and in Next it costs five steps: a route file, a rewrite, `output: 'export'` made conditional, a post-build script, and a placeholder the export forces which the script then deletes. Two of them fail silently. All of it exists because `*.md` is a *pattern* the docs catch-all already owns, while `llms-full.txt` is a fixed path that needs none of it. Astro and Vite serve either shape in a few lines, so the simpler one travels better too.

### The corpus as markdown

Two files, at `/llms.txt` and `/llms-full.txt`, in [llmstxt.org](https://llmstxt.org)'s format. Both are prerendered and neither ships a byte to a browser:

```ts
// app/llms.txt/route.ts — the whole file
import { docs } from '@/lib/docs';

export const GET = docs.llmsTxt;
export const dynamic = 'force-static';
```

```ts
// app/llms-full.txt/route.ts
import { docs } from '@/lib/docs';

export const GET = docs.llmsFullTxt;
export const dynamic = 'force-static';
```

Configure them once, where the route is created:

```ts
import { createDocsRoute } from '@waveso/docs/next';

export const docs = createDocsRoute({
  contentDir: 'content/docs',
  siteUrl: 'https://example.com',
  llms: { title: 'Your product', description: 'One sentence on the corpus.' },
});
```

`llms.txt` is an index — a line per page with its title and description. `llms-full.txt` is every page's body, each labelled with its own URL and separated by a `---`.

**This is a URL convention, not a button.** A "copy page as markdown" control is UI over these files; an agent fetching the corpus, a reader piping a page into a prompt, and an MCP server built later all want the file, and none of them want a click.

**The markdown is the author's, not a re-render.** A hosted documentation service has to reconstruct markdown from whatever it rendered; the source is still on disk here, so these files are the original bodies with exactly two edits — a `# title` when the body has none, and link destinations resolved against the page they were written on. Everything else survives byte for byte, list markers and table alignment included.

That resolution matters more than it looks: the destination for this text is a chat window, where `[auth](./api/auth)` has nothing to resolve against. Destinations are found by **parsing**, not by matching `](…)`, so the example URLs in your code fences are left exactly as written — which a regex rewriter would edit, in the one place a reader is meant to copy verbatim. Without a `siteUrl` the links are rewritten to root-relative paths instead of absolute ones.

The same three functions are exported from `@waveso/docs/llms-txt` for anyone building their own artifact — `buildLlmsTxt`, `buildLlmsFullTxt` and `toPortableMarkdown`, the last being one page at a time.

### Development

Markdown files are not in Next's module graph, so nothing recompiles a route module when one changes. `createDocsRoute` re-scans the content directory on every request outside `NODE_ENV=production`: edits appear on reload, new files are found without a restart, and the sidebar from `docs.source.nav()` agrees with the page body on the *same* request.

The rescan is shared. Next runs `generateMetadata` and your page concurrently, and a layout calling `nav()` is a third reader; invalidation is wrapped in `React.cache`, so the first of them re-reads the disk and the rest see that scan. Without it each invalidated the others' work in flight — measured at 22 `readdir` + 824 `readFile` per request on a 401-file tree, against 11 + 412 for one scan.

## Runtimes

What each entry point *requires*, measured by bundling it with no runtime assumed and asserted exactly — not approximately — by `src/entry-runtime.test.ts`:

| Entry | Node builtins |
| --- | --- |
| `@waveso/docs/types` | none |
| `@waveso/docs/frontmatter` | none |
| `@waveso/docs/highlighter` | none |
| `@waveso/docs/render` | none |
| `@waveso/docs/search-index` | none |
| `@waveso/docs/source` | `node:fs/promises`, `node:path` |
| `@waveso/docs/next` | `node:crypto`, `node:fs/promises`, `node:path` |
| `@waveso/docs/react/*` | none |

The markdown pipeline needs no filesystem and no `.wasm` — Shiki is loaded through its JavaScript regex engine deliberately, not its WASM one. So parsing and highlighting run wherever JavaScript does; only reading a directory of `.md` files needs Node, which is what `source` is for.

That is a statement about requirements and not a blessing. A bundle that resolves is not a runtime, and this package is tested on Node. If you run it elsewhere, note that `render` bundles to roughly 2.8 MB with all eighteen grammars inlined — narrow `langs` for anything with a size limit, since grammars are dynamic imports.

## Errors

Every failure this package raises carries a `code`, so a host can branch on the kind of thing that went wrong rather than on message text:

```ts
import { isDocsError } from '@waveso/docs/errors';
import { docs } from '@/lib/docs';

try {
  await docs.renderAll();
} catch (error) {
  if (isDocsError(error) && error.code === 'draft-link') {
    console.warn(error.message);
  } else {
    throw error;
  }
}
```

`DocsErrorCode` is exported as a union, so a `switch` over it is exhaustive and a typo is a compile error. No error class is exported, deliberately: `instanceof` against a copy of a module resolved twice — two versions in a monorepo, a bundler that duplicates it — silently answers `false`, and a string code with a structural guard has no such failure mode.

### Troubleshooting

| Code | What happened | What to do |
| --- | --- | --- |
| `broken-link` | A markdown link resolves to a route no published page owns. | Fix the link, or add an `aliases` entry to the page that moved. |
| `draft-link` | A link points at a page that exists but is `draft: true`. | Publish the page, or drop the link until it ships. |
| `alias-link` | A link points at an alias, which is a redirect and not a page. | Link the page the alias redirects to — the error names it. |
| `broken-anchor` | A `#fragment` that no heading on the target page owns. | Fix the link, or restore the heading. Heading ids come from the heading text, so renaming one renames its anchor. |
| `invalid-alias` | An `aliases` entry is empty, escapes the content root, or is not URL-safe. | Write it as a root-relative path, e.g. `/docs/old-name`. |
| `alias-collision` | Two pages claim one alias, or an alias shadows a real route. | Remove one of them; a redirect cannot have two destinations. |
| `route-collision` | Two files resolve to the same route. | Usually `about.md` beside `about/index.md`. Keep one. |
| `invalid-frontmatter` | A page has no frontmatter block, or the schema rejected it. | Every page needs at least `title`. The message names the file and the field. |
| `invalid-meta` | A `meta.json` is malformed, or names a page that is not there. | Check the filename spelling — entries are filenames without the extension. |
| `invalid-config` | An option passed to this package cannot be used as given. | The message names the option. `siteUrl` must be an absolute origin with no path. |
| `missing-content-dir` | `contentDir` does not point at a readable directory. | It resolves against `process.cwd()`, which is your project root under `next build`. |
| `broken-symlink` | A markdown page is reachable only through a broken symbolic link. | Repoint or delete the link; skipping it would silently drop a route. |
| `descriptor-limit` | The process ran out of file descriptors while scanning the content directory. | Raise the limit — `ulimit -n`, or `LimitNOFILE` under systemd. The scan holds at most 64 open at once, so something else in the process has them. |
| `invalid-image` | A relative image needs an `imageResolver`, or one returned an unusable shape. | Pass `imageResolver`, or use an absolute `/path` the browser can resolve. |
| `unknown-theme` | A theme name outside the supported set. | Pass a `highlighter` of your own if you need a theme this package does not load. |
| `unknown-language` | A fence language outside the loaded set. | Add it to `langs`, or accept the plain-text fallback. |
| `missing-peer` | `next` is absent, or not the shape this adapter expects. | Install `next`, or build pages from `@waveso/docs/react/*` with your own loader. |
| `search-index-unavailable` | The dialog could not fetch or parse the index. | Check `indexUrl` — pass `docs.searchIndexUrl`, and prefix it yourself under a Next `basePath`. |
| `search-index-dynamic` | The search-index route ran at request time instead of prerendering. | Add `export const dynamic = 'force-static'` to the route file. It must be a literal. |
| `llms-unconfigured` | `docs.llmsTxt` or `docs.llmsFullTxt` was called without an `llms` option. | Pass `llms: { title, siteUrl }` to `createDocsRoute`. The title is the `h1` of `llms.txt`; without `siteUrl` every link in the file is root-relative. |
| `invalid-code-meta` | A fence's `title=` cannot be read. | Quote it: ```` ```ts title="app/page.tsx" ````. |
| `internal` | A plugin ran without context this package always supplies. | This one is a bug here. Please report it with the stack trace. |

## Requirements

| | |
| --- | --- |
| Node.js | ≥ 22.12.0 |
| React | 19 |
| Next.js | 16 (optional peer — only `@waveso/docs/next` needs it) |
| Module format | **ESM only** |
| TypeScript | 5.9+ |

ESM-only is forced rather than chosen: `unified` and the entire `remark-*` / `rehype-*` lineage are `"type": "module"` with no CJS build, so a dual output would resolve to nothing. `attw` reports `cjs-resolves-to-esm` for this package; that is the intended shape.

If you extend the frontmatter schema, use `.exactOptional()` rather than `.optional()` for optional fields: the latter infers `{ description?: string | undefined }`, which is not assignable to `DocFrontmatter`.

> [!NOTE]
> Passing `next/link` **straight** into `DocsSidebar` does not type-check under
> `exactOptionalPropertyTypes: true`. Next's `LinkProps` re-declares `onClick?`,
> `onMouseEnter?` and `onTouchStart?` *without* `| undefined` while React's
> anchor props include it, so the two declaration files disagree — about props
> `next/link` accepts perfectly well at runtime. It is true of every `next/link`
> call site in a project with that flag on, not just this one.
>
> Import `DocsLink` instead of casting:
>
> ```tsx
> 'use client';
> import { DocsLink } from '@waveso/docs/react/next-link';
> import { DocsSidebar } from '@waveso/docs/react/sidebar';
>
> <DocsSidebar nav={nav} pathname={pathname} Link={DocsLink} />
> ```
>
> `docs.Layout` and `DocsSearch` have always used the same adapter internally,
> so this only ever came up when composing a shell by hand.
>
> `docs.Page` and `DocsSearch` are both unaffected — each wraps `next/link`
> inside the package, which is where that cast belongs. Without the flag,
> `Link={Link}` compiles exactly as shown above.

## Stability

**This is `0.x`, and `0.x` means breaking changes land in minors.** They will be
listed, with the migration, in the changelog. What follows is what counts as
breaking — which is the part most packages leave unsaid until someone is angry.

### What is public API

| | Covered |
| --- | --- |
| Every subpath in `exports`, and every runtime name it exports | ✅ enforced by `manifest.test.ts` |
| Exported types, including `DocsErrorCode`'s members | ✅ enforced by `error-taxonomy.test.ts` |
| **CSS class names** — `wave-docs-*`, and the shell's element tree | ✅ a name changes only in a release that carries the migration |
| **The hast this emits** — element names, and the attributes on them | ✅ the same policy as the types |
| Layout tokens — the six custom properties above | ✅ |
| Anything reachable only through `dist/` internals, or a private module | ❌ |

The two in bold are the ones usually omitted, and omitting them is how a
package ships a "patch" that silently reflows everyone's site. If you can write
a selector against it or read it out of `RenderedDoc.hast`, this package owes
you a changelog entry before it moves.

### Four clauses

**Dropping a major of `next`, `react` or `react-dom` is breaking; adding one is
not.** Widening `peerDependencies` to accept the next major is a minor and
always safe to take. Narrowing it — dropping React 19 once React 20 has settled
— is breaking, gets its own release, and will not be bundled with features.

**The Node floor follows LTS, and moving it is breaking.** It rises when a
version leaves maintenance, not when a shiny builtin appears. Today `22.12.0`.

**A third-party type in this package's signature makes that library's major
ours.** `unified`'s `PluggableList` is in `remarkPlugins`, `MiniSearch`'s
`Options` is in `miniSearchOptions`, and hast's `Root` is in `RenderedDoc`. When
one of those releases a breaking major, so does this — a package that quietly
re-exports someone else's break is worse than one that names it.

**Zod is a dependency, not a peer, and that is deliberate.** Your Zod is yours.
When you extend the frontmatter schema, take `z` from
`@waveso/docs/frontmatter`.

### What is not covered

The rendered *appearance* — colours, spacing, the type scale — is design, and it
will change without a major. The class names it hangs on will not.

## Design notes

<details>
<summary><strong>Why not MDX?</strong></summary>

<br />

MDX is not markdown; it is a JavaScript module that looks like markdown. That buys arbitrary components in prose, and costs the thing this package exists to protect: the output is code, so it must be compiled and bundled per page, it cannot be cached as JSON, it cannot cross the RSC boundary as data, and a non-engineer can no longer safely edit a page. An author can also break the build with a stray `<`.

Here the extension points are the component map and the `callout` element. If you need more component freedom in prose than that allows, you need MDX — use it, and accept the bundle.

</details>

<details>
<summary><strong>Why not react-markdown?</strong></summary>

<br />

`react-markdown` parses **in the browser**. `unified` + `remark-parse` + `remark-gfm` is roughly 60 KB gzipped shipped to every reader, plus Shiki if you want highlighting, to do work that could have happened once at build time.

It also hardcodes `passNode: true` with no opt-out, so any component you map that spreads its props renders `node="[object Object]"` into production HTML — with no type error, because `node` is a legal prop on the component and an unknown attribute on the element. `DocContent` leaves `passNode` off.

</details>

<details>
<summary><strong>Why stop at hast instead of an HTML string?</strong></summary>

<br />

An HTML string is a dead end: you can only render it with `dangerouslySetInnerHTML`, which forfeits component mapping, makes every element unstyleable except through descendant selectors, and puts the burden of trusting the content on you.

A hast tree is data. It survives `JSON.stringify`, crosses the RSC boundary, caches to disk, and renders through `hast-util-to-jsx-runtime` with your components substituted for whichever elements you care about. The cost is a slightly larger payload; positions are stripped before it ships, which removes roughly a third of the JSON. Measured at 33% on a mixed page — it rises on short pages, where the offsets are a larger share of a smaller tree. Two figures in this repository disagreed about it (38% in a comment, 44% here) until somebody measured.

</details>

## Development

```sh
pnpm install
pnpm test          # vitest
pnpm run typecheck # tsc --noEmit
pnpm run build     # tsdown
pnpm run lint      # biome
pnpm run check:package  # publint + are-the-types-wrong
```

### Project structure

```
.changeset/           # Changesets config
.github/workflows/    # CI + publish
src/
  types.ts            # The shared contract. Type-only
  source.ts           # Filesystem → DocFile[] + nav tree
  render.ts           # The unified pipeline → hast + TOC
  highlighter.ts      # Fine-grained Shiki
  frontmatter.ts      # Base schema + validation
  search-index.ts     # Section-scoped records → MiniSearch
  next.ts             # The App Router adapter
  meta.ts             # meta.json ordering
  plugins/            # remark/rehype plugins
  react/              # Components. Only the next-* modules touch next/*
  styles.css          # Theme tokens + prose styles
```

## Releasing

This project uses [Changesets](https://github.com/changesets/changesets) with GitHub Actions.

1. Run `pnpm changeset` to describe your changes (patch, minor, or major)
2. Commit the generated changeset file with your PR
3. When merged to `main`, CI versions and publishes to npm

## License

[MIT](./LICENSE)
