---
'@waveso/docs': minor
---

**The search results and the sidebar say "there is more this way" the same way
the table does, and hide their scrollbars where they can.**

Four gradients on the search list, exactly as `.wave-docs-table-scroll` does it:
the two `local` covers are painted in the surface colour and travel *with* the
rows, so each sits over its shadow only while that edge is at rest, and the two
`scroll` shadows are pinned to the box. A grey edge appears on precisely the side
that has rows off-screen, with no listener, no state and no hydration.

⚠️ IT REPLACED A MASK, WHICH WAS THE WRONG TOOL TWICE OVER. A mask fades content
to *transparent*, so what showed through was the dialog's own white — a hole
rather than a shadow. And it cannot be conditional: CSS has no way to ask whether
there is anything above to scroll to, so the first and last rows were softened
even at rest.

## The sidebar needs its shadow above the content, not behind it

⚠️ `.wave-docs-sidebar` PAINTS ITS OWN GROUND, AND MUST. It is in the theme's
opt-in rule — the one that installs a ground wherever it installs a foreground
ramp — so a consumer mounting the tree alone gets one, and `styles.browser.test`
requires the shell to be a single surface. An element's background is painted
*below* its children, so the four-gradient trick was covered by a child 480px
tall: measured 255/255 at the top edge with the nav scrolled — declared,
computed, and invisible.

So the nav's shadows are sticky overlays instead, the way the table's are and for
the reason its comment gives, with opacity driven by a **named** scroll timeline
on the nav.

⚠️ NAMED, BECAUSE `scroll(nearest block)` WAS A REAL BUG RATHER THAN A TIDIER
SPELLING. `nearest` means the nearest ancestor *scroll container*, and a box is
only one when it actually has scrollable overflow. This nav is a screen tall and
on most sites its tree fits — measured `scrollHeight - clientHeight === 0` at
1440×900 on this very site — so `nearest` walked straight past it and found the
document, which always scrolls. The shadow was keyed to the *page*: it faded in
as a reader scrolled the article, on a navigation with nothing hidden, while the
sticky panel was still travelling to its pinned position. Appearing and moving at
once.

Named, it can only be this element's own scroll, and the inactive-timeline rule
then does the right thing for free: a nav that fits declares a timeline with no
range, the animation does not apply, and `opacity: 0` wins.

⚠️ AND THE STICKY INSET IS NEGATIVE BY THE NAV'S BLOCK PADDING, WITH A MATCHING
START MARGIN — TWO HALVES OF ONE FIX. A sticky child of a scroll container is
constrained to the *content* box rather than the scrollport, so `top: 0` pinned
the band 32px down the panel, floating over the search trigger instead of sitting
on its edge. Found by painting it red and reading the pixels back.

The margin is the other half: sticky only holds an element once scrolling would
carry it past the threshold, so laid out at the content-box top the band began
32px *below* the edge and slid up over the first 32px of scroll — visible, and
moving, exactly while its opacity was ramping in. Pulled up by the same padding,
its resting place already is the threshold: pinned from the first pixel, never
moving. Measured identical pixel rows at scrollTop 20, 90 and max.

The padding is a custom property now, because the overlays cancel exactly it and
two literals that must agree are two literals that drift. The gradient is radial,
the shape the table and the search list use — strongest against the edge it
belongs to rather than a flat ramp across the band.

⚠️ AND THE NAV'S FADE IS A LENGTH, NOT A PERCENTAGE OF THE SCROLL. The table's
keyframes shape their fade in percentages, which are percentages of the
container's *total* scroll range — fine on a table, wrong on a navigation. A nav
with 1000px of scroll turns the same `2%…8%` into 20px…80px, so the shadow spends
eighty pixels of scrolling arriving at full strength, which reads exactly like it
is moving with the content rather than pinned to the edge. `animation-range: 0
1rem` makes it the same short distance whatever the nav's height, identical on a
six-page site and a three-hundred-page one, with plain fades for keyframes
because the shaping now lives in the range.

⚠️ THE SCROLLBAR IS HIDDEN ONLY WHERE THE SHADOW EXISTS. Both live in the same
`@supports (animation-timeline: scroll())`, so Firefox — where scroll-driven
animations have not shipped — keeps the thin bar rather than losing the bar and
the shadow together. A scrollbar is the one cue that a column has more below it,
and taking it away before something replaces it trades a slab for nothing.

⚠️ AND A SECOND TEST LEARNED THAT `getAnimations()` IS NOT "TRANSITIONS". A
scroll-driven animation's `finished` promise resolves when the *scroll position*
reaches the end, which is to say never on a panel sitting at the top — so
awaiting the whole list hung `sidebar.browser.test.tsx` for its full 15s timeout
the moment this shadow existed. `nav.browser.test.tsx` had already been bitten by
the table's; this is the second place the assumption lived.
