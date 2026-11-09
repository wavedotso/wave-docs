---
'@waveso/docs': patch
---

**The search trail reads as names on one line, under a mounted `basePath` and in a Tailwind host.**

Two defects in the second line of a search result, both invisible on a root-mounted site with no CSS reset:

- **The titles never matched under a mounted `basePath`, `/docs` included.** The trail was split from the hit's `href`, which carries the mount and percent-encodes its segments, while the crumb titles are keyed by slug. So every row showed its raw route, the mount first: `learn › agents › agent-skills`. The trail is now read from the record's slug, its `id` without the anchor, so it shows `Agents › Agent skills`, unescaped, and leaves out the mount, the same on every row.
- **Each crumb stood on its own line in a Tailwind host.** Tailwind's preflight sets `svg { display: block; vertical-align: middle }`, and the chevron between two crumbs is an SVG. `.wave-docs-search-result-sep` now says `display: inline` and `vertical-align: baseline` itself, in the `components` layer, which outranks the reset.
