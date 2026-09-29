---
title: Vite
description: A build plugin, a virtual module, and your own router.
---

Vite has no routing. That is not a gap to work around — it is the reason
`@waveso/docs/vite` is a *build plugin* rather than an adapter: it owns no
routes, renders no pages and decides no URLs.

It does the half no framework should have to: read the markdown, render it once,
check every link and anchor, and write out what a docs site serves. Your router
does the rest.

## The plugin

```ts title="vite.config.ts"
import { waveDocs } from '@waveso/docs/vite';

export default {
  plugins: [
    waveDocs({
      contentDir: 'content/docs',
      basePath: '/docs',
      llms: { title: 'Your product' },
    }),
  ],
};
```

That is the whole setup. Every option `createDocsRoute` takes for *rendering* —
`themes`, `langs`, `remarkPlugins`, `linkResolver`, `onBrokenLinks` — means the
same thing here, because both adapters build their renderer through the same
function.

## What it emits

Four things, under `basePath`, in `vite build` and from the dev server alike:

| Path | Contents |
| --- | --- |
| `search-index.json` | The MiniSearch index, unless `search: false` |
| `llms-full.txt` | Every page's markdown, when `llms` is set |
| `llms.txt` | One line per page, unless `llms.index` is `false` |
| `wave-docs/<slug>.json` | One rendered page each — the root page is `index.json` |

**The first three are the paths the Next adapter uses.** That is deliberate:
[`SearchDialog`](./search.md)'s `indexUrl` and the
[Copy page](./llms.md) button's `corpusUrl` default to exactly those, so a
component carried from a Next site to a Vite one keeps working with no prop
change.

Nothing is written into `public/`. In development the files are served from
memory, so there is no generated file in your repository for `git status` to ask
about and none to go stale while the dev server is off.

## The virtual module

```tsx
import { nav, pages, loadPage, searchIndexUrl, corpusUrl } from 'virtual:wave-docs';
```

`nav` is the tree [`DocsSidebar`](./layout.md) wants. `pages` is every
published page — slug, href, title, description — which is what a pager or an
index needs. Both are inlined, because the sidebar needs them on every route
anyway.

**The rendered pages are not inlined.** `loadPage(slug)` fetches one:

```tsx
const page = await loadPage(['guides', 'links']);
```

Inlining them instead would put the whole corpus in the entry chunk — a reader
downloads two hundred pages to read one. What comes back is already parsed and
already highlighted, so the markdown parser and Shiki stay out of your bundle
exactly as they do under Next.

For types, reference the client declarations once:

```ts title="src/vite-env.d.ts"
/// <reference types="@waveso/docs/vite-client" />
```

## What you supply

Two values the framework would otherwise give you, both already ordinary props
on every component in this package:

```tsx
<DocsSidebar nav={nav} pathname={pathname} Link={Link} />
<SearchDialog indexUrl={searchIndexUrl} navigate={navigate} />
```

`pathname` is a string and `navigate` is a function — `router.push`, a
`react-router` navigate, or `location.assign`. Omit `Link` and links render as
a plain `<a>`.

## What it costs

The markdown parser and Shiki run at build time, so neither ships. What a
client-rendered app pays and a Next app does not is the hast-to-React step —
about 13.6 KB gzipped, through `DocContent`. There is no server render to do it
in.

The alternative would be to emit HTML strings and inject them. This package
will not: it uses `dangerouslySetInnerHTML` nowhere, and the `components` map
that turns a callout or a code frame into a real component is the reason the
hast tree exists at all.

## No Vite peer dependency

The plugin's own types are declared structurally rather than imported from
`vite`, so this package neither depends on Vite nor pins a Vite major. There is
no version for it to be incompatible with and no major bump to chase.

## Links still fail the build

`contentDir` is outside Vite's module graph, so nothing else in a Vite build has
any reason to look at it — which is exactly why a link check has to live in the
plugin. A link to a page that does not exist, or an anchor to a heading that was
renamed, fails `vite build` rather than shipping:

```ts
waveDocs({ contentDir: 'content/docs', onBrokenLinks: 'throw' })
```

Cross-page anchors are checked once every page is in hand, which is the first
moment they can be: a single page's render can prove `#setup` exists on itself
and nothing about `./other.md#setup`.
