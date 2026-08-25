---
'@waveso/docs': patch
---

The navigation stops being lopsided.

Its rows sat 16px from the inline start and 31px from the end. The 15px was
`scrollbar-gutter: stable`, which reserves the scrollbar's width whether or not
it is showing — and that reservation sits *inside* the padding.

The jump it prevents is one 15px shift, the first time a nav grows past a
screen. What it cost was permanent and on every page.

⚠️ AND IT IS A NO-OP ON macOS, WHICH IS WHY IT SURVIVED BEING LOOKED AT.
`scrollbar-gutter` does nothing where overlay scrollbars are the default, so the
asymmetry was invisible to everyone who built this and plain on every Windows
and Linux machine that opened it.

`scrollbar-width: thin` in its place, with `scrollbar-color`, so the scrollbar
that does appear is narrow and coloured rather than a UA slab against the
panel's edge. A browser test measures both insets and fails at 15px.
