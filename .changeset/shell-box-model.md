---
'@waveso/docs': patch
---

The shell no longer depends on the host shipping a CSS reset.

⚠️ `box-sizing` WAS THE HOST'S TO SET, AND ALMOST EVERY HOST SETS IT.
`.wave-docs-sidebar__link` is `width: 100%` with `0.5rem` of inline padding, so
under `content-box` it is a 272px box in a 256px track — and the external-link
icon that `justify-content: space-between` pins to the far end renders 8px
outside the sidebar, clipped in half. Tailwind's preflight and every
normalize-style reset declare `border-box` globally, so this was invisible in
every project that has one, and visible on the only site here that ships no CSS
at all. `box-sizing: border-box` now applies to elements carrying a
`wave-docs-` class, scoped to this package's own namespace rather than to `*`,
because the prose renders a consumer's components too.

Three README claims were wrong and are corrected: `react/*` is ten subpaths and
not nine, three modules import from `next/*` and not two, and the twenty-two
chrome labels break down into six groups rather than the five that summed to
nineteen.
