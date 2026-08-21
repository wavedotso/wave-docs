---
title: Errors
description: Every DocsErrorCode this package raises, what produced it, and what to change.
---

Every failure this package raises is an `Error` whose message names the package
and which carries a `code`. That exists so a host can branch on the kind of thing
that went wrong rather than on message text — downgrade a broken link in a
preview build, report `invalid-frontmatter` differently from `missing-peer`.

## Branching on a failure

`isDocsError` narrows an unknown caught value. It checks the message prefix as
well as the shape, so an unrelated `Error` that happens to carry a `code` —
Node's own `ENOENT`, for one — is not mistaken for this package's:

```ts title="lib/render-docs.ts"
import { isDocsError } from '@waveso/docs/errors';
import { docs } from '@/lib/docs';

try {
  await docs.renderAll();
} catch (error) {
  if (isDocsError(error) && error.code === 'draft-link') {
    console.warn(error.message);
  } else {
    throw error;
  }
}
```

**No error class is exported, and that is deliberate.** `instanceof` against a
copy of a module resolved twice — two versions installed in a monorepo, a bundler
that duplicates it — silently answers `false`. It does not throw and it does not
warn; the branch stops being taken, in the build where it mattered. A
string `code` and a structural guard have no such failure mode.

**`DocsErrorCode` is a union of string literals, not `string`.** A `switch` over
it is exhaustive, so adding a code makes an unhandled branch a type error rather
than a silent fall-through, and `'draft_link'` fails to compile instead of
comparing `false` forever.

```ts title="lib/report.ts"
import type { DocsErrorCode } from '@waveso/docs/errors';

const isAuthorMistake = (code: DocsErrorCode): boolean =>
  code === 'broken-link' || code === 'draft-link' || code === 'broken-anchor';
```

`DocsError` is the interface — an `Error` with a `readonly code` — for a
signature that wants to name it. The entry point is `@waveso/docs/errors`, which
imports no Node builtin and is listed in [Entry points](./entry-points.md).

## The codes

Twenty-one, exhaustively.

| Code | What happened | What to do |
| --- | --- | --- |
| `broken-link` | A markdown link resolves to a route no published page owns. | Fix the link, or add an `aliases` entry to the page that moved. The message names the closest published route when it looks like a typo. |
| `draft-link` | A link points at a page that exists but is `draft: true`. | Publish the page, drop the link, or build with `includeDrafts`. |
| `alias-link` | A link points at an alias, which is a redirect and not a page. | Link the page the alias redirects to — the error names it. |
| `broken-anchor` | A `#fragment` that no heading on the target page owns. | Fix the link, or restore the heading — heading ids come from the heading text. |
| `invalid-alias` | An `aliases` entry is empty, escapes the content root, is not valid percent-encoding, or contains redirect pattern syntax — `:` `(` `)` `+` `*` `?` `{` `}`. | Write it as a literal former URL, relative to the base path — `aliases: [legacy/old-name]`. The accepted spellings are in [Links](../guides/links.md). |
| `alias-collision` | Two pages claim one alias, or an alias shadows a real route. | Remove one of them; a redirect cannot have two destinations. |
| `route-collision` | Two files resolve to the same route. | Usually `about.md` beside `about/index.md`. Rename one, or delete the other. |
| `invalid-frontmatter` | A page has no frontmatter block, or the schema rejected it. | Every page needs at least `title`. The message names the file and the field. |
| `invalid-meta` | A `meta.json` is not JSON, is malformed, names a page that is not there, or has more than one `"..."` entry. | Check the filename spelling — entries are filenames without the extension. |
| `invalid-config` | An option passed to this package cannot be used as given. | The message names the option. `siteUrl` must be an absolute origin with no path; `miniSearchOptions` functions cannot cross the server boundary. |
| `missing-content-dir` | `contentDir` does not point at a readable directory. | It resolves against `process.cwd()`, which is the project root under `next build`. |
| `broken-symlink` | A markdown page is reachable only through a broken symbolic link. | Repoint or delete the link. Skipping it would delete a route nobody asked to delete. |
| `descriptor-limit` | The process ran out of file descriptors while scanning the content directory. | Raise the limit, not the corpus. See below. |
| `invalid-image` | A relative image needs an `imageResolver`, or one returned an unusable shape, or a `src` climbs above the content root. | Return `{ src, width?, height? }` or `undefined`, or use an absolute `/path` the browser can resolve. |
| `unknown-theme` | A theme name outside the supported set. | Pick a supported theme — the message lists them — or pass a `highlighter` of your own. |
| `unknown-language` | A fence language outside the loaded set. | Add it to `langs`, or accept the plain-text fallback. |
| `missing-peer` | `next` is absent, or not the shape this adapter expects. | Install `next`, or build pages from `@waveso/docs/react/*` with your own loader. |
| `search-index-unavailable` | The dialog could not fetch or parse the index. | A 404 means the route file was never created; anything else, check `indexUrl` — pass `docs.searchIndexUrl`, and prefix it yourself under a Next `basePath`. |
| `search-index-dynamic` | The search-index route ran at request time instead of prerendering. | Add `export const dynamic = 'force-static'` to the route file. See below. |
| `invalid-code-meta` | A fence's `title=` cannot be read. | Quote it with double quotes: `title="app/page.tsx"`. |
| `internal` | A plugin ran without context this package always supplies. | This one is a bug here, not there. |

Four of these are severity-gated rather than fatal. `broken-link`, `draft-link`
and `alias-link` obey `onBrokenLinks`; `broken-anchor` obeys `onBrokenAnchors`.
Both default to `'throw'`, and at `'warn'` the identical message goes to
`console.warn` with no code to catch — both are set in
[Configuration](./configuration.md), and [Links](../guides/links.md) has the
whole story.

## The ones worth more than a row

### `search-index-dynamic`, and the literal

Route segment config is parsed before the module runs, so
`export const dynamic = 'force-static'` has to be a literal. The route file is
on [Search](../guides/search.md); the cost, in [Internals](../internals.md).

### `descriptor-limit`, and the bound of 64

The scan holds at most 64 descriptors open at a time, so reaching this code
means the limit is below 64, or something else in the process holds them.
Raise it with `ulimit -n`; [Internals](../internals.md) measures the bound.

### `internal` is a bug here

Every other code describes something in a project's own content or configuration.
`internal` describes a plugin of this package's running without context this
package always supplies — `remarkDocLinks` without `file.data.docLinkContext`,
which `createDocsRenderer` always sets. Reaching it from ordinary use means a
defect here. Report it with the stack trace; the stack is deliberately left
unflattened, `dist/` frames and all, because those are the frames a maintainer
needs.

## The prefix

`DOCS_ERROR_PREFIX` is `'@waveso/docs: '`, and it is exported so a log filter can
be written against a constant rather than a copied string. Every message carries
it — that is what `isDocsError` tests, and before it existed roughly half the
messages omitted the package name, so `message.startsWith('@waveso/docs:')` was
not even a reliable filter.

`code` is attached non-enumerably, so it does not appear in `JSON.stringify` or a
spread. Error objects look exactly as they did, and are branchable.

In a build log a failure reads as one paragraph — the package, the file, the
line, what was written, what it resolved to, and what to do about it.
[Links](../guides/links.md) prints one in full.

Next: [Stability](./stability.md).
