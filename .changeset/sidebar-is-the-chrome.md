---
'@waveso/docs': minor
---

**`docs.Layout` renders no header.** The drawer trigger and the search — the
trigger and its dialog both — now live in `.wave-docs-layout__sidebar`, a real
grid item at every width: a 16rem column above 64rem, an in-flow sticky strip
below it. The rule behind it: every persistent element this package renders is
in normal flow, inside the grid, and offsettable — two elements in flow push
each other and both stay visible, while a fixed one overlaps what is beneath
it with neither side able to detect the collision.

Migration, in full:

| Was | Becomes |
| --- | --- |
| `<docs.Layout title={<Brand/>}>` | Delete it. The index page's title brands the docs |
| `<docs.Layout actions={<ThemeToggle/>}>` | Render it in your own layout, around `docs.Layout` |
| `--wave-docs-header-height` set to size the bar | `--wave-docs-bar-height`, same value |
| `--wave-docs-header-height` set so sticky columns clear a bar | `--wave-docs-chrome-offset`, same value |
| A host bar our header sat under | `--wave-docs-chrome-offset: <their height>` |
| `actions` as the client-search escape hatch | `search={false}` plus your own `DocsSearch` |
| A `rootMargin` you relied on defaulting to `-80px` | Pass it explicitly |

⚠️ `--wave-docs-header-height` HAS TWO ROWS BECAUSE IT DID TWO JOBS. It sized
the header, and it was the offset both sticky columns parked below. The sizing
job is now `--wave-docs-bar-height` and the offset job is
`--wave-docs-chrome-offset`, so renaming it to the first and stopping there
loses the desktop offset silently: nothing errors, and the sidebar and the table
of contents park under whatever bar you render above them.

⚠️ `--wave-docs-chrome-offset` DEFAULTS TO `0rem`, WITH A UNIT, AND THE UNIT IS
LOAD-BEARING. It is read inside `calc(100dvh - …)` on both sticky columns, where
a unitless `0` is invalid at computed-value time — the `max-height` on the
sidebar and on the table of contents would die rather than resolve to no change.

`DocsToc`'s `rootMargin` default changes from `'-80px 0px -60% 0px'` to
`'0px 0px -60% 0px'`. The 80px reserved room for a sticky header that is no
longer rendered; `DocsToc` is exported standalone, so its default assumes
nothing overlays the content, and a host whose own chrome does overlay passes
the prop.

`DocsLayoutProps` is three props — `children`, `search` and `labels`.
`.wave-docs-layout__header`, `.wave-docs-layout__header-inner`,
`.wave-docs-layout__title` and `.wave-docs-layout__actions` stop being rendered,
and `.wave-docs-layout__sidebar` changes containment: `DocsSidebar` is a
grandchild of it now, so a `.wave-docs-layout__sidebar > .wave-docs-sidebar`
selector stops matching, and the wrapper generates a box below 64rem where it
generated none.
