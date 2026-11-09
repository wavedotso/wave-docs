---
'@waveso/docs': patch
---

**A search result's trail opens at the documentation root.**

The second line of a result now begins with a mark for the root, then a chevron
before every crumb: `⌂ › Guides › Theming`.

It is grammar rather than information, which is what earns a constant mark here
when the `basePath` did not: the mount was constant *and* shaped like a name, so
it competed with the real segments while saying nothing. This says the one thing
no name can — that the line under the heading is a location. Without it the last
crumb reads as a repeat of the heading directly above, because a breadcrumb ends
on the page it names.

The root page needed a filler for the same reason, and no longer does. It was a
bare `/` first, then the page's own navigation title, which was the word already
on the line above. It is the home mark alone now.

The mark's `viewBox` is cropped to its ink. `vertical-align: baseline` aligns an
element's box, and Lucide leaves two user units of empty floor under the house —
8.3% of the box — so the full viewBox would hang it that far above the baseline.
Cropping is the alignment; there is no offset. One selector carries `display:
inline` and `vertical-align: baseline` for both glyphs, so a Tailwind preflight
cannot break the new one the way it broke the separator.

About 90 gzipped bytes.
