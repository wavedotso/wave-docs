---
title: Styling
description: Five tokens, one stylesheet, and no Tailwind anywhere.
---

The stylesheet is plain CSS with `wave-docs-*` class names. There is no
Tailwind, no `@apply`, and no `tailwindcss` peer — it was declared as an
optional peer once, which blocked `npm install` outright for every project on
Tailwind 3, because npm still range-checks an optional peer that happens to be
installed.

```tsx
import '@waveso/docs/styles.css';
```

## Layout tokens

Five custom properties size the shell. All of them are inside an `@layer`, so an
unlayered `:root` of your own still wins.

| Token | Default | Controls |
| --- | --- | --- |
| `--wave-docs-measure` | `46rem` | Prose column width. `none` opts out |
| `--wave-docs-header-height` | `3.5rem` | Header, and the offset sticky columns park below |
| `--wave-docs-sidebar-width` | `16rem` | Sidebar track |
| `--wave-docs-toc-width` | `15rem` | Table-of-contents track |
| `--wave-docs-shell-width` | `100rem` | Maximum shell width |

```css title="app/globals.css"
:root {
  --wave-docs-measure: 52rem;
  --wave-docs-accent: oklch(0.55 0.2 265);
}
```

> [!WARNING]
> Put your overrides in an unlayered rule, or in a layer you declared after
> this package's. An unlayered declaration beats every layered one, which is
> why the package layers its own tokens — if it did not, yours could never win.

## Breakpoints

Three, in `rem` so they scale with the reader's base font size: the sidebar
appears at **64rem**, the table of contents at **80rem**, and the grid stops
growing at **100rem**.

64rem is arithmetic rather than taste. A 16rem sidebar plus a 46rem measure plus
two 1.5rem gutters is 65rem, so anything narrower introduces the sidebar exactly
where it starts eating the measure it frames.

## Dark mode

CSS variables, not a `dark:` variant. Three ways in, and the package handles
all three:

```html
<html data-theme="dark">      <!-- explicit -->
<html class="dark">           <!-- next-themes' default -->
<html data-theme="system">    <!-- follow the OS -->
```

`.dark` is supported because `next-themes` defaults to `attribute="class"`, and
that default is what most projects ship.

Every colour in the sheet is a token defined in the light block and redefined in
both dark blocks — a test fails the build on one that is not, and on any bare
`oklch()` outside those blocks. That rule exists because the table's
horizontal-scroll shadow was once a hardcoded black, and black at 12% over a
dark background is nothing at all.

## Your own components

Every element the pipeline emits can be replaced:

```tsx title="app/docs/[...slug]/page.tsx"
import { DocContent } from '@waveso/docs/react/doc-content';

<DocContent
  hast={doc.hast}
  components={{ a: MyLink, img: MyImage }}
/>
```

The map is merged over the built-in one, so you replace what you name and keep
the rest.

Next: [extend the pipeline](./plugins.md).
