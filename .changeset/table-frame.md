---
'@waveso/docs': patch
---

**A table keeps one frame, at the panel's radius.**

It wore `.wave-docs-panel` for a while — outer frame, header band, inset card —
and that was wrong for a reason worth writing down rather than just undoing.

⚠️ THE PANEL SEPARATES *CHROME* FROM *CONTENT*, AND A TABLE'S HEADER ROW IS
CONTENT. "Where to go next" and a code frame both have chrome to put in the
band: a title, a language, a copy button. A table's `<thead>` is data. Setting
the body into a card away from its own header cost three vertical rules down
each side, stopped the row dividers short of the box and narrowed the reading
width — on the densest element on a page, for nothing gained. Full-width
dividers are what let an eye track a row across.

What is kept is the outer radius: `--wave-docs-radius-lg` rather than
`--wave-docs-radius`, so a table and a code block read as two of one family
without the table pretending to chrome it has not got.

⚠️ AND AN EMPTY HEADER ROW NOW DRAWS NO BAND, WHICH GFM PRODUCES ROUTINELY. A
GFM table always has a `<thead>` — the delimiter row is what makes it a table —
so an author who wants a plain two-column list of facts writes `| | |` and gets
a header of empty `<th>`s, which rendered as a tinted strip with nothing in it.
`:empty` and not a text check: GFM emits `<th></th>` with no whitespace inside.
A header with even one named column keeps its band.

**And a fence with neither a title nor a language gets no band either.** The
header row is floored so titled and untitled fences match, which is right when
there is a label and wrong when there is not: a bare fence had only the copy
button, adrift in a strip of empty ground. The row is the button now.
