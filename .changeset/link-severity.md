---
'@waveso/docs': minor
---

**Link checking has severity levels, and broken links now say what you probably meant.**

**BREAKING: `assertLinks: boolean` is replaced by `onBrokenLinks: 'throw' | 'warn' | 'ignore'`**, defaulting to `'throw'`. `assertLinks: false` becomes `onBrokenLinks: 'ignore'`; `assertLinks: true` was the default and can be dropped. The shape follows Docusaurus's `onBrokenLinks` for the same reason it exists there: the tool cannot know how much a given site cares, and guessing produces either a build that fails on somebody's legitimate URL or one that ships a dead link quietly.

**Broken-link errors now offer the closest published route** when the link looks like a typo of one:

```
@waveso/docs: guide.md:12 links to './instalation.md', which resolves to
'/docs/instalation' — no such page exists. Did you mean '/docs/installation'?
```

A typo is a near-miss by construction, which is what makes the suggestion safe to offer *and* safe to withhold — the same trick `git`, `tsc`, `cargo` and Python 3.12 use. It decorates an error that was already being raised; it never decides whether to raise one. `/docs/instructions` is five edits from `/docs/installation` — a different word, not a typo — and gets no suggestion, because sending an author to rename a correct link is worse than saying nothing.

**New `onUnverifiableLinks`, defaulting to `'ignore'`, closes the root-mount gap.** To check `[x](/setup)` the package must first know it is a documentation link. Under `basePath: '/docs'` the prefix says so. Under `basePath: '/'` there is no prefix — `/setup` may be a page of yours, `/login` almost certainly is — so until now those links were dropped unrecorded and a typo in one shipped silently.

They are recorded and marked now, and the site decides:

```ts
createDocsRoute({
  contentDir: 'content/docs',
  basePath: '/',
  onUnverifiableLinks: 'throw', // this domain is documentation and nothing else
});
```

The default stays `'ignore'` because a root mount inside a larger application genuinely cannot distinguish the two, and failing that build would be wrong. Relative links (`./other.md`) are resolved against the content tree, so they are verifiable at every mount and always governed by `onBrokenLinks`.

`docs.wave.so` runs with `onUnverifiableLinks: 'throw'`, which is the configuration this option was written for.
