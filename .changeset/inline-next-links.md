---
'@waveso/docs': patch
---

**The site's pages stop hand-writing their own "Next" link.** Nineteen of them
ended with `Next: [Page](./page.md).`, which the pager has rendered from the
navigation tree since it landed — the same link, twice, a few hundred pixels
apart, and the hand-written one silently wrong the moment a page moved in the
tree.

Documentation-only: no package change.
