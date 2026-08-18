---
'@waveso/docs': minor
---

**Image sources are now split and percent-decoded, exactly as links have always been.** `foldImageSrc` handed the authored `src` straight to `foldSegments`, so three ordinary spellings broke — and the first is the one GitHub's own editor writes for you.

- **`![a](./getting%20started.png)`** — drag a file whose name has a space into GitHub's editor and this is what it writes. It reached the `imageResolver` still encoded, so `readFile(path.join('content/docs', src))` — the implementation this README gives — threw `ENOENT` and the build died with `invalid-image` on a file that is plainly on disk and that GitHub renders correctly.
- **`![a](./diagram.png?v=2)` and `![a](./sprite.svg#icon)`** — the query and the fragment were baked into the filename, so the resolver looked for a file called `diagram.png?v=2`. They are split off before the call now and re-attached to whatever the resolver returns, so the cache-buster survives and `#icon` still selects the symbol inside the sprite. A resolver returning a query or fragment of its own keeps its own, because two `?` in one URL is not a URL.
- **`![a](./%2E%2E%2Fsecret.png)`** — folded without decoding, that is one segment with no slash in it, so the climb check never fired. `ImageResolver`'s contract promises the path is contained; any resolver that decodes — anything building a `URL` — was outside it. `foldSegments` can only refuse a `../` that is spelled as one, which is why decoding happens first.

**One implementation, in `splitHref`.** Four call sites need the same split-decode-fold-reattach sequence; three had it inline and the fourth had none of it. They now share one.

**`invalid-image` covers malformed encoding too.** Decoding means the image path can raise `URIError`, and an unwrapped one would reach the build with no code, no file and no line — past the very check that exists to make image failures locatable.

`ImageResolver`'s docstring now says what its argument is: a file path, decoded, with the query and fragment already removed.
