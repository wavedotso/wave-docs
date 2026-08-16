---
title: Wave Docs
description: Markdown documentation for Next.js, with no parser in the browser.
---

Point `@waveso/docs` at a folder of `.md` files and you get a documentation
site: routing, navigation, a table of contents, syntax highlighting, search and
redirects.

This site is one of them. Every page you can reach from the sidebar is a
markdown file in `site/content/`, rendered by the same package you would
install — and the shell around it is one line in a layout file.

## The idea

Markdown becomes [hast](https://github.com/syntax-tree/hast) in Node, at build
time. A hast tree is plain serialisable JSON, so Next renders it inside a Server
Component and the browser receives a tree of nodes and a component map.

```ts title="what a page is, by the time React sees it"
interface RenderedDoc {
  hast: Root;              // the document, as data
  toc: TocEntry[];         // headings, from the pass that made the ids
  frontmatter: DocFrontmatter;
  href: string;
}
```

Never `unified`, never `remark-parse`, never Shiki. Three things follow, and
they are the reasons to pick this over the alternatives.

**Nothing is stringified to HTML.** The pipeline stops at hast, so the output
stays *data*. You map `h2`, `a`, `img`, `pre` and `callout` onto your own
components, and nothing is ever handed to `dangerouslySetInnerHTML`.

**Table-of-contents anchors cannot drift.** Heading ids are read off the same
pass that annotated the document, rather than recomputed by a second parse. Two
sections called "Install" get `#install` and `#install-1`, and the rail on the
right matches — by construction, not by coincidence.

**Broken internal links fail the build.** `[auth](./api/auth.md)` is the right
way to link between markdown files: it resolves on GitHub and in every editor
preview, and it 404s once published. Those links are rewritten to routes and
their targets checked.

## What it costs a reader

Under 13 KB gzipped, total, and that is the whole of what this package sends to
a browser. Every figure is a ceiling a build fails over rather than a number
somebody remembered to update.

> [!NOTE]
> The one honest cost is the payload: shipping a tree instead of a string is
> about 20% more brotli on a prose page. That is the price of never handing
> markup to `dangerouslySetInnerHTML`, and it is the first number a skeptical
> reviewer should ask for.

Start with [Installation](./installation.md).
