---
'@waveso/docs': minor
---

Retheming now works from a plain `:root`, and config files highlight.

The stylesheet's own guidance — "redefine the tokens in your own `:root`" — could
not work against it. The dark tokens are `:root:not([data-theme='light'])`, which
is specificity (0,2,0), so an unlayered `:root` at (0,1,0) lost regardless of load
order; the cascade never reached source order. Overriding meant `:root:root:root`.

Every block now lives in a layer — `theme` for tokens, `base` for resets,
`components` for classes, declared in that order — and unlayered CSS outranks
every layer whatever its specificity. Inside the layer the dark blocks still beat
the light one, so OS following and `data-theme` are unchanged. The README gains a
Theming section, which it did not have.

Added the `ini` and `toml` grammars, and registered `cfg` and `conf` as aliases of
`ini`. Shiki resolves a fence against a grammar's own aliases rather than against
this package's loader keys, and `ini` ships only `properties` — so a ```cfg block
threw `Language 'cfg' not found` and `fallbackLanguage` rendered it as plain text.
The fence an author writes follows the filename: nobody types ```ini above a file
called `server.cfg`, and on a FiveM docs site that block is the most-read code on
the page.
