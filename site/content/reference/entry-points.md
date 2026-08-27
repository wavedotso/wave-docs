---
title: Entry points
description: Every subpath in the exports map, what it contains, and what it needs to run.
---

**There is no root export, and no wildcard.** Every entry point is enumerated in
`exports`, so an import always names the file it came from, and a name that is
not documented is not importable — see [Stability](./stability.md).

## The subpaths

| Subpath | Environment | Contents |
| --- | --- | --- |
| `@waveso/docs/next` | Node | `createDocsRoute`, `createDocsSitemap`, `createDocsRedirects` |
| `@waveso/docs/source` | Node | `createDocsSource`, `resolveDocsConfig` |
| `@waveso/docs/render` | Node | `createDocsRenderer`, `resolveMarkdownLink` |
| `@waveso/docs/highlighter` | Node | `createDocsHighlighter`, `DEFAULT_DOCS_LANGS`, `DEFAULT_DOCS_THEMES` |
| `@waveso/docs/search-index` | Node | `extractSearchRecords`, `buildSearchIndex` |
| `@waveso/docs/llms-txt` | Node | `buildLlmsTxt`, `buildLlmsFullTxt`, `toPortableMarkdown` |
| `@waveso/docs/react/<name>` | Browser + RSC | Eleven components, one per subpath — enumerated below |
| `@waveso/docs/frontmatter` | Any | `docFrontmatterSchema`, `parseFrontmatter`, `z` |
| `@waveso/docs/errors` | Any | `isDocsError`, `DOCS_ERROR_PREFIX`, and the `DocsError` and `DocsErrorCode` types |
| `@waveso/docs/types` | Any | Seventeen shared types. Type-only — it compiles to an empty JavaScript file |
| `@waveso/docs/styles.css` | — | The stylesheet |
| `@waveso/docs/package.json` | — | The manifest, for tooling that resolves it |

Each entry also exports the types that go with its function — `DocsRouteOptions`
from `next`, `DocsRendererOptions` and `DocsRenderer` from `render`,
`DocsHighlighterOptions` from `highlighter`, `DocsSource` from `source`. The
shapes those are written against live in `types`, which
imports nothing at runtime and can therefore be imported from a Node module, a
Server Component and a browser bundle alike.

`sideEffects` lists `*.css` and nothing else, so a bundler may drop any module
you do not import — and must keep the stylesheet, which is imported for its
effect rather than for a name.

### The React subpaths

Ten components, one file each. The boundary column is the directive the module
actually ships, which is what decides whose bundle it lands in:

| Subpath | Exports | |
| --- | --- | --- |
| `react/doc-content` | `DocContent` | Server Component. Mounts the copy runtime only when the tree contains a code frame |
| `react/markdown-components` | `createMarkdownComponents`, `defaultMarkdownComponents` | No client boundary anywhere under the map |
| `react/callout` | `Callout`, `CALLOUT_TYPES` | Server Component |
| `react/youtube` | `YouTube` | Server Component |
| `react/skip-link` | `SkipLink`, `DOCS_CONTENT_ID` | Server Component |
| `react/sidebar` | `DocsSidebar` | `'use client'`. Takes `pathname` as a prop |
| `react/toc` | `DocsToc` | `'use client'`. Scrollspy via `IntersectionObserver` |
| `react/search-dialog` | `SearchDialog` | `'use client'`. Host-agnostic |
| `react/next-search` | `DocsSearch` | `'use client'`. Imports `next/link` and `next/navigation` |
| `react/next-link` | `DocsLink` | `'use client'`. Imports `next/link` |

**`react/youtube` being a Server Component is load-bearing**, and
`server-boundary.test.ts` walks the whole map for a directive rather than
trusting the column above. [Internals](../internals.md) has the regression
that put the test there.

The props are in [Components](./components.md).

## `"browser": null`

The five Node-only subpaths carry `"browser": null` in the map, so importing one
from client code fails with a located *module not found* rather than resolving.

**That is about weight, not about `node:fs`.** Three of the five would bundle
without complaint: `render`, `highlighter` and `search-index` require no Node
builtins at all. The markdown pipeline runs wherever JavaScript does, and Shiki
is loaded through its JavaScript regex engine rather than WASM on purpose. What
a bundler would do with them is *succeed*, and ship `unified`, `remark-parse`
and every Shiki grammar to a reader — the exact outcome this package exists to
prevent, arriving with no error to notice. Only `source` and `next` genuinely
need the filesystem.

## Runtimes

What each entry *requires*, measured by bundling it with `platform: 'neutral'`
so nothing is resolved away as assumed-present, and asserted exactly — with
`toEqual`, never `toContain` — by `src/entry-runtime.test.ts`:

| Entry | Node builtins |
| --- | --- |
| `@waveso/docs/types` | none |
| `@waveso/docs/frontmatter` | none |
| `@waveso/docs/highlighter` | none |
| `@waveso/docs/render` | none |
| `@waveso/docs/search-index` | none |
| `@waveso/docs/llms-txt` | none |
| `@waveso/docs/source` | `node:fs/promises`, `node:path` |
| `@waveso/docs/next` | `node:crypto`, `node:fs/promises`, `node:path` |

`source` needs the filesystem because reading a content directory is what it is
for; `next` inherits its two and adds `node:crypto` for the search index's ETag.
A subset assertion would pass the moment a new builtin appeared, which defeats
the point of the file — one `node:crypto` import three modules deep costs
nothing locally and rules out every non-Node runtime at once. Both spellings
count, too: `gray-matter@4` did `require('fs')` rather than `node:fs`, for a
`matter.read()` this package never called, and a check that only looked for the
`node:` prefix would have reported the tree clean while it was not.

`errors` and the ten React subpaths are outside that set. Neither reaches a
builtin today — `errors` imports nothing at all, and the React modules import
`react`, each other, and in two cases `next` — but no assertion pins it.

> [!WARNING]
> A bundle that resolves is not a runtime. This is a statement about
> requirements, not a blessing — the package is tested on Node. Elsewhere, note
> that `render` bundles to roughly 2.8 MB with all eighteen default grammars
> inlined. Narrow `langs` for anything with a size limit, since grammars are
> dynamic imports. See [Code blocks](../guides/code-blocks.md).

## The `next` peer

`next` is an optional peer, and `@waveso/docs/next` is the only entry that
reaches for it. It does so through a dynamic `import()` with a literal
specifier, so a consumer's bundler still resolves it statically while
`next/link` and `next/navigation` stay off the module graph of anyone who never
touches this entry point — including `next.config.ts`, which loads it for
`createDocsSitemap` and `createDocsRedirects` outside the Next runtime.

When the peer is absent the failure is `missing-peer`, whose message names the
specifier and the alternative. Node's own `ERR_MODULE_NOT_FOUND` names a file
inside this package instead, which reads as our bug rather than a missing
install. The codes are in [Errors](./errors.md).

Two React subpaths import Next statically, and are named so the exception is
visible in the file list: `react/next-link` and `react/next-search`. Every other
component takes its link and image components as props, which is what keeps the
renderer testable without a router.

## No barrel file

```ts title="lib/docs.ts"
import { createDocsRoute } from '@waveso/docs/next';
import type { DocFile } from '@waveso/docs/types';
```

Subpaths rather than a root index, so every import names its origin and a
bundler can drop what you did not ask for. A root export would defeat both: one
module graph for the whole package, and `@waveso/docs` in the import line saying
nothing about which half of it you pulled in.

Two subpaths were deleted rather than kept for symmetry, and are not coming
back. `./markdown-links` froze six names to make one of them reachable, and the
plugin among those six throws unless the caller sets an undocumented field —
surface with no use. `./search-options` froze `tokenizeSearchText`, an
`Intl.Segmenter` policy with a feature-detect fallback, i.e. the function most
likely to change. `resolveMarkdownLink` survived, from `render`: six public
names became one, and it is the only one a `linkResolver` author cannot
hand-roll. What that policy does and does not promise is
[Stability](./stability.md).
