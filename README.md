<div align="center">

# @waveso/docs

<p><strong>Markdown documentation for Next.js.<br />Parsed in Node at build time, so the parser never reaches the browser.</strong></p>

[![npm](https://img.shields.io/npm/v/@waveso/docs)](https://www.npmjs.com/package/@waveso/docs)
[![license](https://img.shields.io/npm/l/@waveso/docs)](./LICENSE)
![React 19](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)
![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)

</div>

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

`react` and `react-dom` are required peers. `next` and `zod` are optional — install only what you use.

**`zod` is needed by three entry points, not by the package as a whole**: `@waveso/docs/frontmatter`, `@waveso/docs/source` and `@waveso/docs/next`, because `docFrontmatterSchema` is a Zod schema. `@waveso/docs/react/*`, `/render`, `/search-index`, `/search-options`, `/markdown-links` and `/types` all load without it. If you import any of the first three, install it:

```sh
pnpm add zod
```

The floor is `4.4.3`, not `^4.0.0`: the built-in frontmatter schema calls `.exactOptional()` at module scope, so an earlier 4.x throws on import with nothing in the message naming zod.

**There is no `tailwindcss` peer and no Tailwind involved.** The stylesheet is plain CSS with `wave-docs-*` class names. It was declared as an optional peer once, which blocked `npm install` outright for any project on Tailwind 3 — npm still range-checks an optional peer that happens to be installed.

There is no `image-size` peer either. An `imageResolver` you write is welcome to read dimensions with it — but it is your dependency, in your own `package.json`. Declaring it here installed nothing and did not make `await import('image-size')` resolve for you; it only looked like it helped.

## Quick start

**Two route files are required.** `[...slug]` does not match `/docs` itself, so the index needs its own `page.tsx`. An optional catch-all (`[[...slug]]`) does match, but leaves `/docs/index` live and serving byte-identical HTML with no canonical between them.

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

```
content/docs/
  index.md
  getting-started.md
  api/
    meta.json
    authentication.md
```

That is a working documentation site.

> [!IMPORTANT]
> `dynamicParams` must be written out as `false`. Route segment config is parsed statically before the module runs, so `export const dynamicParams = docs.dynamicParams` fails `next build`. Without it, Next invokes the route on a server at request time for every unlisted URL, to produce a 404 that was already knowable at build time — and `output: 'export'` refuses to build at all.

## Entry points

There is no root export. Every entry point is a subpath, so an import always names the file it came from.

| Subpath | Environment | Contents |
| --- | --- | --- |
| `@waveso/docs/next` | Node | `createDocsRoute`, `createDocsSitemap`, `createDocsRedirects` |
| `@waveso/docs/source` | Node | `createDocsSource`, `resolveDocsConfig` |
| `@waveso/docs/render` | Node | `createDocsRenderer` |
| `@waveso/docs/highlighter` | Node | `createDocsHighlighter`, `DEFAULT_DOCS_LANGS` |
| `@waveso/docs/search-index` | Node | `extractSearchRecords`, `buildSearchIndex`, `writeSearchIndex` |
| `@waveso/docs/react/*` | Browser + RSC | See [Components](#components) |
| `@waveso/docs/frontmatter` | Any | `docFrontmatterSchema`, `parseFrontmatter` |
| `@waveso/docs/search-options` | Any | `SEARCH_INDEX_OPTIONS` |
| `@waveso/docs/types` | Any | Every shared type. Type-only |
| `@waveso/docs/styles.css` | — | The stylesheet |

The Node-only subpaths carry `"browser": null`, so importing one from client code fails with a located *module not found* rather than quietly bundling `node:fs`.

## Components

Every component takes data as props and imports nothing from `next/*` — the adapter injects `next/link` and `next/image`. That keeps the renderer host-agnostic and testable without a router.

| Component | Subpath | Notes |
| --- | --- | --- |
| `DocContent` | `react/doc-content` | Renders a hast tree. Server Component |
| `DocsSidebar` | `react/sidebar` | Takes `pathname` as a prop, not from `next/navigation` |
| `DocsToc` | `react/toc` | Scrollspy via `IntersectionObserver` |
| `SearchDialog` | `react/search-dialog` | ⌘K, arrow keys, focus trap |
| `Callout` | `react/callout` | Note · tip · important · warning · caution |
| `YouTube` | `react/youtube` | Click-to-load facade |
| `SkipLink` | `react/skip-link` | Targets `docs.Page`'s `<article>` |
| `createMarkdownComponents` | `react/markdown-components` | The element → component map |

### Layout

App Router layouts are Server Components and `usePathname` is client-only, so the one client boundary in a docs layout is a wrapper around the sidebar:

```tsx
// components/docs-nav.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DocsSidebar } from '@waveso/docs/react/sidebar';
import type { DocNavNode } from '@waveso/docs/types';

export function DocsNav({ nav }: { nav: DocNavNode[] }) {
  return <DocsSidebar nav={nav} pathname={usePathname()} Link={Link} />;
}
```

```tsx
// app/docs/layout.tsx
import type { ReactNode } from 'react';
import { SkipLink } from '@waveso/docs/react/skip-link';
import { DocsNav } from '@/components/docs-nav';
import { docs } from '@/lib/docs';
import '@waveso/docs/styles.css';

export default async function DocsLayout({ children }: { children: ReactNode }) {
  const nav = await docs.source.nav();
  return (
    <>
      <SkipLink />
      <DocsNav nav={nav} />
      {children}
    </>
  );
}
```

A page that needs the table of contents renders itself from `docs.getPage(segments)` instead of re-exporting `docs.Page`:

```tsx
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
      <article id="docs-content" tabIndex={-1} className="wave-docs-prose">
        <DocContent hast={doc.hast} />
      </article>
      <DocsToc entries={doc.toc} />
    </>
  );
}
```

## Frontmatter

```yaml
---
title: Authentication             # required
description: Bearer tokens.       # <meta name="description"> and search
label: Auth                       # sidebar label, when the title is too long
draft: true                       # excluded from nav, search and static params
order: 10                         # sort weight where there is no meta.json
aliases: [old-auth, legacy/auth]  # former URLs → permanent redirects
---
```

`title` is required on every `.md` file in the tree. A file without one fails the build rather than shipping an untitled page.

`draft` is deliberately **not** tied to `NODE_ENV`. Preview deployments are production builds, so branching on it would hide drafts in exactly the place reviewers look — drive `includeDrafts` from your own environment check instead.

### Your own fields

Pass a `frontmatterSchema` and every `DocFile` and `RenderedDoc` carries your fields, inferred, with no type argument anywhere:

```ts
// content/docs-schema.ts — one module, imported by every route file
import { docFrontmatterSchema } from '@waveso/docs/frontmatter';
import { z } from 'zod';

export const frontmatterSchema = docFrontmatterSchema.extend({
  audience: z.enum(['user', 'operator']).exactOptional(),
});
```

```ts
const docs = createDocsRoute({ contentDir: 'content/docs', frontmatterSchema });

const doc = await docs.getPage(['api', 'auth']);
doc?.frontmatter.audience; // 'user' | 'operator' | undefined
doc?.frontmatter.title; //    string
```

Any [Standard Schema](https://standardschema.dev) validator works — Zod, Valibot, ArkType. The field is typed `StandardSchemaV1<unknown, TFrontmatter>` rather than as a Zod type, so the package does not dictate your validator. Reach for `zod` only if you extend `docFrontmatterSchema`, which is itself a Zod schema — see [Installation](#installation).

Four things are worth knowing before you write one.

**Let the type be inferred — never name it.** Naming it explicitly *and* omitting the schema type-checks and then lies, because nothing validates the type you named:

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
createDocsRoute({
  contentDir: 'content/docs',
  imageResolver: async (src) => {
    const { width, height } = await imageSize(path.join('content/docs', src));
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

Nothing builds the index for you. `docs.renderAll()` exists for exactly this, and shares the scan, the highlighter and the render cache with your routes:

```ts
// scripts/build-search-index.ts — run before `next build`
import { extractSearchRecords, writeSearchIndex } from '@waveso/docs/search-index';
import { docs } from '../lib/docs';

const rendered = await docs.renderAll();
const records = rendered.flatMap((doc) => extractSearchRecords(doc));
await writeSearchIndex(records, 'public/search-index.json');
```

```tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SearchDialog } from '@waveso/docs/react/search-dialog';

export function Search() {
  const router = useRouter();
  return <SearchDialog indexUrl="/search-index.json" navigate={router.push} Link={Link} />;
}
```

MiniSearch is `import()`ed and the index fetched on hover, focus or first open — never on page load.

### What gets indexed

**The whole section**, not a preview of it. `extractSearchRecords` once truncated `text` to 300 characters *before* indexing, which dropped roughly 80% of a normal corpus — and because the default `combineWith: 'AND'` requires every term to land in the same record, a two-word query against a page that plainly contained both words returned nothing. Indexing and display are now separate concerns: the full text is searchable, and `storeFields` carries only what the dialog renders.

### CJK and other scripts

Tokenisation uses `Intl.Segmenter` where available, so Chinese, Japanese and Thai — which do not delimit words with spaces — index and query as words rather than as whole clauses. Without it, `search('安装')` matched nothing on a page that was entirely about 安装.

Both halves of the seam take the same overrides, and they must agree — an index built with one `tokenize` and queried with another matches nothing at all:

```ts
buildSearchIndex(records, { fuzzy: 0.1, prefix: true });
```

```tsx
<SearchDialog indexUrl="/search-index.json" searchOptions={{ fuzzy: 0.1, prefix: true }} />
```

## Configuration

```ts
interface DocsConfig<TFrontmatter extends DocFrontmatter = DocFrontmatter> {
  contentDir: string;        // relative paths resolve against process.cwd()
  basePath?: string;         // default '/docs'; '/' normalises to ''
  includeDrafts?: boolean;   // default false
  assertLinks?: boolean;     // default true
  frontmatterSchema?: StandardSchemaV1<unknown, TFrontmatter>;
}
```

`createDocsRoute` additionally accepts:

| Option | Default | Purpose |
| --- | --- | --- |
| `langs` | 18 grammars | Typed `readonly DocsLang[]`, so a typo is a compile error |
| `themes` | `github-light` / `github-dark` | Shiki theme pair |
| `highlighter` | built-in | Supply your own for grammars outside the set |
| `titleHeading` | `true` | Build an `<h1>` from `frontmatter.title` when the markdown has none |
| `components` | built-in map | Override any element → component mapping |
| `contentId` | `'docs-content'` | The id `SkipLink` targets; `false` if your layout owns it |
| `rescanPerRequest` | dev only | Re-scan the content directory per request |
| `siteUrl` | — | Makes canonical URLs absolute |
| `linkResolver` · `imageResolver` | — | Override link rewriting and image dimensions. An `imageResolver` receives a folded, contained src — except an absolute `/logo.png` or a schemed `https://…`, which arrive unfolded, so branch on them |

`titleHeading` defaults on because a document with no `h1` has a broken heading outline and fails every accessibility audit. Turn it off if your layout renders the title itself.

### Redirects and sitemap

Separate calls, usable from `next.config.ts` and `app/sitemap.ts` — neither loads the Next runtime:

```ts
import { createDocsRedirects, createDocsSitemap } from '@waveso/docs/next';

// next.config.ts
export default { redirects: () => createDocsRedirects({ contentDir: 'content/docs' }) };

// app/sitemap.ts
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

### Development

Markdown files are not in Next's module graph, so nothing recompiles a route module when one changes. `createDocsRoute` re-scans the content directory on every request outside `NODE_ENV=production`: edits appear on reload, new files are found without a restart, and the sidebar from `docs.source.nav()` agrees with the page body on the *same* request.

The rescan is shared. Next runs `generateMetadata` and your page concurrently, and a layout calling `nav()` is a third reader; invalidation is wrapped in `React.cache`, so the first of them re-reads the disk and the rest see that scan. Without it each invalidated the others' work in flight — measured at 22 `readdir` + 824 `readFile` per request on a 401-file tree, against 11 + 412 for one scan.

## Requirements

| | |
| --- | --- |
| Node.js | ≥ 20.19.0 |
| React | 19 |
| Next.js | 16 (optional peer — only `@waveso/docs/next` needs it) |
| Module format | **ESM only** |
| TypeScript | 5.9+ |

ESM-only is forced rather than chosen: `unified` and the entire `remark-*` / `rehype-*` lineage are `"type": "module"` with no CJS build, so a dual output would resolve to nothing. `attw` reports `cjs-resolves-to-esm` for this package; that is the intended shape.

If you extend the frontmatter schema, use `.exactOptional()` rather than `.optional()` for optional fields: the latter infers `{ description?: string | undefined }`, which is not assignable to `DocFrontmatter`.

> [!NOTE]
> Under `exactOptionalPropertyTypes: true`, passing `next/link` straight into
> `DocsSidebar` or `SearchDialog` does not type-check — `next/link` types
> `prefetch` as `boolean | null | undefined` where `DocsLinkProps` says
> `boolean | undefined`. `docs.Page` is unaffected, because the adapter wraps
> `next/link` internally. Without that flag, `Link={Link}` compiles as shown.

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

A hast tree is data. It survives `JSON.stringify`, crosses the RSC boundary, caches to disk, and renders through `hast-util-to-jsx-runtime` with your components substituted for whichever elements you care about. The cost is a slightly larger payload; positions are stripped before it ships, which removes about 44% of the JSON on a typical page.

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
  react/              # Components. Import nothing from next/*
  styles.css          # Theme tokens + prose styles
```

## Releasing

This project uses [Changesets](https://github.com/changesets/changesets) with GitHub Actions.

1. Run `pnpm changeset` to describe your changes (patch, minor, or major)
2. Commit the generated changeset file with your PR
3. When merged to `main`, CI versions and publishes to npm

## License

[MIT](./LICENSE)
