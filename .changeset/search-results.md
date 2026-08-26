---
'@waveso/docs': minor
---

**Search results get a glyph, a breadcrumb, and no scrollbar.**

**A page or a section, as an icon.** Which one is read off the `href` rather
than a new index field — a record with an anchor is a section within a page and
one without is the page itself, which is what `buildSearchIndex` means by its
lead record — so the records did not grow by a byte.

⚠️ AND THE ICON IS NOT DECORATION, IT IS THE ALIGNMENT. With no icon a result's
heading sat on the same column as the input's *magnifier* while the input's own
text sat 24px right of it: three left edges where a reader expects two, which is
what made the dialog read as stacked levels rather than as a list under a field.
The icon takes the magnifier's column and the text takes the input's, so the two
rows are the same shape. Measured: 18px and 42px, both rows, plus the footer's
key caps on the 18.

**The second line is a breadcrumb.** The segments were always a trail from the
site's root to the page; slashes made them read as a URL to parse and `›` makes
them read as what they are. ⚠️ SAFE ONLY BECAUSE THAT LINE IS `aria-hidden` —
more than one screen reader pronounces the character, which is exactly why
`spokenName` joins with commas instead. The two lines carry the same fact in the
form each audience can use.

⚠️ THE SEPARATOR IS THE PACKAGE'S OWN CHEVRON, NOT A CHARACTER, AND TWO
CHARACTERS WERE MEASURED AND REJECTED FIRST. `›` (U+203A) inks 4.93px tall in
the shipped mono face at 11px, against 6.32 for an `s` and 8.51 for a `b` — it
sat visibly below the words it separated. `❯` (U+276F) inks 8.03 and fixed the
height *on one machine*: `ui-monospace` resolves to SF Mono here, Consolas on
Windows, Liberation Mono on Linux, and a glyph missing from one of those falls
back to another face at another width. U+3009 already demonstrated exactly that,
measuring 11.24px against the 6.62 cell.

An SVG has no font to be missing from — and it is the same Lucide chevron the
sidebar and the pager draw, which is the real argument: everything else here is
that one set.

⚠️ AND THE TRAIL IS SET IN THE SANS, NOT IN THE MONO IT STARTED IN — WHICH IS
WHAT MADE THE SEPARATOR RELIABLE. A monospace face advances every glyph one
cell, so the segments marched on a rigid grid an icon could not join, and its
metrics are whatever the machine resolves: SF Mono here, Consolas on Windows,
Liberation Mono on Linux. The cap height an inline glyph is sized against
therefore moved from reader to reader, which is the same portability problem
that ruled out `›` and `❯` as characters — arriving a second time through the
face rather than through the glyph. Proportional sans has ordinary spacing and
one set of metrics to match. `font-size` goes up a notch with it, because a
mono face reads larger at the same size and holding the number would have
shrunk the line.

⚠️ AND THE `viewBox` IS CROPPED TO THE STROKE, WHICH IS WHAT RETIRED FOUR
CORRECTIONS. On Lucide's full 24 grid the chevron occupies x 9–15 and y 6–18,
so a square box around it was five sixths air across and half air down — and
every one of those gaps had to be subtracted back by hand: a `vertical-align`,
a negative `margin-inline`, a negative `margin-block`, and a size chosen to
make the surplus come out right. `8 5 8 14` is the painted extent, caps and
joins included. The box is the glyph, so it sits on the baseline the way a
letter does with nothing declared, and the air beside it is one positive
`margin-inline`.

⚠️ AND IT CARRIES `overflow: visible`, WITHOUT WHICH THE POINT IS FLAT. An
`svg` clips to its viewport by default and this `viewBox` is exactly the
stroke's extent, so the round join at the tip lands on the box's own edge and
loses its outermost anti-aliased pixel. Nothing overlaps anything: what spills
is a fraction of a pixel.

## The scrollbar is hidden, and it cannot be conditional

⚠️ THERE IS NO CSS WAY TO SHOW A SCROLLBAR ONLY WHILE SCROLLING. That behaviour
is the platform's: macOS draws overlay scrollbars that fade in on scroll and out
after it, and this list gets it for free there. Windows and Linux draw a classic
one that is always present, and the only ways to make it come and go are a
JavaScript timer toggling a class or a scrollbar drawn from scratch in script —
which is what a `ScrollArea` component is, and neither belongs in a package whose
whole argument is what it does *not* ship to a reader.

So it is hidden, as `@waveso/app` does with `.scrollbar-none`. What replaces it
is the keyboard rather than a fade: the footer says `↑ ↓ Select`, the list is
driven by `aria-activedescendant`, and arrowing past the last visible row scrolls
it and loads the next page.

⚠️ AND `pageSize` STAYS A WINDOW, NOT A CAP. It was a hard ceiling of 8 once, and
that was removed with measurements: on a six-page site "docs" matches 18, so
results were unreachable and the live region announced "8 results" — not a
smaller truth but a false one. Rendering every row of a 300-page corpus costs
40ms, 128ms at 4x throttle, which is what paging exists to avoid; the ceiling
was never what made it fast.

The size budget moves with the glyphs, and the figures the README and the
installation page publish move with it — a document here may not understate what
this package costs.
