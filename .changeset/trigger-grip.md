---
'@waveso/docs': patch
---

**The sidebar trigger's pill is the icon.**

⚠️ IT CARRIED A GLYPH INSIDE A SHAPE THAT ALREADY SAID THE SAME THING. Three
docsify dots, then two grip bars — and a rounded bar on the seam between two
panes *is* the handle, so anything painted on it is a second label for the
first. The marks are gone and the width came down from `1rem` to `0.375rem`,
which is what makes it read as a handle rather than as a button that happens to
be tall.

⚠️ AND THE PADDING IS NOW DERIVED FROM THE WIDTH, BECAUSE THINNING THE PILL
BROKE THE TARGET. The strip is `width: auto`, so the button is exactly as wide
as the bar inside it; at a fixed `4px` of padding that came to **14px** — a
pointer target the width of a pencil line, on the one control a reader reaches
for without looking. `padding-inline: (1.5rem - var(--wave-docs-trigger-width))
/ 2` holds the target at 24px, WCAG 2.5.8's floor, whatever the paint becomes.

`nav.browser.test.tsx` predicted this in a comment — "narrow the token again and
the target fails" — and it did, exactly. That test now asserts the derived
relationship rather than the old literals, so the next narrowing cannot repeat
it.
