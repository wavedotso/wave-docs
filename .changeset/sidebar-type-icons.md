---
'@waveso/docs': minor
---

**The sidebar tells a category from a page at a glance.** A folder on every
group, a page on every page.

Weight and a chevron were the only difference, and that is not enough to scan:
a `Reference` group sitting directly above an `Internals` page read as one
undifferentiated column, and a real tree interleaves the two a dozen times. A
silhouette is read before any word is.

Two inline SVG paths, in the same style as the disclosure chevron and the
external-link mark that were already there. The package still ships no icon
set and takes no icon dependency — a folder and a page are as generic as the
chevron beside them.

`icons={false}` on `DocsSidebar` turns them off, for a host whose own
navigation has a different vocabulary and does not want a second one.

⚠️ AN EXTERNAL LINK'S MARK MOVED TO THE HEAD OF ITS ROW. It used to sit at the
far end, which cost twice: the leading slot had to be an empty box to stop the
column going ragged, and the trailing edge carried two unrelated meanings —
"opens elsewhere" on one row, "expands" on the next. Leading is what a row *is*;
trailing is what it *does*. With the mark moved, the only thing at the far end
of any row is a chevron, which is what makes a group legible from across the
column, and it leaves that edge free for a status dot or an overflow control
later. A browser test measures the alignment, because the claim is about a
column and a column is geometry.

The sr-only "(opens in a new tab)" did **not** move with it — the name is still
read as "GitHub, opens in a new tab" rather than the other way round.

⚠️ AND `icons={false}` PUTS THE MARK BACK ON THE TRAILING EDGE. With no column
to lead, rendering nothing would leave a link that leaves your site looking
exactly like one that does not. Turning off a decorative column is not consent
to drop a warning.

The markers sit at `opacity: 0.4` and inherit their row's colour rather than
carrying a grey of their own, so the relationship holds at every weight — a
bold group title and a muted page title each get a marker a fixed step lighter
than themselves. Full strength on hover and on the current page.

New public class names: `.wave-docs-sidebar__icon` and
`.wave-docs-sidebar__label`. The label wrapper is the flex hook that lets a row
put a chevron at its far end, and it is present whether or not there is a
marker beside it.

## Your own icons, by name

The three built-ins are defaults, not a set. Content names an icon; the host
maps the name to a component:

```yaml
# content/internals.md
icon: wrench
```

```json
// content/reference/meta.json
{ "title": "Reference", "icon": "book" }
```

```tsx
<docs.Layout icons={{ wrench: Wrench, book: Book }}>{children}</docs.Layout>
```

Also on `DocsSidebar` and `DocsNav` for a hand-assembled shell.

⚠️ A NAME, NEVER ART THIS PACKAGE SHIPS. Content is authored in YAML and JSON
and cannot carry a React element, and a docs package mounted inside someone
else's application must not stand its iconography next to theirs. The bundle
grows by a lookup, not by an icon set — and never will by one.

⚠️ EVERY COMPONENT IN THE MAP MUST BE A CLIENT COMPONENT. `docs.Layout` is a
Server Component and the tree it hands the map to is not, so React serialises a
*reference* to each icon; a server component cannot be one. Icons imported from
a library already satisfy this. The same boundary `search` documents.

A name with no entry in the map falls back to the built-in marker for that
node's type — a typo in one file leaves a folder where a book should be, not a
hole in the column.
