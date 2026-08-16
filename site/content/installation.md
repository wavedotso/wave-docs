---
title: Installation
description: One dependency, three route files, and a folder of markdown.
---

```sh
pnpm add @waveso/docs
```

`react` and `react-dom` are required peers. `next` is optional — only
`@waveso/docs/next` needs it.

## Three route files

`[...slug]` does not match `/docs` itself, so the index needs its own
`page.tsx`. The third file serves the search index, which the layout's search
trigger reads.

```ts title="lib/docs.ts"
import { createDocsRoute } from '@waveso/docs/next';

export const docs = createDocsRoute({ contentDir: 'content/docs' });
```

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

```tsx title="app/docs/layout.tsx"
import '@waveso/docs/styles.css';
import { docs } from '@/lib/docs';

export default docs.Layout;
```

```ts title="app/docs/search-index.json/route.ts"
import { docs } from '@/lib/docs';

export const GET = docs.searchIndex;
export const dynamic = 'force-static';
```

That is a working documentation site: routing, a sidebar, a table of contents,
syntax highlighting, search, a mobile drawer and a skip link.

> [!IMPORTANT]
> `dynamicParams` must be written out as `false`, and `dynamic` as
> `'force-static'`. Route segment config is parsed statically before the module
> runs, so `export const dynamicParams = docs.dynamicParams` fails `next build`.
> Without it, Next invokes the route at request time for every unlisted URL to
> produce a 404 that was already knowable at build time — and `output: 'export'`
> refuses to build at all.

## The content folder

```
content/docs/
  index.md
  installation.md
  api/
    meta.json
    authentication.md
```

A directory becomes a section. `meta.json` names it and orders it:

```json title="content/docs/api/meta.json"
{
  "title": "API",
  "pages": ["authentication", "rate-limits"]
}
```

Pages not listed in `pages` come after the ones that are, alphabetically. A
`meta.json` naming a page that does not exist fails the build.

## Frontmatter

`title` is required — a page without one has a broken heading outline and fails
every accessibility audit.

```yaml
---
title: Authentication
description: API keys, scopes and rotation.
draft: false
---
```

A `draft: true` page is absent from routes, from the navigation and from the
search index, in every environment. There is no preview mode that leaks it.

Next: [make it yours](./styling.md).
