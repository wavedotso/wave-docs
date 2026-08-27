---
title: Markdown for agents
description: llms.txt, llms-full.txt, and the Copy page button that reads them.
---

Your documentation is markdown before it is HTML, and two audiences want it
that way: a reader pasting a page into a chat window, and an agent reading the
whole corpus on its own.

Both are served by one file.

## Two files, one of them optional

```ts title="lib/docs.ts"
import { createDocsRoute } from '@waveso/docs/next';

export const docs = createDocsRoute({
  contentDir: 'content/docs',
  siteUrl: 'https://example.com',
  llms: {
    title: 'Your product',
    description: 'One sentence on what this documentation covers.',
  },
});
```

```ts title="app/docs/llms-full.txt/route.ts"
export const GET = docs.llmsFullTxt;
export const dynamic = 'force-static';
```

That is the whole setup. `llms-full.txt` is every published page's markdown in
one file, each labelled with its own URL and separated by a `---`.

`llms.txt` — an index of one line per page, in
[llmstxt.org](https://llmstxt.org)'s format — is a second route and entirely
optional:

```ts title="app/docs/llms.txt/route.ts"
export const GET = docs.llmsTxt;
export const dynamic = 'force-static';
```

**The corpus is the one that earns its file.** It carries every page *and* its
URL, so an agent that finds it has everything the index would have told it. Add
the index when you want the convention's entry point; skip it when you want six
files instead of seven.

Both are prerendered, and neither ships a byte to a browser.

## Copy page

A button at the top of every page puts that page's markdown on the reader's
clipboard. It is **on by default** once `llms` is configured, and it needs no
other setup — it reads `/llms-full.txt` and slices out the page it is on.

```ts
copyPage: false                      // off
copyPage: { label: 'Copy as MD' }    // relabelled
```

The default is deliberately "on if `llms` is set" rather than plain `true`.
`docs.llmsFullTxt` refuses to serve without an `llms` option, so a site without
one has no corpus by construction — and rendering a button there would produce
a control whose only possible outcome is to remove itself.

**If the route file is missing, the button removes itself.** That is the one
case the server cannot see: `llms` configured and
`app/docs/llms-full.txt/route.ts` never created. Only a fetch can tell, so the
first click that 404s takes the button away. A network failure is treated
differently — the wiring is fine and the next press may work, so it reports and
stays.

### What it costs

Nothing on page load. The corpus is fetched on *click* and cached for the rest
of the visit, so every reader who never presses the button pays zero bytes —
page weight and first paint are unchanged. The button itself is 1.2 KB gzipped
and holds no markdown of its own.

One download is around 40 KB gzipped for twenty pages, and roughly 2 MB at a
thousand. Docs are read on desktops by people who deliberately pressed
something and expect it to do work; while the fetch is in flight the label
pulses, so the wait reads as progress rather than as a verdict.

### Why not a `.md` URL per page

That was the first design, and in Next it costs five steps: a route file, a
rewrite, `output: 'export'` made conditional, a post-build script, and a
placeholder the export forces which the script then deletes. Two of them fail
silently.

All of it exists because `*.md` is a *pattern* the docs catch-all already owns —
a route in the App Router is a folder, and a segment holds either a `page` or a
`route`, never both. `llms-full.txt` is a fixed path, which needs none of it.

Frameworks whose routes can carry a file extension have no such problem, and the
button is ready for them: it takes a `corpusUrl`, so an adapter that can serve
`/guides/links.md` points at that instead and the component does not change.

## The markdown is the author's

A hosted documentation service has to reconstruct markdown from whatever it
rendered, and loses whatever the render dropped. The source is still on disk
here, so these files are the original bodies with exactly two edits.

**A `# title` when the body has none** — a page whose title lives only in
frontmatter would otherwise arrive as an untitled fragment.

**Link destinations resolved against the page they were written on.** The
destination for this text is a chat window, where `[auth](./api/auth.md)` has
nothing to resolve against. The markdown extension comes off, because
`/api/auth` is the route and `/api/auth.md` is nothing — and only for your own
origin, since a raw file on GitHub is a real URL that ends in `.md`.

Everything else survives byte for byte: list markers, table alignment, trailing
whitespace. Destinations are found by **parsing**, not by matching `](…)`, so
the example URLs in your code fences are left exactly as written — which a
regex rewriter would edit, in the one place a reader is meant to copy verbatim.

## Drafts never appear

The list comes from the same source the routes are built from, so what ships as
markdown is exactly what ships as HTML. A `draft: true` page is absent from
both.
