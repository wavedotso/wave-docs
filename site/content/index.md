---
title: Wave Docs
label: Overview
description: Markdown documentation for Next.js. The parser runs in Node at build time and never reaches the browser.
actions:
  - label: Quick start
    href: /getting-started/quick-start
  - label: Why hast
    href: /internals
explore:
  - question: How to get it into a Next app
    href: /getting-started/installation
  - question: What the five files actually do
    href: /getting-started/quick-start
  - question: How a directory becomes a section
    href: /getting-started/navigation
  - question: Which decisions are hard to reverse
    href: /internals
---

Point `@waveso/docs` at a folder of `.md` files and you get a documentation
site: routing, navigation, a table of contents, syntax highlighting, search,
redirects and a sitemap.

**This site is one of them.** Every page in the sidebar is a markdown file in
`site/content/`, rendered by the package you would install, from a layout file
that is one line of shell and no CSS of its own.

## The decision everything follows from

Markdown becomes [hast](https://github.com/syntax-tree/hast) in Node, at build
time. A hast tree is plain serialisable JSON, so Next renders it inside a Server
Component and the browser receives a tree of nodes and a component map — never
`unified`, never `remark-parse`, never Shiki.

```
content/*.md ──▶ source ──▶ render ──▶ { hast, toc, frontmatter }
                 (Node)     (Node)              │
                                          RSC payload
                                                │
                                        <DocContent hast={…} />
```

Three things follow from that shape, and they are the reasons to choose this
over the alternatives.

**Nothing is stringified to HTML.** The pipeline stops at hast, so the output
stays *data*. You map `h2`, `a`, `img`, `pre` and `callout` onto your own
components, and nothing is ever handed to `dangerouslySetInnerHTML`.

**Table-of-contents anchors cannot drift.** Heading ids are read off the same
pass that annotated the document, rather than recomputed by a second parse. Two
sections called "Install" get `#install` and `#install-1`, and the rail on the
right matches — by construction, not by coincidence.

**Broken internal links fail the build.** `[auth](./api/auth.md)` is the right
way to link between markdown files: it resolves on GitHub and in every editor
preview, and it 404s once published. Those links are rewritten to routes, their
targets checked, and their `#fragments` checked against the headings that exist.

## What a reader downloads

| | At most |
| --- | --- |
| Everything the quick start ships, gzipped | 14.6 KB |
| Without the search dialog | under 4 KB |
| Markdown parser | none |
| Syntax highlighter | none |

Every figure is a **ceiling** rather than a measurement somebody remembered to
update: `pnpm size` fails the build when one is passed, in CI and again in
`prepublishOnly`, and fails it again if the published table ever promises better
than the code delivers.

The honest cost is on the other side of the ledger. Shipping a tree instead of a
string is about 20% more brotli on a prose page, and about 12% on a page with
code and tables. That is the price of never handing markup to
`dangerouslySetInnerHTML`, and it is the first number a sceptical reviewer
should ask for.

## Five files

```ts title="lib/docs.ts"
import { createDocsRoute } from '@waveso/docs/next';

export const docs = createDocsRoute({ contentDir: 'content/docs' });
```

```tsx title="app/docs/layout.tsx"
import '@waveso/docs/styles.css';
import { docs } from '@/lib/docs';

export default docs.Layout;
```

The other three are a catch-all page, an index page and the search-index route —
each one a re-export, each one explained in the
[quick start](./getting-started/quick-start.md). What that gets you is a working
documentation site: routing, a navigation sidebar, a table of contents,
syntax highlighting, search, a mobile drawer and a skip link.

Three peer dependencies, one of them optional. No Tailwind, no MDX toolchain, no
build step of your own.

## Enforced, not intended

Documentation is full of promises. These are the ones with a test behind them,
and the test is named so it can be read.

| | Enforced by |
| --- | --- |
| Every published cost figure is a ceiling | `pnpm size` |
| Every subpath, and every name it exports, is public API | `manifest.test.ts` |
| Every `DocsErrorCode` member is public API | `error-taxonomy.test.ts` |
| Which Node builtins each entry point needs, exactly | `entry-runtime.test.ts` |
| Every foreground and background pair clears WCAG 4.5:1 | `styles.test.ts` |
| Every code example in the README compiles | `pnpm run check:readme` |
| The shell needs no layout CSS from its host | `site-budget.test.ts` |

That last one is what this site is for. A documentation site built by the people
who wrote the package will work — they know which class to add when a column
collapses, and they add it locally without noticing they have papered over a
defect every consumer will hit. So this site is held to a hard zero: no
stylesheet, no inline layout style, no wrapper between the shell and the page.
Anything it needs and cannot have is a bug report against the package, filed by
construction rather than by goodwill.
