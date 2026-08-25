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

**The active row is the sidebar's current-page row.** It was a 2px accent
outline, which read as a component borrowed from somewhere else; it is a tint
plus accent ink now, easing on the same 150ms the sidebar's rows use. Moving the
pointer over a result activates it, so hovering *is* this state — there is no
second rule for it.

⚠️ DROPPING THE RING DOES NOT DROP THE CONTRAST, BECAUSE THE INK REPLACES IT.
The old comment argued the ring was load-bearing: a tint alone is 1.12:1 and
WCAG 1.4.11 asks 3:1 of a state indicator. The heading turning `accent` is the
indicator now — 4.60:1 light, 6.30:1 dark against the tint it sits on — which is
the same pair the sidebar has always shipped. What must not come back is the
tint carrying the state alone.

## The field, and the gap under it

**No border, a fill instead.** A bordered field inside a bordered dialog is two
frames a few pixels apart for one control — and the border was what forced the
`calc(0.75rem - 1px)` padding it used to pay, since content inside a bordered box
starts a border further in. No border, no correction, and the padding is a round
number again.

**Its radius is the token the result rows take.** It was
`calc(var(--wave-docs-radius) - 0.375rem)` — concentric with the dialog, and a
number nothing else in the file used, so the field and the rows six pixels below
it rounded differently. Every inset box in this dialog is a small control on the
`-sm` tier, and them agreeing with *each other* is what a reader sees; agreeing
with the frame is arithmetic only a measurement finds.

⚠️ AND THE GAP UNDER THE FIELD WAS PAID TWICE. The field's margin and the result
list's top padding both contributed, so the space between the input and the first
result was double the space above the input — a doubled gap in the one place a
reader's eye travels on every keystroke. The list drops its top padding; the
field keeps its margin, because an empty result list is `display: none` and a gap
paid from there would vanish on the query that matches nothing.
