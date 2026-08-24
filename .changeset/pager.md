---
'@waveso/docs': minor
---

**Every page links to the ones either side of it.** `docs.Page` renders a pager
under the prose. Nothing is authored: a page gets one by being in the
navigation.

⚠️ THE ORDER IS THE SIDEBAR'S, NOT THE SLUG LIST'S. `generateStaticParams` has
every route in it and no opinion about their order; `meta.json` is where the
author said what comes next, and it is what the reader is looking at. Two
orderings of the same pages is two answers to one question, and they drift the
first time a `meta.json` moves — so the pager reads the same tree `DocsSidebar`
renders and flattens it. A pager that disagrees with the column beside it is
impossible by construction.

Separators and external links are not stops: a separator is a label with
nowhere to go, and a "next page" that lands on npm has ended the sequence
rather than continued it. A group with an `index.md` contributes its own page
before its children, which is the order its rows appear in.

⚠️ A PAGE OUTSIDE THE TREE GETS NO PAGER, RATHER THAN THE FIRST ONE. `-1` from
`findIndex` reads as "just before the beginning", so an unguarded lookup hands
every draft and every route rendered outside the navigation the same first page
as its "next" — confidently wrong on exactly the pages nobody checks.

⚠️ AND AN EMPTY CELL AT EACH END, NOT A MISSING ONE. The two links share a grid
row; drop the absent side and the survivor slides into the first track, so the
first page of a site puts "Next" on the left and every other page puts it on
the right. The one page where the position moves is the one a reader sees
first.

Nothing renders at all when there is no neighbour either side — a one-page site
would otherwise get a navigation landmark containing nothing.

A chevron on the outer edge of each link points the way it goes.

⚠️ AND "OUTWARD" MIRRORS. Under `dir="rtl"` the grid's first track is on the
right, so the *previous* link moves there and its arrow has to point right —
the reverse of the rule that draws it. Same trap as the sidebar's chevron, in a
component built after it, and `[dir='rtl']` again rather than `:dir(rtl)`.

No client JavaScript: two links, two captions and two glyphs, rendered on the
server. Each
link is named by direction *and* destination — "Previous: Installation" — since
a link announced as a bare title says nothing about which way it goes. The
landmark is named too, because a page now carries three of them.

New: `DocsPager` at `@waveso/docs/react/pager`, `pager: false` on
`createDocsRoute` to omit it, and `previousPage`, `nextPage` and `pagination`
in `labels`.
