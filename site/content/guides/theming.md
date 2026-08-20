---
title: Theming
description: Five layout tokens, one layer stack, and dark mode that never switches itself on.
---

Retheme by redefining the tokens, restyle by overriding the `wave-docs-*`
classes — and both win for a reason worth understanding, because it is not
source order.

## The stylesheet

There is no Tailwind, no `@apply` and no `tailwindcss` peer.
[Installation](../getting-started/installation.md) covers why it is not even
an optional one.

`@tailwindcss/typography` is not used either. `.prose` pins `max-width: 65ch`,
which is wrong inside a three-column shell, and styles `pre` and `code` in
direct conflict with Shiki's own output. `.wave-docs-prose` does the same job
without the fight.

Every colour is a `--wave-docs-*` custom property. Redefine the ones you want in
your own `:root`, after the import:

```css title="app/globals.css"
@import '@waveso/docs/styles.css';

:root {
  --wave-docs-accent: oklch(0.55 0.2 265);
  --wave-docs-bg-subtle: oklch(0.98 0.004 265);
}
```

## Layout tokens

Five custom properties size the shell.

| Token | Default | |
| --- | --- | --- |
| `--wave-docs-measure` | `46rem` | Prose column width. `none` opts out |
| `--wave-docs-header-height` | `3.5rem` | Header, and the offset sticky columns park below |
| `--wave-docs-sidebar-width` | `16rem` | Sidebar track |
| `--wave-docs-toc-width` | `15rem` | Table-of-contents track |
| `--wave-docs-shell-width` | `100rem` | Maximum shell width |

Those five are the whole settable layout surface — the gutter and the drawer
width are literals, because each appears once. `--wave-docs-scroll-padding` is
derived rather than set: the header height plus a rem of air, with the sticky
columns offset by the same token, so changing the header moves all three
together.

## Breakpoints

Three, in `rem` so they scale with the reader's base font size: the sidebar
appears at **64rem**, the table of contents at **80rem**, and the grid stops
growing at **100rem**.

**64rem is arithmetic rather than taste.** A 16rem sidebar plus a 46rem measure
plus two 1.5rem gutters is 65rem, so anything narrower introduces the sidebar
exactly where it starts eating the measure it frames.

## The typeface

`--wave-docs-font-sans: inherit` hands the whole package your own typeface, in
one line. That is the documented opt-out; overriding the family on every element
the sheet touches is not.

The token ships a real stack rather than `inherit` by default: inheriting means
a host that never set a family renders its documentation in the UA serif, which
reads as broken rather than as unstyled.

## Everything is layered

**Everything this stylesheet declares lives in a `@layer`** — `theme` for the
tokens, `base` for the element resets, `components` for the classes, declared in
that order at the top of the file so it cannot depend on which block appears
first. Unlayered CSS outranks every layer regardless of specificity.

The distinction matters. The dark tokens are declared as
`:root[data-theme='dark']`, which is specificity (0,2,0). Outside a layer, an
unlayered `:root` at (0,1,0) would lose *no matter where it was loaded* — the
cascade never reaches source order — and overriding would mean writing
`:root:root:root`. Layered, source order settles it and a plain `:root` is
enough.

> [!WARNING]
> Put your overrides in an unlayered rule, or in a layer you declared after this
> package's. An unlayered declaration beats every layered one, which is why the
> package layers its own tokens — if it did not, yours could never win.

`styles.test.ts` asserts that the sheet declares nothing outside a layer, and
that `--wave-docs-measure` and `--wave-docs-font-sans` in particular sit in
`theme`. It also asserts no `!important` anywhere.

## Dark mode is opt-in

CSS variables, not a `dark:` variant. What goes on `<html>`:

| On `<html>` | Result |
| --- | --- |
| nothing | Light |
| `class="dark"` | Dark |
| `data-theme="dark"` | Dark |
| `data-theme="system"` | Follows `prefers-color-scheme` |

`.dark` is honoured because [next-themes](https://github.com/pacocoursey/next-themes)
defaults to `attribute="class"` and never sets `data-theme`. That default is
what most projects ship.

**This is deliberate, and it is a change.** The tokens used to switch on
`prefers-color-scheme` alone. But the stylesheet styles the docs subtree, not
the page — so on a light-only site with a `/docs` section, a visitor whose OS
was in dark mode got the near-white foreground ramp on the host's white
background: **1.23:1**, i.e. invisible. A stylesheet cannot assume it owns the
page it is dropped into, so it now switches only when the host says to.

If your site really does follow the OS and has no theme toggle, say so once:

```tsx
<html lang="en" data-theme="system">
```

Every colour is defined in the light block and redefined in both dark blocks —
the `@media` one and the attribute one, which cannot be combined into a single
selector list. A test fails the build on a token that is not, and on any bare
`oklch()` outside those blocks. That rule exists because the table's
horizontal-scroll shadow was once a hardcoded black, and black at 12% over a
dark background is nothing at all.

> [!NOTE]
> If you retheme, re-check contrast. `src/styles.test.ts` asserts that every
> foreground/background pair the shipped tokens compose clears WCAG 1.4.3
> (4.5:1); none of the text this package renders is "large" in the WCAG sense —
> the callout labels are 16px, the search breadcrumbs 12px — so 3:1 is never
> enough.

## Your own components

Restyling ends where the markup does. Every element the pipeline emits can be
replaced instead:

```tsx title="app/docs/[...slug]/page.tsx"
import { DocContent } from '@waveso/docs/react/doc-content';

<DocContent hast={doc.hast} components={{ a: MyLink, img: MyImage }} />
```

The map is merged over the built-in one, so you replace what you name and keep
the rest. Pass it as `components` to
[`createDocsRoute`](../reference/configuration.md) or to `DocContent` directly;
the components themselves are listed in
[Components](../reference/components.md).

`className` on `DocContent` is appended to `wave-docs-prose`, never substituted
for it — nearly every rule in the sheet is scoped under that class, and dropping
it leaves a page whose code blocks keep their syntax colours and lose everything
else, which reads as a design choice rather than as a mistake.

Next: [Layout](./layout.md).
