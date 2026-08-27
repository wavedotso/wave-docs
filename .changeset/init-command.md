---
'@waveso/docs': minor
---

**`npx @waveso/docs init` — the route files, written for you.**

A new `bin`, plus `docsScaffold` and `initDocs` for a host scaffolder that
wants to write them its own way.

⚠️ THE FILE COUNT IS NEXT'S FLOOR AND THE TYPING IS NOT. A route in the App
Router is a folder in the *consumer's* `app/`, so no package can add one — six
files is the minimum for a documentation site however good this package gets.
What a scaffold can remove is hand-typing them, and that matters here because
three of the six fail **silently** when they are slightly wrong:

- a `dynamicParams` that is not a literal `false` builds green, then renders
  unlisted URLs on demand — Next parses route segment config out of the module
  before any of it runs, so a value it would have to execute an import to learn
  is no value at all;
- a route handler without `export const dynamic = 'force-static'` re-renders the
  whole corpus per request, from markdown output tracing never put in the
  deployment bundle;
- an index page nobody created leaves the mount itself a 404, because
  `[...slug]` does not match `/docs`.

Every one of those produces an application that builds. The tests assert those
lines specifically rather than the prose around them.

⚠️ AND IT NEVER OVERWRITES. A file that exists is reported and skipped, so a
second run is safe and running it in a project that already has a `layout.tsx`
cannot destroy one. Scaffolders that clobber are scaffolders people stop
running.

⚠️ AND THE LAYOUT HAS TWO SHAPES, BECAUSE `docs.Layout` IS NOT A ROOT LAYOUT.
It owns the sidebar, the search trigger, the skip link and the grid, and
deliberately not `<html>` or `<body>` — which is the property that lets a host
wrap it. At a root mount there is no other layout to own them, so the generated
file is a real root layout that renders the shell inside it; under `/docs` it is
the one-liner, and a root layout is offered beside it for a bare project that
has none. Getting this wrong produces an application Next refuses to build with
an error about a missing root layout, pointing nowhere near the cause.

Non-interactive: flags and defaults rather than prompts, so it runs the same way
in a terminal, in CI and inside another tool's scaffolder — and adds no
dependency to a package that ships its parser to nobody. `node:util`'s
`parseArgs` refuses an unknown flag rather than ignoring it, because silently
dropping `--base-paths` writes the scaffold to the wrong place and reports
success.

`llms.txt` is behind `--llms-index` rather than default, because `llms-full.txt`
already carries every page *and* its URL — an agent that finds the corpus has
everything, and the "Copy page" button reads the corpus. Six files is the floor;
the index is the seventh, and optional.

Verified by building both mount shapes with a real Next: a scaffolded project
compiles and prerenders with no edits.

## Also

⚠️ `[[...slug]]` WAS RE-TESTED AS A WAY TO DROP A FILE, AND IT LOSES THE INDEX
ENTIRELY. The README's objection was duplicate content at `/docs/index`; the
measured behaviour is worse. `docs.generateStaticParams()` returns no entry for
the root — by design, since `page.tsx` owns it — so an optional catch-all
prerenders every page *except* the home page, and `out/index.html` is simply
absent. Making it work would need a second params function in the package, and
only then would the duplicate-content problem arrive. Two route files stay.
