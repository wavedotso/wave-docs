---
title: Images
description: Absolute, external and relative sources, and the imageResolver a relative one needs.
---

Three kinds of image source reach the pipeline. Two of them work with no
configuration at all. The third has no correct output without one, so it fails
the build instead of guessing.

## Absolute and external sources need no setup

Put the file in `public/` and write `![](/diagram.png)`. An external URL
behaves the same way.

| Source | |
| --- | --- |
| `![Architecture](/diagram.png)` | ✅ served from `public/` |
| `![Logo](https://example.com/logo.png)` | ✅ external |
| `![Architecture](./diagram.png)` | ⛔️ needs an `imageResolver` |

A source beginning with `/`, `//` or a scheme is already a URL a browser can
fetch from any page, so it is passed through unchanged — folding one would
corrupt it. It is still offered to an `imageResolver` when the site configures
one, so a host can rewrite it onto a CDN, and a resolver that declines it has
given a complete answer: leave it as it is.

## Why a relative source is a different thing

**Nothing in `public/` corresponds to it.** The browser resolves a relative
`src` against the *route*, not against the markdown file — so `/docs/guide`
requests `/docs/diagram.png` and `/docs/guide/setup` requests
`/docs/guide/diagram.png`, from byte-identical markdown. Both spellings
preview correctly in an editor and in the GitHub file browser, which is why
the author never sees it; a reader sees one broken image on one page.

Rather than ship that, a relative source with no `imageResolver` fails the
build with [`invalid-image`](../reference/errors.md), naming the image and the
document and offering both fixes — pass a resolver, or move the file under
`public/` and write an absolute `src`.

**The fold runs for every document, resolver or not.** It used to be gated on
`imageResolver`, which is the option nobody sets first — so under the
quick-start configuration `![d](./diagram.png)` shipped byte-for-byte as
authored and the browser resolved it. Link checking could not see it either,
because the link pass visits `link` and `definition` nodes and never `image`.
The build stayed green and the containment check below was dead code in the
one configuration most sites run.

> [!IMPORTANT]
> A source that climbs above the content root fails whether or not a resolver
> is configured. The fold refuses a `../` chain that leaves the root, and it
> decodes before folding, because `%2E%2E%2Fsecret.png` spells `../` in
> disguise — a resolver that decodes on its own would otherwise escape the
> root its contract promises it cannot.

Markdown links fold through the same implementation, so a link and an image
agree about where `../` points. [Links](./links.md) covers the rest of that
pass.

## Writing an imageResolver

The resolver receives the source **already folded against the markdown file's
directory**: `./diagram.png` in `guides/deploying.md` arrives as
`guides/diagram.png`. It arrives percent-decoded and NFC-normalised, so
`./getting%20started.png` — what GitHub's editor writes when a filename
contains a space — reaches `readFile` as a name that exists on disk. Any
`?query#hash` is split off first, because a resolver is asked to find a *file*
rather than `diagram.png?v=2`, and put back afterwards unless the resolver
wrote a query or fragment of its own.

Return a public URL plus the intrinsic pixel dimensions — the two things
`next/image` requires and markdown does not carry:

```ts title="lib/docs.ts"
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { imageSize } from 'image-size';
import { createDocsRoute } from '@waveso/docs/next';

createDocsRoute({
  contentDir: 'content/docs',
  imageResolver: async (src) => {
    const { width, height } = imageSize(
      await readFile(path.join('content/docs', src)),
    );
    return { src: `/docs-assets/${src}`, width, height };
  },
});
```

**`image-size` is your dependency, not this package's.** Read dimensions with
it, from a build manifest, or from anywhere else. Why it is not a peer is in
[Installation](../getting-started/installation.md).

The second argument is the document's `DocLinkContext` — `segments`,
`dirSegments` and `relativePath` — for a resolver that needs to know which
page asked.

### What the return value must be

| Returned | |
| --- | --- |
| `{ src, width, height }` | The usual answer. `width` and `height` must be finite numbers |
| `{ src }` | A src with no dimensions. The element degrades to a plain `<img>` |
| `undefined` | Leaves an absolute or external source alone. On a relative one it throws |

`ImageResolver` is a type, and a type stops at the JavaScript boundary. A
resolver reading dimensions from a manifest and handing back
`{ src, width: '1200' }` produced `width="undefined"` in the HTML, on one
page, at build time, with nothing naming the image or the document — so the
shape is checked at runtime and every failure is an `invalid-image` that names
both. A resolver that throws is wrapped the same way:
`ENOENT: no such file 'architecture.png'` names neither the document nor the
line that wanted it.

Returning `undefined` for a *relative* source is not an answer. Emitting the
folded path would put `guide/diagram.png` in the HTML, which the browser
resolves against the route exactly as before — the precise failure the fold
exists to prevent. It throws the same `invalid-image` as configuring no
resolver at all, because it is the same situation: nothing can serve that
file.

## The props that reach the element

`src`, `alt`, `width` and `height` are the four `next/image` refuses to render
without, short of `fill`, and they come from the resolver. Four more are
forwarded to the image component:

| Prop | Default | |
| --- | --- | --- |
| `sizes` | — | The `sizes` attribute, forwarded to `next/image` |
| `loading` | `lazy` | `eager` on the tree wins over the default |
| `decoding` | `async` | `async`, `auto` or `sync` |
| `fetchPriority` | — | `high` on a hero image is the usual reason |

**Markdown carries none of them.** They reach the element from a `components`
override, or from a [rehype plugin](./plugins.md) that sets the property on
the `img` node — both of which see the same closed props interface, so an
attribute outside it stops at the seam rather than reaching `next/image`
silently.

`loading` resolves before the spread rather than after it, and that ordering
is the whole point: written after, the default won every time and `eager` was
a prop no tree could reach. A lone image is lifted out of its wrapping
paragraph to a top-level block precisely because it is usually the page's
largest element, and `loading="lazy"` on the LCP element costs it a round
trip.

Without intrinsic dimensions the injected component is skipped and a plain
`<img>` renders instead. `next/image` throws without them, and degrading one
image beats failing the page it is on.

Every image carries the `wave-docs-image` class: `max-width: 100%`,
`height: auto`, and `--wave-docs-radius` for the corners.
[Theming](./theming.md) covers the token;
[Components](../reference/components.md) covers the props the injected image
accepts; [Configuration](../reference/configuration.md) lists `imageResolver`
beside every other option.

Next: [Search](./search.md).
