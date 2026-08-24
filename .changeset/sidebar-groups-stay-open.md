---
'@waveso/docs': patch
---

Sidebar groups stop collapsing behind the reader.

Expand three sections, click a page, and two of them shut. Or: open a section,
read a page in it, open another section, read a page in *that* — and the first
one closes. Both reported from real use, and both the same defect.

⚠️ THE CAUSE WAS `setToggled({})` ON EVERY NAVIGATION. The reader's own state
and the route's default share one map — `toggled[key] ?? hasActive` — so
clearing it does not "reset the tree to its default" in any useful sense. The
default is *open only what holds the current page*, so wiping the map collapses
everything the reader had deliberately opened.

Navigation now opens whatever holds the page just arrived at, and closes
nothing. A group closes when the reader closes it.

⚠️ AND IT RECORDS `true` RATHER THAN DELETING THE KEY, WHICH IS THE HALF THAT
IS EASY TO GET WRONG. Deleting also reopens the group — it falls back to
`hasActive` — and looks correct for exactly one navigation. Read a page in one
section, then a page in another, and the first section has no entry left and no
longer holds the route, so it shuts. That is the second report, reproduced by
the obvious fix.

The state is also seeded from the first route rather than starting empty, so a
group open at first paint is open by *record* rather than by inference. Without
it, landing on a deep page from a search result and clicking away collapses the
section you arrived in, while one you had opened by hand would have stayed.

Kept from the old reset: a group collapsed an hour ago must not hide the page
just navigated to. It is reopened explicitly.

It costs 60 gzipped bytes on the sidebar bundle — a walk that names the groups
holding the current route. The line it replaces cost nothing, which is the
point: the cheapest possible reset was also the one that threw away everything
the reader had opened. Published sizes rise with it: the quick start's total
14.3 → 14.5 KB, the navigation 3 → 3.1 KB.
