---
title: Reference
description: Every entry point, every option, and what each one costs.
---

There is no root export. Every entry point is a subpath, so an import always
names the file it came from.

| Subpath | Environment | Contents |
| --- | --- | --- |
| `@waveso/docs/next` | Node | `createDocsRoute`, `createDocsSitemap`, `createDocsRedirects` |
| `@waveso/docs/source` | Node | `createDocsSource`, `resolveDocsConfig` |
| `@waveso/docs/render` | Node | `createDocsRenderer`, `resolveMarkdownLink` |
| `@waveso/docs/highlighter` | Node | `createDocsHighlighter`, `DEFAULT_DOCS_LANGS`, `DEFAULT_DOCS_THEMES` |
| `@waveso/docs/search-index` | Node | `extractSearchRecords`, `buildSearchIndex` |
| `@waveso/docs/frontmatter` | Any | `docFrontmatterSchema`, `parseFrontmatter`, `z` |
| `@waveso/docs/errors` | Any | `DocsErrorCode`, `DocsError`, `isDocsError`, `DOCS_ERROR_PREFIX` |
| `@waveso/docs/types` | Any | Every shared type. Type-only |
| `@waveso/docs/react/*` | Browser + RSC | Nine components, one per subpath |
| `@waveso/docs/styles.css` | — | The stylesheet |

The Node-only subpaths carry `"browser": null`, so importing one from client
code fails with a located *module not found* rather than resolving.

That is about **weight, not about `node:fs`**. `render`, `highlighter` and
`search-index` require no Node builtins at all — the pipeline runs wherever
JavaScript does, and Shiki is loaded through its JavaScript regex engine rather
than WASM on purpose. What a bundler would do with them is *succeed*, and ship
`unified` and every Shiki grammar to a reader.

## `createDocsRoute`

| Option | Default | |
| --- | --- | --- |
| `contentDir` | — | Required. Resolved against `process.cwd()` |
| `basePath` | `/docs` | Where the routes are mounted |
| `siteUrl` | — | Makes canonicals absolute. Must be an absolute URL |
| `includeDrafts` | `false` | `draft: true` pages join the routes |
| `titleHeading` | `true` | Emit an `h1` from the frontmatter title |
| `frontmatterSchema` | built-in | Any Standard Schema. Extend, do not replace |
| `remarkPlugins` | `[]` | Before link resolution |
| `rehypePlugins` | `[]` | After heading ids, before Shiki |
| `miniSearchOptions` | `{}` | Forwarded to the dialog automatically |
| `components` | `{}` | Merged over the built-in element map |
| `excludeLangs` | `[]` | Fences to route past the highlighter |

## `docs.Layout`

Five props, and a test fails when someone adds a sixth.

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `children` | `ReactNode` | — | The page |
| `title` | `ReactNode` | — | Brand, at the header start |
| `actions` | `ReactNode` | — | Header end, after search |
| `search` | `boolean \| DocsSearchProps` | `true` | The trigger; an object configures the dialog |
| `labels` | `DocsLabels` | English | The four strings the shell renders itself |

Everything else a docs shell gets asked for is already reachable. An
announcement banner renders *above* `docs.Layout` in your own layout, because it
does not own `<body>`. A content footer goes inside `children`. Sidebar links,
social icons and separators are `DocNavNode`s authored in `meta.json`.

## What it costs

| | At most |
| --- | --- |
| Everything the quick start ships, gzipped | 13.0 KB |
| Search dialog and router wiring | 9.0 KB |
| Navigation: sidebar and mobile drawer | 2.2 KB |
| Table of contents | 0.9 KB |
| Copy-button runtime | 0.9 KB |
| hast over the wire vs HTML, prose page | 1.20× |
| Highlighting vs no highlighting | 2.00× |

Every one is a ceiling `pnpm size` fails the build over, in CI and again in
`prepublishOnly`.

## Requirements

| | |
| --- | --- |
| Node.js | ≥ 22.12.0 |
| React | 19 |
| Next.js | 16 (optional peer) |
| Module format | **ESM only** |
| TypeScript | 5.9+ |

ESM-only is forced rather than chosen: `unified` and the entire `remark-*` /
`rehype-*` lineage are `"type": "module"` with no CJS build, so a dual output
would resolve to nothing.
