---
'@waveso/docs': patch
---

**The search dialog lines up on one column, and its input is a field rather
than a band.**

The input row was flush to the dialog's frame, so it could only round the two
corners it shared with it and needed a rule underneath to separate it from the
results. Inset by the same margin the results list uses, it is a box like they
are — all four corners rounded, and the gap does the separating.

⚠️ AND ITS RADIUS IS THE DIALOG'S MINUS THE GAP, NOT THE DIALOG'S. A rounded box
inset inside a rounded box is concentric only at `outer - gap`; equal radii run
the two corners at different curvatures six pixels apart and the field reads as
pasted onto the dialog rather than set into it.

**One column, measured from the bottom up.** The footer's key caps are the
anchor — the one row whose left edge is a drawn object — and the results' text
and the input's magnifier are measured to it. All three now start 18px from the
dialog's inner edge.

⚠️ BOXES, NOT INK. A cap's arrow sits its own border and `0.4em` of padding
inside the cap, so aligning the *glyphs* would put every other row on a column
that moves whenever the footer's font size does.

⚠️ AND THE INPUT ROW PAYS `calc(0.75rem - 1px)` BECAUSE IT IS THE ONE ROW WITH A
BORDER. Content inside a bordered box starts a border further in than content
inside an unbordered one, so equal padding misses by exactly that — the same
subtraction `--wave-docs-panel-inset` exists for.
