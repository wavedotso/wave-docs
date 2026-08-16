---
title: Internals
description: The decisions that are hard to reverse, and why they went that way.
---

Notes for anyone reading the source, or deciding whether to depend on it.

## Two route files, not `[[...slug]]`

An optional catch-all matches `/docs` as well as `/docs/anything`, which looks
like it saves a file. It leaves `/docs/index` live and serving byte-identical
HTML with no canonical between them — the duplicate-content problem, shipped by
default and invisible until a search console mentions it.

## The search index is a route

Not a build script. `docs.searchIndex` is a `force-static` route handler, so it
is rebuilt by the same `next build` that builds the pages, and in `next dev` it
re-reads the disk per request — a page you add is searchable on the next
keystroke rather than at the next time you remember to run something.

```ts
export const GET = docs.searchIndex;
export const dynamic = 'force-static';
```

Without `force-static`, Next re-renders the whole corpus per request, from
markdown that output tracing did not put in the deployment bundle. On a
serverless host that throws — at the reader, inside the search dialog, with no
warning at build time. So the handler detects it and fails loudly with
`code: 'search-index-dynamic'`, naming the file to edit.

## The mobile drawer is a `<dialog>`

One `<dialog closedby="any">` opened by a server-rendered
`<button command="show-modal">`, so it works on the first tap — before
hydration, and with JavaScript disabled. Focus moves inside and Tab stays there,
Escape closes and restores focus, the backdrop dismisses, and the page behind
does not scroll. All of that is the browser's.

At 64rem the same element becomes the sticky sidebar column via
`display: contents`, so one navigation serves both breakpoints: one landmark,
one copy of the links in the payload, nothing to keep in step.

## The copy button is not a component

It is one delegated listener for the page, mounted by `DocContent` and only when
the page has a fence — not a client component per code block. The button is
`visibility: hidden` until that listener attaches, so a reader with JavaScript
off sees no button and finds no dead tab stop.

## The video facade ships no JavaScript

A `<details>` with a `loading="lazy"` iframe. A closed one issues no request and
an open one does — measured in Chromium, not assumed — which keeps the
click-to-load behaviour, gains native keyboard support, and removes a hydration
root from every page whether or not it embeds a video.

## Nothing is `scrollIntoView`

`element.scrollIntoView({ block: 'nearest' })` reads as exactly the right call
and scrolls **every** scrollable ancestor, the document included. On a docs page
that means opening a deep link scrolls the sidebar *and* jumps the article the
reader came to read. The sidebar finds its own scrollport and assigns
`scrollTop`; a test asserts `scrollIntoView` is never called.

## This site is the harness

Six markdown files and five route files, with **no CSS of its own** — a test
fails the build if a stylesheet here declares a layout property. If a page needs
a rule the package does not provide, that is a defect in the package rather
than something to patch locally.
