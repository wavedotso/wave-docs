# @waveso/docs

Markdown documentation for **Next.js** (App Router / RSC), from one content
directory and one pipeline.

The markdown parser and the syntax highlighter never reach the browser.

## Architecture

Markdown becomes [hast](https://github.com/syntax-tree/hast) in Node, at build
time. A hast tree is plain serialisable JSON, so Next renders it inside a Server
Component and the browser receives a tree of nodes and a component map, never
`unified`, `remark-parse` or Shiki. The pipeline stops at hast rather than stringifying
to HTML precisely so the output stays data: you map `h2`, `a`, `img`, `pre` and
`callout` onto your own components, and nothing is ever passed to
`dangerouslySetInnerHTML`.

```
content/*.md ──▶ source ──▶ render ──▶ RenderedDoc { hast, toc, frontmatter }
                (Node)      (Node)              │
                                          RSC payload
                                                │
                                          <DocContent hast={…} />
```

The React layer takes that tree as a prop and imports nothing from `next/*` —
the adapter injects `next/link` and `next/image`. That keeps the renderer
host-agnostic, so a non-Next host only needs its own loader around
`@waveso/docs/source` and `@waveso/docs/render`.

Three things follow from that shape and are worth knowing up front:

- **Positions are stripped.** The tree is the payload, so the line/column spans
  `unified` attaches to every node are removed before it ships — about 44% of
  the JSON on a real page, describing a file the browser does not have.
- **Shiki loads 16 grammars, not 346.** The bundled `@shikijs/rehype` entry
  point loads every grammar it ships with (~4.4 s and 11 MB per build worker);
  this package uses `shiki/core` with an explicit highlighter and the JavaScript
  regex engine, so no WASM is loaded either.
- **Broken internal links fail the build.** `[auth](./api/auth.md)` is the right
  way to link between markdown files — it works on GitHub and in every editor
  preview — and it 404s once published. Those links are rewritten to routes and
  the targets are checked.

## Install

```sh
npm install @waveso/docs
```

`react`, `react-dom` and `zod` are required peers — `zod` because the built-in
frontmatter schema is a Zod schema, though a schema of your own may come from any
[Standard Schema](https://standardschema.dev) validator. `next` and `tailwindcss`
are optional peers — install only the ones you use. `image-size`
is optional too, and nothing here imports it: it is declared so that an
`imageResolver` you write can `await import('image-size')` without adding a
dependency the rest of the package would carry. There is no built-in resolver;
without one, markdown images render as a plain `<img>`.

The package has **no root export**; every entry point is a subpath, so an import
always names the file it came from:

| Subpath | Environment | Contents |
| --- | --- | --- |
| `@waveso/docs/types` | any | Every shared type. Type-only, compiles to nothing. |
| `@waveso/docs/frontmatter` | any | `docFrontmatterSchema`, `parseFrontmatter` |
| `@waveso/docs/source` | Node | `createDocsSource`, `resolveDocsConfig` |
| `@waveso/docs/render` | Node | `createDocsRenderer` |
| `@waveso/docs/highlighter` | Node | `createDocsHighlighter` |
| `@waveso/docs/search-index` | Node | `extractSearchRecords`, `buildSearchIndex`, `writeSearchIndex` |
| `@waveso/docs/search-options` | any | `SEARCH_INDEX_OPTIONS` |
| `@waveso/docs/next` | Node | `createDocsRoute`, `createDocsSitemap`, `createDocsRedirects` |
| `@waveso/docs/react/*` | browser + RSC | `doc-content`, `markdown-components`, `callout`, `youtube`, `sidebar`, `toc`, `skip-link`, `search-dialog` |
| `@waveso/docs/styles.css` | — | The stylesheet |

The Node-only subpaths carry `"browser": null`, so importing one from client
code fails with a located "module not found" instead of quietly bundling
`node:fs`.

## Next.js

**Two route files are required.** This is the one thing people get wrong.
`[...slug]` does not match `/docs` itself — the route table emits `/docs/index`
and `/docs` returns 404 — so the index needs its own `page.tsx`. An optional
catch-all (`[[...slug]]`) does match `/docs`, but it leaves `/docs/index` live
and serving byte-identical HTML with no canonical between them.

Create the route once, in a module both route files and the layout import.
`createDocsRoute` itself is *not* memoised — each call builds its own renderer
and route set — while the filesystem scan, the highlighter and the component map
underneath it are shared per process. One instance is still the shape you want:

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

**Declare `dynamicParams`, and declare it as a literal.** Next defaults it to
`true`, which means a URL `generateStaticParams` never listed still gets
rendered on demand: `/docs/typo` reaches the source layer, `readFile` throws
`ENOENT`, and Next answers **HTTP 500**. Google retries a 5xx as a crawl
failure; it accepts a 404 as an answer.

It has to be written out as `false`. Route segment config is parsed statically
out of the module before anything in it runs, so `export const dynamicParams =
docs.dynamicParams` — the obvious thing to write, and what earlier drafts of
this README said — fails `next build` with *"Next.js can't recognize the
exported `dynamicParams` field in route. It needs to be a static boolean."*
`docs.dynamicParams` exists to document the value and type it as `false`, not to
be forwarded.

`docs.Page` renders `<article id="docs-content" tabIndex={-1}>` — the target
`SkipLink` points at by default. Rename it with `contentId`, or pass
`contentId: false` if your layout owns the id.

### Layout

`DocsSidebar` needs the current pathname, and takes it as a prop rather than
reading `next/navigation`, so it stays host-agnostic. App Router layouts are
Server Components and `usePathname` is client-only, so the one
client boundary in a docs layout is a wrapper around the sidebar:

```tsx
// components/docs-nav.tsx
'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
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

export default async function DocsLayout({
  children,
}: {
  children: ReactNode;
}) {
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

A page that needs the table of contents or the frontmatter renders itself from
`docs.getPage(segments)` instead of re-exporting `docs.Page`:

```tsx
// app/docs/[...slug]/page.tsx
import { notFound } from 'next/navigation';
import { DocContent } from '@waveso/docs/react/doc-content';
import { DocsToc } from '@waveso/docs/react/toc';
import { docs } from '@/lib/docs';

export default async function Page({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const doc = await docs.getPage(slug ?? []);
  if (doc === undefined) notFound();

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

`DocContent` takes a `components` map — `createMarkdownComponents({ Link, Image })`
from `@waveso/docs/react/markdown-components` — when you want `next/link` and
`next/image` in prose. `docs.Page` does that for you.

### Development

Markdown files are not in Next's module graph, so nothing recompiles a route
module when one changes. `createDocsRoute` therefore re-scans the content
directory on every request outside `NODE_ENV=production`: edits show up on
reload and new files are found without a restart. Set `rescanPerRequest: false`
to opt out, or `true` to keep it in production (a rescan of a few hundred small
files is single-digit milliseconds; it is the render that costs).

Redirects and the sitemap are separate calls, usable from `next.config.ts` and
`app/sitemap.ts` — neither loads the Next runtime:

```ts
import { createDocsRedirects, createDocsSitemap } from '@waveso/docs/next';

// next.config.ts
export default { redirects: () => createDocsRedirects({ contentDir: 'content/docs' }) };

// app/sitemap.ts
export default () =>
  createDocsSitemap({ contentDir: 'content/docs', siteUrl: 'https://example.com' });
```

## `meta.json`

One optional file per directory, controlling order and labelling. Chosen over
numeric filename prefixes because a filename cannot express separators, external
links or a directory title.

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

Omit `pages` entirely and the directory sorts by frontmatter `order`, then
title — exactly what a lone `"..."` does. Naming an entry that resolves to
nothing fails the build, with the `meta.json` path, the offending entry and the
list of available names.

A group heading takes its `meta.json` `title`, else its `index.md` `label`, else
its `index.md` `title`, else the directory name humanised.

## Frontmatter

```yaml
---
title: Authentication          # required
description: Bearer tokens.    # <meta name="description"> and search
label: Auth                    # sidebar label, when the title is too long
draft: true                    # excluded from nav, search and static params
order: 10                      # sort weight in directories without meta.json
aliases: [old-auth, legacy/auth]  # former URLs → permanent redirects
---
```

`title` is required on every `.md` file in the tree; a file without one fails
the build rather than shipping an untitled page.

`draft` is deliberately **not** tied to `NODE_ENV`. Vercel preview deployments
are production builds, so branching on it would hide drafts in exactly the place
reviewers look — drive `includeDrafts` from your own env check instead.

### Your own fields

Pass a `frontmatterSchema` and every `DocFile` and `RenderedDoc` the host hands
back carries your fields, with no type argument anywhere:

```ts
// content/docs-schema.ts — one module, imported by every route file
import { docFrontmatterSchema } from '@waveso/docs/frontmatter';
import { z } from 'zod';

export const frontmatterSchema = docFrontmatterSchema.extend({
  // `.exactOptional()`, not `.optional()` — see the note at the end.
  audience: z.enum(['user', 'operator']).exactOptional(),
});
```

```tsx
// app/docs/[...slug]/page.tsx
import { createDocsRoute } from '@waveso/docs/next';

import { frontmatterSchema } from '@/content/docs-schema';

const docs = createDocsRoute({
  contentDir: 'content/docs',
  frontmatterSchema,
});

export default docs.Page;
export const generateStaticParams = docs.generateStaticParams;
export const generateMetadata = docs.generateMetadata;
export const dynamicParams = false;

// In a layout or a page of your own — inferred, no `createDocsRoute<…>`:
const doc = await docs.getPage(['api', 'auth']);
doc?.frontmatter.audience; // 'user' | 'operator' | undefined
doc?.frontmatter.title; //    string
```

Five things are worth knowing before you write one.

**Let the type be inferred — never name it.** `createDocsRoute(...)`,
`createDocsSource(...)` and `parseFrontmatter(...)` all read your frontmatter
type off the schema you pass. Naming it explicitly *and* omitting the schema
type-checks and then lies:

```ts
// ⚠️ Compiles. Every extra field is `undefined` at runtime, typed as present.
const docs = createDocsRoute<MyFrontmatter>({ contentDir: 'content/docs' });
```

Nothing validates `MyFrontmatter` there, because no schema was supplied. Making
that unexpressible was tried — overloads requiring the schema whenever the type
is named — and reverted: the same rule also rejects passing a `DocsConfig<T>`
through generically, which is legitimate and which this package does internally.
Pass the schema, omit the type argument, and the hazard cannot arise.

**Any [Standard Schema](https://standardschema.dev) validator works** — Zod,
Valibot, ArkType. The field is typed `StandardSchemaV1<unknown, TFrontmatter>`
rather than as a Zod type, so the package does not dictate your validator, and a
schema handed over through the spec interface cannot hit the mismatch two copies
of Zod in one `node_modules` otherwise produce. `zod` stays a required peer
because `docFrontmatterSchema` itself is a Zod schema, and extending it is the
shortest path to a valid one.

**Unknown keys are stripped**, by Zod and by every other validator worth using.
The parsed frontmatter is exactly what the schema declares, so declare every
field you intend to read — under the base schema a page with `audience: operator`
parses fine and loses the value. `docFrontmatterSchema.extend(...)` keeps the
built-ins; a `z.object({ … })` written from scratch does not.

**The output must still satisfy `DocFrontmatter`.** `title` drives the `<h1>`
fallback and `<title>`, `draft` the visibility filter, `aliases` the redirects,
`order` and `label` the sidebar. A schema that drops them is a compile error
where you pass it, not a mystery at render time:

```ts
createDocsRoute({
  contentDir: 'content/docs',
  // Type error: `{ audience: string }` is not assignable to `DocFrontmatter`,
  // which requires `title`.
  frontmatterSchema: z.object({ audience: z.string() }),
});
```

**Identity is load-bearing.** The filesystem scan is memoised per resolved
config, and two schema objects count as the same schema only when they are the
same object — build one inline in each of the two route files and each file pays
for its own scan. Export one from a shared module, as above. (Sharing a scan
across *different* schemas would be far worse than an extra read: the cached
frontmatter belongs to whichever schema arrived first.)

A page the schema rejects fails the build, naming the file, every bad path, and
whose schema rejected it:

```
Invalid frontmatter in api/auth.md:
  - audience: Invalid option: expected one of "user"|"operator"
Fix the YAML block at the top of that file, or the `frontmatterSchema` in your docs config.
```

For a walk of your own, `@waveso/docs/frontmatter` exports the pieces directly.
`parseFrontmatter` is async because Standard Schema allows `validate` to return a
promise, and a schema with an async refinement does:

```ts
import { docFrontmatterSchema, parseFrontmatter } from '@waveso/docs/frontmatter';

const frontmatter = await parseFrontmatter(raw, 'api/auth.md', frontmatterSchema);
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

`TFrontmatter` is inferred from `frontmatterSchema` and defaults to
`DocFrontmatter`, so a config without one behaves exactly as before — see
[Your own fields](#your-own-fields).

`createDocsRoute` additionally accepts `langs`, `themes`, `highlighter`,
`titleHeading`, `linkResolver`, `imageResolver`, `components`, `contentId`,
`rescanPerRequest` and `siteUrl`.

`langs` is typed `readonly DocsLang[]` — the curated grammar set, re-exported
from `@waveso/docs/next` so you need not reach into the Node-only highlighter
entry point — so a typo is a compile error rather than a build-time one. Load a grammar outside that set by passing your own
`highlighter`.

`titleHeading` defaults to `true`: a page whose markdown does not start with
`# ` gets an `<h1>` built from `frontmatter.title`, because a document with no
`h1` has a broken heading outline and fails every accessibility audit. Turn it
off if your layout renders the title itself.

## Markdown support

GFM (tables, strikethrough, task lists, autolinks), GitHub alert syntax
(`> [!NOTE]` → `<callout type="note">`), heading ids and permalinks, dual-theme
Shiki highlighting, and lone images unwrapped out of their paragraph. Raw HTML
in the source is **dropped**, not passed through: `rehype-raw` is not in the
chain, and on its own it happily reparses `<script>` back into the tree.

A bare YouTube URL on its own line becomes a click-to-load facade — one ~15 KB
thumbnail instead of ~717 KB of embed and player JavaScript on page load. A
labelled link (`[the intro](https://youtu.be/…)`) keeps its label and stays a
link.

## Search

Build-time index, client-side dialog, MiniSearch. Records are section-scoped
(one per `h2`–`h6`) so a hit deep-links to the right heading instead of dropping
the reader at the top of a 2,000-word page.

Nothing builds the index for you, so build it yourself — `docs.renderAll()` is
there for exactly this, and it shares the scan, the highlighter and the render
cache with the routes:

```ts
// scripts/build-search-index.ts, run before `next build`
import { extractSearchRecords, writeSearchIndex } from '@waveso/docs/search-index';
import { docs } from '../lib/docs';

const rendered = await docs.renderAll();
const records = rendered.flatMap((doc) => extractSearchRecords(doc));
await writeSearchIndex(records, 'public/search-index.json');
```

```tsx
'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SearchDialog } from '@waveso/docs/react/search-dialog';

export function Search() {
  const router = useRouter();
  return (
    <SearchDialog
      indexUrl="/search-index.json"
      navigate={router.push}
      Link={Link}
    />
  );
}
```

MiniSearch is `import()`ed and the index fetched on hover, focus or first open —
never on page load.

## Why not MDX?

MDX is not markdown; it is a JavaScript module that looks like markdown. That
buys arbitrary components in prose and costs the thing this package exists to
protect: the output is code, so it has to be compiled and bundled per page, it
cannot be cached as JSON, it cannot cross the RSC boundary as data, and a
non-engineer can no longer safely edit a page. It also means an author can break
the build with a stray `<`.

Here the extension points are the component map and the `callout` element. If
you need a component in prose more than that allows, you need MDX — use it, and
accept the bundle.

## Why not react-markdown?

`react-markdown` parses **in the browser**. `unified` + `remark-parse` +
`remark-gfm` is roughly 60 KB gzipped shipped to every reader, plus Shiki if you
want highlighting, to do work that could have happened once at build time.

It also hardcodes `passNode: true` with no opt-out, so any component you map
that spreads its props renders `node="[object Object]"` into production HTML —
with no type error, because `node` is a legal prop on the component and an
unknown attribute on the element. `DocContent` leaves `passNode` off.

## Notes on this codebase

`exactOptionalPropertyTypes` is on, which is why the Zod schema uses
`.exactOptional()` — `.optional()` infers `{ description?: string | undefined }`,
which is not assignable to `DocFrontmatter`. Extenders need the same.

ESM-only, and not by preference: `unified` and the entire `remark-*`/`rehype-*`
lineage are `"type": "module"` with no CJS build, so a dual output would resolve
to nothing. `attw` reports `cjs-resolves-to-esm` for this package; that is the
intended shape, and the `check:package` script ignores that rule specifically.

## License

MIT
