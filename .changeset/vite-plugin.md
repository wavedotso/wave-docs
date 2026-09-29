---
'@waveso/docs': minor
---

Vite builds a docs site now, through `@waveso/docs/vite`.

It is a build plugin rather than an adapter: Vite has no routing, so it owns no routes, renders no pages and decides no URLs. `waveDocs()` reads the content directory, renders it once, checks every link and anchor, and emits `search-index.json`, `llms-full.txt`, `llms.txt` and one JSON tree per page — then hands the app a navigation tree and a page loader through `virtual:wave-docs`. You keep your own router, and pass `pathname` and `navigate` the way every component in this package already accepts them.

The three shared artifact paths are the ones the Next adapter uses, so `SearchDialog`'s `indexUrl` and `DocsCopyPage`'s `corpusUrl` defaults keep working — a component moves between the two without a prop change. `@waveso/docs/vite-client` carries ambient types for the virtual module.

No Vite peer dependency: the plugin's types are declared structurally, so this package pins no Vite major.

The markdown parser and Shiki still run at build time and stay out of the browser. What a client-rendered app does pay, and Next does not, is the hast-to-React step — about 13.6 KB gzipped via `DocContent`, because there is no server render to do it in.

Internally, the four things both adapters do before anything framework-shaped happens — collect routes, construct a renderer, render every page, check cross-page anchors — moved into one shared module, so a render-affecting option cannot be added to one adapter and forgotten in the other.
