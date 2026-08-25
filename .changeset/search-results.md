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

⚠️ THE SEPARATOR IS U+276F `❯` RATHER THAN U+203A `›`, AND THAT IS A SIZE
DECISION MEASURED IN THE SHIPPED FACE. At 11px mono, `›` inks 4.93px tall
against 6.32 for an `s` and 8.51 for a `b` — visibly shorter than the words it
separates. `❯` inks 8.03, which is letter height, and still advances one mono
cell (6.62px) so the line stays on the grid. U+27E9 `⟩` is taller still at 9.8
but overshoots below the baseline, and U+3009 `〉` measures 11.24px wide — a CJK
fallback breaking the monospace grid outright.

⚠️ AND THE SEPARATOR IS TIGHTENED WITH `word-spacing`, NOT A THINNER SPACE
CHARACTER. The line is monospace, where every glyph advances one cell — a U+2009
thin space would take exactly as much room as U+0020, or drop out of the mono
face and render at a different width from every other gap on the line.
`word-spacing` adjusts the advance added at each separator instead, which is
independent of the cell, and a route segment is a slug so those are the only
spaces it can touch.

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
