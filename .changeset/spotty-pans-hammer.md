---
'@waveso/docs': minor
---

Fix 38 defects found in a pre-publish review. Several are behaviour changes; the ones you can notice are listed first.

**Dark mode is now opt-in.** The tokens used to switch on `prefers-color-scheme` alone, but the stylesheet styles the docs subtree rather than the page — so a light-only site with a `/docs` section served near-white text on the host's white background (1.23:1) to every visitor whose OS was in dark mode. Dark now requires `data-theme="dark"` or `class="dark"` on `<html>`; `data-theme="system"` opts back into following the OS. `color-scheme` is declared, so native scrollbars and form controls match.

**The `tailwindcss` peer dependency is gone.** Nothing in the package used Tailwind, and declaring it blocked `npm install` outright for any project on Tailwind 3 — npm range-checks an optional peer that happens to be installed. The `@source "./"` directive is gone with it; it was injecting 14 unrequested utilities into every Tailwind consumer's CSS. `zod` is now an optional peer too: only `/frontmatter`, `/source` and `/next` need it.

**Search indexes the full text of a section.** It previously truncated to 300 characters *before* indexing, dropping ~80% of a normal corpus, and stored none of it for display either. Tokenisation now uses `Intl.Segmenter`, so CJK text is searchable at all — it previously returned zero hits. Both `buildSearchIndex` and `SearchDialog` accept MiniSearch overrides.

**Aliases are validated.** `aliases: ['v1:beta']` used to compile to a Next redirect *wildcard*: the build passed, then `/docs/v1-guide` — a real prerendered page — was permanently 308'd away. Metacharacters, relative segments and empty entries are now rejected when the page is read, naming the file. Linking to an alias also fails the build now, naming the page to link instead: an alias is never prerendered, so it was a green build and a hard 404.

**Relative images fail the build instead of shipping a broken `src`.** Nothing ever rewrote them, so the browser resolved them against the route and identical markdown requested a different file from every page. Absolute and external sources are unaffected.

**A custom `frontmatterSchema` can no longer drop the package's own fields.** All six — `title`, `description`, `label`, `draft`, `aliases`, `order` — are parsed from the raw YAML and laid back over your schema's output, so a custom schema can only ever *add*. A bare `z.object({ title, … })` type-checks but used to strip `draft` and `aliases`, publishing every draft, submitting them to Google, and returning no redirects. The price is that a `.default()`, `.transform()` or `.coerce` aimed at one of the six is not honoured: the YAML wins.

**Links to unusual URL schemes are dropped rather than rendered.** `javascript:`, `data:` and `vbscript:` never reach an `href` — including the obfuscated spellings a browser still navigates. The allowlist is GitHub's (`http`, `https`, `mailto`, `tel`, `sms`, `ftp`, `ftps`, `irc`, `ircs`, `xmpp`, `news`, `nntp`, `feed`, `git`, `matrix`); anything else keeps its text, loses its destination, and warns outside production.

**Absolute internal links are respelled before they are checked.** `/docs/café` and `/docs/caf%C3%A9` are the same page, and only the encoded form used to match — so the human-readable spelling every editor produces failed the build with "no such page exists" for a page that plainly exists.

Also fixed: `siteUrl` with a path silently truncated out of every canonical and the whole sitemap; `` ```JSON ``/`` ```Bash `` shipping unhighlighted; the search dialog's focus trap breaking on a click, its Close button navigating on Enter, and IME composition being consumed as "open result"; the search index cached forever against the first `indexUrl`; every focus indicator vanishing under Windows High Contrast; long tokens forcing horizontal scroll at 320px; a `draft: true` index page publishing its title as a public sidebar heading; symlinked and `.MD` files vanishing silently; percent-encoded and NFD filenames failing to resolve; `writeSearchIndex` truncating the served file in place; the TOC scrollspy dying permanently when headings mount late; YouTube re-stealing focus on every re-render; markdown images ignoring an author's `loading`; Shiki splicing an invalid `root` node into the tree; `renderAll` running unbounded; and `docs.source.nav()` being one request stale in dev while every page view scanned the filesystem twice over.

Every failure now throws with a `code` (`'broken-link'`, `'invalid-alias'`, `'invalid-frontmatter'`, …) and a message naming this package, so a host can branch on the kind of failure instead of matching message text. Where an underlying parser failed — js-yaml on frontmatter, `JSON.parse` on `meta.json` — its own error is attached as `cause`.

### API changes

- `extractSearchRecords(doc)` takes no options; `ExtractSearchRecordsOptions` and `excerptLength` are gone, since full section text is now indexed.
- `SearchRecord.id` is a slug (`page#anchor`), not an `href` — an href embedded `basePath`, so moving a site from `/docs` to `/reference` changed the identity of every record.
- `buildSearchIndex(records, options?)` and `<SearchDialog searchOptions={…}>` accept MiniSearch overrides. They must agree.
- `DocsSource.drafts()` is new, and `DocsRouteOptions` gains `excludeLangs`, which existed on the renderer and was reachable from nothing.
- Optional properties across the public option types are now spelled `?: T | undefined`, so a consumer with `exactOptionalPropertyTypes` can pass a possibly-undefined value — `siteUrl: process.env.SITE_URL` was previously a compile error.
- The CSS custom property `--wave-docs-header-height` is now `--wave-docs-scroll-padding`, which is what it actually controls.
- `engines.node` is `>=22.12.0`. Node 20 reached end of life in April 2026.
