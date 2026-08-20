---
'@waveso/docs': patch
---

The shell no longer depends on the host shipping a CSS reset, and the header
styles the two slots a host fills.

⚠️ `box-sizing` WAS THE HOST'S TO SET, AND ALMOST EVERY HOST SETS IT.
`.wave-docs-sidebar__link` is `width: 100%` with `0.5rem` of inline padding, so
under `content-box` it is a 272px box in a 256px track — and the external-link
icon that `justify-content: space-between` pins to the far end renders 8px
outside the sidebar, clipped in half. Tailwind's preflight and every
normalize-style reset declare `border-box` globally, so this was invisible in
every project that has one. `box-sizing: border-box` now applies to elements
carrying a `wave-docs-` class, scoped to this package's own namespace rather
than to `*`, because the prose renders a consumer's components too.

⚠️ THE HEADER INHERITED ITS FOREGROUND AND ITS TYPEFACE FROM THE HOST'S `body`.
It is a sibling of `.wave-docs-layout`, `.wave-docs-prose`, `.wave-docs-sidebar`
and `.wave-docs-toc`, so the rule that grounds those four never reached it: it
painted its own background and nothing else. Passing `title` or `actions` — the
documented way to put a brand and a repository link in the bar — rendered them
in whatever the page inherits, which on a page with no CSS is an underlined
serif link. The header now takes `color` and `font-family` of its own, and an
`<a>` in either slot gets a default and a focus ring, in `@layer components` so
an unlayered rule of yours still wins.

The search trigger also gives way to the brand in a short row. `width: 100%`
made its flex base the whole header, so at 390px it took ~200px and the brand
ellipsised to "Wa…"; it is now capped at 9rem, 11rem from 30rem and 20rem from
48rem, and the `⌘K` hint is hidden under `(hover: none) and (pointer: coarse)`,
where it names a key the reader has no way to press.

Three README claims were wrong and are corrected: `react/*` is ten subpaths and
not nine, three modules import from `next/*` and not two, and the twenty-two
chrome labels break down into six groups rather than the five that summed to
nineteen.
