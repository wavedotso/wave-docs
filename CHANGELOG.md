# @waveso/docs

## 0.1.0

### Minor Changes

- adddaea: Initial release.

  Markdown documentation for Next.js, from one content directory and one pipeline.
  Markdown becomes hast in Node at build time, so the browser receives a tree of
  nodes and a component map — never `unified`, `remark-parse` or Shiki.

  - `createDocsRoute` wires a content directory to an App Router catch-all, with
    `dynamicParams: false`, a real index route, awaited `params` and a canonical
    URL on every page.
  - Frontmatter is extensible through `frontmatterSchema`, typed as a
    [Standard Schema](https://standardschema.dev) so Zod, Valibot and ArkType all
    work and your fields are inferred with no type argument.
  - Internal `.md` links are rewritten to routes and their targets checked, so a
    link that works on GitHub cannot 404 once published.
  - Table-of-contents ids come from the same `rehype-slug` pass that annotates the
    document, so anchors match by construction rather than by a second parse.
  - GitHub alert syntax, a click-to-load YouTube facade, section-scoped MiniSearch
    records, a sidebar, a scrollspy TOC, a search dialog and a themeable
    stylesheet.

- ed73890: Retheming now works from a plain `:root`, and config files highlight.

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
  this package's loader keys, and `ini` ships only `properties` — so a `` cfg block
threw `Language 'cfg' not found` and `fallbackLanguage` rendered it as plain text.
The fence an author writes follows the filename: nobody types  ``ini above a file
  called `server.cfg`, and on a FiveM docs site that block is the most-read code on
  the page.
