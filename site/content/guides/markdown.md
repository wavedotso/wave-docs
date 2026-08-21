---
title: Markdown
description: GFM, GitHub alerts, heading permalinks and YouTube facades — and the raw HTML that is thrown away.
---

The pipeline is remark and rehype, in a fixed order, in Node at build time. It
understands GFM, GitHub's alert syntax and a bare YouTube URL. It drops raw
HTML.

## GFM

`remark-gfm` runs immediately after the parser, so tables, strikethrough, task
lists, autolinks and footnotes all work.

```md title="content/guides/example.md"
| Route | File |
| --- | --- |
| `/` | `content/index.md` |

~~Absolute links~~ — link the `.md` file instead.

- [x] Parse the file
- [ ] Ship it

https://github.com/wavedotso/wave-docs
```

A table is wrapped in a focusable, labelled `<section>`: CSS alone cannot make
a wide table scrollable, an unfocusable scroll container cannot be scrolled by
keyboard, and the label turns that tab stop into a named `region`. It reads
`Table`; `labels.table` renames it, along with [the chrome](./translating.md).

**Footnotes use the package's own visually-hidden class.** `remark-rehype`
labels the generated footnote section `class="sr-only"` — a class this package
deliberately does not define, since Tailwind is optional here — so it rendered
as a visible, unstyled "Footnotes" heading. It points at `wave-docs-sr-only`
instead, which hides it the way the default intended.

## Callouts

GitHub's alert syntax becomes a `<callout type="note">` element, mapped to the
`Callout` component:

```md
> [!NOTE]
> The marker line disappears. Everything after it is the body.
```

There are five types. The label is the accessible name — it is carried on
`aria-label`, because a coloured border conveys nothing to a screen reader and
nothing to the 8% of men who cannot separate the red one from the green one.

| Marker | Label | `labels` key |
| --- | --- | --- |
| `> [!NOTE]` | Note | `calloutNote` |
| `> [!TIP]` | Tip | `calloutTip` |
| `> [!IMPORTANT]` | Important | `calloutImportant` |
| `> [!WARNING]` | Warning | `calloutWarning` |
| `> [!CAUTION]` | Caution | `calloutCaution` |

All five, as they render:

> [!NOTE]
> `> [!NOTE]` is still an ordinary blockquote after `remark-gfm` — alerts are
> not part of GFM. `rehype-github-alerts` converts it on the hast side, which
> is why the same file is a quoted block on GitHub and this box here.

> [!TIP]
> A callout holds whatever a blockquote holds. The children are handed straight
> to the `callout` element and the code steps run afterwards, so a list, a
> table or a highlighted fence inside one behaves as it does anywhere else.

> [!IMPORTANT]
> The element is an `<aside role="note">`. `aside` is the honest element for a
> box beside the prose, and the explicit role keeps a callout in the middle of
> an article out of every screen reader's landmark list.

> [!WARNING]
> A `type` this package does not recognise falls back to `note` rather than
> to an unstyled box, and the match folds case. A plugin emitting `danger`
> ships a Note, quietly.

> [!CAUTION]
> The label is the accessible name, so it is never empty. `title` renames one
> box and the `labels` key in the table above renames every box of that
> type; a blank `title` counts as absent, rather than leaving an `<aside>`
> whose only signal is a colour.

`Callout`'s props are in [Components](../reference/components.md).

## Heading ids and permalinks

Every heading gets an id from its text and a permalink appended after it: an
`<a class="heading-anchor">` containing `#`, `aria-hidden`, out of the tab
order. The heading beside it says the same thing, and an empty focusable anchor
with no accessible name is worse than no anchor.

Ids are `github-slugger`'s, so two sections called "Install" become `#install`
and `#install-1`. Anchors are checked at build time; that is
[Links](./links.md).

**A heading that slugs to nothing gets `section-1`.** `github-slugger` strips
emoji and punctuation, so `## 🎉` slugs to the empty string. One such heading is
merely unlinkable; two are worse, because the slugger records the empty slug as
taken and the next becomes `-1`, then `-2` — positional ids, so adding an emoji
heading above moves every anchor below it and rots every link anyone shared.
Substituting before slugging keeps the empty string out of the collision table.

## Lone images

An image alone in a paragraph is lifted out of it. Images render as `<figure>`,
which is not phrasing content, so `<p><figure>…</figure></p>` makes the parser
close the paragraph early and the DOM stops matching what the server rendered —
a hydration mismatch with no indication of the cause, and often no report at
all, only a silently discarded subtree. A paragraph with a caption beside the
image is prose, and stays one. `imageResolver` is in [Images](./images.md).

## YouTube URLs

A paragraph containing nothing but a YouTube URL becomes a click-to-load
facade: one ~15 KB thumbnail against the ~717 KB an eager `<iframe>` fetches on
every page view, pressed or not. It is a `<details>` element and ships no client
JavaScript at all — [Internals](../internals.md) has the accounting.

```md
https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=754

[the part about hydration](https://youtu.be/dQw4w9WgXcQ?t=754)
```

The first becomes a player. The second keeps its label and stays a link: only a
link whose visible text is its own href is converted. `watch`, `youtu.be`,
`shorts`, `embed` and `youtube-nocookie.com` are recognised, and a `t`, `start`
or `list` is carried into the embed — a link to one moment in a two-hour talk
used to open at zero and, because the facade autoplays, start playing there.
Anything that is not a single video stays a link.

## Raw HTML is dropped

**Raw HTML in the source is dropped, not passed through.** `remark-rehype` runs
with `allowDangerousHtml: false`, so `<div>`, `<br>` and `<details>` do not
reach the tree and do not reach the page. It fails silently — no error, no
warning, the element is absent, and a `<details>` block that took an afternoon
to write is gone with nothing to grep for.

That is about the pipeline rather than about trust. The output is a hast tree
mapped onto React components — nothing is ever handed to
`dangerouslySetInnerHTML` — so raw HTML has nowhere to go. Passing it through
would take `rehype-raw`, which is not in the chain: on its own it happily
reparses `<script>` back into the tree. A link's own href passes through
untouched, and a scheme outside the allowlist loses its destination.

For an element markdown has no syntax for, add a rehype plugin that emits it and
a component to render it. Both slots are in [Plugins](./plugins.md).

Fenced code has enough behaviour to need a page of its own.

Next: [Code blocks](./code-blocks.md).
