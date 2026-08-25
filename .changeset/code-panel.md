---
'@waveso/docs': minor
---

**The code frame wears the panel.** A fence is now an outer card holding a
header row — the filename or the language on the left, the copy button on the
right — and an inset surface with the code on it, dressed by the same
`.wave-docs-panel` rules as "where to go next".

⚠️ THE `<figcaption>` STAYS A DIRECT CHILD OF THE `<figure>`, WHICH IS WHY THIS
HAS NO HEADER WRAPPER. A `figcaption` has to be the first or last child of its
figure; inside the `.wave-docs-panel__header` `<div>` that "where to go next"
uses it captions nothing, the markup is invalid, and a titled block loses the
accessible name it had. So the frame lays its header out on a grid and shares
the primitive's *insets* rather than its header element. The button stays out of
the caption for the matching reason: a `<button>` inside a `<figcaption>`
contributes its accessible name to the figure's, so `swap.ts` would announce as
"swap.ts Copy code from swap.ts".

⚠️ AND A TITLE IS WHAT DECIDES WHETHER THERE IS A FRAME AT ALL. With one, the
figure is a panel: a band carrying the filename and the copy button, and the
code set into a card below it. With none there is nothing to put in a band, so
the frame flattens away, the surface becomes the block, and the button sits on
the code — which is what Mintlify does, and what stops an unnamed fence from
carrying a reserved slot with nothing in it.

A language is not a title for this purpose. A fence declaring `ts` and no
filename is still an untitled fence, and a band holding a two-letter badge is
the same empty header with a word in it. `data-lang` stays on the figure for
anyone selecting on it.

One shape of markup, switched in the stylesheet rather than in the pipeline: two
markup paths mean two fixtures, and the one that is not on screen is the one
that rots.

**The copy button no longer hides until you hover.** It faded in on `:hover` or
`:focus-within` because it was positioned over the code and had nowhere of its
own to be. It has a slot in the header row now, and a reserved slot that stays
empty until you point at it reads as a rendering fault — so the reveal, the
`@media (hover: none)` exception that existed because a hover-only control does
not exist on a phone, and the reduced-motion guard on its transition all went
with it. It is still `visibility: hidden` until the runtime attaches, which is
the structural promise and is unchanged.

## Three things the restructure moved, each of which was a defect

⚠️ THE `<pre>` DRAWS NO FRAME OF ITS OWN ANY MORE. It carried the border, the
radius and the background; inside a `.wave-docs-panel__body` that carries all
three, that draws the frame twice one pixel apart. `pre:not(.shiki)` keeps its
own, because an excluded fence is never wrapped.

⚠️ AND ITS INLINE PADDING IS `1rem` BECAUSE THAT IS `--wave-docs-panel-inset`,
not because it is a round number. The label sits at that inset plus the
surface's border; the code sits at the surface's border plus this. The
`1.125rem` it was put the first character 2px right of the filename above it —
visible, and attributable to nothing.

⚠️ AND THE FOCUS RING ON THE `<pre>` IS INSET NOW. Shiki gives it
`tabindex="0"` so a keyboard reader can scroll a wide block, and the surface
around it is `overflow: hidden` so a square corner cannot poke through the
frame's rounded one — which clipped a `+2px` outline away to nothing.
`styles.test.ts` reads rules as text and would have gone on passing.

## The panel grew two properties, both to settle a cascade rather than a taste

`--wave-docs-panel-surface` is the inset surface's ground, and its default lives
in a `var()` fallback rather than in a declaration. `.wave-docs-code__body` and
`.wave-docs-panel__body` are both one class, so source order decides and the
panel is declared later: a code frame asking for the darker code ground got the
panel's white. Moving the ground to a property did not fix it either — a frame
wears `.wave-docs-panel` *and* `.wave-docs-code`, so both rules set that property
on the same element at the same specificity, and source order handed it back.
Measured twice as `oklch(1 0 0)` where `oklch(0.975 0.003 262)` was written. In
the fallback there is no declaration to lose to.

`--wave-docs-panel-header-row` floors the header. With a label the row is the
label's height and with none it is the button's, and a page mixing titled and
untitled fences showed two header heights.

The frame's markup now has one home — `codeFrameMarkup` — that the browser tier
mounts and the plugin tier asserts the pipeline agrees with. Written out
separately in both, a hand-written fixture goes on describing a frame the
pipeline stopped emitting while every assertion measuring it stays green.
