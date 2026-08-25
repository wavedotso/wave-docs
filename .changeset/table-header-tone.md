---
'@waveso/docs': patch
---

**A table header stops drawing a band of the frame's own colour.**

`thead th` was `--wave-docs-bg-subtle`, which is the panel frame's tone — so
inside the frame it painted a tinted band immediately within the surface's
border: border, band, border inside about six pixels, which reads as a doubled
frame rather than as a header.

The rule under it is gone with the tint. It was a `box-shadow: inset 0 -1px 0`
rather than a `border-block-end`, because with `border-collapse: collapse` the
border belongs to the table and scrolls out from under a sticky cell — and
inside the frame it was the third horizontal line in about six pixels. Weight is
what says "header" now, the same way "where to go next" gives its own title
neither a rule nor a ground.

⚠️ THE `background` DECLARATION STAYS, AND IT IS NOT DECORATION. It is the
surface's own colour through `--wave-docs-panel-surface`, so there is nothing to
see and a host that repaints the surface gets a header that follows it. But a
sticky cell with a *transparent* background shows the rows travelling underneath
it the moment anything gives the table a height to scroll in, which a host
constraining the panel can do without touching this file.
