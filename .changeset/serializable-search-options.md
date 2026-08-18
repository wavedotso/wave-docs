---
'@waveso/docs': minor
---

**`docs.Layout` no longer breaks `next build` when the route tunes MiniSearch with a function.** It has been doing so since 0.3.0, in exactly the case the option's own capitalised warning tells you to use it for.

`createDocsRoute({ miniSearchOptions })` and `export default docs.Layout` are the two things the quick start tells you to do, and the layout forwards those options to the dialog because it must — MiniSearch reads `tokenize` and `processTerm` when indexing *and* when querying, so an index built with one and queried with another matches nothing at all and says nothing. But `docs.Layout` is a Server Component and the dialog is a Client Component, and React serialises what crosses between them. So a `processTerm` in that object took the whole build down:

```
Error: Functions cannot be passed directly to Client Components
  {processTerm: function processTerm}
```

Serialisable overrides — `storeFields`, `boost`, anything under `searchOptions` — were unaffected, which is why this survived two releases: every documented example uses those.

**The fix is a refusal, not a silent drop.** Forwarding the serialisable half and discarding the rest would rebuild the original defect: an index built with a `processTerm` the query does not share is the zero-results-and-no-error failure the forwarding exists to prevent. `docs.Layout` now throws `invalid-config` instead, naming every offending option — `miniSearchOptions.processTerm`, `miniSearchOptions.searchOptions.filter` — and naming the remedy.

**The remedy is a client boundary of your own**, which is the only place the two halves can share a function by module reference rather than by prop. Keep it on `createDocsRoute` so the index is still built with it, pass `search={false}`, and render the dialog from a `'use client'` module that imports the same function — `README.md` has the three files under **Search → Functions need a client boundary**. `search={false}` deliberately does not throw: it is the supported path, so it must not be the one that fails.

**TypeScript now says so at the seam.** `DocsLayoutProps['search']` takes the new `SerializableSearchOptions` rather than MiniSearch's full `Options`, so `<docs.Layout search={{ miniSearchOptions: { tokenize } }}>` does not compile. `DocsSearch` and `SearchDialog` are unchanged and still take everything — they are already client components, which is the whole point. The type is the friendlier half of the guard, not the load-bearing one: a JavaScript caller has no types, and an `Omit` list goes stale the minor MiniSearch adds a callback, so the runtime check walks the values structurally and finds a function wherever it is.

**`DocsLayoutSearchProps` and `SerializableSearchOptions` are now exported from `@waveso/docs/next`.** Both already appeared in `DocsLayoutProps.search`; until now there was no way to spell either one.

**Why nothing caught it:** the test asserted on `element.props.search` and so never crossed the boundary it was testing. A props assertion is not an RSC test. The smoke build now checks that the forwarded options reach the flight payload — `pnpm test:smoke` reads them back out of the prerendered HTML — because only a real build can prove the allowed half arrives.
