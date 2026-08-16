# ADR 001 — The shell contract

- **Status:** accepted
- **Date:** 2026-08-15
- **Applies from:** 0.3.0

## Context

The next release adds a layout: a header, a sidebar, a table-of-contents rail, a
mobile drawer, and the grid that arranges them. Nine design workstreams produced
specifications for that layout in parallel, and three of them described the same
element tree with **three different class vocabularies, three breakpoint sets and
three sticky mechanisms**.

Class names are public API here. The stability policy says everything under
`@waveso/docs/*` is public and nothing undocumented is exported; a consumer
restyling `.wave-docs-layout__sidebar` is doing exactly what the package invites,
and renaming it later is a breaking change. Meanwhile the grid CSS sits *before*
`docs.Layout` on the critical path, because Layout consumes it — so no CSS work
can start and no CSS estimate is real until one person picks one vocabulary.

This document is that pick. It is deliberately short and total: everything in it
is frozen, and anything not in it is free.

## Decision

### Element tree

`docs.Layout` renders every element below. A consumer never writes one.

```
header   .wave-docs-layout__header
           └── .wave-docs-layout__header-inner
grid     .wave-docs-layout
columns    ├── .wave-docs-layout__sidebar   wraps <DocsSidebar>
           ├── main.wave-docs-layout__main  the page's main landmark
           └── .wave-docs-layout__toc       rendered by docs.Page, placed by the grid
drawer   dialog.wave-docs-layout__drawer
```

`__toc` is rendered by `docs.Page` rather than by `Layout`, because a Next layout
receives `{children, params}` and cannot see `doc.toc`.

**`__main` is emitted by `docs.Page` too, on the `<main>` itself** — `Layout`
renders `{children}` straight into the grid with no wrapper of its own. An
earlier draft of this table said "wraps `{children}`", which is not
implementable: a wrapper would make the TOC a child of the main column instead
of a sibling track, and the third `grid-template-columns` track would sit empty
at every width above 80rem. Next inserts nothing around a page's output, so the
two elements `docs.Page` returns arrive as direct grid children.
`src/react/layout.test.tsx` and `src/next.test.ts` both pin it.

The wrappers exist so `DocsSidebar` and `DocsToc` stay layout-agnostic. A
consumer composing the primitives by hand gets the same components with none of
this vocabulary, which is the point: the shell is one opinion, not a tax.

### Breakpoints

```
64rem   sidebar column appears; drawer collapses to display: contents
80rem   TOC column appears
100rem  shell stops growing (--wave-docs-shell-width)
```

`rem`, not `px`, so a reader who raises their base font size gets the single-column
layout at a proportionally larger viewport — which is what they asked for.

64rem is not a round number chosen for looks. A 16rem sidebar plus a 46rem measure
plus two 1.5rem gutters is 65rem, so a 60rem breakpoint introduces the sidebar at
exactly the width where it starts eating the measure it exists to frame. The
sidebar arrives when there is room for it and not before.

### Tokens

Five, all settable by a consumer, all declared in `@layer theme`:

| Token | Default | Controls |
| --- | --- | --- |
| `--wave-docs-measure` | `46rem` | prose column width |
| `--wave-docs-header-height` | `3.5rem` | header, and the sticky offset below it |
| `--wave-docs-sidebar-width` | `16rem` | sidebar track |
| `--wave-docs-toc-width` | `15rem` | TOC track |
| `--wave-docs-shell-width` | `100rem` | maximum shell width |

Derived, not settable:

```css
--wave-docs-scroll-padding: calc(var(--wave-docs-header-height) + 1rem);
```

Hardcoded, not tokens: the gutter (`1.5rem`) and the drawer width
(`min(20rem, 85vw)`).

**Why five and not two.** Sidebar and TOC width share one `grid-template-columns`
declaration. Overriding a layered rule there means restating three values and
getting the middle one right — a worse escape hatch than a token. Gutter and
drawer width each appear only in single-value declarations, where an ordinary CSS
override is already the cleanest tool, so they stay literals.

**46rem** is 736px at a 16px root, which is roughly 83 `ch` in the shipped
stack. That is wider than the 45–75 characters a *prose* measure wants, and
deliberately so: this column also carries code blocks, API tables and callouts,
which need width more than a paragraph does, and narrowing it to 36rem pushes
every six-column table into horizontal scroll to buy a line length nobody
complained about. It is the measure Stripe, GitHub and most docs sites land on
for the same reason.

(An earlier draft of this ADR claimed 75 characters. It is ~83; the arithmetic
is above. The browser tier measures the real figure once it exists.)

### Sticky

Sticky positioning lives on the **wrappers** — `.wave-docs-layout__sidebar` and
`.wave-docs-layout__toc` — and never on `.wave-docs-sidebar` or `.wave-docs-toc`.

Two reasons. `position: sticky` resolves against the nearest scrolling ancestor,
so putting it on the component couples the component to a shell it must also work
without. And `DocsSidebar` has no prop for it, so a layout that wanted sticky on
the component would have to reach inside and set an attribute it does not own.

### Grid tracks

Every content track is `minmax(0, 1fr)`, and `.wave-docs-layout__main` carries
`min-width: 0`.

This is load-bearing rather than defensive. A grid track's default `min-width` is
`auto`, which resolves to the *content's* min-content width — so a wide table
pushes the track past the viewport and takes the whole page into horizontal
scroll. Measured with both removed: 1048px of document inside a 1024px viewport.

The two are **redundant with each other**, not jointly required — removing either
one alone still passes; only removing both reproduces the overflow. Keep both
anyway: they fail in opposite directions, and whichever is left reads as
arbitrary without the other beside it.

### Drawer

One `<dialog closedby="any">` holding the single `<DocsSidebar>`, opened by a
server-rendered `<button command="show-modal" commandfor="…">` — pure HTML, so it
works before hydration and with JavaScript disabled.

```html
<dialog id="wave-docs-nav" class="wave-docs-layout__drawer" closedby="any"
        aria-label="Documentation navigation">
  <button class="wave-docs-layout__drawer-close" command="close" commandfor="wave-docs-nav">…</button>
  <!-- DocsSidebar -->
</dialog>
```

At ≥64rem:

```css
dialog.wave-docs-layout__drawer:not(:modal) { display: contents; }
```

`display: contents` removes the dialog box from layout **and from the
accessibility tree**, so one nav DOM serves both breakpoints — no duplicated
landmark, no duplicated links in the payload, no second copy to keep in step.

This is the single most deletable-looking line in the shell and it must not be
deleted; it carries a comment saying so.

Measured in Chromium 149, native gives us: modal open via `command`, focus moved
inside, `::backdrop` painted, Tab cycling that never reaches the header, Escape
closing and restoring focus to the trigger, and light dismiss from `closedby`.
Two things it does not give, both handled inside the client boundary
`DocsSidebar` already occupies — closing on navigation (a `usePathname` effect
calling `close()`), and a small delegated fallback for browsers predating
`command`.

Scroll lock stays scoped:

```css
html:has(dialog.wave-docs-layout__drawer:modal) { overflow: hidden; }
```

Unscoped, a consumer's own modal would lock our scroll and vice versa.

### Pipeline step numbering

~~For anyone citing pipeline positions in a comment or a commit message: the TOC
capture is **step 10**, after `rehypeSlug` and before `rehypeAutolinkHeadings`.
An earlier draft of the roadmap called it step 11.~~

**Superseded, and the number was the mistake.** The TOC capture is now the
**last** step in the pipeline — after the host's `rehypePlugins`, after Shiki,
after `rehypeFlattenRoots` — so it describes the same document the search index
does. A plugin that adds or removes a heading changes both together, and there
is nothing left to validate afterwards.

Cite the position by what it is adjacent to, not by an index. This section
existed to stop two drafts disagreeing about "step 10" versus "step 11", and
what it actually produced was a frozen number that went stale the moment the
step moved. `src/render.ts` is the order of record.

## What this does not fix

Deliberately open, so the people building them are not boxed in: the header's
internal composition, the drawer's animation, the TOC's active-item treatment,
and every colour. Those are design decisions with no cross-workstream contract to
break.

## Alternatives rejected

**Let the first CSS PR set the convention.** Three PRs are in flight
simultaneously across three tracks; whoever lands second rewrites, and the
rewrite is invisible in review because both versions look reasonable in
isolation.

**Defer the vocabulary to `docs.Layout`.** The grid CSS is on the critical path
*before* `docs.Layout` — Layout consumes the grid, not the other way round. This
ordering is why the ADR is half a day and the alternative is a four-day rewrite.

**A `slots` map instead of fixed wrappers.** It promotes the layout's internal
anatomy to semver-frozen API immediately. Two node props can become a slots map
later; a slots map cannot become two props.

## Consequences

Every class name and token above is public API from 0.3.0 and changes only in a
major. In exchange, four workstreams can build against a fixed contract in
parallel, and the CSS estimates behind them become real.
