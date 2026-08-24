---
'@waveso/docs': patch
---

A separator now rules off the block above it.

It ends one section as much as it names the next, and 1rem of margin was not
saying so — the gap read as "these two lists are a bit far apart" rather than as
a division.

⚠️ THE RULE AND THE LABEL SHARE THE LIST'S OWN EDGE, WHICH IS ALSO THE ROWS'. A
row is full-bleed — its hover surface spans the whole column, and so does the
search field above it — so a rule on that edge divides the column, while an
inset one floats inside it. The label sits on the same line, because a heading
and the rule above it reading as one object is the whole reason the rule exists.

The label keeps the rows' own content edge — the marker column when there is
one, the words when `icons={false}` removes it. Those are the same number: a
row's `padding-inline` is what both modes have in common, so matching it lands
on whichever is there, with no query and nothing threaded to the stylesheet.

⚠️ AND NOT ABOVE THE FIRST CHILD. A `meta.json` may open with
`"---Reference---"`, and on that tree the very first thing in the navigation
would otherwise be a hairline above nothing.

The label also drops from `font-weight: 650` to `500`. At 650 it was heavier
than the group titles it sits under — a divider out-shouting the navigation it
divides. Weight rather than colour, because there is no lighter colour to
reach for: `--wave-docs-fg-subtle` is already the lightest text token at 5.05:1
against WCAG 1.4.3's 4.5:1 floor, and `--wave-docs-border` — the rule's own
colour — measures 1.31:1 and is a line colour, not a text one.
