---
'@waveso/docs': patch
---

**The copy button draws Lucide icons, like everything else here.**

It rendered `⧉`, and swapped in `✓` and `×` through CSS `content` — three
characters drawn by whatever font resolved, at whatever weight and baseline
that font has, beside a sidebar, a pager, a callout and a search dialog that
are all Lucide paths at `stroke-width: 2`. It read as a different icon set
because it was one. Now `copy`, `check` and `x` on the same 24×24 grid.

⚠️ THE SWAP IS `display` AND NOT `visibility`, AND THAT IS NOT A PREFERENCE.
All three icons ship in the markup and the stylesheet picks one — there is no
component owning this button, so there is no state to re-render. But the button
is `visibility: hidden` until the runtime attaches, which is what keeps a reader
with no JavaScript from meeting a control that does nothing and keeps it out of
the tab order — and `visibility` inherits. An icon rule setting it back to
`visible` would draw a glyph inside a button that is meant to be invisible.
`display` does not inherit, so the button's own rule still governs all three.

Three icons per fence is fifty on a page with fifty of them, and the repeat is
why that is affordable: byte-identical every time, which is the case gzip
handles best. The quick start's gzipped payload did not move, and the
hast-over-the-wire ratio for code and tables went from 1.11× to 1.09×.

⚠️ AND ONE TEST WAS PASSING BY ACCIDENT. `render.test.ts` asserted that a
GitHub alert produces no octicons by checking the *whole document* for `<svg>`,
which was only ever true because nothing else in the pipeline emitted one. It
now checks the callout's own subtree, which is what it meant.
