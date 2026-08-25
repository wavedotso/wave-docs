---
title: Code blocks
description: Fences, titles, the eighteen grammars, and the one delegated listener behind every copy button.
---

Every fence is highlighted in Node at build time and wrapped in a `<figure>`
with a copy button. No highlighter reaches the browser — the only thing that
does is the listener that makes the button work.

## The frame

A highlighted fence comes out as a `<figure class="wave-docs-code">` holding an
optional `<figcaption>`, a `<button>` and the `<pre>` Shiki produced. Give it a
title and the caption becomes a bar across the top of the block:

````md
```ts title="app/page.tsx"
export default function Page() {
  return <h1>Hello</h1>;
}
```
````

**The title lands in three places at once** — the caption, the button's
accessible name (`Copy code from app/page.tsx`, rather than eight controls all
called "Copy code"), and the search index. The caption is the one part of a
code block a reader can search for, which is why it is a `<figcaption>` and not
an attribute. [Search](./search.md) covers what reaches the index.

**A `title=` that is not double-quoted fails the build**, naming the document
and quoting the offending meta string. An unquoted `title=app/page.tsx` ships a
caption truncated at the first space, and an unterminated `title="app/page.tsx`
ships no caption at all — both silently. The error code is `invalid-code-meta`;
[Errors](../reference/errors.md) lists the rest. A filename containing a double
quote is inexpressible and gets no escape grammar.

### The rest of the meta string

Nothing else on the fence is consumed. The parser reads `title=` and never
rewrites `code.data.meta`, so Shiki still forwards the raw string to its own
transformers as `meta.__raw` — `{1,3-5}` and `showLineNumbers` pass through
untouched. A parser that ate what it recognised would silently disable every
feature it had not been taught about yet.

## Languages

Eighteen grammars load by default — what technical documentation actually
contains:

```
typescript  tsx  javascript  jsx  json  shellscript  css  html
markdown    yaml  diff  sql  python  go  rust  prisma  ini  toml
```

The usual aliases are accepted too: `ts`, `js`, `bash`, `sh`, `shell`, `zsh`,
`md`, `yml`, `py`, `rs`, `properties`.

A ```` ```cfg ```` fence (or ```` ```conf ````) uses the `ini` grammar, because
the fence an author types follows the filename — nobody writes ```` ```ini ````
above a file called `server.cfg`. Shiki resolves a fence against a grammar's own
aliases rather than against the loader table, and `ini` ships exactly one alias,
`properties`, so the two names are registered on the grammar itself.

**Fence languages are matched case-insensitively.** ```` ```JSON ```` and
```` ```Bash ```` highlight like their lowercase spellings. Folding is not
politeness: the Shiki integration tests its loaded-language list with no case
folding, and the plain-text fallback then swallowed the miss, so those fences
shipped monochrome with `<pre>` properties byte-identical to a highlighted
block — correct in the author's editor and on GitHub, wrong only in production.

**A language outside the loaded set falls back to plain text rather than
throwing.** A fence never fails a build over its language. Configuration does:
`langs` is typed as a union of the names this package can load, so `'typescrpt'`
is a compile error, and a value arriving from JSON config throws
`unknown-language` naming the supported set. Pass `langs` to change the set,
`themes` to change the light/dark pair, or `highlighter` to supply your own —
see [Configuration](../reference/configuration.md).

## The copy button

**One delegated listener for the page, not a component per block.** `DocContent`
mounts it, and only when the tree it was handed contains a code frame — a page
with no fences ships none of it. The buttons are server-rendered HTML with no
React identity at all: one `click` listener on `document`, one live region on
`<body>`, and a `data-copied` attribute the stylesheet reads for the tick and
the cross. At most 1.1 KB gzipped, which `pnpm size` holds it to.

The alternative — mapping `pre` to a `'use client'` component, which is what the
comparable packages do — puts one client reference and one hydration root in the
flight stream per fence, fifty of each on a page with fifty blocks, and drags
the highlighted subtree across the client boundary as children.
[Internals](../internals.md) puts that beside the rest of the shape decisions.

**The button is `visibility: hidden` until that listener attaches.** The markup
is there whether or not any JavaScript runs — scripts off, `renderToStaticMarkup`,
anyone rendering the hast by hand — and the runtime sets
`data-wave-docs-code-ready` on `<html>` once it installs. `visibility: hidden`
also takes the control out of the tab order, which `opacity: 0` would not, so a
reader without JavaScript finds no dead tab stop where a button should be.

The button sits before the `<pre>`, so the tab order reads "copy this block",
then "the scrollable code region". Its accessible name never changes, including
on success — the outcome is announced through a live region instead. All four
strings (`copyCode`, `copyCodeFrom`, `copied`, `copyFailed`) are translatable,
and the first two are baked into the HTML at build time: see
[Translating the chrome](./translating.md).

## The language badge

The `<figure>` carries `data-lang` — the folded language, so ```` ```JSON ````
gives `json`. A fence with no language carries no attribute at all rather than
`data-lang="text"`, so a badge rule needs no exception for it. No badge is
rendered by default; one rule turns it on:

```css title="app/globals.css"
.wave-docs-code[data-lang]::before {
  content: attr(data-lang);
}
```

**Keeping it in CSS is deliberate.** A real element would enter the search index
and `textContent`, so every code block would pollute search results with its
language name and the copy button would copy it. Generated content does neither.
The colour tokens to position it against are in [Theming](./theming.md).

## Fences you render yourself

`excludeLangs` tells Shiki to leave a language alone, so the `<pre>` reaches your
own component untouched — for diagrams, or anything that is not really code:

```ts title="lib/docs.ts"
import { createDocsRoute } from '@waveso/docs/next';

export const docs = createDocsRoute({
  contentDir: 'content/docs',
  excludeLangs: ['mermaid'],
});
```

Those fences are deliberately **not** framed: a copy button on a rendered
diagram copies its source, which is not what the reader clicked. They keep the
surface of a highlighted block — the same background, border and horizontal
scroll, and the `tabindex` that lets a keyboard scroll it — so `excludeLangs` on
its own produces a page that looks deliberate rather than unstyled.

To render them, map `pre`:

```tsx title="lib/components.tsx"
import { isValidElement, type ReactNode } from 'react';

/** Yours: a `'use client'` component wrapping whichever renderer you like. */
declare function Mermaid(props: { children: string }): ReactNode;

function textOf(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textOf(node.props.children);
  }
  return '';
}

export const components = {
  pre: (props: { children?: ReactNode }) => {
    const child = props.children;
    const className = isValidElement<{ className?: string | string[] }>(child)
      ? child.props.className
      : undefined;

    // An array, not a string. See the caution below.
    const languages = Array.isArray(className) ? className : [className];

    if (languages.includes('language-mermaid')) {
      return <Mermaid>{textOf(props.children)}</Mermaid>;
    }
    return <pre {...props} />;
  },
};
```

Pass it as `components` to `createDocsRoute`, or to `DocContent` directly.

> [!CAUTION]
> **`className` is an array, not a string.** An excluded fence never reached
> Shiki, so its `<code>` still carries hast's `["language-mermaid"]` — Shiki's
> own output is a string. A `className === 'language-mermaid'` check compiles,
> reads correctly, and silently never matches, so every diagram renders as its
> own source. This catches everyone once.

`Mermaid` is yours. This package deliberately ships no renderer: several hundred
kilobytes of client JavaScript with its own CVE history, behind an option most
sites never set. A `rehypePlugins` entry sees excluded fences before they are
disguised, and sees every code block the same way — see
[Plugins](./plugins.md).
