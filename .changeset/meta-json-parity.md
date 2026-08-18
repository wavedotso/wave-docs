---
'@waveso/docs': patch
---

**`meta.json` is now read the way markdown is.** Four ways it was not, and one of them is a security gap.

**A hand-written nav entry went round the link allowlist.** `{ "title": "Status", "href": "javascript:alert(1)" }` reached `<a href>` through `DocsSidebar` with nothing looking at its scheme — while a `javascript:` link in the markdown beside it was dropped by a check whose own comment calls it load-bearing. Both paths end at the same anchor, so both now use the same allowlist, and it lives in one module rather than two copies. `meta.json` is refused at parse time rather than dropped at render, because the file is authored and a nav entry that silently vanishes is the quietest possible failure.

**A `mailto:` entry was announced as opening a new tab.** `external` was "has a scheme", so `mailto:` and `tel:` were given `target="_blank"`, an external-link icon and an "(opens in a new tab)" suffix — describing a tab that never appears, to precisely the reader who cannot see that it did not. The markdown path has always drawn the line at http(s); the sidebar does now too. (The test asserting the old behaviour asserted the bug, and said so in its own name.)

**A UTF-8 BOM failed the build on a character nobody can see.** `readFile(…, 'utf8')` leaves it in and `JSON.parse` refuses it — `Unexpected token ''`, in the file the author is looking straight at. `readPage` learned this for markdown when `gray-matter` was swapped out; this is the same line for the same reason.

**A name in `meta.json` is matched in NFC**, because the filenames it is matched against are. `source.ts` normalises at the `readdir` boundary — macOS hands back decomposed forms — so a `meta.json` written on a Mac could list `café` and fail with `lists "café", which does not exist`, beside a list of available names containing a visually identical `café`.
