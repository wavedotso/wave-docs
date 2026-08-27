---
'@waveso/docs': minor
---

**The corpus, as markdown, at `/llms.txt` and `/llms-full.txt`.**

Two route handlers — `docs.llmsTxt` and `docs.llmsFullTxt` — wired the way
`docs.searchIndex` already is, plus `@waveso/docs/llms-txt` for anyone building
the files somewhere else. Both prerender; the browser bundles are byte for byte
what they were.

⚠️ THIS IS A URL CONVENTION AND NOT A BUTTON, WHICH IS THE WHOLE ORDERING
ARGUMENT. A "copy page as markdown" control is UI over these files. An agent
fetching the corpus, a reader piping a page into a prompt, and an MCP server
built later all want the *file*, and none of them want a click — so the control
is the shallow half and shipping it first builds nothing the other three can
use. The format is [llmstxt.org](https://llmstxt.org)'s: an index of one line
per page, and a second file with every body in it.

⚠️ AND THE MARKDOWN IS THE AUTHOR'S, NOT A RE-RENDER — WHICH A HOSTED SERVICE
CANNOT SAY. Mintlify and its peers reconstruct markdown from what they rendered
and lose whatever the render dropped. The source is still on disk here, so
`DocFile.content` is the body as written, and it takes exactly two edits: a
`# title` when the body has none, and link destinations resolved against the
page they were written on. Everything else survives byte for byte — list
markers, table alignment, trailing whitespace — and a test asserts that on a
deliberately awkward document, because an implementation that re-serialised
would pass every other test in the file.

⚠️ AND THE DESTINATIONS ARE FOUND BY PARSING, NOT BY MATCHING `](…)`. A regex
matches inside fenced code, which is exactly where a documentation corpus keeps
its example URLs — so a regex rewriter edits the sample a reader is meant to
copy verbatim. mdast carries the node's position but not the destination's, so
the URL is located inside the node's own slice and searched **from the end**:
`[/api/reference](/api/reference)` is ordinary in a corpus that documents its
own routes, and a forward search rewrites the visible label while leaving the
target relative — the exact inverse of the job. A destination that cannot be
located verbatim is left alone. Skipping is always safe; guessing is not.

Measured on this site: 21 pages, `llms.txt` 2.9 KB, `llms-full.txt` 163.8 KB,
every relative link resolved, and the only `./` paths left in the output are
inside inline code — the pages that document link syntax.

`siteUrl` is `createDocsRoute`'s existing one rather than a second copy. There
is one origin per repository already, feeding `alternates.canonical` and the
sitemap, and a second place to write it is a second place to write it
*differently* — a corpus whose links point at a staging host is worse than one
whose links are relative, because it looks right. Without a `siteUrl` at all
the links are root-relative, which is the honest half of the feature for docs
mounted inside a private app.

New error code: `llms-unconfigured`, thrown when a handler is called with no
`llms` option, rather than serving an index whose `h1` calls your product
"Documentation".
