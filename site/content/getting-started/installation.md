---
title: Installation
description: One package, three peers, two that deliberately are not peers, and every byte a reader downloads.
---

One `pnpm add` and nothing else to wire into your project.

```sh
pnpm add @waveso/docs
```

That is the whole installation. `react` and `react-dom` are required peers;
`next` is optional, needed only by `@waveso/docs/next`.

| Peer | Range | |
| --- | --- | --- |
| `react` | `^19.0.0` | Required |
| `react-dom` | `^19.0.0` | Required |
| `next` | `^16.0.0` | Optional — only `@waveso/docs/next` imports it |

Everything else — `unified`, the whole `remark-*` and `rehype-*` chain, Shiki,
MiniSearch, Zod — is a dependency of this package and is resolved for you.
Without `next`, pages can still be built from `@waveso/docs/react/*` with a
loader of your own; [Entry points](../reference/entry-points.md) lists which
subpath needs what.

## Why Zod is a dependency and not a peer

**Zod is not a peer.** It ships as a dependency of this package, so your
project's Zod — version 3, version 4, or none at all — is irrelevant and
nothing conflicts. When you extend the built-in schema, take `z` from here
rather than from your own install:

```ts
import { docFrontmatterSchema, z } from '@waveso/docs/frontmatter';
```

That is not a style preference. `.extend()` composes shapes across copies of
Zod, but the schema it returns is only ever as trustworthy as the instance that
made it — and a consumer with their own Zod has no way to know whether it is
the same one. Re-exporting ours removes the question: the extension is built
from the same module object, by construction rather than by luck.

**As a peer it was an install-time failure for most of the ecosystem.**
`frontmatter.ts` and `meta.ts` import Zod at module scope, which is what a
dependency is. Demanded as a peer, `^4.4.3` refused to install beside the Zod
that roughly 69% of the ecosystem was on: 47% still on 3.x, plus every 4.x
below 4.4.3.

Your own Zod stays yours, for everything else in your app — and it need not be
Zod at all. Validation goes through
[Standard Schema](https://standardschema.dev) rather than Zod's own API, so a
Valibot or ArkType schema works the same way, and a schema you hand over is
never re-wrapped by the copy of Zod in here.
[Writing content](./writing-content.md) has the extension example.

## What is deliberately not a peer

**There is no `tailwindcss` peer and no Tailwind involved.** The stylesheet is
plain CSS with `wave-docs-*` class names. It was declared as an optional peer
once, which blocked `npm install` outright for any project on Tailwind 3 — npm
still range-checks an optional peer that happens to be installed.
[Theming](../guides/theming.md) covers the tokens it does use.

There is no `image-size` peer either. An `imageResolver` you write is welcome
to read dimensions with it — but it is your dependency, in your own
`package.json`. Declaring it here installed nothing and did not make
`await import('image-size')` resolve for you; it only looked like it helped.
[Images](../guides/images.md) has the resolver.

> [!NOTE]
> `optional` in `peerDependenciesMeta` means "need not be installed". It does
> not mean "not checked" — npm validates the range against a version that *is*
> present. So an optional peer for something the package never used was a hard
> `ERESOLVE` for anyone on the wrong major, in exchange for nothing. Both
> entries above were removed for exactly that.

## Requirements

| | |
| --- | --- |
| Node.js | ≥ 22.12.0 |
| React | 19 |
| Next.js | 16 (optional peer — only `@waveso/docs/next` needs it) |
| Module format | **ESM only** |
| TypeScript | 5.9+ |

**ESM-only is forced rather than chosen.** `unified` and the entire `remark-*`
/ `rehype-*` lineage are `"type": "module"` with no CJS build, so a dual output
would resolve to nothing. `attw` reports `cjs-resolves-to-esm` for this
package; that is the intended shape.

The Node floor follows LTS. It rises when a version leaves maintenance, not
when a shiny builtin appears, and moving it is a breaking change — as is
dropping a React or Next major. [Stability](../reference/stability.md) states
both as promises.

If you extend the frontmatter schema, use `.exactOptional()` rather than
`.optional()` for optional fields: the latter infers
`{ description?: string | undefined }`, which is not assignable to
`DocFrontmatter`.

## What it costs

Every figure below is a **ceiling**, and `pnpm size` fails the build if the
measurement passes it — in CI and again in `prepublishOnly`. So these are
numbers this package is held to, not numbers somebody remembered to update.

| | At most |
| --- | --- |
| Everything the quick start ships, gzipped | 14.3 KB |
| Search dialog and router wiring | 9.5 KB |
| Navigation: one sidebar, open and closed | 3 KB |
| Table of contents | 0.9 KB |
| Copy-button runtime | 1.1 KB |
| hast over the wire vs HTML, prose page | 1.20× |
| hast over the wire vs HTML, code and tables | 1.12× |
| Highlighting vs no highlighting | 2.00× |

**The first row is the honest total.** A reader who lands on a page of your
documentation downloads under 14.3 KB gzipped of JavaScript from this package,
and that is the whole of it. No markdown parser and no syntax highlighter reach
the browser at all — those run in Node at build time. Drop the search dialog
and it is under 4 KB.

**The middle pair narrows as a page gains code.** Shiki emits the same token
spans either way, so on a page of code and tables they dominate both
representations equally and the ratio falls to 1.12× — against 1.20× for
prose, where the tree's own structure is most of what is extra.

Each row is measured rather than estimated. The client rows are each
`'use client'` entry bundled standalone with React and Next external, then
gzipped; the payload rows are brotli of `{hast, toc}` against brotli of the
same tree serialised to HTML, kept as a ratio so the number is
machine-independent. `size-budget.json` holds a second, looser ceiling per
entry with a note explaining what to do when it is hit — and a build fails if
the table above ever promises worse than that file enforces.
[Internals](../internals.md) has the reasoning behind the budgets.

Next: [Quick start](./quick-start.md).
