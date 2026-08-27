---
'@waveso/docs': minor
---

**"Copy page" — this page's markdown, on the reader's clipboard.**

On by default, 1.2 KB gzipped, and it needs no configuration: it reads
`/llms-full.txt` and slices out the page it is on. The corpus is a file this
package already ships for agents, so the button adds no artifact of its own.

⚠️ IT SLICES THE CORPUS BECAUSE PER-PAGE `.md` URLS COST FIVE STEPS IN NEXT,
AND THAT WAS BUILT FIRST. A route file, a rewrite, `output: 'export'` made
conditional, a post-build script, and a placeholder the export forces which the
script then deletes. Two of those fail *silently*: a rewrite that stops
matching says nothing, and a route folder named `_md` is a *private folder*
excluded from routing entirely — the same 404 with nothing in the console,
which cost three rounds of debugging the rewrite pattern before the folder name
was suspected.

All of it existed because `*.md` is a *pattern* the docs catch-all already owns,
and a segment holds either a `page` or a `route`, never both. `llms-full.txt` is
a **fixed path**, which needs none of it: one route file, the same cost as the
search index, rendering on demand in development and prerendering into a static
export. For a package whose pitch is "point it at a folder of markdown", five
steps of `next.config.ts` surgery was the wrong trade, and the simpler shape
travels better — Astro and Vite serve a fixed path in a few lines too.

⚠️ AND IT HOLDS NO MARKDOWN OF ITS OWN. Embedding each page's source in its own
HTML was the other alternative: five to eight kilobytes gzipped on *every page
load* for a control most readers never press. The fetch is on click, so page
weight and first paint are untouched for everyone who does not use it, and the
result is cached for the rest of the visit. One corpus download is ~40 KB
gzipped at twenty pages and ~2 MB at a thousand, which is Stripe-scale.

⚠️ AND THE DEFAULT IS "ON IF `llms` IS SET", NOT PLAIN `true`, BECAUSE THE
SERVER CAN ANSWER MOST OF THIS. `docs.llmsFullTxt` refuses to serve without an
`llms` option, so a site without one has no corpus by construction — and a
`true` default there renders a control whose only possible outcome is to remove
itself, which a reader watches vanish under the cursor. Explicit `true` still
wins, for a host serving the corpus some other way.

⚠️ AND IT STILL REMOVES ITSELF WHEN THE ROUTE FILE IS MISSING, which is the one
case the server cannot see: `llms` configured and `app/llms-full.txt/route.ts`
never created. Only a fetch can tell. A network failure is deliberately *not*
treated the same — the wiring is fine and the next press may work, so it
reports and stays.

## The links in the copied markdown point at pages

⚠️ THE MARKDOWN EXTENSION COMES OFF THE DESTINATION, AND WITHOUT IT EVERY
INTERNAL LINK IN THE CORPUS 404ED. Authors write `[auth](./api/auth.md)` on
purpose — it resolves on GitHub and in an editor preview — and `/api/auth.md` is
not a route. `index` collapses onto its directory's own page, matching `toHref`.

⚠️ FOR OUR OWN ORIGIN ONLY. A raw file on GitHub, or a spec published as
markdown, is a real URL that ends in `.md`; trimming it points at a page that
does not exist on a host we do not control.

## The rest

While the fetch is in flight the label pulses rather than the button jumping
straight to its outcome. A cold click crosses the network, and with nothing in
between the ✓ or ✗ reads as a verdict on the click rather than on a request that
had been running. The label animates instead of a spinner appearing: a fourth
glyph in a bundle whose whole argument is its size, for information the label
can carry. It sits inside the `prefers-reduced-motion` block, so a reader who
asked for less motion gets `cursor: progress` and the live region.

⚠️ `font: inherit` RENDERED THE BUTTON IN TIMES. This package scopes its sans to
the components that own text — `.wave-docs-prose` and `.wave-docs-toc` set it,
`body` and `.wave-docs-layout__main` do not, because a host owns their
typography. So a control placed in `main` inherits the browser's default serif,
and the mismatch was not only the face: Times sits on a different baseline at
the same size, which made an exactly-aligned button look crooked and sent the
first diagnosis after the wrong bug.

⚠️ AND THE HEADER IS CAPPED *AND* CENTRED, WHICH IS TWO DECLARATIONS.
`.wave-docs-prose` is both, inside a `main` that is wider than the measure, so a
header filling `main` puts its trailing edge past the text it belongs to.
Measured at 1440px: the button's right edge at 1152 against the prose's 1096.
`.wave-docs-pager` carries the identical pair for the identical reason.

`writeClipboard` — the clipboard write with its `execCommand` fallback for plain
HTTP — moved out of the code runtime into a private module both buttons share,
so the two cannot come to disagree about whether a copy worked.

`DocsCopyPage` is exported from `@waveso/docs/react/copy-page` for a
hand-composed shell. Its `failedLabel` defaults to an instruction rather than an
apology, because the failure that reaches a reader usually leaves them able to
finish the job themselves.
