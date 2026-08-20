---
title: Configuration
description: Every option createDocsRoute accepts, its type and its default, and what it hands back.
---

`createDocsRoute` takes one object and returns one. The object it takes is
`DocsRouteOptions`: the seven fields of `DocsConfig`, which describe the content
tree and are shared with every other function in the package, plus thirteen that
configure the render pipeline, search, the component map and the chrome.

## The type

```ts
interface DocsRouteOptions<
  TFrontmatter extends DocFrontmatter = DocFrontmatter,
> {
  contentDir: string;
  basePath?: string;
  includeDrafts?: boolean;
  siteUrl?: string;
  frontmatterSchema?: StandardSchemaV1<unknown, TFrontmatter>;
  onBrokenLinks?: DocsLinkSeverity;
  onBrokenAnchors?: DocsLinkSeverity;
  externalRoutes?: readonly string[];
  langs?: readonly DocsLang[];
  themes?: DocsThemes;
  highlighter?: DocsHighlighter | Promise<DocsHighlighter>;
  excludeLangs?: readonly string[];
  titleHeading?: boolean;
  remarkPlugins?: PluggableList;
  rehypePlugins?: PluggableList;
  linkResolver?: LinkResolver;
  imageResolver?: ImageResolver;
  miniSearchOptions?: Partial<Options<SearchRecord>>;
  components?: MarkdownComponents;
  labels?: DocsLabels;
}

type DocsLinkSeverity = 'throw' | 'warn' | 'ignore';
```

Twenty options, one of them required. Every optional is really declared
`?: T | undefined` rather than `?: T`, so a value you computed and may hand over
as `undefined` is accepted under `exactOptionalPropertyTypes` instead of forcing
a conditional spread at the call site.

## Content and routing

| Option | Type | Default | |
| --- | --- | --- | --- |
| `contentDir` | `string` | — | The content root. Relative paths resolve against `process.cwd()` |
| `basePath` | `string` | `'/docs'` | URL prefix the routes are mounted at. Multiple segments are fine |
| `includeDrafts` | `boolean` | `false` | Publish pages marked `draft: true`. Deliberately not tied to `NODE_ENV` |
| `siteUrl` | `string` | — | Absolute origin. Makes every `alternates.canonical` and `og:url` absolute |

Drafts are excluded from navigation, search and `generateStaticParams`, and a
link to one fails the build with `draft-link` rather than the generic
`broken-link` — the message names the reason, because "no such page exists" is
unfollowable advice about a file plainly sitting on disk. Gate `includeDrafts`
on an env check of your own: a Vercel preview is a production build, so
branching on `NODE_ENV` hides drafts in the one place reviewers look. See
[Writing content](../getting-started/writing-content.md).

### `contentDir`

Resolved with `path.resolve(process.cwd(), contentDir)`, which is the project
root under both `next build` and `vite build`. The resolved path is the first
fragment of the memoisation key: sources are cached per resolved config, so the
route files of a docs site share one filesystem scan rather than each starting
their own. Calling `createDocsRoute` once at module scope in every route file is
the intended shape, and the second call is free.

### `basePath`

Normalised to a leading slash and no trailing one, so every href elsewhere is a
plain concatenation. `'/'` normalises to `''` — the Next convention — and runs of
slashes collapse, which is not cosmetic: `'//docs'` is read by a browser as
scheme-relative, and every canonical, `og:url` and sitemap entry on the site
would point at a host called `docs`.

A root mount changes one behaviour, and only one: absolute links carry no prefix
to test against, so `externalRoutes` starts to matter.

### `siteUrl`

**A bare origin, or the build fails with `invalid-config`.** Canonicals and
sitemap entries are built with `new URL(href, siteUrl)`, and that discards a
path: `'/docs/x'` against `'https://example.com/product-docs'` yields
`https://example.com/docs/x`. The whole site would then publish canonicals
pointing at URLs that 404, and Google reads a canonical aimed at a 404 as a
reason to drop the page. Put the path in `basePath`, which does take multiple
segments.

Omit it and the canonical is a root-relative path, which Next resolves against
`metadataBase`. Set neither and the pages ship with no usable canonical at all.

## Validation

| Option | Type | Default | |
| --- | --- | --- | --- |
| `frontmatterSchema` | `StandardSchemaV1<unknown, TFrontmatter>` | `docFrontmatterSchema` | Validates every page's frontmatter, and types what you read back |
| `onBrokenLinks` | `DocsLinkSeverity` | `'throw'` | An internal link that resolves to no published page |
| `onBrokenAnchors` | `DocsLinkSeverity` | `'throw'` | A `#fragment` no heading on the target page owns |
| `externalRoutes` | `readonly string[]` | `[]` | Route prefixes your application owns, not the documentation |

### `frontmatterSchema`

Any [Standard Schema](https://standardschema.dev) validator — Zod, Valibot,
ArkType — rather than a Zod type specifically, so the package dictates no
validator and a schema handed over through the spec interface cannot hit the
cross-instance mismatch two copies of Zod in one `node_modules` produce. The
inferred `TFrontmatter` flows into every `DocFile` and `RenderedDoc` the route
returns, with no type argument anywhere in the route file.

> [!IMPORTANT]
> **Export it from one shared module and import that.** The scan is memoised per
> resolved config, and two schema objects are the same schema only when they are
> the same object — so a schema built inline in each route file buys each file
> its own filesystem walk. [Writing content](../getting-started/writing-content.md)
> has the module.

The package's own six fields — `title`, `description`, `label`, `draft`,
`aliases`, `order` — are re-read from the YAML and laid back over your output
whatever your schema says, so a bare `z.object({ title, audience })` cannot lose
a redirect. It only costs you the six in the inferred type.

### The two severities

Both take `'throw'`, `'warn'` or `'ignore'`, and both default to `'throw'`. A
link that 404s was valid in your editor and on GitHub, so it is the kind of
mistake nobody finds by reading — and `'warn'` is a line in a build log, which
is a line nobody reads. It exists for a migration running knowingly against an
incomplete corpus.

`onBrokenAnchors` is the more common failure of the two: headings get renamed
constantly and nothing renames the links into them. It is checked against every
`id` in the rendered page rather than against the table of contents, which
captures `h2`–`h3` only — so a link to an `h4`, or to an id one of your
`rehypePlugins` added, is fine. Lower it to `'warn'` if a plugin of yours adds
ids this package cannot see at render time. Both errors name the file, the line
and the closest near-miss; [Links](../guides/links.md) has the messages.

### `externalRoutes`

**Only meaningful at a root mount, which is also the only place it is needed.**
Under `basePath: '/docs'` an absolute link either carries the prefix — so it is
documentation, and is checked — or it does not, and this package leaves it
alone. Under `basePath: '/'` there is no prefix: `/setup` and `/login` look
identical, and both are checked against the published pages.

That is the right default, because a root mount is what you choose when the
origin serves documentation and nothing else. If yours serves something else
too, name what is yours:

```ts title="lib/docs.ts"
export const docs = createDocsRoute({
  contentDir: 'content/docs',
  basePath: '/',
  externalRoutes: ['/login', '/dashboard', '/api/'],
});
```

A link is skipped when it equals one of these or begins with one followed by
`/` — so `/api` covers `/api/keys` and not `/apiary`. It is a statement about
your application, so nothing here infers it.

## The pipeline

| Option | Type | Default | |
| --- | --- | --- | --- |
| `langs` | `readonly DocsLang[]` | eighteen grammars | Grammars loaded into the default highlighter. Anything else falls back to plain text |
| `themes` | `DocsThemes` | `github-light` / `github-dark` | The light and dark pair. Both are emitted, and CSS picks |
| `highlighter` | `DocsHighlighter \| Promise<DocsHighlighter>` | built from `langs` and `themes` | Reuse your own — the escape hatch for a grammar or theme outside the curated set |
| `excludeLangs` | `readonly string[]` | — | Fence languages Shiki must not touch, e.g. `['mermaid']` |
| `titleHeading` | `boolean` | `true` | Prepend an `<h1>` from `frontmatter.title` when the body has none |
| `remarkPlugins` | `PluggableList` | — | Attached after `remarkGfm`, before link resolution |
| `rehypePlugins` | `PluggableList` | — | Attached after heading ids and permalinks, before the code steps |
| `linkResolver` | `LinkResolver` | built-in | Replaces markdown-link resolution entirely |
| `imageResolver` | `ImageResolver` | — | Maps an image `src` to a public URL and its intrinsic dimensions |

Turn `titleHeading` off only if your layout renders the page title itself: a
document with no `h1` fails `page-has-heading-one`, and markdown that repeats
the frontmatter title as `# ` is a duplication authors forget to keep in step.

**Both themes are emitted at once, and CSS picks.** Shiki is run with
`defaultColor: false`, so a `<pre>` carries `--shiki-light` and `--shiki-dark`
custom properties rather than an inline `background-color` from whichever theme
was called default — which used to paint the light background onto code blocks
in dark mode, and could only be fought off with `!important`. See
[Theming](../guides/theming.md).

Both plugin slots are attached once, to a processor shared by every file, so a
plugin holding state accumulates it across the whole build rather than per
document. The positions are the useful ones and are not negotiable —
[Plugins](../guides/plugins.md) explains what each slot sees. Grammars and fence
handling are in [Code blocks](../guides/code-blocks.md); the resolvers, their
arguments and the folding done before they are called are in
[Images](../guides/images.md) and [Links](../guides/links.md).

## Search

| Option | Type | Default | |
| --- | --- | --- | --- |
| `miniSearchOptions` | `Partial<Options<SearchRecord>>` | `{}` | MiniSearch overrides for the index `docs.searchIndex` builds |

**The identical object must reach the dialog.** MiniSearch reads `tokenize` and
`processTerm` both when indexing and when querying, so applying one here and not
there produces an index whose terms no query can spell: zero results, no error,
nothing in the console. `docs.Layout` forwards the serialisable half for you and
throws `invalid-config` on the rest rather than dropping it quietly.
[Search](../guides/search.md) has the `'use client'` recipe for a function-valued
override.

## Components

| Option | Type | Default | |
| --- | --- | --- | --- |
| `components` | `MarkdownComponents` | `next/link` + `next/image` | Overrides, merged over the Next-flavoured defaults |

The default map is built once per process and wires `next/link` and
`next/image` through dynamic imports, so `next.config.ts` can load this entry
point for the sitemap and the redirects without either on its module graph.
Yours are merged over it key by key. The element names available are in
[Components](./components.md).

## The chrome

| Option | Type | Default | |
| --- | --- | --- | --- |
| `labels` | `DocsLabels` | English | Every string this package renders that is not your content |

**The route is where they belong, because they do not all live in one
runtime.** Four are rendered by the shell, three by the navigation tree, two
by the table of contents, nine by the component map, two by a client-side copy
runtime, and two are baked into the HTML by a rehype plugin at build time — so
`docs.Layout`'s own `labels` prop can reach four of the twenty-two, and
overrides these key by key rather than replacing them.
[Translating the chrome](../guides/translating.md) lists all twenty-two with
their defaults.

## What the route returns

| Member | Type | |
| --- | --- | --- |
| `Page` | `(props: DocsPageProps) => Promise<ReactNode>` | Default export for `app/<basePath>/[...slug]/page.tsx` |
| `IndexPage` | `() => Promise<ReactNode>` | Default export for `app/<basePath>/page.tsx`. Not optional — `[...slug]` does not match the base path itself |
| `generateStaticParams` | `() => Promise<Array<{ slug: string[] }>>` | For the catch-all. The root `index.md` is absent by design: its segments are `[]` |
| `generateMetadata` | `(props: DocsPageProps) => Promise<DocsPageMetadata>` | Title, description, `alternates.canonical`, and an `article` Open Graph block |
| `dynamicParams` | `false` | Read it, do not re-export it. Your route file must declare the literal |
| `Layout` | `(props: DocsLayoutProps) => Promise<ReactNode>` | The whole shell: skip link, header, sidebar column, mobile drawer, grid |
| `source` | `DocsSource<TFrontmatter>` | `all`, `drafts`, `find`, `nav`, `slugs`, `invalidate`, and the resolved `config` |
| `getPage` | `(segments: string[]) => Promise<RenderedDoc<TFrontmatter> \| undefined>` | One page rendered — `hast`, `toc`, `frontmatter`. `undefined` when there is no such page |
| `renderAll` | `() => Promise<Array<RenderedDoc<TFrontmatter>>>` | Every published page. The escape hatch behind `searchIndex` |
| `searchIndex` | `() => Promise<Response>` | `GET` for `app/<basePath>/search-index.json/route.ts` |
| `searchIndexUrl` | `string` | The base path with `/search-index.json` appended. Not prefixed with Next's own `basePath` config |

**Two route files need a route segment config that is a literal, and neither can
be forwarded from here.** Next parses those out of the module before any of it
runs, so `export const dynamicParams = docs.dynamicParams` fails `next build`
outright — `docs.dynamicParams` exists to document the value and type it as
`false`, and you write `export const dynamicParams = false` yourself. The other
is `dynamic = 'force-static'` on the search-index route, which is not on this
object at all: without it Next re-renders your entire corpus on every request,
from markdown that output tracing did not put in the deployment bundle. The
handler detects that at runtime and throws `search-index-dynamic` rather than
failing quietly.

Outside a production build the route re-reads the content directory once per
request, because markdown is not in Next's module graph and nothing
re-evaluates a route module when a file changes.

## The other four functions

Each takes a slice of the same config, so one options object can feed all of
them.

| Function | Config it takes | |
| --- | --- | --- |
| `createDocsSource` | `DocsConfig` | The filesystem walk alone — no renderer, no highlighter. Memoised per resolved config |
| `createDocsRenderer` | `DocsRendererOptions` | Its `config` is four resolved fields: `basePath`, `onBrokenLinks`, `onBrokenAnchors`, `externalRoutes` |
| `createDocsSitemap` | `DocsConfig` + four | `siteUrl` is required here, plus `changeFrequency`, `priority` and `lastModified` |
| `createDocsRedirects` | `DocsConfig` | Every published page's `aliases`, as permanent redirects resolved against `basePath` |

`DocsRendererConfig` is declared as a `Pick` of `ResolvedDocsConfig` so a full
resolved config passes straight through — the host resolves configuration once,
with `resolveDocsConfig`, and hands the same object to the walk and to the
renderer, which is what keeps the two from drifting. The renderer's own options
repeat the pipeline set above and add four the route fills in for you:
`knownRoutes`, `draftRoutes` and `aliasRoutes` from the source walk, and
`codeLabels`, which the route derives from `labels`.

`createDocsSitemap`'s `lastModified` defaults to the file's mtime, which on a CI
runner is the checkout time — every page then claims to have changed today.
Wire it to your git history if the dates are load-bearing. Drafts are excluded,
and so are aliases: an alias is a redirect, and listing a redirect in a sitemap
is a crawl error. Both functions are safe to call from `next.config.ts`, which
loads this entry point outside the Next runtime. Where each one lives is
[Entry points](./entry-points.md); what a failure means is
[Errors](./errors.md).

Next: [Entry points](./entry-points.md).
