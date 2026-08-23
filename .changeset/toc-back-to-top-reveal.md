---
'@waveso/docs': patch
---

The back-to-top link appears when there is something to go back to.

It sat at the foot of the table of contents on every page, including at the top
of one, offering to return a reader to where they already were. It now fades in
between 25dvh and 35dvh of scroll and fades back out on the way up.

No JavaScript was added to do it. The reveal is a scroll-driven animation, so
scroll position alone drives it — no listener, no state, no re-render per
frame, and correct before the component has hydrated. `DocsToc` is the smallest
client component this package ships and it has not grown by a byte.

`visibility` moves with the fade, so the link leaves the tab order while it is
invisible rather than sitting there as a focus target nobody can see — and it
rejoins only once it is legible, not at the first pixel of the fade.

Where the timeline cannot run the link is simply always present, exactly as it
was: Firefox has not shipped scroll-driven animations, a page too short to
scroll leaves the timeline inactive, and so does a host that scrolls an inner
pane rather than the document. Nothing hides a control on the strength of a
feature the engine did not run.
