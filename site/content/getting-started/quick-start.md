---
title: Quick start
description: One command between an empty Next application and a documentation site.
---

```bash
npx @waveso/docs init
```

That writes every file below into an existing Next application. It never
overwrites: anything already there is reported and left alone, so a second run
is safe and a project that already has a `layout.tsx` cannot lose it.

```
--app-dir <dir>       where the App Router lives            (app)
--config <file>       where createDocsRoute goes            (lib/docs.ts)
--content-dir <dir>   where your markdown lives             (content/docs)
--base-path <path>    where the docs are mounted            (/docs)
--site-url <url>      your origin, for canonicals and links
--llms-index          also write llms.txt, the agent index
```

Then put markdown in `content/docs/` and uncomment `siteUrl`.
[Installation](./installation.md) is the single dependency all of this assumes.

**Six small files, so why a scaffold?** Because three of them fail *silently*
when they are slightly wrong. A `dynamicParams` that is not a literal `false`
builds green and then renders unlisted URLs on demand. A route handler missing
`export const dynamic = 'force-static'` re-renders your whole corpus per
request, from markdown that is not in the deployment bundle. An index page
nobody created leaves the mount itself a 404. The file count is Next's floor —
a route is a folder in *your* `app/`, and no package can add one — but the
typing is not.

The rest of this page is what it writes, and why.

## Create the route once

```ts title="lib/docs.ts"
import { createDocsRoute } from '@waveso/docs/next';

export const docs = createDocsRoute({ contentDir: 'content/docs' });
```

`contentDir` resolves against `process.cwd()`, which is the project root during
`next build`. `basePath` defaults to `/docs`, so that is where the routes below
are mounted; every other option is in
[Configuration](../reference/configuration.md).

Calling `createDocsRoute` a second time costs nothing — the filesystem scan,
the highlighter and the component map are shared per process. The shared module
is for the options, so a `siteUrl` or an `imageResolver` is written in one place
rather than in each route file.

## Two page files, not one

```tsx title="app/docs/[...slug]/page.tsx"
import { docs } from '@/lib/docs';

export default docs.Page;
export const generateStaticParams = docs.generateStaticParams;
export const generateMetadata = docs.generateMetadata;
export const dynamicParams = false;
```

```tsx title="app/docs/page.tsx"
import { docs } from '@/lib/docs';

export default docs.IndexPage;
export const generateMetadata = docs.generateMetadata;
```

**The second file is not optional, and leaving it out is the most common way to
ship this broken.** `[...slug]` does not match `/docs` itself: the route table
emits `/docs/index`, and `/docs` returns 404. The root `index.md` is absent from
`generateStaticParams` for the same reason — its segments are `[]`, and a
catch-all cannot render an empty parameter list.

**The fix is a sibling `page.tsx`, not an optional catch-all.** `[[...slug]]`
would match `/docs` and save this file, at the cost of a duplicate route —
[Internals](../internals.md) has the argument.

> [!IMPORTANT]
> `dynamicParams` must be written out as the literal `false`. Route segment
> config is parsed statically out of the module before any of it runs, so
> `export const dynamicParams = docs.dynamicParams` fails `next build` with
> "Next.js can't recognize the exported `dynamicParams` field in route. It needs
> to be a static boolean." The field exists on the route object so the value is
> documented in one place and typed as `false`, not so it can be forwarded.

Declaring it is not optional either. Next defaults `dynamicParams` to `true`, so
a URL `generateStaticParams` never listed is still invoked on demand: the route
runs on a server at request time to produce a 404 that was already knowable at
build time. `output: 'export'` refuses to build without it at all.

## The layout

```tsx title="app/docs/layout.tsx"
import '@waveso/docs/styles.css';
import { docs } from '@/lib/docs';

export default docs.Layout;
```

That line is the whole shell — a skip link, the grid, and the sidebar that
carries the navigation, the search trigger and, below 64rem, the drawer
trigger. **It renders no header.** A host's own header, theme toggle and
repository link are rendered around `docs.Layout`, in the layout file that
wraps it. [Layout](../guides/layout.md) covers the three props and composing
your own instead; the stylesheet's tokens are in
[Theming](../guides/theming.md).

It does not own the table of contents. A Next layout receives
`{ children, params }` and cannot know which page is rendering, so `docs.Page`
emits the table of contents as its second child and the grid places it.

## The search route

```ts title="app/docs/search-index.json/route.ts"
import { docs } from '@/lib/docs';

export const GET = docs.searchIndex;
export const dynamic = 'force-static';
```

**`docs.Layout` renders the search trigger by default, so leaving this file
out ships a control that opens onto "Search is unavailable right now. Try
reloading the page."** For a site that genuinely wants no search,
`search={false}` drops both the trigger and this file:

```tsx title="app/docs/layout.tsx"
import type { ReactNode } from 'react';
import '@waveso/docs/styles.css';
import { docs } from '@/lib/docs';

export default function DocsLayout({ children }: { children: ReactNode }) {
  return <docs.Layout search={false}>{children}</docs.Layout>;
}
```

**`dynamic = 'force-static'` must be written out as a literal too**, or the
route throws `search-index-dynamic` at the reader, inside the search dialog.
[Search](../guides/search.md) has that failure in full, and the caching
headers the route sets in place of Next's.

## The corpus route

```ts title="app/docs/llms-full.txt/route.ts"
import { docs } from '@/lib/docs';

export const GET = docs.llmsFullTxt;
export const dynamic = 'force-static';
```

Every published page's markdown in one file — for agents, and for the **Copy
page** button, which reads it and slices out the page it is on. The button is
on by default once `llms` is configured, and needs nothing else.

Leave this file out and the button removes itself on the first click; that
failure is deliberate, and [Markdown for agents](../guides/llms.md) has the
whole story, including why the button does not use a `.md` URL per page.

## The content folder

```
content/docs/
  index.md
  getting-started.md
  api/
    meta.json
    authentication.md
```

`index.md` at the root is what `docs.IndexPage` renders; every other file is a
page under the catch-all. A directory becomes a section, and `meta.json` names
and orders it — see [Navigation](./navigation.md). Frontmatter, drafts and
schema fields of your own are in [Writing content](./writing-content.md).

## What you have now

Routing, a navigation sidebar, a table of contents, syntax highlighting, search,
a mobile drawer, a skip link, a corpus for agents and a Copy page button — from
six files, none longer than a dozen lines, and no layout CSS of your own. This
site is built from the same six.

Every failure this package raises carries a `DocsErrorCode`, and
[Errors](../reference/errors.md) lists each one with its fix.
