---
'@waveso/docs': minor
---

**A page becomes a landing page by declaring its actions.** `actions` in the
frontmatter turns `title` and `description` into a page header with those links
beneath them:

```yaml
---
title: Wave Docs
description: Markdown documentation for Next.js.
actions:
  - label: Quick start
    href: /getting-started
  - label: GitHub
    href: https://github.com/waveso/docs
    variant: secondary
---
```

Leave it off and the page is exactly what it was: `description` stays a `<meta>`
tag and the title is the first thing in the prose. That is the whole of the
adaptation for the two shapes this package serves — documentation that is the
entire site puts a hero on its index, and documentation mounted at `/docs`
inside an application that already has a marketing page leaves `actions` off.
There is no mode, no `standalone` flag and nothing to configure.

Actions are primary-then-secondary by position, so the common case needs no
`variant`. Anything that leaves the site gets a plain `<a>` rather than the
router link, plus `target`, `rel` and a screen-reader suffix; `mailto:` and
`tel:` get none of that, because they open no tab. Unsafe hrefs fail the build
rather than reaching an `<a>` — frontmatter was the one door into an `href` that
bypassed `isSafeHref`.

`DocsHero` is exported at `@waveso/docs/react/hero`, and `DocAction` from
`@waveso/docs/types`.

⚠️ A HERO PAGE MUST NOT ALSO WRITE ITS OWN `# Title`. `render` normally prepends
an `<h1>` from `frontmatter.title`; on a hero page the hero renders that heading
instead, because the tagline and the actions have to sit beneath it. Writing one
in the body as well ships two `h1`s — the same duplication `titleHeading` has
always warned about.

The background is a rotated line grid drawn with `repeating-linear-gradient`
rather than an inlined SVG: no data URI in the stylesheet, and the lines are
`--wave-docs-hero-grid` and `--wave-docs-hero-grid-strong` — Wave 200 and Wave
300 from `@waveso/ui` in the light theme, Wave 900 and Wave 800 in the dark one
— so they follow the theme. They are tokens of their own rather than the border
colours, because a decorative tint must not be tied to a functional contrast
ratio.
