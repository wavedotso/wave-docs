---
title: Links
description: Markdown links rewritten to routes, and the checks that keep a broken one from shipping.
---

`[auth](./api/auth.md)` is the right way to link between markdown files. It
resolves on GitHub and in every editor preview — and it 404s once published,
unless something rewrites it. This package rewrites it, and checks the target.

## What the rewriter does

Relative links resolve against the containing document: the markdown extension is
dropped, `index` collapses onto the directory's own page, `?query` and `#anchor`
survive, and anything with a scheme is left alone. An extension that is not `.md`
or `.mdx` marks an asset; no extension at all is a page. Every rewritten href is
recorded, so its target can be asserted rather than shipped.

| Written in `guide/setup.md` | Becomes | |
| --- | --- | --- |
| `./auth.md` | `/docs/guide/auth` | Relative to this file's directory |
| `../api/index.md` | `/docs/api` | `index` is the directory's own page |
| `./auth.md#tokens` | `/docs/guide/auth#tokens` | The fragment survives, and is checked |
| `./schema.json` | `/docs/guide/schema.json` | An asset: folded, never checked against routes |
| `#tokens` | `#tokens` | A link into this page; the anchor is checked |

## Broken links

**`onBrokenLinks` defaults to `'throw'`, and should stay there.** A link that
404s was valid in your editor and on GitHub, so it is the kind of mistake nobody
finds by reading — and a warning in a build log is a warning nobody reads.
`'warn'` exists for a migration running knowingly against an incomplete corpus.

It and `onBrokenAnchors` take the same three values. `'throw'` fails the build
with a `DocsError` carrying the code; `'warn'` puts the identical message on
`console.warn`, ungated, because a build is the run being reported on; `'ignore'`
reports nothing. The error names the file, the line and the closest published
route when the link looks like a typo of one:

```
@waveso/docs: guide.md:12 links to './instalation.md', which resolves to
'/docs/instalation' — no such page exists. Did you mean '/docs/installation'?
Fix the link, or add an `aliases` entry to the page it used to point at.
```

**A suggestion is offered only for a genuine near-miss.** The ceiling is three
edits, scaled down by the length of what was written, so `/api` is never offered
as a fix for `/ui`. `/docs/instructions` is five edits from `/docs/installation` —
a different word, not a typo — and gets none: a wrong suggestion sends you to
rename a link that was correct.

Two failures get their own diagnosis. A link to a page marked `draft: true` is a
`draft-link`, because the file is plainly on disk and the generic message would
send you hunting a typo that is not there; a link to an alias is an `alias-link`,
and names the page to link instead. Both obey `onBrokenLinks` — see
[Errors](../reference/errors.md).

## Broken anchors

**`onBrokenAnchors` defaults to `'throw'`.** A route used to be verified and its
fragment thrown away, so `[setup](./install.md#setup)` built green with no `#setup`
anywhere on the page. It is the more common of the two failures: headings get
renamed constantly, and nothing renames the links into them.

```
@waveso/docs: guide.md:12 links to '#instalation', and this page has no
'#instalation'. Did you mean 'installation'? Heading ids come from the heading
text, so renaming a heading renames its anchor.
```

The check runs against every `id` in the rendered page rather than against the
table of contents — which captures `h2`–`h3` only, so a link to an `h4` is fine,
and so is a link to an id one of your [plugins](./plugins.md) put on something
that is not a heading. Lower it to `'warn'` if a plugin of yours adds ids this
package cannot see at render time.

Same-page anchors are checked as each page renders, where the tree and the
recorded links are both in hand, so those errors carry the file and the line.
Cross-page anchors need the target page's ids, which exist only once every page has
been rendered, and their message names the page rather than a line.

> [!IMPORTANT]
> `docs.renderAll()` is that pass, and it runs in every build that serves
> [search](./search.md) — the index route is `force-static`, so Next prerenders it.
> A site that never calls it gets the same-page half, which has the line numbers.

## Routes your application owns

**`externalRoutes` only matters at a root mount.** Under `basePath: '/docs'` an
absolute link either carries the prefix — so it is documentation and is checked —
or it does not, and this package leaves it alone. Under `basePath: '/'` there is
no prefix: `/setup` and `/login` look identical, and both are checked against the
published pages.

That is the right default: a root mount is what you choose when the origin serves
documentation and nothing else. If yours serves something else, name what is yours:

```ts title="lib/docs-root.ts"
import { createDocsRoute } from '@waveso/docs/next';

export const docs = createDocsRoute({
  contentDir: 'content/docs',
  basePath: '/',
  externalRoutes: ['/login', '/dashboard', '/api/'],
});
```

A link is skipped when it equals one of these or begins with one followed by `/` —
so `/api` covers `/api/keys` and not `/apiary`. Nothing here infers it.

## Aliases are redirects

**An alias is a redirect, not a page.** It is never prerendered, so linking one
from your markdown fails the build and names the page to link instead. Aliases are
validated as the file is read, so a rejection names the markdown it came from:

| Alias | |
| --- | --- |
| `quickstart`, `guides/old-name` | ✅ |
| `v1:beta`, `c++`, `docs/(old)` | ⛔️ path-to-regexp metacharacters |
| `../escape`, `./here` | ⛔️ relative segments |
| `''` | ⛔️ empty |

> [!WARNING]
> The rejected spellings are not pedantry. Next compiles a redirect `source` as a
> path pattern, so `aliases: ['v1:beta']` installed a **wildcard** — it built green
> and then permanently 308'd `/docs/v1-guide`, a real prerendered page, elsewhere.

Two pages claiming one alias, or an alias that shadows a real route, fails as
`alias-collision`: both silently lose a page otherwise, and both are typos.
Where aliases sit in the frontmatter is in
[Writing content](../getting-started/writing-content.md).

## Redirects and sitemap

Separate calls, usable from `next.config.ts` and `app/sitemap.ts` — neither
loads the Next runtime:

```ts title="next.config.ts"
import { createDocsRedirects } from '@waveso/docs/next';

export default { redirects: () => createDocsRedirects({ contentDir: 'content/docs' }) };
```

```ts title="app/sitemap.ts"
import { createDocsSitemap } from '@waveso/docs/next';

export default () =>
  createDocsSitemap({ contentDir: 'content/docs', siteUrl: 'https://example.com' });
```

Each alias becomes one permanent redirect to the page's route. The sitemap lists
every published page, drafts and aliases excluded — a redirect in a sitemap is a
crawl error — and dates each from the file's mtime.

`siteUrl` must be a bare origin. A path component
(`https://example.com/product-docs`) is rejected, because `new URL(href, siteUrl)`
discards it — every canonical and every sitemap entry would then point somewhere
that 404s. Put the path in `basePath`, which does take multiple segments; the rest
is in [Configuration](../reference/configuration.md).

Next: [Theming](./theming.md).
