---
'@waveso/docs': minor
---

**`docs.Layout` renders no header, and the navigation is one sidebar at every
width.** A full-width sticky bar is the one element that competes with a host
application's own for the viewport's top edge, and two of the sites using this
have one — measured against a fixed 64px host bar, ours landed on top of theirs
at every width. The chrome it held lives in the sidebar now:

```
.wave-docs-shell                       the query container
└─ .wave-docs-layout                   the grid
   ├─ .wave-docs-layout__sidebar       paints nothing, and moves
   │  ├─ …__sidebar-nav                the surface, and the one border
   │  └─ …__sidebar-trigger            a 44px strip — paints nothing at rest
   ├─ .wave-docs-layout__sidebar-scrim
   ├─ .wave-docs-layout__main
   └─ .wave-docs-layout__toc
```

Pressing the trigger translates the sidebar by exactly the navigation's width,
so it leaves the page entirely and the trigger's outer edge lands on the inline
start edge. There is no drawer, no `<dialog>`, no second control and no second
copy of the tree.

**Nothing this package renders is anchored to the viewport.** The sidebar is a
grid item, the trigger is a flex child of it, and the scrim is `absolute` inside
`.wave-docs-layout` — so every one of them resolves against a box this package
owns and *your* layout placed. `position: fixed` is the thing to avoid, and the
reason is specific: a fixed element is anchored to the viewport you share with
it, your navbar is in the same viewport, and neither can detect the other. The
search dialog is the one exception and always was.

**There is not one width-based `@media` query left.** Every breakpoint is
`@container`. `@media` asks how wide the *screen* is, which is the wrong
question for a package mounted at `/docs` inside an application that owns the
rest of the page: put this in a 700px panel on a 1920px monitor and `@media`
says "wide", the sidebar takes its 16rem column, and the reading column comes
out around 60px. Two shapes fall out of the container width — beside the
article, or over it behind a scrim with `inert`, Escape, click-to-dismiss and
focus moved in and restored.

Migration, in full:

| Was | Becomes |
| --- | --- |
| `<docs.Layout title={<Brand/>}>` | Delete it. The index page's title brands the docs |
| `<docs.Layout actions={<ThemeToggle/>}>` | Render it in your own layout, around `docs.Layout` |
| `--wave-docs-header-height` set so sticky columns clear a bar | `--wave-docs-chrome-offset`, same value |
| `--wave-docs-header-height` set to size the bar | Nothing sizes a bar. There is no bar |
| `--wave-docs-shell-width` set to cap the shell | Nothing. `--wave-docs-measure` caps the reading column |
| `actions` as the client-search escape hatch | `search={false}` plus your own `DocsSearch` |
| A `rootMargin` you relied on defaulting to `-80px` | Pass it explicitly |
| `.wave-docs-layout__header` / `__title` / `__actions` | Not rendered |
| `.wave-docs-layout__sidebar > .wave-docs-sidebar` | The tree is a grandchild now |

⚠️ `--wave-docs-header-height` DID TWO JOBS AND ONLY ONE SURVIVES. It sized the
header, and it was the offset both sticky columns parked below. Nothing of this
package's sits above the content any more, so the sizing job is gone; the offset
job is `--wave-docs-chrome-offset`, and a host with their own fixed bar still
needs to set it or the sidebar and the table of contents park underneath it.

⚠️ `--wave-docs-chrome-offset` DEFAULTS TO `0rem`, WITH A UNIT, AND THE UNIT IS
LOAD-BEARING. It is read inside `calc(100dvh - …)`, where a unitless `0` is
invalid at computed-value time — the height on the sidebar and the `max-height`
on the table of contents would die rather than resolve to no change.

⚠️ `--wave-docs-shell-width` IS GONE RATHER THAN RENAMED. It capped the whole
shell and centred it, which pushed the sidebar's inline start 480px in from the
screen on a 2560px display — and left a *closed* navigation parked in the
centring margin instead of off the page. The sidebar owns the page's inline
start edge at every width now, which is what makes "closed" mean off the screen
by construction, and the reading column is what is capped.

`DocsToc`'s `rootMargin` default changes from `'-80px 0px -60% 0px'` to
`'0px 0px -60% 0px'`. The 80px reserved room for a sticky header that is no
longer rendered; a host whose own chrome overlays the content passes the prop.

`DocsLayoutProps` is three props — `children`, `search` and `labels`.

Two behaviours are lost with the drawer and are worth knowing: the navigation no
longer opens before hydration (it was a server-rendered
`<button command="show-modal">`), and the client bundle grows about 500 bytes
for the containment work `<dialog>` used to give for free.
