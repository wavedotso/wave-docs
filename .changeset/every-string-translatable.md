---
'@waveso/docs': minor
---

**Every string this package renders is now yours to set.** `DocsLayoutProps.labels` documented itself as "the whole of what a non-English site has to say" and reached four strings of twenty-two.

Verified in this repository's own `site/out`, which is how it was found: a site built exactly the documented way shipped `<nav aria-label="On this page">`, a visible `Back to top`, `aria-label="Tip"` on every callout, `aria-label="Table"` on every wide table, `Copy code` on every fence, `(opens in a new tab)` after every external link, `Expand <group>` on every sidebar disclosure, and `Play video` on every embed — in English, whatever language the site was written in. The copy runtime announced `Copied to the clipboard.` to a screen reader, in English, on every site on earth.

**`createDocsRoute({ labels })` is where they live now**, because they are not rendered in one place and a layout prop could never have reached them:

| where | strings | cost to override |
| --- | --- | --- |
| the shell | 4 | none, server-rendered |
| the navigation tree | 3 | crosses to a client component |
| the table of contents | 2 | crosses to a client component |
| your content — callouts, tables, external links, YouTube | 9 | none, server-rendered |
| code frames | 2 | none, baked in at build time |
| the copy runtime | 2 | crosses to a client component |

`docs.Layout`'s `labels` prop still exists and now overrides the route's **key by key**, for a site with two shells or a section in another language — a whole-object override would mean naming one string cost you the other twenty-one.

`{title}` is a placeholder in the five strings that interpolate a name, rather than a function: three of them cross a Server → Client boundary where a function cannot go, and a translator has to be able to move the name within the sentence, which concatenation forbids.

**`rehypeCodeFrame` has taken a `copyLabel` since it was written and nothing ever passed one.** The plugin is private, so the option was unreachable from every entry point while the README said the label was configurable. It is wired now, and joined by `copyCodeFrom` for a titled fence.

**Sizes moved, and the published figures moved with them.** `sidebar` 1.9 → 2.0 KB, `nav` 2.25 → 2.45, `next-nav` 2.34 → 2.55, `code-runtime` 0.98 → 1.15. The README's cost table now reads 13.5 KB for the quick start, 2.4 KB for navigation and 1.1 KB for the copy runtime. About 200 gzipped bytes for a chrome that can be translated at all.

**A key that is declared and never wired now fails the suite.** `LABEL_COVERAGE` in `next.test.ts` requires every member of `DocsLabels` to name where it is proven, and fourteen of them are asserted against real rendered markup with sentinel values — a string that cannot occur by accident cannot pass by accident.
