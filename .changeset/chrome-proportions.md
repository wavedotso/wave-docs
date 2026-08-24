---
'@waveso/docs': patch
---

The sidebar's handle and the search shortcut stop competing with the page.

**The handle is 16 × 56 and faded.** It was 20 × 80 at full strength — a solid
slab beside the reading column, for a control nobody looks at while reading. It
now sits at 40% until a pointer or a caret reaches it, the same treatment as the
tree's markers.

⚠️ BOTH MARKS FADE, NOT THE PILL ALONE. Fading `::before` by itself leaves crisp
dots on a washed-out slab, which reads louder than the solid grip it replaced.

⚠️ AND NOT ON THE `<button>`, which would take the focus ring down with it —
`opacity` applies to the whole element, outline included, so a keyboard reader
would get a 40% indicator on the control they had just moved to. It is on the
two pseudo-elements, and `:focus-visible` restores both.

⚠️ THE TAP TARGET IS UNCHANGED BY ANY OF IT. The button is the whole strip and
runs the height of the column; the pill is paint. At 16px plus 4px of padding a
side the strip is 24px wide — WCAG 2.5.8's minimum to the pixel, and a test now
says so, because the next narrowing is the one that fails it.

⚠️ THE DOTS DO NOT SCALE WITH THE PILL. They are `box-shadow` offsets on one
element, so they span 18px whatever the pill does. Found by shortening it to
16px tall and watching the outer two render outside it.

**`⌘K` is levelled with `Search`.** Equal `font-size` in two families is not
equal type: the label is `ui-sans-serif` and the badge `ui-monospace`, which
draws 0.7292px of cap per px. `1.012em` is what puts the `K`'s cap on the `S`'s.

⚠️ AND THE SYMBOL IS `1.369em`, THE MEASURED INK RATIO — NOT A HAIR MORE. At
`1.45em` the `⌘` stood 6% above the cap line, and the badge read as *bigger
type* than the label: 88 device px of ink against the word's 85, its top three
higher, its centre 1.5 out. Same letter height, louder cluster. At the ratio,
`Search` and `⌘K` measure 85 and 85 and share a centre to the device pixel.

⚠️ AND `line-height: 0` ON THE SYMBOL, WHICH IS WHAT MADE THE TWO CENTRE. A line
box is as tall as the tallest inline box in it, so the 20.5px glyph made the
`<kbd>` 20.55px against the label's 17 — and flex centres them by their *boxes*,
so the `K` rode 1.9px high inside a box the symbol had stretched.

Also fixed: the focus-indicator test looked its selectors up with `indexOf`, so
`…:focus-visible` matched inside `…:focus-visible::before` — a different rule,
about pseudo-elements, with no business declaring an outline. It reported the
trigger as having no focus indicator while the trigger's own rule sat further
down the file declaring one.
