---
title: Plugins
description: Two slots, at the two positions that are safe to open.
---

The pipeline takes `remarkPlugins` and `rehypePlugins`. Everything between them
is fixed, because the order of the seventeen steps is what the rest of the
package's guarantees are made of.

```ts title="lib/docs.ts"
import { createDocsRoute } from '@waveso/docs/next';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';

export const docs = createDocsRoute({
  contentDir: 'content/docs',
  remarkPlugins: [remarkMath],
  rehypePlugins: [rehypeKatex],
});
```

Both take a unified `PluggableList` — a plugin, or a `[plugin, options]` pair,
or a list of either.

## Where they run, and why there

**`remarkPlugins` attach after GFM and before link resolution.** Which is to
say: while links are still mdast `url` strings, so anything a plugin emits is
folded, contained and asserted exactly like authored markdown. A plugin writing
`[x](../other/page.md)` gets the same resolution an author would, and one
writing `![i](./x.png)` throws `invalid-image` without an `imageResolver`, for
the same reason. There is no second class of link.

**`rehypePlugins` attach after heading ids and permalinks exist, and before
Shiki.** They are step 11 of the seventeen: slugging and autolinking have
already run, so every heading has its final id; the code steps have not, so a
fence is still `<pre><code class="language-ts">` with the author's text in it
rather than several hundred token spans. Fences named by `excludeLangs` are not
disguised yet either, so a plugin sees every code block the same way.

## The second position is the whole reason the slots exist

Before the slots existed the pipeline was frozen with no entry point, and both
apparent escape hatches are provably useless. `frozen.use()` throws.
`frozen().use(plugin)` *appends* — so the plugin runs after Shiki and sees
`<span class="line">` where the code used to be.

A slot at the end is not a smaller version of a slot in the middle. It is a
different thing, aimed at a tree the author never wrote.

## There is no after-Shiki slot

Code-block internals belong to Shiki's own `transformers`, not to this. The
honest documentation for an after-Shiki hook would be a list of things you must
not do — the token spans, the `--shiki-light` / `--shiki-dark` custom
properties and the language class are all load-bearing downstream, and a plugin
walking them is walking an output shape rather than a document.

Reach for [`excludeLangs`](./code-blocks.md) instead when a fence should not be
highlighted at all. That is a decision the pipeline makes before Shiki, where
it can still be made cleanly.

## The table of contents is captured last

Dead last — after your plugins, after everything else. The table of contents is
then read off the identical tree the search index walks, so a plugin that adds
or removes a heading changes both together and there is nothing left to keep in
step.

Both drifts were measured before the capture moved. A plugin deleting a heading
id left `toc` pointing at an id no longer in the document, while search
silently dropped the section. One adding an `<h2>` produced a search record
with no entry on the rail. Both silent, and neither reachable now — which is
why no validation pass and no error code exist for them.

## Raw HTML does not survive either slot

`remarkRehype` runs with `allowDangerousHtml` off and this package does not run
`rehype-raw`, so a raw `html` node is dropped rather than passed through. That
applies to a plugin's output exactly as it applies to
[authored markdown](./markdown.md). A plugin that needs an element builds it as
a node, not as a string of HTML.

> [!WARNING]
> The drop is silent. A remark plugin that emits `'<figure>…</figure>'` as raw
> HTML produces a document with nothing where the figure should be, and no
> error anywhere in the build to say so.

## One processor, shared by every file

> [!NOTE]
> The pipeline is built and frozen once and shared by every file, so a plugin
> holding state accumulates it across the whole build rather than per document.
> Keep them pure, or key what they hold on the vfile.

The document's identity travels on the vfile rather than in plugin options,
which is what lets one frozen processor serve every page: `file.path` is the
markdown file's path, and `file.data` is per document. A plugin that needs to
remember something about the current page puts it there. A module-level `Map`
keyed by nothing is the version of the same plugin that works on the first file
and reports the first file's answer for all of the rest.

## What a plugin cannot reach

The slots are the whole seam. The steps around them are not configurable, and
several of the package's promises depend on that: link resolution and the
broken-link and anchor assertions described in [Links](./links.md), the code
frame and its fence `title=`, the Shiki step's colour handling in
[Theming](./theming.md), and the shared tree behind [Search](./search.md).

Everything else the route accepts — `langs`, `themes`, `highlighter`,
`excludeLangs`, `linkResolver`, `imageResolver`, and the
[`labels`](./translating.md) — is in
[Configuration](../reference/configuration.md).
