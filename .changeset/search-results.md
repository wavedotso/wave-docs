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

⚠️ AND IT IS DRAWN AT `1rem`, THE SIZE EVERY OTHER GLYPH IN THIS DIALOG IS —
AFTER A FIRST PASS AT `0.8125rem` THAT WAS DERIVED FROM THE WRONG REFERENCE.
That size put the chevron's ink on the trail's x-height, 6.5px against an `o`'s
6.32, which is the right rule for a glyph as wide as the letters and the wrong
one for this. Lucide draws on a 24 grid and this chevron spans six units across
and twelve down, so its ink is half as wide as it is tall; matched to x-height
it carries visibly less weight than the words it punctuates and reads as a
smudge rather than a mark. Matched to the *cap* height instead — 7.99px against
a `b`'s 8.36 — it reads as the same colour as the line, and that lands on the
icon scale, so the special size disappears with it.

⚠️ AND THE `viewBox` IS CROPPED TO THE INK, WHICH IS WHAT RETIRED THREE NEGATIVE
MARGINS. On the full grid the box was 13px wide around 3.25px of chevron: five
sixths of the element was air, so every gap on the line had to be clawed back
with a negative `margin-inline` and the surplus height with a negative
`margin-block`. `8 0 8 24` keeps the vertical grid exactly as Lucide draws it —
same path, same stroke ratio, ink still half the box's height — and drops the
horizontal padding the glyph never used. The box is now its own ink, 5.33px
wide, `margin-inline` is a real gap that means what it says, and the row
measures the 55.5px it measured before.

⚠️ AND ITS ALIGNMENT IS `middle`, WHICH REPLACED FOUR HAND-MEASURED `em` VALUES.
A replaced element sits on the baseline, which hangs a glyph below the row of
lowercase it separates, so this needed correcting. The correction was measured
against a `Range` over the neighbouring words and was wrong again every time the
box resized, by exactly half that change — the box is centred on its own ink, so
half of any resize lands below the baseline. That number belongs to the *box*,
not the text, and re-deriving it on every resize is how it goes stale. `middle`
puts the box's centre on the x-height's, which is the same place, and follows the
box wherever it goes: measured 0.07px out after the resize above, with no second
pass.

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
