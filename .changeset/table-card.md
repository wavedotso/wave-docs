---
'@waveso/docs': patch
---

**A table's header row sits on the frame, and the card starts at the body.**

Everywhere else the panel's body *is* the white card and the header sits above
it on the frame's band. A table cannot do that: `<thead>` cannot leave the
`<table>`, because the columns have to share one table layout.

So it is reached from the other side. The surface goes transparent and
edgeless, the header row takes the frame's own ground, and the card is drawn by
the body cells — with the four corner cells rounding it.

⚠️ THE CARD IS THE CELLS BECAUSE A `tbody` CANNOT BE ONE, AND THAT IS WORTH
WRITING DOWN. Measured in a real engine, both ways: in the separated model a
row-group border is not painted at all, and in the collapsing model it is
painted square. A *cell* is an ordinary box and takes a `border-radius` in
either model, which is what makes this work.

The panel's edge joins its ground and its overflow as a property
(`--wave-docs-panel-edge`), so a wearer that draws its own card can retire the
surface's without a specificity fight. The 1px is kept and made transparent
rather than removed, so the concentric arithmetic stays true and nothing shifts.
