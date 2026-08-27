---
'@waveso/docs': minor
---

**A search result's trail reads names, not slugs.**

`Getting started › Installation`, where it used to be
`getting-started › installation`. `docs.Layout` builds the lookup from the
navigation and passes it to the dialog as `crumbTitles`; a host composing the
dialog by hand and passing none gets slugs, not gaps.

⚠️ THE TITLES ARE NOT IN THE SEARCH INDEX, AND THAT IS THE WHOLE REASON THIS IS
AFFORDABLE. `search-index.json` is 46 KB gzipped on this package's own site and
the README publishes that number; a title on every record would grow the one
artifact the package is sold on. This is one entry per *directory*, out of a
tree the layout already holds and already serialises for the sidebar.

⚠️ AND A GROUP HAS NO SLUG OF ITS OWN. `DocNavGroup` is a title, a children
array and an optional `href` — nothing names its directory — so the path comes
from the first descendant page's slug, cut at the depth the group sits at. Keyed
by the cumulative path rather than the bare segment, because `guides/api` and
`reference/api` are both `api` and the second would otherwise rename the first.

⚠️ AND THE ROOT PAGE'S `/` IS GONE. A page at the site root has no trail, and a
lone slash was a filler for that — the one row still speaking in URLs while
every other row spoke in names. It shows the name its navigation entry carries
instead.

Measured: the dialog grows 40 bytes gzipped, and the published figure for
"Search dialog and router wiring" moves from 9.8 KB to 9.9 KB. A document here
may not understate what this package costs.
