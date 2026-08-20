---
title: Writing content
description: The YAML block at the top of a page, and how to add fields of your own.
---

A page is a `.md` file with a YAML block at the top. The package reads six
fields from that block. Everything else in it is yours, once you say what it is.

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

`title` is required on every `.md` file in the tree. A file without one fails
the build rather than shipping an untitled page: the title drives the `<h1>`
fallback, `<title>`, the sidebar and search, so there is no reader-facing
surface a missing one leaves intact.

`description` becomes the `<meta name="description">` and the search snippet.
It is deliberately not length-capped. The 155–160 character advice is a
pixel-width heuristic about where Google truncates a snippet, not a limit —
enforcing it here would fail a build over prose that renders fine.

`label` replaces the title in the navigation, and nowhere else. Sidebars are
narrow; page titles are not.

`order` is a sort weight within one directory, for directories with no
`meta.json`. Lower sorts first; pages without an order sort last,
alphabetically. Ordering a whole section is
[`meta.json`'s job](./navigation.md).

`aliases` are the page's former URLs, relative to the docs base path. The Next
adapter turns them into permanent redirects, so a rename never becomes a silent
404 — [Links](../guides/links.md) covers what a legal alias looks like, and why
the spelling is validated rather than trusted.

### Drafts

A `draft: true` page is excluded from the navigation, from the search index and
from `generateStaticParams`, in every environment. There is no preview mode that
leaks it, and a link to one fails the build as `draft-link` rather than shipping
a link to a 404.

`includeDrafts` builds them anyway. It defaults to `false`.

```ts title="lib/docs.ts"
import { createDocsRoute } from '@waveso/docs/next';

export const docs = createDocsRoute({
  contentDir: 'content/docs',
  includeDrafts: process.env.DOCS_DRAFTS === '1',
});
```

**`draft` is deliberately not tied to `NODE_ENV`.** Preview deployments are
production builds, so branching on it would hide drafts in exactly the place
reviewers look. Drive `includeDrafts` from your own environment check instead.

## Your own fields

Pass a `frontmatterSchema` and every `DocFile` and `RenderedDoc` carries your
fields, inferred, with no type argument anywhere:

```ts title="content/docs-schema.ts"
import { docFrontmatterSchema, z } from '@waveso/docs/frontmatter';

export const frontmatterSchema = docFrontmatterSchema.extend({
  audience: z.enum(['user', 'operator']).exactOptional(),
});
```

```ts title="lib/docs.ts"
import { createDocsRoute } from '@waveso/docs/next';
import { frontmatterSchema } from '@/content/docs-schema';

export const docs = createDocsRoute({
  contentDir: 'content/docs',
  frontmatterSchema,
});
```

```ts
const doc = await docs.getPage(['api', 'auth']);

doc?.frontmatter.audience; // 'user' | 'operator' | undefined
doc?.frontmatter.title; //    string
```

Any [Standard Schema](https://standardschema.dev) validator works — Zod,
Valibot, ArkType. The field is typed `StandardSchemaV1<unknown, TFrontmatter>`
rather than as a Zod type, so the package does not dictate your validator. The
`z` above is re-exported from this package precisely so that extending
`docFrontmatterSchema` needs no install and no matching version.

Four things are worth knowing before you write one.

**Let the type be inferred — never name it.** Naming it explicitly *and*
omitting the schema type-checks and then lies, because nothing validates the
type you named:

```ts
// Compiles. Every extra field is `undefined` at runtime, typed as present.
const docs = createDocsRoute<MyFrontmatter>({ contentDir: 'content/docs' });
```

**Unknown keys are stripped**, by Zod and by every other validator worth using.
Declare every field you intend to read — under the base schema, a page with
`audience: operator` parses fine and silently loses the value.
`docFrontmatterSchema.extend(…)` keeps the built-ins; a `z.object({ … })`
written from scratch does not.

**The package's own fields survive a schema that forgets them.** `title` drives
the `<h1>` fallback and `<title>`, `draft` the visibility filter, `aliases` the
redirects, `order` and `label` the sidebar. All six are re-read from the raw
YAML and laid back over your schema's output, so a custom schema can only ever
*add* fields — it cannot drop or corrupt the ones the package reads itself. The
price is that a `.default()`, `.transform()` or `.coerce` aimed at one of the
six is not honoured: the YAML wins.

That is a runtime guarantee, not a compile-time one, and the difference matters.
`TFrontmatter extends DocFrontmatter` constrains only `title`, because the rest
are optional. A `z.object({ title, audience })` type-checks perfectly and used
to strip `draft` and `aliases` on the way through — publishing every draft,
submitting them to Google, and silently returning no redirects at all. Prefer
`docFrontmatterSchema.extend(…)` anyway: you then get the built-in fields in
*your* inferred type, rather than merely at runtime.

**Export the schema from one module.** The filesystem scan is memoised per
resolved config, and two schema objects count as the same schema only when they
are the same object. Build one inline in each route file and each file pays for
its own scan.

A page the schema rejects fails the build, naming the file, every bad path, and
whose schema rejected it:

```
Invalid frontmatter in api/auth.md:
  - audience: Invalid option: expected one of "user"|"operator"
Fix the YAML block at the top of that file, or the `frontmatterSchema` in your docs config.
```

`frontmatterSchema` sits beside every other option in
[Configuration](../reference/configuration.md), and the codes this validation
throws are listed in [Errors](../reference/errors.md).

Next: [Navigation](./navigation.md).
