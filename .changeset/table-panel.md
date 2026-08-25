---
'@waveso/docs': minor
---

**A table wears the panel.** The scroll region is the inset surface and the
frame goes around it, so a table, a code block and "where to go next" read as
three of one thing rather than three boxes that happen to be near each other.

There is no header row: GFM has no table caption syntax, so there is nothing to
put in one. The frame alone is the point.

⚠️ AND THE SURFACE HAD TO STOP CLIPPING BEFORE THE TABLE COULD WEAR IT.

`.wave-docs-panel__body` was a flat `overflow: hidden` — which is what keeps a
`<pre>`'s square corner from poking through the inner radius, and is also
declared *after* `.wave-docs-table-scroll` at the same specificity. A wide table
would have been cut off at the frame with no way to reach the rest of it and
nothing on screen saying so, taking the whole four-gradient scroll affordance
with it. The surface now hands its overflow to the wearer through
`--wave-docs-panel-overflow`, with the default in the `var()` fallback for the
same reason the ground's default lives there: a frame wears `.wave-docs-panel`
*and* its own class, so both rules set the property on one element at one
specificity and source order decides.

⚠️ `scrollWidth > clientWidth` CANNOT SEE THAT DEFECT. It is true of a clipped
box as well as a scrolling one, so both existing wide-table tests went on
passing against a table a reader could not scroll. The new assertion reads the
*computed* `overflow-x`, because what failed was a cascade and not a missing
rule.

The frame is a `<div>` and not the `<figure>` the code block uses: a `<figure>`
earns its element from its `<figcaption>`, and one here would be a `figure` role
with no accessible name wrapped around a `region` that already has one.

`.wave-docs-table-scroll` no longer declares its own border, radius or
`overflow-x`. Leaving the overflow there would have been worse than redundant —
the value written would not be the value in effect, and the next reader would
change it and watch nothing happen.

## The frame markup has one home now, and it was written the day it bit

`tableFrameMarkup` in the fixtures. `styles.browser.test.ts` carried three
hand-written copies of `<section class="wave-docs-table-scroll">`; the moment the
component started emitting a frame around it, every one of them became a scroll
region with no frame and no overflow — measuring a shape the component had
stopped emitting, and failing for reasons unrelated to what they were testing.
`doc-content.test.tsx` asserts the component agrees with the fixture.
