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

**Every row in the dialog is the same object as the trigger that opened it.**
A reader clicks a bordered, filled control, lands in a bordered, filled field,
and picks from a list of bordered, filled rows. The active one darkens its edge —
`--wave-docs-border` to `--wave-docs-border-strong`, which is the trigger's own
pair of states — on the same 150ms easing the sidebar's rows use. Moving the
pointer over a result activates it, so hovering *is* this state; there is no
second rule for it.

It was a 2px accent ring, briefly an accent tint. The ring read as a component
borrowed from somewhere else, and one that comes and goes as a reader arrows is
worse than one that never moves.

⚠️ THE EDGE IS A CHANGE, NOT A CONTRAST CARRIER. `border-strong` on `bg-subtle`
is about 1.9:1, under the 3:1 WCAG 1.4.11 asks of a state indicator — so the
marker carries the rest, going `fg-subtle` to `fg`, which is text contrast rather
than non-text and is the sidebar's own hover. What must not happen is the edge
being left to do this alone.

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
