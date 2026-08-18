---
'@waveso/docs': patch
---

**`search={{ className }}` no longer deletes the class the header depends on.** It was applied before the spread, so a host passing a class — the ordinary reason to pass `search` an object — replaced `wave-docs-layout__search` instead of adding to it, and the trigger lost its place in the header grid. Adding a class should not remove one.

**A declining `imageResolver` no longer emits an unusable src.** Returning `undefined` for a relative image wrote the folded path — `guide/diagram.png` — which the browser resolves against the *route*: `/docs/guide` asks for `/docs/guide/diagram.png` and `/docs/guide/setup` asks for `/docs/guide/setup/guide/diagram.png`, from identical markdown, with a green build. That is the precise failure unconditional folding exists to prevent, surviving in the one branch that skipped the check for it. It is the same `invalid-image` as having no resolver at all, because it is the same situation. A *public* src that a resolver declines still passes through untouched — "leave it as it is" is a complete answer for one of those.

**`decoding` and `fetchPriority` reach a custom `Image` component.** `createImage` spreads the tree's attributes into whichever component it was given, under a comment saying those two survive into the optimising branch — and `wrapNextImage` destructures a fixed list, so they did not. They are declared members of `DocsImageProps` now, which is the right shape for a component seam; a comment promising an open one was not.

**An equal theme pair written two ways no longer builds two highlighters.** The cache key was `JSON.stringify({ langs, themes })`, and `JSON.stringify` preserves insertion order — so `{ light, dark }` and `{ dark, light }` produced two keys and two whole Shiki instances, each loading every grammar. `langs` was already sorted for exactly this reason.

**`@waveso/docs/highlighter` has tests.** It is a public subpath and had none: the escape hatch a consumer reaches for precisely when the defaults do not fit, and the least likely to be exercised by anything else here. Seven now cover the cache identity, both refusals, every default grammar, and the ```cfg / ```conf aliases the module exists for — which Shiki resolves against a grammar's own alias list rather than against ours, so registering `ini` under a `cfg` key would not have worked and nothing would have said so.
