---
'@waveso/docs': patch
---

**A table header stops drawing a band of the frame's own colour.**

`thead th` was `--wave-docs-bg-subtle`, which is the panel frame's tone — so
inside the frame it painted a tinted band immediately within the surface's
border: border, band, border inside about six pixels, which reads as a doubled
frame rather than as a header.

It is the surface's own ground now, through
`--wave-docs-panel-surface`, so a host that repaints the surface gets a header
that follows it. Still opaque, because rows scroll underneath a sticky header
and a transparent one shows them through — weight and the rule below it are
what say "header", the same way "where to go next" divides its rows and tints
none of them.
