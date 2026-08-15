---
'@waveso/docs': minor
---

Search works out of the box, the default page is one you would keep, and the public surface is frozen. Several changes are breaking; those come first.

**Search is two files now, and neither is a build script.** The index is a prerendered route handler on the object you already hold, so it is rebuilt by the same `next build` that builds your pages — and in `next dev` it re-reads the disk per request, so a page you add is searchable on the next keystroke instead of at the next time you remember to run a script:

```ts
// app/docs/search-index.json/route.ts — the whole file
import { docs } from '@/lib/docs';

export const GET = docs.searchIndex;
export const dynamic = 'force-static';
```

`docs.searchIndexUrl` is derived from your `basePath`, so it is right at `/`, at `/docs`, and under a nested prefix. **`writeSearchIndex` is removed** — it was the only documented way to build an index, and this replaces it; `buildSearchIndex` and `renderAll()` remain for an artifact the route cannot express, and `docs.searchIndex` is asserted byte-identical to them. Verified against a real `next build`: the body prerenders in both output modes and is byte-identical between them, response headers survive into the prerender manifest, and CI now runs that build on every pull request.

**`export const dynamic = 'force-static'` is not optional, and the handler enforces it.** Without it Next re-renders your entire corpus per request, from markdown that output tracing did not put in the deployment bundle — on a serverless host that throws, at the reader, inside the search dialog, and the build prints no warning. It now fails loudly with `code: 'search-index-dynamic'`, naming the file to edit.

**`DocsSearch`, at `@waveso/docs/react/next-search`**, is the `'use client'` wrapper around `useRouter()` and `next/link` that every consumer was writing by hand — and skipping `Link` silently cost hover prefetching on every result. `SearchDialog` is unchanged and still host-agnostic.

**`SearchDialog`'s `searchOptions` prop is now `miniSearchOptions`**, and `createDocsRoute` takes the same name for the same object. MiniSearch's own name for the query defaults is `searchOptions`, so the old prop produced `searchOptions={{ searchOptions: { fuzzy: 0.1 } }}` — a stutter nobody writes, which is why both README examples were written flat, did not compile, and would not have errored at runtime either.

**Your project is no longer traced into your server bundle.** `contentDir` is a string this package cannot resolve statically, so Turbopack fell back to tracing the whole project — every source file, your entire `public/` folder, your last build's output — into the server output for every docs route. Measured at 332 traced files for a three-page site, of which 39 were the project's own. Nothing here reads markdown at request time, so nothing needs tracing, and now nothing is.

**Five names are gone**, all pre-1.0 and all replaced: the `./react/*` wildcard is enumerated as explicit subpaths, and `./markdown-links` and `./search-options` are no longer exported. Every subpath in `exports` is now listed in the README, and that is enforced by a test.

**The default page is worth looking at.** A 46rem measure and a system font stack, a 1.2 minor-third type scale, tables that scroll instead of shredding the layout, one focus `outline` in place of five `box-shadow` rings (which also deletes the forced-colors block that existed to patch them), and a responsive shell with breakpoints at 64/80/100rem. The element tree, the five layout tokens and the breakpoints are frozen in `docs/adr/001-shell-contract.md`.

**Three new harnesses, because the old ones could not see these failures.** A browser tier running real Chromium — jsdom reports every width as `0`, so the measure, the type scale, reflow and the table floor were unassertable. A smoke build of a real Next application against the published `exports` map, in both output modes. And `pnpm check:readme`, which type-checks every example in this README as one project: it immediately found `app/docs/layout.tsx` defined twice with different bodies, and an `imageResolver` example calling `imageSize(path)` when `image-size` v2 takes a `Uint8Array`.
