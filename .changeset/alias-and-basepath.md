---
'@waveso/docs': patch
---

**An alias copied out of the address bar was encoded twice.** An alias *is* a former URL, so `aliases: [getting%20started]` is the ordinary way to write one — and the route builder encoded the `%` again, producing a redirect source of `/docs/getting%2520started` that no request can ever match. The page moved, the alias was written, and the old URL still 404'd.

It decodes first now, which makes both spellings round-trip: the pasted form decodes and re-encodes to itself, and the readable `c# guide` has nothing to decode and still becomes `c%23%20guide`. The `.`/`..` and redirect-pattern checks moved to the decoded value too — `%2E%2E` is `..` in disguise and `%28` is `(`, so checking the raw text passed exactly the inputs those checks exist to catch.

**`basePath: '//docs'` pointed the whole site off itself.** A browser reads a leading `//` as scheme-relative, so `//docs/setup` navigates to a host called `docs` — and `basePath` builds every canonical, every `og:url` and every sitemap entry. Runs of slashes collapse now.
