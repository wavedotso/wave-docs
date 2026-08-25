---
'@waveso/docs': minor
---

**Nothing in the search dialog is selected until the reader selects it.**

Typing lit the first result the instant it arrived, so a row changed under a
reader for something they had not chosen — and on this package's accent that
reads as a decision already made. `activeIndex` starts at `-1` now: an arrow key
or the pointer moving over a row is what selects.

⚠️ AND EVERY GUARD FOR IT ALREADY EXISTED, WHICH IS WHY THIS IS ONE NUMBER.
`hits[-1]` is `undefined`, so no `aria-activedescendant` is written and Enter
returns without opening anything. The one place that needed teaching is the
arrow keys: they wrap modulo the list, and `(-1 - 1 + n) % n` is the *second to
last*, so Up from a fresh query landed one short of the end.

**The active row is a tint and an ink**, easing on the same 150ms the sidebar's
rows use. Moving the pointer over a result activates it, so hovering *is* this
state; there is no second rule for it.

It was a 2px accent ring, and briefly the trigger's border pair. The ring read as
a component borrowed from somewhere else, and one that comes and goes as a reader
arrows is worse than one that never moves; the border pair meant bordering
*every* row to make one edge legible, which turns a list into a stack of cards. A
row is a list item and its state is a colour — the field above it is a control,
and that is what wears the trigger's border.

⚠️ THE INK IS NOT DECORATION, IT IS WHAT KEEPS THE STATE PERCEIVABLE. A tint
alone is 1.12:1 light and 1.19:1 dark, under the 3:1 WCAG 1.4.11 asks of a state
indicator. `accent` on `accent-subtle` is 4.60:1 / 6.30:1 — text contrast rather
than non-text, and the same pair the sidebar's current-page row has always
shipped. What must not happen is the tint carrying this alone.

## The list fades at both edges

A mask on the scrollport, so the row being cut off is the one that softens. It
does not travel with the content: a mask paints against the element's own box, so
the two stops stay at the top and bottom of the *port* while the rows move under
them.

⚠️ IT IS UNCONDITIONAL, WHICH IS THE ONE THING TO KNOW. CSS cannot ask "is there
anything above this to scroll to" — the table's shadow answers that with a
scroll-driven animation whose timeline goes inactive when nothing overflows, and
a mask has no equivalent. So the first and last rows carry a little of it at
rest. At `1.25rem` against a row nearer three times that, it costs the top pixel
or two of a heading and buys never guillotining one.

## The field, and the gap under it

**The field is the trigger, expanded.** Same border, same fill, same radius. It
was a border with no fill — two frames a few pixels apart — and briefly a fill
with no border, which is a tinted band rather than a control. The trigger has
always been both, and both together are what reads as a field.

⚠️ THE PADDING IS NOT COPIED WITH THEM. The trigger pays `calc(0.5rem - 1px)`
because it is a compact control in a sidebar; the field pays
`calc(0.75rem - 1px)` because its glyph has to land on the column the results
and the footer sit on. The `- 1px` is the border either way — content inside a
bordered box starts a border further in.

The field takes the base radius and the result rows take `-sm`, which is the tier
system doing what it says: both are controls, and a result row is a list item.

⚠️ AND THE GAP UNDER THE FIELD WAS PAID TWICE. The field's margin and the result
list's top padding both contributed, so the space between the input and the first
result was double the space above the input — a doubled gap in the one place a
reader's eye travels on every keystroke. The list drops its top padding; the
field keeps its margin, because an empty result list is `display: none` and a gap
paid from there would vanish on the query that matches nothing.
