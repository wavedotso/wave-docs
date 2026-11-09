---
'@waveso/docs': minor
---

**`docs.Layout` takes a `brand`: the site's mark, at the top of the sidebar.**

It renders above the search trigger, inside the navigation the sidebar's trigger moves, in a `.wave-docs-layout__brand` wrapper with the same room under it as the search. Nothing renders when it is unset, so existing sites are unchanged.

It is not the header's `title` come back. It adds no bar across the top, so a host with a navbar of its own still gets no second one; it answers the one region a host cannot reach from outside `docs.Layout`, the top of the sidebar, for a site whose docs carry no navbar of their own.
