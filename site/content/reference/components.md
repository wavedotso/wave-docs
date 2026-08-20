---
title: Components
description: Every React component the package exports, its subpath, its props and its defaults.
---

Ten subpaths under `@waveso/docs/react/`, one module each, every one listed in
`exports` — there is no wildcard, so a name that is not here is not importable.

## Data in, no router

**Every component takes its data as props, and every module that imports
`next/*` is named for it** — `next-search` for `useRouter`, `next-link` for
`next/link` itself, and the private `next-nav` for `usePathname`, so the
exceptions are visible in the file list rather than buried. Only the two that
reach for a hook tie anything here to a router. Everything else has
`next/link` and `next/image` injected, which keeps the renderer host-agnostic
and testable without mounting one: the sidebar's tests pass a string
`pathname`, the dialog's a stub `navigate`.

`DocsSearch` is the one component that reaches for Next itself, and it exists
so the exception is ours rather than yours — it is the fifteen-line
`'use client'` wrapper around `SearchDialog` every consumer wrote by hand, and
the ones who skipped `Link` lost hover prefetching on every result with nothing
telling them.

| Component | Subpath | Boundary | |
| --- | --- | --- | --- |
| `DocContent` | `react/doc-content` | server | Renders a hast tree, inside `.wave-docs-prose` |
| `DocsSidebar` | `react/sidebar` | client | Takes `pathname` as a prop, not from `next/navigation` |
| `DocsToc` | `react/toc` | client | Scrollspy via `IntersectionObserver` |
| `DocsSearch` | `react/next-search` | client | `SearchDialog`, wired to Next's router |
| `SearchDialog` | `react/search-dialog` | client | ⌘K, arrow keys, focus trap. Host-agnostic |
| `DocsLink` | `react/next-link` | client | `next/link`, adapted — pass it as `Link` when composing by hand |
| `Callout` | `react/callout` | server | Note · tip · important · warning · caution |
| `YouTube` | `react/youtube` | server | Click-to-load facade, with no client JavaScript at all |
| `SkipLink` | `react/skip-link` | server | Targets `docs.Page`'s `<main>`; `DOCS_CONTENT_ID` is that id |
| `createMarkdownComponents` | `react/markdown-components` | server | The element → component map |

None of them needs a Node builtin — the whole `react/*` family bundles with
nothing assumed, which [Entry points](./entry-points.md) states exactly.

**The shell is not on this list.** Its modules are private —
[Stability](./stability.md) names them, with the reason for each.
`docs.Layout` is the public name for the shell, and it has to be: the drawer's
trigger lives in the header and binds to the dialog by a fixed `id`, so
exporting the pieces would publish a way to render half a shell.
[Layout](../guides/layout.md) covers composing your own.

## DocContent

```tsx title="app/docs/[...slug]/page.tsx"
import { DocContent } from '@waveso/docs/react/doc-content';
```

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `hast` | `Root` | — | The tree from `docs.getPage`, or from `@waveso/docs/render` |
| `components` | `MarkdownComponents` | — | Overrides, merged over `defaultMarkdownComponents` |
| `className` | `string` | — | Appended to `wave-docs-prose`, never substituted for it |
| `labels` | `CodeRuntimeLabels` | — | The copy runtime's two announcements |

**A Server Component, and it must stay one.** The parser and Shiki ran in Node
at build time; this walks the resulting tree, and nothing here pulls unified,
remark or a highlighter into the browser.

`className` is appended, never substituted: nearly every rule in the stylesheet
is scoped under `.wave-docs-prose`, `.wave-docs-prose .shiki` included, so
dropping it leaves a page whose code blocks keep their syntax colours and lose
everything else — which reads as a design choice rather than as a mistake.

`labels` takes `copied`, default `'Copied to the clipboard.'`, and
`copyFailed`, default `'Copy failed. Select the code and press Control or
Command + C.'` They live here because this is the component that mounts the
copy runtime, and the one no consumer can avoid. The runtime renders only when
the tree contains a code frame, so a page without fences ships no extra bytes.

## DocsSidebar

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `nav` | `DocNavNode[]` | — | The tree from `docs.source.nav()` |
| `pathname` | `string` | — | Current route, for `aria-current` and for which groups open |
| `Link` | `DocsLinkComponent` | plain `<a>` | Client-side router link |
| `label` | `string` | `'Docs'` | Accessible name for the landmark |
| `expandGroup` | `string` | `'Expand {title}'` | A collapsed group's toggle. `{title}` is the group's own name |
| `collapseGroup` | `string` | `'Collapse {title}'` | The same toggle when open |
| `externalLink` | `string` | `'(opens in a new tab)'` | Screen-reader suffix on an external link |
| `className` | `string` | — | |

`{title}` is a placeholder rather than a function because `docs.Layout` sets
these from a Server Component, and a function cannot cross that boundary — and
because a translator has to be able to move the name within the sentence.

**Nearby links prefetch; the rest do not.** Nearby means the list that directly
contains the current page, plus the heading link of the group the reader is
inside — 5 to 15 warm links on a real sidebar rather than 400 or none. No
`role="tree"` and no `tabindex` anywhere in the markup either: this is the APG
Disclosure Navigation pattern, ordinary links with a button per collapsible
group, and `sidebar.test.tsx` asserts the absence of both.

## DocsToc

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `entries` | `TocEntry[]` | — | Headings from `docs.getPage`, already nested by depth |
| `label` | `string` | `'On this page'` | Accessible name for the landmark |
| `rootMargin` | `string` | `'-80px 0px -60% 0px'` | The `IntersectionObserver` root margin |
| `topLabel` | `string` | `'Back to top'` | Text for the back-to-top link |
| `className` | `string` | — | |

The default reserves 80px for a sticky header and ignores the bottom 60% of the
screen, so the active entry tracks what you are reading rather than what has
scrolled into view. **Only `px` and `%` are legal** — `IntersectionObserver`
throws on any other unit, `rem` included.

Scrolling is the browser's: the entries are real anchors and nothing here calls
`scrollTo`. The observer retries for up to 60 frames — about a second at 60 Hz
— while *no* id resolves, which covers a `<Suspense>` boundary or a tabs
wrapper mounting its panel late. With `entries` empty the component renders
`null`, and that `null` is load-bearing in the grid.

## DocsSearch

```tsx title="app/docs/layout.tsx"
import { DocsSearch } from '@waveso/docs/react/next-search';

<DocsSearch indexUrl={docs.searchIndexUrl} />
```

`DocsSearchProps` is `Omit<SearchDialogProps, 'navigate' | 'Link'>` — Next
answers those two, and [Internals](../internals.md) has why `navigate` is a
closure rather than the method itself. `indexUrl` stays required, and
`docs.searchIndexUrl` is the only value to pass: defaulting it to
`/search-index.json` would be wrong under every non-root `basePath`, and wrong
as a 404 the reader hits and the author never sees.

## SearchDialog

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `indexUrl` | `string` | — | URL of the serialised index |
| `navigate` | `(href: string) => void` | — | Router navigation for the selected result |
| `Link` | `DocsLinkComponent` | plain `<a>` | Result links, so hovering a hit prefetches |

The other fifteen props are the ten strings, the three numbers,
`resultCountLabels` and `miniSearchOptions`. They are tabulated with their
defaults on [Search](../guides/search.md) rather than repeated here — that
page explains the tuning and the client boundary, and one table for both is
one table to keep correct.

`navigate` is injected rather than imported so the dialog stays host-agnostic:
`useRouter().push`, a `react-router` navigate and `location.assign` all satisfy
it. The dialog portals itself to `document.body`, so a navbar's stacking
context cannot trap it behind the page. Render it once, wherever the trigger
belongs.

## DocsLink

`next/link`, adapted to `DocsLinkProps` and ready to pass. It takes no props of
its own — it *is* a `DocsLinkComponent`.

```tsx title="app/docs/nav.tsx"
'use client';
import { DocsLink } from '@waveso/docs/react/next-link';
import { DocsSidebar } from '@waveso/docs/react/sidebar';

<DocsSidebar nav={nav} pathname={pathname} Link={DocsLink} />
```

A module-scope constant rather than a factory: a fresh component identity for a
link remounts every link in the document on every render.

Pass it rather than `next/link` itself, which does not type-check into
`DocsSidebar` under `exactOptionalPropertyTypes: true` —
[Layout](../guides/layout.md) has that case.

Its `'use client'` is not for a hook — there is none. A function cannot be
handed from a Server Component to a Client one, so without the directive
passing it to `DocsSidebar` fails `next build` with "Functions cannot be passed
directly to Client Components".

## Callout

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `type` | `string` | `'note'` | One of `CALLOUT_TYPES`; anything unrecognised falls back to `note` |
| `title` | `string` | the type's own heading | Overrides the heading for this callout |
| `labels` | `Partial<Record<CalloutType, string>>` | — | Default headings per type |
| `className` | `string` | — | |
| `children` | `ReactNode` | — | |

`CALLOUT_TYPES` is `['note', 'tip', 'important', 'warning', 'caution']` — the
five kinds GitHub understands, and the five `rehype-github-alerts` emits from
`> [!NOTE]` and friends. `CalloutType` is that union. `type` is typed as a
plain string because it arrives as an unvalidated hast attribute, and a blank
`title` counts as absent: an empty one leaves the callout with no accessible
name, which is the one thing this component exists to provide.

It renders an `<aside role="note">` carrying the label on `aria-label`, rather
than leaving the kind to the coloured border — which conveys nothing to a
screen reader and nothing to the 8% of men who cannot separate the red one from
the green one.

## YouTube

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `id` | `string` | — | The 11-character video id. Without it the component renders `null` |
| `start` | `number` | — | Seconds to start at, from the link's `t` or `start` |
| `list` | `string` | — | Playlist the video was linked inside, from the link's `list` |
| `title` | `string` | `'YouTube video player'` | Accessible name for the player |
| `playLabel` | `string` | `'Play video: {title}'` | The closed facade's control |
| `hideLabel` | `string` | `'Hide video: {title}'` | The open facade's control |
| `className` | `string` | — | |

`{title}` is replaced with `title` in both labels — a placeholder rather than
concatenation, because several languages put the name first.

**No hydration root.** Without an `id` it renders `null`, and the facade is a
`<details>` rather than a state hook — [Internals](../internals.md) has the
measurement.

## SkipLink

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `href` | `string` | `'#docs-content'` | Fragment id of the main content region |
| `className` | `string` | — | |
| `children` | `ReactNode` | `'Skip to content'` | |

`DOCS_CONTENT_ID` is re-exported from the same subpath and is the string
`'docs-content'`. One constant for both halves, and no way to change it: the id
was spelled independently in two files once, and a skip link pointing at an id
nothing carries scrolls nowhere and focuses nothing — a failure with no symptom
until a keyboard user hits it.

Put it first inside `<body>`, and give the target `tabIndex={-1}`. Browsers
move the scroll position on a fragment link but not always the focus, so an
unfocusable target strands focus at the top of the document. `docs.Layout`
renders one for you.

## createMarkdownComponents

| Option | Type | Default | |
| --- | --- | --- | --- |
| `Link` | `DocsLinkComponent` | plain `<a>` | Client-side router link |
| `Image` | `DocsImageComponent` | plain `<img>` | Optimising image component |
| `labels` | `MarkdownLabels` | — | The ten strings this map renders itself |

It returns a `MarkdownComponents` map with five entries — `a`, `img`, `table`,
`callout` and `youtube` — and `defaultMarkdownComponents` is the result of
calling it with nothing. **Call it once at module scope.** Every call returns
fresh component identities, and remounting the whole document on each render is
what that costs.

`MarkdownLabels` is the subset of `DocsLabels` this map owns: `externalLink`,
`table`, the five `calloutNote`…`calloutCaution` headings, and `youtubeTitle`,
`youtubePlay` and `youtubeHide`. All server-rendered, so overriding them costs
no client bytes. [Translating the chrome](../guides/translating.md) has the
whole set.

The `a` mapping drops a destination whose scheme is not in the allowlist,
keeping the text in a `<span>` and warning once per href outside production;
adds `target="_blank" rel="noopener noreferrer"` and a visually hidden
`externalLink` suffix to a link that opens in a new tab; and routes only in-app
paths through `Link`, since fragments and `mailto:` gain nothing from a router
link and break under one. `table` wraps the table in a labelled, focusable
`<section>` — a scroll container that is not focusable cannot be scrolled by
keyboard at all.

### DocsLinkProps

`Omit<ComponentProps<'a'>, 'href' | 'ref'>` with `href: string` required, plus
one addition: `prefetch?: boolean`, honoured by `next/link` and ignored by a
plain `<a>`. **`false` disables the hover path and the viewport path both**, so
it is a stronger switch in the App Router than the name suggests. The adapter
omits it rather than passing `undefined`, since `next/link`'s own `prefetch` is
`boolean | 'auto' | null` with no `undefined` in it.

The interface is shaped to be satisfied by `next/link` without this package
ever importing it. Importing `next/*` here would couple the React layer to
Next, which is half the point of the package.

### DocsImageProps

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `src` | `string` | — | Required |
| `alt` | `string` | — | Required; the mapping passes `''` when the tree carries none |
| `width` | `number` | — | Required |
| `height` | `number` | — | Required |
| `title` | `string` | — | |
| `className` | `string` | — | Joined with `wave-docs-image` |
| `sizes` | `string` | — | Forwarded to the image |
| `loading` | `'eager' \| 'lazy'` | `'lazy'` | |
| `decoding` | `'async' \| 'auto' \| 'sync'` | `'async'` | |
| `fetchPriority` | `'high' \| 'low' \| 'auto'` | — | `'high'` on a hero image is the usual reason |

`width` and `height` are required because `next/image` refuses to render
without them, short of `fill`; they come from the build-time `ImageResolver`.
Where either is missing the mapping degrades to a plain `<img>` rather than
failing the page — [Images](../guides/images.md) has that path in full.

`loading` defaults to `lazy`, but never over the author's own choice: a leading
image is lifted out of its paragraph precisely because it is usually the page's
LCP element, and lazy-loading that costs it a round trip.

> [!IMPORTANT]
> **Only what `DocsImageProps` declares reaches a custom `Image`.** Markdown
> carries none of `sizes`, `loading`, `decoding` or `fetchPriority`, so they
> come from your `imageResolver` or a `components` override — and anything else
> in the tree's attributes stops at this seam. `decoding` and `fetchPriority`
> were documented as surviving into the optimising branch while the adapter
> destructured a fixed list without them; they are declared members now rather
> than a promise the code could not keep.

Next: [Errors](./errors.md).
