---
'@waveso/docs': patch
---

**docs.wave.so serves the documentation at its root**, so a page is `docs.wave.so/installation` rather than `docs.wave.so/docs/installation` — a host called `docs` should not say it twice.

Nothing in the package changed: `basePath` has always taken any prefix, and `'/'` is one of them. The default is still `/docs`, defined in one place, and every consumer gets it unless they say otherwise.

What did change is which configuration the harnesses cover. `smoke/` builds on the default `/docs` in both output modes on every CI run, so moving the site to the root mount loses nothing and covers the half that was thin: an empty base path is a distinct code path in `toHref`, `toRoute` and `isInternalAbsoluteLink`, and two unit assertions used to be all of it. The two harnesses now cover both mount points and both documented layout shapes — smoke keeps the README's one-line `export default docs.Layout`, the site composes `<docs.Layout>` inside a root layout.

**One behaviour differs at the root mount, and it is worth knowing.** With an empty base, an absolute link like `/installation` cannot be told apart from any other route in the application, so it is not checked against the published routes — under `/docs`, a typo in `/docs/instalation` fails the build; at the root it does not. Relative markdown links, which is what documentation should be written with, are unaffected.
