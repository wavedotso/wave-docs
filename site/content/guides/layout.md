---
title: Layout
description: The shell docs.Layout renders, its three props, and composing your own instead.
---

`export default docs.Layout` is the whole of the shell — one re-export, in the
layout file beside the catch-all route.

## What the one line renders

**Skip link, sidebar, mobile drawer, and the grid that arranges them.** There
is no header. The sidebar is the chrome, and it holds the drawer trigger, the
search trigger and the drawer itself.

It is a real box at every width, in two shapes and one tree. At 64rem and
above it is a 16rem sticky column, the search trigger at the top of it and the
navigation below. Under 64rem it is a sticky strip spanning the grid's single
track, the drawer trigger beside the search trigger and the navigation inside
the `<dialog>` that trigger opens.

It reads the navigation tree and the search index URL itself, so there is
nothing to fetch and nothing to pass — the line from the
[quick start](../getting-started/quick-start.md) is the finished shell.

Your layout stays a Server Component. The two pieces that need a client — the
navigation, for `usePathname`, and the search dialog — carry their own
`'use client'` boundaries inside the package, so the boundary is theirs rather
than yours.

It owns neither `<html>` nor `<body>`, which is what lets it nest under `/docs`
in an existing app or sit in the root layout of a site whose docs are the root,
as this one does.

## Composing into a host that already has chrome

**Every persistent element this package renders is in normal flow, inside the
grid, and offsettable.** Nothing is `position: fixed`, and the difference is
mechanical rather than stylistic: two elements in flow push each other and
both stay visible, while a fixed one overlaps whatever is beneath it with
neither side able to detect the collision. That is what lets the shell drop
into an application that already has a header, a navbar and site-wide search
of its own — theirs render around `docs.Layout`, and documentation search
stays inside the sidebar, where what it searches is not a question. Modals
are the exception and always were: the search dialog and the drawer are
top-layer, and present only while open.

The one fact only the host knows is whether their own bar is sticky and how
tall it is. That is `--wave-docs-chrome-offset`, and it is the whole of what
they have to say:

```css title="app/globals.css"
:root {
  --wave-docs-chrome-offset: 4rem;
}
```

Both sticky columns start there instead of at the top of the viewport, and an
anchored heading parks below it rather than underneath the bar. There is no
mode flag and no header switch beside it, because there is nothing else about
a host's chrome this package needs to be told.
[Theming](./theming.md) has the other five layout tokens.

## The props

Call it instead of re-exporting it when there is something to configure:

```tsx title="app/docs/layout.tsx"
import type { ReactNode } from 'react';
import '@waveso/docs/styles.css';
import { docs } from '@/lib/docs';

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <docs.Layout search={{ placeholder: 'Search the docs' }}>
      {children}
    </docs.Layout>
  );
}
```

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `children` | `ReactNode` | — | The page, rendered straight into the grid |
| `search` | `boolean \| DocsLayoutSearchProps` | `true` | The search trigger. An object configures the dialog |
| `labels` | `DocsLabels` | the route's | Overrides `createDocsRoute`'s labels, key by key |

**Three props, and two of them are small objects.** That is deliberate, and it
is the difference between this and an eleven-slot layout: everything else a
docs shell gets asked for is already reachable somewhere better. An
announcement banner renders *above* `<docs.Layout>` in your own layout, and a
footer below it, because this does not own `<body>`. A content footer goes
inside `children`. Sidebar links, social icons and separators are `DocNavNode`s
you author in [`meta.json`](../getting-started/navigation.md). A theme toggle
and a repository link belong to the layout that already wraps this one.

There were five. `title` and `actions` were slots in the header and went with
it.

`search` takes anything [`DocsSearch`](./search.md) takes except `indexUrl`,
which stays derived from your `basePath`, and with `miniSearchOptions` narrowed
to its serialisable half. You do not need to repeat that option here to match
`createDocsRoute` — the route's own value is forwarded, so the object that
built the index is the object that queries it. `className` is joined rather
than replaced: `search={{ className: 'my-search' }}` adds to
`wave-docs-layout__search` instead of taking the grid placement away from the
trigger.

> [!WARNING]
> A `tokenize` or a `processTerm` here is refused by name with
> `invalid-config` rather than forwarded, because this prop crosses to a
> Client Component. [Search](./search.md) has the boundary to take instead.

The shell renders four of the twenty-two strings, and `labels` overrides
`createDocsRoute`'s key by key — see
[Translating the chrome](./translating.md).

## The mobile drawer

Below 64rem the strip carries a server-rendered
`<button command="show-modal">` and the navigation is the `<dialog>` it opens
— so it works on the first tap, before hydration, and with JavaScript
disabled. Trigger and drawer are bound by a fixed `id` rather than a `useId`:
they render in different subtrees, and the attributes must agree before React
hydrates or the first tap does nothing.

Why it is a `<dialog>` at all, and what the component adds on top of one, is
in [Internals](../internals.md).

At 64rem and above the trigger is `display: none` and that same dialog becomes
the sticky column, via `display: contents`. The rule is scoped `:not(:modal)`,
so the drawer still opens as a real modal at any width — a 64rem viewport at
200% zoom is a narrow one.

## Composing it yourself

`docs.Layout` is one opinion, not a tax. The components underneath are
[exported individually](../reference/components.md) and take data as props, so
a shell of your own is `DocsSidebar` + `DocsToc` + `SkipLink` + `DocsSearch`
with your own CSS — pass `docs.searchIndexUrl` to the last of those. The drawer
is not among them: it is private, because the trigger that opens it lives in
the sidebar strip and is bound by `id`.

`docs.getPage(segments)` gives you the parts a custom page needs:

```tsx title="app/docs/[...slug]/page.tsx"
import { notFound } from 'next/navigation';
import { DocContent } from '@waveso/docs/react/doc-content';
import { DocsToc } from '@waveso/docs/react/toc';
import { docs } from '@/lib/docs';

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const doc = await docs.getPage(slug ?? []);
  if (!doc) notFound();

  return (
    <>
      <main className="wave-docs-layout__main" id="docs-content" tabIndex={-1}>
        <DocContent hast={doc.hast} />
      </main>
      {doc.toc.length === 0 ? null : (
        <aside className="wave-docs-layout__toc">
          <DocsToc entries={doc.toc} />
        </aside>
      )}
    </>
  );
}
```

`docs-content` is the id the skip link points at, and `DOCS_CONTENT_ID` — from
`@waveso/docs/react/skip-link` — is that string. The `tabIndex` goes with it: a
fragment link moves the scroll position but not always the focus, and an
unfocusable target strands a keyboard reader at the top of the sidebar they
were trying to skip. `main`, not `article`, because this is the page's main
landmark and there is nothing else in the shell competing for the role.

> [!IMPORTANT]
> `docs.Page` returns exactly this shape: the `<main>` and the table of
> contents as **two siblings**, not one wrapped element. They land as direct
> children of the grid, which is what puts them in separate columns — so a page
> of your own inside `docs.Layout` returns a fragment rather than a wrapper.

### next/link and exactOptionalPropertyTypes

**Passing `next/link` straight into `DocsSidebar` does not type-check under
`exactOptionalPropertyTypes: true`.** Next's `LinkProps` re-declares
`onClick?`, `onMouseEnter?` and `onTouchStart?` *without* `| undefined` while
React's anchor props include it, so the two declaration files disagree — about
props `next/link` accepts at runtime. It is true of every `next/link` call
site in a project with that flag on, not only this one.

Import `DocsLink` rather than casting. Narrowing `DocsLinkProps` to fit would
break the plain-`<a>` fallback that makes these components host-agnostic,
which is a real feature traded for a types artifact.

`docs.Layout`, `docs.Page` and `DocsSearch` are all unaffected — each wraps
`next/link` inside the package, which is where that cast belongs. Without the
flag, `Link={Link}` compiles as written.

### The two class names are load-bearing

They are the part of this most often left off, and both are public API since
0.3.0, so they are safe to write by hand.
[Stability](../reference/stability.md) has what that covers.

`wave-docs-layout__main` carries the block padding and `min-width: 0`. That
last one is a pair with the grid's `minmax(0, 1fr)`, and the two fail in
opposite directions: the track constraint protects a child that carries no
`min-width`, and `min-width: 0` protects a track someone respells. Measured
with both removed: 1048px of document inside a 1024px viewport, on one wide
table.

`wave-docs-layout__toc` is what the grid reserves its third track with, via
`:has()`. Unclassed, the table of contents auto-places into the next row
underneath the sidebar above 80rem, and renders inline on a phone instead of
being hidden.

**The `null` is load-bearing too.** `:has()` matches an empty `<aside>` exactly
as well as a full one, so a page with no headings would give up 15rem of track
to nothing. Render no element rather than an empty one.

The widths themselves — 16rem of sidebar, 15rem of table of contents — are
tokens. [Theming](./theming.md) is where to change them.
