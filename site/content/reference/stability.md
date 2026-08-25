---
title: Stability
description: What counts as a breaking change in 0.x, and the test that holds each promise.
---

**This is `0.x`, and `0.x` means breaking changes land in minors.** They are
listed, with the migration, in the changelog. What follows is what counts as
breaking — the part most packages leave unsaid until someone is angry.

## What is public API

| | Covered | Held by |
| --- | --- | --- |
| Every subpath in `exports`, and every runtime name it exports | ✅ | `manifest.test.ts` |
| Every prop of every exported `…Props` interface | ✅ | `manifest.test.ts` |
| Exported types, including `DocsErrorCode`'s members | ✅ | `error-taxonomy.test.ts` |
| **CSS class names** — `wave-docs-*` — and the shell's element tree | ✅ | `styles.test.ts`, `layout.test.tsx`, `next.test.ts` |
| **The hast this emits** — element names, and the attributes on them | ✅ | `render.test.ts` |
| The six layout tokens | ✅ | `styles.test.ts` |
| Anything reachable only through `dist/` internals, or a private module | ❌ | — |

The two in bold are the ones usually omitted, and omitting them is how a package
ships a "patch" that silently reflows everyone's site. **If a selector can
reach it, or it can be read out of `RenderedDoc.hast`, this package owes you a
changelog entry before it moves.** The class vocabulary and the element tree
are public API, and a name in either changes only in a release that carries the
migration. [Layout](../guides/layout.md) shows the tree a consumer restyles;
[Components](./components.md) lists the props; [Errors](./errors.md) lists the
`DocsErrorCode` members.

**0.7.0 is the first release to break one of the names above, and it breaks
them in a minor.** `.wave-docs-layout__header` and
`.wave-docs-layout__header-inner` stop being rendered, and
`--wave-docs-header-height` splits in two. All three were public API from
0.3.0, and the changelog entry carries the migration for each.

The six layout tokens are `--wave-docs-measure`, `--wave-docs-bar-height`,
`--wave-docs-chrome-offset`, `--wave-docs-sidebar-width`,
`--wave-docs-toc-width` and `--wave-docs-shell-width`.
`--wave-docs-scroll-padding` is derived rather than set, and
breakpoint-dependent: `--wave-docs-chrome-offset` plus `--wave-docs-bar-height`
plus a rem of air below 64rem, and `--wave-docs-chrome-offset` plus a rem at and
above it, where no strip is rendered. The gutter (`1.5rem`) and the drawer width (`min(20rem, 85vw)`) are literals
rather than tokens: each appears in a single-value declaration, where an
ordinary CSS override is already the cleanest tool.
[Theming](../guides/theming.md) has the defaults.

**`--wave-docs-header-height` split rather than being renamed, and that is the
sharp edge of the 0.7.0 migration.** It sized the header *and* was the offset
both sticky columns parked below. `--wave-docs-bar-height` took the size;
`--wave-docs-chrome-offset` took the offset, and is the one declaration that
tells this package where a host's own sticky bar ends. A consumer who renames
the token to `--wave-docs-bar-height` and stops there loses the sticky offset on
both columns, with no error to say so.

### Nothing undocumented is exported

**A name is public when the built module exports it, not when the source says
so.** That distinction is not pedantic: five runtime names —
`DOCS_ERROR_PREFIX`, `DEFAULT_DOCS_THEMES`, `CALLOUT_TYPES`,
`defaultMarkdownComponents` and `DOCS_CONTENT_ID` — once shipped as public API
documented in no file, so a consumer who imported one was depending on something
this package did not consider public and would have renamed without a major.
`manifest.test.ts` now imports every subpath out of `dist/` and fails on a
runtime name the README does not mention, and reads every prop out of the
emitted `.d.ts` rather than the source.

**The `exports` map enumerates every subpath rather than wildcarding them.**
Node's `exports` wildcard does not check that a target exists, so
`"./react/*"` made every file that ever lands in `src/react/` public API on the
day it is typed — verified with a throwaway module dropped into `dist/react/`,
which imported cleanly. A wildcard makes this promise unkeepable rather than
merely unkept.

Seven modules under `src/react/` are private on purpose — `link-adapter`,
`layout`, `nav`, `next-nav`, `code-runtime`, `nearest-scroll-top` and
`shell-labels` — each with its reason recorded in the same test, which also
fails when an allowlist entry outlives the file it names. `docs-error`,
`map-pooled` and `section-boundary` are kept out of the map entirely. Two
subpaths, `./markdown-links` and `./search-options`, were deleted rather than
kept for symmetry and are pinned shut. [Entry points](./entry-points.md) is the
list of what remains.

## Four clauses

**Dropping a major of `next`, `react` or `react-dom` is breaking; adding one is
not.** Widening `peerDependencies` to accept the next major is a minor and always
safe to take. Narrowing it — dropping React 19 once React 20 has settled — is
breaking, gets its own release, and will not be bundled with features. The
policy has to name each peer for the promise to reach it, so `manifest.test.ts`
walks `peerDependencies` and fails when the policy does not name one of them —
a peer added later would otherwise inherit the promise silently.

**The Node floor follows LTS, and moving it is breaking.** It rises when a
version leaves maintenance, not when a shiny builtin appears. Today `22.12.0`.
That floor is deliberately lower than the one contributors run — `.nvmrc` pins
26 — and it may not name an end-of-life line: Node 20 went EOL on 2026-04-30,
and pnpm fails an install on an `engines` mismatch by default, so the promise is
neither patched nor free. Two files said `20.19.0` and `22.12.0` once, and the
README was the wrong one; the floor is now compared against `package.json` by
test.

**A third-party type in this package's signature makes that library's major
ours.** `unified`'s `PluggableList` is in `remarkPlugins` and `rehypePlugins`
([Plugins](../guides/plugins.md)), MiniSearch's `Options` is in
`miniSearchOptions` ([Search](../guides/search.md)), and hast's `Root` is in
`RenderedDoc`. When one of those releases a breaking major, so does this — a
package that quietly re-exports someone else's break is worse than one that names
it. `frontmatterSchema` takes `StandardSchemaV1` from `@standard-schema/spec`,
which carries its version in the type's name rather than only in a range.

**Zod is a dependency, not a peer, and that is deliberate.** Your Zod is yours.
As a peer it was an install-time failure for most of the ecosystem —
[Installation](../getting-started/installation.md) has the measurement, and
the peers you do install. Owning the copy also makes the `.extend()`
instance-identity guarantee structural rather than documented. When you extend
the frontmatter schema, take `z` from `@waveso/docs/frontmatter` — see
[Writing content](../getting-started/writing-content.md).

> [!IMPORTANT]
> `tailwindcss` is not a peer either, for the same reason and one worse. A
> `tailwindcss: ^4` peer ERESOLVE-failed every Tailwind 3 project outright, for
> a dependency this package never used: `styles.css` has no `@apply`, and every
> class in `dist/react/**` is `wave-docs-*` BEM.

## What is not covered

**The rendered appearance is design, and it will change without a major.**
Colours, spacing, the type scale. The class names it hangs on will not — that is
the whole point of freezing the vocabulary and not the paint.

Four things are deliberately open, so the people building them are not boxed
in: the sidebar strip's internal arrangement below 64rem, the sidebar's scroll
behaviour when the tree is longer than the viewport, the drawer's animation,
and every colour. Where a version switcher goes, if versioned documentation is
ever built, is open as well, and listed here so it is not mistaken for an
oversight. Those are design decisions with no cross-workstream contract to
break. If your site depends on one, restate it in your own stylesheet — the
package's rules are layered, so an unlayered rule of yours wins without
`!important`.

**Two things that were open before 0.7.0 are now closed.** The header's
internal composition is closed by there being no header. The table of
contents' active-item treatment is closed by `DocsToc`'s `rootMargin` default,
which changed at 0.7.0 — a public prop's default, so it is a migration entry
rather than an open question.

Nothing under `dist/` is API except through a subpath in `exports`, and a deep
import into a private module is not covered by any of the above.

## Where the changes are written down

Every break gets a changelog entry with the migration in it. The sidebar links
the changelog under **Project**;
[CHANGELOG.md](https://github.com/wavedotso/wave-docs/blob/main/CHANGELOG.md)
is the same file on GitHub. Every page of this site is built by the package it
documents, so the promises above are under test on every commit.
