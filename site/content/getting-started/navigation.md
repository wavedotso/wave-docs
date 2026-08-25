---
title: Navigation
description: One optional meta.json per directory decides sidebar order, group headings, separators and links.
---

The sidebar is built from the content tree. One optional `meta.json` per directory
changes the order and the labelling; every directory without one still gets a
sidebar.

## Why a file, and not a filename

**A filename cannot express a separator, an external link or a directory title.**
Numeric prefixes — `01-installation.md` — carry exactly one piece of
information, and a docs sidebar needs four. They also put the sort weight in the
URL, so reordering the tree changes every link into it.

`meta.json` is validated strictly: an unrecognised key fails the build rather
than being ignored. The keys people reach for are `page`, `order` and `items`,
none of which exist, and each of them would otherwise fail as a sidebar that
quietly drops half the file.

## Every entry kind

```json title="content/api/meta.json"
{
  "title": "API Reference",
  "pages": [
    "index",
    "authentication",
    "---Advanced---",
    "...webhooks",
    "...",
    { "title": "Status page", "href": "https://status.example.com" }
  ]
}
```

| Entry | Meaning |
| --- | --- |
| `"authentication"` | A file or subdirectory in this directory, in this position |
| `"---Advanced---"` | A non-interactive separator with the enclosed label |
| `"..."` | Everything not named explicitly. At most one per file |
| `"...webhooks"` | Expand the `webhooks` subdirectory inline, with no group wrapper |
| `{ "title", "href" }` | An arbitrary link. `external` is inferred from the href |

A name is the filename without its extension, or the directory name —
`"authentication"` addresses `authentication.md`, `"...webhooks"` addresses
`webhooks/`. Anything unnamed is dropped unless a `"..."` says where to put
it.

`"...webhooks"` discards the group wrapper, not the directory's own page: the
link to `webhooks/index.md` is spliced in ahead of its children, because the
group heading was the only thing carrying that href and the route exists either
way.

> [!WARNING]
> An entry's `href` is checked against the same scheme allowlist the markdown
> path uses, and refused at parse time — `http(s)`, `mailto`, `tel`, `sms`,
> `ftp`, `irc`, `xmpp`, `news`, `feed`, `git` or `matrix`, or a path, which
> needs no scheme at all. `external` means "opens a new tab", which is http(s)
> only: a `mailto:` entry hands off to the OS and stays where it is, so it is
> not announced as opening one.

## With no `pages` list

Omit `pages` and the directory sorts by frontmatter `order` ascending, then by
title. Entries without an `order` sort after every entry that has one, and the
title comparison is pinned to the `en` locale so sidebar order cannot depend on
the build machine. That is exactly what a lone `"..."` does.

`label` wins over `title` for the sidebar entry when a page sets one — sidebars
are narrow. Both are frontmatter fields; see
[Writing content](./writing-content.md).

> [!NOTE]
> A directory's own `index.md` is not listed as a child of its group: the group
> heading already links to it. The content root is the exception — nothing
> encloses it, so its `index.md` is listed by default, and a reader who follows
> a link can get back to the landing page.

## Group headings

A group heading takes its `meta.json` `title`, else its `index.md` `label`, else
its `index.md` `title`, else the directory name humanised — `getting-started`
becomes `Getting Started`.

## This site's own sidebar

**Look left.** The sidebar you are reading is the example. Its root `meta.json`
names the five top-level entries in reading order, then a `---Project---`
separator, then three external links:

```json title="content/meta.json"
{
  "pages": [
    "index",
    "getting-started",
    "guides",
    "reference",
    "internals",
    "---Project---",
    { "title": "GitHub", "href": "https://github.com/wavedotso/wave-docs" },
    { "title": "npm", "href": "https://www.npmjs.com/package/@waveso/docs" },
    {
      "title": "Changelog",
      "href": "https://github.com/wavedotso/wave-docs/blob/main/CHANGELOG.md"
    }
  ]
}
```

Each of the three sections has a `meta.json` of its own, and each sets a
`title`: `Getting started`, `Guides`, `Reference`. Without it the headings would
read `Getting Started` and the sentence case would be wrong in one place out of
three — the humanised name capitalises every word.

## When it fails

**Naming an entry that resolves to nothing fails the build.** The message
carries the path to the `meta.json`, the offending entry and the names that are
actually there:

```
@waveso/docs: /app/content/reference/meta.json lists "confguration", which does not exist. Available entries: components, configuration, entry-points, errors, stability.
```

Two other entries are build errors for the same reason — they look deliberate
and are always typos. Naming the same child twice renders the page twice, both
copies highlighted as the current page. A second `"..."` has no honest reading,
because a directory has a single set of unnamed pages. Both throw
`invalid-meta`; see [Errors](../reference/errors.md).

Three things are deliberately *not* errors. A draft named in `pages` resolves
and is not emitted, so the build does not break and mend as `includeDrafts` is
flipped. A group that turned out to be empty is dropped. A separator left
standing over nothing — the group after it emptied, or another separator
follows — is dropped with it, which cannot be left to the author to notice:
previewing with drafts on is exactly the mode where the group is not empty.

Nav nodes are ordinary data. `DocNavNode` is the union of `page`, `group`,
`separator` and `link`, and a shell that wants to render them itself takes them
as props — see [Layout](../guides/layout.md).
