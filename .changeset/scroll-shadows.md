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

So the navigation's overflow moved to an inner box, `.wave-docs-layout__sidebar-scroll`,
and the panel keeps only its edges.

⚠️ THAT SPLIT IS THE FIX, AND EVERY VERSION BEFORE IT FOUGHT THE SCROLLER. An
absolutely positioned child of a scroll container is laid out against that
container's padding box and *joins its scrollable overflow* — so nothing placed
inside a scroller is ever pinned to it. `position: sticky` only clamps, and a
clamp is still a thing that travels until it catches. With the scrolling on an
inner element the panel is an ordinary positioned box: `top: 0` and `bottom: 0`
are its own edges, and the bands have no scroll to have a position within.

The timeline is declared on the scroller and `timeline-scope`d up to the panel,
because a `scroll-timeline` name is visible to the declaring element's
descendants and these pseudo-elements belong to its parent.

⚠️ AND THE SHADOW BELONGS TO THE PANEL RATHER THAN THE TREE, because
`.wave-docs-sidebar` paints an opaque ground — it is in the theme's opt-in rule,
and the shell has to be one surface — so a background on the scroller would be
painted underneath it. Measured 255/255 when it was.

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
