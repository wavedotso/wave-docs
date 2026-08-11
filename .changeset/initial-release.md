---
'@waveso/docs': minor
---

Initial release.

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
