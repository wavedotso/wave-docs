---
'@waveso/docs': minor
---

**Anchors are checked now.** A route was verified and its fragment thrown away, so `[setup](./install.md#setup)` built green with no `#setup` anywhere on the page. It is the more common of the two link failures — headings get renamed constantly and nothing renames the links into them — and it went unchecked while the rarer one did not.

`onBrokenAnchors` defaults to `'throw'`, and the error names the heading you probably meant:

```
@waveso/docs: guide.md:12 links to '#instalation', and this page has no
'#instalation'. Did you mean 'installation'?
```

Checked against every `id` in the rendered page, not against the table of contents — which captures `h2`–`h3` only, so a link to an `h4` is fine, and so is a link to an id one of your `rehypePlugins` added. Same-page anchors are checked as each page renders, so those errors carry a line number; cross-page anchors need the target's ids and are checked by `docs.renderAll()`, which runs in every build that serves search.

**`onUnverifiableLinks` is replaced by `externalRoutes`, and the default flipped.** It shipped in no release, so nothing to migrate.

The old option asked you to reason about *our* inability to verify a link. The new one asks for a fact about *your* application, which is the thing you actually know:

```ts
createDocsRoute({
  basePath: '/',
  externalRoutes: ['/login', '/dashboard', '/api/'],
});
```

And absolute links at a root mount are now checked by default rather than ignored. A root mount is what you choose when the origin serves documentation and nothing else — `docs.example.com` — so an unknown absolute link there is a typo, and silence was the wrong default. A site that serves something else names what is its own; `/api` covers `/api/keys` and not `/apiary`.

That also removes the `'warn'` level that made no sense: warning on every legitimate route in your application is not a diagnostic.

**New error code `broken-anchor`**, documented in the troubleshooting table and offered in the bug form.
