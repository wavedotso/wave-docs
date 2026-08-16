---
title: Plugins
description: Two slots, at the two positions that are safe to open.
---

The pipeline takes `remarkPlugins` and `rehypePlugins`:

```ts title="lib/docs.ts"
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

export const docs = createDocsRoute({
  contentDir: 'content/docs',
  remarkPlugins: [remarkMath],
  rehypePlugins: [rehypeKatex],
});
```

## Where they run, and why there

`remarkPlugins` run **before link resolution**, so what they emit is folded,
contained and asserted exactly like authored markdown. A plugin that generates a
`[link](./other.md)` gets the same treatment as one you typed.

`rehypePlugins` run **after heading ids exist and before Shiki**, so a fence is
still the author's text rather than a tree of token spans.

That second position is the whole reason the slots exist. A frozen pipeline had
two apparent escape hatches and both were useless: `frozen.use()` throws, and
`frozen().use(plugin)` *appends*, so the plugin runs after Shiki and sees
`<span class="line">` where the code used to be.

> [!TIP]
> The table of contents is captured last — after your plugins, after everything.
> A plugin that adds or removes a heading changes the rail and the search index
> together, because both read the same finished document.

## Excluding a language

Some fences are not code. A Mermaid block wants to reach the browser as text,
for a client-side renderer to pick up:

```ts
createDocsRenderer({ excludeLangs: ['mermaid'] });
```

The block keeps its surface — background, border, padding, horizontal scroll and
a `tabindex` so a keyboard can scroll it — and is deliberately left unframed,
with no copy button.

> [!CAUTION]
> An excluded fence's `<code>` carries `className` as an **array**
> (`['language-mermaid']`), where a Shiki-highlighted one carries `class` as a
> **string**. A component reading one spelling sees nothing on the other. This
> catches everyone once.

## Errors you can branch on

Every failure carries a `code` from a nineteen-member union, exported so a
`switch` over it can be exhaustive:

```ts
import { isDocsError } from '@waveso/docs/errors';

try {
  await docs.renderAll();
} catch (error) {
  if (isDocsError(error) && error.code === 'broken-link') {
    // the message names the file and the link
  }
  throw error;
}
```

`DocsErrorCode` is a union of string literals, not `string`, so a typo in that
comparison is a compile error rather than a branch that silently never runs.

Next: [the reference](./reference.md).
