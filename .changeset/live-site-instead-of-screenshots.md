---
'@waveso/docs': patch
---

**The README shows the live site instead of screenshots.** Three PNGs, a Playwright script to shoot them, a pinned tag and two tests to keep the pin honest — replaced by a link to [docs.wave.so](https://docs.wave.so), which is this package's documentation built with this package.

The screenshots were a photograph of the harness. The site *is* the harness: the same `site/` that CI builds on every commit, whose acceptance test forbids it a single line of layout CSS of its own. A reader who wants to know what the shell looks like can now use it — open the search, resize to a phone, tab through the drawer — instead of looking at a picture of it taken on somebody's Mac.

It also removes a whole class of staleness. A pinned screenshot is wrong the moment the shell changes and right only if someone remembers to re-shoot and re-pin; the last one was pinned to `v0.3.0` while the images had been regenerated for 0.4.0, so npm showed a search dialog the release had already replaced. A URL cannot go stale.

`pnpm shoot` is gone. The regression it was meant to catch — a stylesheet change reflowing the shell — is the browser tier's, which asserts geometry rather than pixels and runs in the same Chromium everywhere.
