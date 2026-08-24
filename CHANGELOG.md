# @waveso/docs

## 0.7.1

### Patch Changes

- 43af6e9: The back-to-top link appears when there is something to go back to.

  It sat at the foot of the table of contents on every page, including at the top
  of one, offering to return a reader to where they already were. It now fades in
  between 25dvh and 35dvh of scroll and fades back out on the way up.

  No JavaScript was added to do it. The reveal is a scroll-driven animation, so
  scroll position alone drives it — no listener, no state, no re-render per
  frame, and correct before the component has hydrated. `DocsToc` is the smallest
  client component this package ships and it has not grown by a byte.

  `visibility` moves with the fade, so the link leaves the tab order while it is
  invisible rather than sitting there as a focus target nobody can see — and it
  rejoins only once it is legible, not at the first pixel of the fade.

  Where the timeline cannot run the link is simply always present, exactly as it
  was: Firefox has not shipped scroll-driven animations, a page too short to
  scroll leaves the timeline inactive, and so does a host that scrolls an inner
  pane rather than the document. Nothing hides a control on the strength of a
  feature the engine did not run.

## 0.7.0

### Minor Changes

- da25315: **A page becomes a landing page by declaring its actions.** `actions` in the
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

- 915729f: **`docs.Layout` renders no header, and the navigation is one sidebar at every
  width.** A full-width sticky bar is the one element that competes with a host
  application's own for the viewport's top edge, and two of the sites using this
  have one — measured against a fixed 64px host bar, ours landed on top of theirs
  at every width. The chrome it held lives in the sidebar now:

  ```
  .wave-docs-shell                       the query container
  └─ .wave-docs-layout                   the grid
     ├─ .wave-docs-layout__sidebar       paints nothing, and moves
     │  ├─ …__sidebar-nav                the surface, and the one border
     │  └─ …__sidebar-trigger            a 44px strip — paints nothing at rest
     ├─ .wave-docs-layout__sidebar-scrim
     ├─ .wave-docs-layout__main
     └─ .wave-docs-layout__toc
  ```

  Pressing the trigger translates the sidebar by exactly the navigation's width,
  so it leaves the page entirely and the trigger's outer edge lands on the inline
  start edge. There is no drawer, no `<dialog>`, no second control and no second
  copy of the tree.

  **Nothing this package renders is anchored to the viewport.** The sidebar is a
  grid item, the trigger is a flex child of it, and the scrim is `absolute` inside
  `.wave-docs-layout` — so every one of them resolves against a box this package
  owns and _your_ layout placed. `position: fixed` is the thing to avoid, and the
  reason is specific: a fixed element is anchored to the viewport you share with
  it, your navbar is in the same viewport, and neither can detect the other. The
  search dialog is the one exception and always was.

  **There is not one width-based `@media` query left.** Every breakpoint is
  `@container`. `@media` asks how wide the _screen_ is, which is the wrong
  question for a package mounted at `/docs` inside an application that owns the
  rest of the page: put this in a 700px panel on a 1920px monitor and `@media`
  says "wide", the sidebar takes its 16rem column, and the reading column comes
  out around 60px. Two shapes fall out of the container width — beside the
  article, or over it behind a scrim with `inert`, Escape, click-to-dismiss and
  focus moved in and restored.

  Migration, in full:

  | Was                                                           | Becomes                                                |
  | ------------------------------------------------------------- | ------------------------------------------------------ |
  | `<docs.Layout title={<Brand/>}>`                              | Delete it. The index page's title brands the docs      |
  | `<docs.Layout actions={<ThemeToggle/>}>`                      | Render it in your own layout, around `docs.Layout`     |
  | `--wave-docs-header-height` set so sticky columns clear a bar | `--wave-docs-chrome-offset`, same value                |
  | `--wave-docs-header-height` set to size the bar               | Nothing sizes a bar. There is no bar                   |
  | `--wave-docs-shell-width` set to cap the shell                | Nothing. `--wave-docs-measure` caps the reading column |
  | `actions` as the client-search escape hatch                   | `search={false}` plus your own `DocsSearch`            |
  | A `rootMargin` you relied on defaulting to `-80px`            | Pass it explicitly                                     |
  | `.wave-docs-layout__header` / `__title` / `__actions`         | Not rendered                                           |
  | `.wave-docs-layout__sidebar > .wave-docs-sidebar`             | The tree is a grandchild now                           |

  ⚠️ `--wave-docs-header-height` DID TWO JOBS AND ONLY ONE SURVIVES. It sized the
  header, and it was the offset both sticky columns parked below. Nothing of this
  package's sits above the content any more, so the sizing job is gone; the offset
  job is `--wave-docs-chrome-offset`, and a host with their own fixed bar still
  needs to set it or the sidebar and the table of contents park underneath it.

  ⚠️ `--wave-docs-chrome-offset` DEFAULTS TO `0rem`, WITH A UNIT, AND THE UNIT IS
  LOAD-BEARING. It is read inside `calc(100dvh - …)`, where a unitless `0` is
  invalid at computed-value time — the height on the sidebar and the `max-height`
  on the table of contents would die rather than resolve to no change.

  ⚠️ `--wave-docs-shell-width` IS GONE RATHER THAN RENAMED. It capped the whole
  shell and centred it, which pushed the sidebar's inline start 480px in from the
  screen on a 2560px display — and left a _closed_ navigation parked in the
  centring margin instead of off the page. The sidebar owns the page's inline
  start edge at every width now, which is what makes "closed" mean off the screen
  by construction, and the reading column is what is capped.

  `DocsToc`'s `rootMargin` default changes from `'-80px 0px -60% 0px'` to
  `'0px 0px -60% 0px'`. The 80px reserved room for a sticky header that is no
  longer rendered; a host whose own chrome overlays the content passes the prop.

  `DocsLayoutProps` is three props — `children`, `search` and `labels`.

  Two behaviours are lost with the drawer and are worth knowing: the navigation no
  longer opens before hydration (it was a server-rendered
  `<button command="show-modal">`), and the client bundle grows about 500 bytes
  for the containment work `<dialog>` used to give for free.

### Patch Changes

- 1313e77: The shell no longer depends on the host shipping a CSS reset.

  ⚠️ `box-sizing` WAS THE HOST'S TO SET, AND ALMOST EVERY HOST SETS IT.
  `.wave-docs-sidebar__link` is `width: 100%` with `0.5rem` of inline padding, so
  under `content-box` it is a 272px box in a 256px track — and the external-link
  icon that `justify-content: space-between` pins to the far end renders 8px
  outside the sidebar, clipped in half. Tailwind's preflight and every
  normalize-style reset declare `border-box` globally, so this was invisible in
  every project that has one, and visible on the only site here that ships no CSS
  at all. `box-sizing: border-box` now applies to elements carrying a
  `wave-docs-` class, scoped to this package's own namespace rather than to `*`,
  because the prose renders a consumer's components too.

  Three README claims were wrong and are corrected: `react/*` is ten subpaths and
  not nine, three modules import from `next/*` and not two, and the twenty-two
  chrome labels break down into six groups rather than the five that summed to
  nineteen.

## 0.6.0

### Minor Changes

- 633f274: **Anchors are checked now.** A route was verified and its fragment thrown away, so `[setup](./install.md#setup)` built green with no `#setup` anywhere on the page. It is the more common of the two link failures — headings get renamed constantly and nothing renames the links into them — and it went unchecked while the rarer one did not.

  `onBrokenAnchors` defaults to `'throw'`, and the error names the heading you probably meant:

  ```
  @waveso/docs: guide.md:12 links to '#instalation', and this page has no
  '#instalation'. Did you mean 'installation'?
  ```

  Checked against every `id` in the rendered page, not against the table of contents — which captures `h2`–`h3` only, so a link to an `h4` is fine, and so is a link to an id one of your `rehypePlugins` added. Same-page anchors are checked as each page renders, so those errors carry a line number; cross-page anchors need the target's ids and are checked by `docs.renderAll()`, which runs in every build that serves search.

  **`onUnverifiableLinks` is replaced by `externalRoutes`, and the default flipped.** It shipped in no release, so nothing to migrate.

  The old option asked you to reason about _our_ inability to verify a link. The new one asks for a fact about _your_ application, which is the thing you actually know:

  ```ts
  createDocsRoute({
    basePath: "/",
    externalRoutes: ["/login", "/dashboard", "/api/"],
  });
  ```

  And absolute links at a root mount are now checked by default rather than ignored. A root mount is what you choose when the origin serves documentation and nothing else — `docs.example.com` — so an unknown absolute link there is a typo, and silence was the wrong default. A site that serves something else names what is its own; `/api` covers `/api/keys` and not `/apiary`.

  That also removes the `'warn'` level that made no sense: warning on every legitimate route in your application is not a diagnostic.

  **New error code `broken-anchor`**, documented in the troubleshooting table and offered in the bug form.

- b6edd50: **New subpath `@waveso/docs/react/next-link`, exporting `DocsLink`** — `next/link` already adapted, so composing a shell by hand no longer needs a cast.

  Passing `next/link` straight into `DocsSidebar` does not type-check under `exactOptionalPropertyTypes`: Next's `LinkProps` re-declares `onClick?`, `onMouseEnter?` and `onTouchStart?` _without_ `| undefined` while React's anchor props include it, so the two declaration files disagree over three props `next/link` accepts perfectly well at run time. It is a disagreement between dependencies, true of every `next/link` call site in a project with that flag on, and nothing the shape of `DocsLinkProps` can fix without breaking the plain-`<a>` fallback that keeps these components host-agnostic.

  `docs.Layout` and `DocsSearch` have always absorbed it internally, so it only bit someone building their own shell — who was told in Troubleshooting to write `Link={Link as DocsLinkComponent}` and wait for a Next-wired component to ship. This is that component; the cast is retired and the note now shows the import.

  ```tsx
  "use client";
  import { DocsLink } from "@waveso/docs/react/next-link";
  import { DocsSidebar } from "@waveso/docs/react/sidebar";

  <DocsSidebar nav={nav} pathname={pathname} Link={DocsLink} />;
  ```

  It carries `'use client'` — not for a hook, there is none, but because `DocsLink` is a function and a function cannot be handed from a Server Component to a Client one. Without the directive it would be a server reference and `next build` would refuse it, which is the same boundary this release fixed for MiniSearch options.

  The private adapter factory it is built from is renamed `link-adapter.ts`, so the two are not one letter apart in the same directory. 180 bytes gzipped, with a 300-byte budget: it should stay the thinnest thing this package ships to a browser.

- 1fa4317: **Link checking has severity levels, and broken links now say what you probably meant.**

  **BREAKING: `assertLinks: boolean` is replaced by `onBrokenLinks: 'throw' | 'warn' | 'ignore'`**, defaulting to `'throw'`. `assertLinks: false` becomes `onBrokenLinks: 'ignore'`; `assertLinks: true` was the default and can be dropped. The shape follows Docusaurus's `onBrokenLinks` for the same reason it exists there: the tool cannot know how much a given site cares, and guessing produces either a build that fails on somebody's legitimate URL or one that ships a dead link quietly.

  **Broken-link errors now offer the closest published route** when the link looks like a typo of one:

  ```
  @waveso/docs: guide.md:12 links to './instalation.md', which resolves to
  '/docs/instalation' — no such page exists. Did you mean '/docs/installation'?
  ```

  A typo is a near-miss by construction, which is what makes the suggestion safe to offer _and_ safe to withhold — the same trick `git`, `tsc`, `cargo` and Python 3.12 use. It decorates an error that was already being raised; it never decides whether to raise one. `/docs/instructions` is five edits from `/docs/installation` — a different word, not a typo — and gets no suggestion, because sending an author to rename a correct link is worse than saying nothing.

  **New `onUnverifiableLinks`, defaulting to `'ignore'`, closes the root-mount gap.** To check `[x](/setup)` the package must first know it is a documentation link. Under `basePath: '/docs'` the prefix says so. Under `basePath: '/'` there is no prefix — `/setup` may be a page of yours, `/login` almost certainly is — so until now those links were dropped unrecorded and a typo in one shipped silently.

  They are recorded and marked now, and the site decides:

  ```ts
  createDocsRoute({
    contentDir: "content/docs",
    basePath: "/",
    onUnverifiableLinks: "throw", // this domain is documentation and nothing else
  });
  ```

  The default stays `'ignore'` because a root mount inside a larger application genuinely cannot distinguish the two, and failing that build would be wrong. Relative links (`./other.md`) are resolved against the content tree, so they are verifiable at every mount and always governed by `onBrokenLinks`.

  `docs.wave.so` runs with `onUnverifiableLinks: 'throw'`, which is the configuration this option was written for.

### Patch Changes

- 102d6ae: **The README shows the live site instead of screenshots.** Three PNGs, a Playwright script to shoot them, a pinned tag and two tests to keep the pin honest — replaced by a link to [docs.wave.so](https://docs.wave.so), which is this package's documentation built with this package.

  The screenshots were a photograph of the harness. The site _is_ the harness: the same `site/` that CI builds on every commit, whose acceptance test forbids it a single line of layout CSS of its own. A reader who wants to know what the shell looks like can now use it — open the search, resize to a phone, tab through the drawer — instead of looking at a picture of it taken on somebody's Mac.

  It also removes a whole class of staleness. A pinned screenshot is wrong the moment the shell changes and right only if someone remembers to re-shoot and re-pin; the last one was pinned to `v0.3.0` while the images had been regenerated for 0.4.0, so npm showed a search dialog the release had already replaced. A URL cannot go stale.

  `pnpm shoot` is gone. The regression it was meant to catch — a stylesheet change reflowing the shell — is the browser tier's, which asserts geometry rather than pixels and runs in the same Chromium everywhere.

- e2bbaf4: **docs.wave.so serves the documentation at its root**, so a page is `docs.wave.so/installation` rather than `docs.wave.so/docs/installation` — a host called `docs` should not say it twice.

  Nothing in the package changed: `basePath` has always taken any prefix, and `'/'` is one of them. The default is still `/docs`, defined in one place, and every consumer gets it unless they say otherwise.

  What did change is which configuration the harnesses cover. `smoke/` builds on the default `/docs` in both output modes on every CI run, so moving the site to the root mount loses nothing and covers the half that was thin: an empty base path is a distinct code path in `toHref`, `toRoute` and `isInternalAbsoluteLink`, and two unit assertions used to be all of it. The two harnesses now cover both mount points and both documented layout shapes — smoke keeps the README's one-line `export default docs.Layout`, the site composes `<docs.Layout>` inside a root layout.

  **One behaviour differs at the root mount, and it is worth knowing.** With an empty base, an absolute link like `/installation` cannot be told apart from any other route in the application, so it is not checked against the published routes — under `/docs`, a typo in `/docs/instalation` fails the build; at the root it does not. Relative markdown links, which is what documentation should be written with, are unaffected.

## 0.5.0

### Minor Changes

- 0d61f5d: **The content scan no longer opens every markdown file at once.** It failed on exactly the large documentation sets this package exists for, and it got worse as a site grew.

  `scanDir` read its own pages with a bare `Promise.all` _and_ recursed into its subdirectories with another, so the number of `readFile` calls in flight equalled the page count of the whole tree. Reproduced on a 1,201-page corpus at the 1,024-descriptor soft limit every Linux and CI image ships with: `next build` died with

  ```
  Error: EMFILE: too many open files, open '<contentDir>/s33/p0829.md'
  ```

  — no error code, no mention that this was the docs scan, and a filename out of a thousand that sends the author to inspect a page which is perfectly fine.

  **Every filesystem call in the scan now goes through one process-wide semaphore**, bounded at 64. Process-wide rather than per-scan because descriptors are a process resource: two routes scanning two content directories would each stay under a per-scan bound and together exceed the only one that matters. The bound is on the leaf calls — `readFile`, `readdir`, `stat`, `realpath` — and deliberately not on the recursion, which would deadlock the moment every slot were held by a directory waiting for a slot to read its children.

  **64 is chosen for the tightest descriptor limit, not for speed.** Measured over those 1,201 pages in 49 directories, nine runs, medians: **88 ms ungated, 106 ms at a bound of 16, 102 ms at 64, 101 ms at 128 and at 256.** Flat from 64 upwards — so the ~14 ms is the gate's own per-call overhead, not lost parallelism, and there is no speed to buy above 64. libuv's filesystem pool is four threads by default, so there was never 1,201-way parallelism there to lose. 14 ms sits against a build that highlights those same pages with Shiki, which is three orders of magnitude more.

  **New error code `descriptor-limit`**, for when the limit is lower than the bound or something else in the process has the descriptors. It says which content directory was being scanned, that the scan holds at most 64 open, and that the fix is `ulimit -n` rather than a smaller corpus — the opposite of what a reader concludes from an error naming one of their own pages. Documented in the troubleshooting table and offered in the bug form.

  The regression test asserts the invariant rather than the number: peak concurrent filesystem calls during a 300-page scan across 30 directories, which had 300 in flight before and has a fixed ceiling now however large the corpus.

- 6c244e5: **The mobile drawer now opens on the page you are reading.** Scroll-the-current-item-into-view had never run on a phone — not intermittently, never.

  Below 64rem the sidebar lives inside `<dialog class="wave-docs-layout__drawer">`, which the UA stylesheet keeps at `display: none` until `showModal()`, wrapped in a `.wave-docs-layout__sidebar` that is `display: contents`. An element in a `display: none` subtree generates no boxes at all, so both report `scrollHeight === clientHeight === 0` and the walk for a scrollable ancestor went past the drawer, past the grid, and returned `null`.

  The timing is what made it unreachable rather than merely unreliable: the effect was keyed on `pathname` alone, and `DocsNav` closes the drawer on every `pathname` change — so at the one moment it could fire, the drawer was always shut, and nothing re-ran when the reader opened it. Measured in Chromium at 390×800 on a 60-item nav: the active item's bottom edge sat at **1594px in an 800px drawer**, 794px below the fold, on the one navigation where the reader knows exactly what they asked for.

  `DocsSidebar` now also positions itself when a `<dialog>` around it opens. It finds that dialog with `closest('dialog')` rather than taking a prop from `DocsNav`, because the condition is "I am inside something that can be hidden and revealed" rather than "I am inside the drawer" — so a consumer who puts `DocsSidebar` in a dialog of their own gets the same behaviour, and nothing in the sidebar has to know what the drawer is.

  **Size budgets raised deliberately:** `sidebar` 1.8 → 1.9 KB, `nav` 2.2 → 2.25 KB, `next-nav` 2.25 → 2.34 KB. The cost is one `toggle` listener; the sidebar was sitting at exactly 100% of its old budget, which is a CI failure waiting for the next byte rather than a limit doing any work.

  **Why no other tier could see it:** jsdom has no layout and no `showModal`, and the stylesheet read as text says nothing about what `display: contents` does to a scrollport. The new tests assert the premise first — that the item measures zero height while the drawer is closed — so they cannot quietly degrade into tests that pass by measuring nothing.

- f2ad4f4: **Every string this package renders is now yours to set.** `DocsLayoutProps.labels` documented itself as "the whole of what a non-English site has to say" and reached four strings of twenty-two.

  Verified in this repository's own `site/out`, which is how it was found: a site built exactly the documented way shipped `<nav aria-label="On this page">`, a visible `Back to top`, `aria-label="Tip"` on every callout, `aria-label="Table"` on every wide table, `Copy code` on every fence, `(opens in a new tab)` after every external link, `Expand <group>` on every sidebar disclosure, and `Play video` on every embed — in English, whatever language the site was written in. The copy runtime announced `Copied to the clipboard.` to a screen reader, in English, on every site on earth.

  **`createDocsRoute({ labels })` is where they live now**, because they are not rendered in one place and a layout prop could never have reached them:

  | where                                                    | strings | cost to override              |
  | -------------------------------------------------------- | ------- | ----------------------------- |
  | the shell                                                | 4       | none, server-rendered         |
  | the navigation tree                                      | 3       | crosses to a client component |
  | the table of contents                                    | 2       | crosses to a client component |
  | your content — callouts, tables, external links, YouTube | 9       | none, server-rendered         |
  | code frames                                              | 2       | none, baked in at build time  |
  | the copy runtime                                         | 2       | crosses to a client component |

  `docs.Layout`'s `labels` prop still exists and now overrides the route's **key by key**, for a site with two shells or a section in another language — a whole-object override would mean naming one string cost you the other twenty-one.

  `{title}` is a placeholder in the five strings that interpolate a name, rather than a function: three of them cross a Server → Client boundary where a function cannot go, and a translator has to be able to move the name within the sentence, which concatenation forbids.

  **`rehypeCodeFrame` has taken a `copyLabel` since it was written and nothing ever passed one.** The plugin is private, so the option was unreachable from every entry point while the README said the label was configurable. It is wired now, and joined by `copyCodeFrom` for a titled fence.

  **Sizes moved, and the published figures moved with them.** `sidebar` 1.9 → 2.0 KB, `nav` 2.25 → 2.45, `next-nav` 2.34 → 2.55, `code-runtime` 0.98 → 1.15. The README's cost table now reads 13.5 KB for the quick start, 2.4 KB for navigation and 1.1 KB for the copy runtime. About 200 gzipped bytes for a chrome that can be translated at all.

  **A key that is declared and never wired now fails the suite.** `LABEL_COVERAGE` in `next.test.ts` requires every member of `DocsLabels` to name where it is proven, and fourteen of them are asserted against real rendered markup with sentinel values — a string that cannot occur by accident cannot pass by accident.

- 952e182: **Image sources are now split and percent-decoded, exactly as links have always been.** `foldImageSrc` handed the authored `src` straight to `foldSegments`, so three ordinary spellings broke — and the first is the one GitHub's own editor writes for you.

  - **`![a](./getting%20started.png)`** — drag a file whose name has a space into GitHub's editor and this is what it writes. It reached the `imageResolver` still encoded, so `readFile(path.join('content/docs', src))` — the implementation this README gives — threw `ENOENT` and the build died with `invalid-image` on a file that is plainly on disk and that GitHub renders correctly.
  - **`![a](./diagram.png?v=2)` and `![a](./sprite.svg#icon)`** — the query and the fragment were baked into the filename, so the resolver looked for a file called `diagram.png?v=2`. They are split off before the call now and re-attached to whatever the resolver returns, so the cache-buster survives and `#icon` still selects the symbol inside the sprite. A resolver returning a query or fragment of its own keeps its own, because two `?` in one URL is not a URL.
  - **`![a](./%2E%2E%2Fsecret.png)`** — folded without decoding, that is one segment with no slash in it, so the climb check never fired. `ImageResolver`'s contract promises the path is contained; any resolver that decodes — anything building a `URL` — was outside it. `foldSegments` can only refuse a `../` that is spelled as one, which is why decoding happens first.

  **One implementation, in `splitHref`.** Four call sites need the same split-decode-fold-reattach sequence; three had it inline and the fourth had none of it. They now share one.

  **`invalid-image` covers malformed encoding too.** Decoding means the image path can raise `URIError`, and an unwrapped one would reach the build with no code, no file and no line — past the very check that exists to make image failures locatable.

  `ImageResolver`'s docstring now says what its argument is: a file path, decoded, with the query and fragment already removed.

- 791c1c0: **Link errors now name the line the link is on.** Every `broken-link`, `draft-link` and `alias-link` reported a line number offset by the length of the frontmatter block — which is to say, a wrong one, on every page that has frontmatter, which is every page.

  `vfile-matter` with `strip: true` deletes the block from the body, so remark counts `node.position.start.line` from the first line of the _body_. The error prints `relativePath:line`, the exact `file:line` form a terminal and an editor turn into a jump. A page with `title`, `description`, `label` and `order` — four fields and two delimiters — is six lines out:

  ```
  - @waveso/docs: setup.md:4 links to './nowhere.md', which resolves to '/docs/nowhere'
  + @waveso/docs: setup.md:10 links to './nowhere.md', which resolves to '/docs/nowhere'
  ```

  Line 4 is the middle of a block that is no longer there. Locatability is that error's entire job.

  **The fix is padding rather than arithmetic.** `DocFile` carries a new `frontmatterLines`, set by the scan, and the renderer prepends that many newlines to what the parser sees. A blank line produces no markdown node, so it costs nothing in the output — and every position downstream is simply correct, including any a future plugin reports, which an offset applied at the four known throw sites would not be.

  `content` is untouched. It is public, its exact value is pinned by tests, and a consumer measuring it should not have to know about this.

  `frontmatterLines` is optional and treated as `0` when absent, so a host loading content itself — the documented reason `@waveso/docs/render` is an entry point — is unaffected.

  **Why nothing caught it:** the render tests hand the renderer a body they wrote themselves, with no frontmatter and therefore no offset, and the source tests never render. The defect lived in the seam and was invisible from either side; the new tests scan a real file and render it.

- 5117aa4: **The search dialog's props are in the README, and the ones that were missing were the ones the changelog told you to migrate to.** A consumer on 0.3.0 with `<DocsSearch maxResults={20} />` upgraded to 0.4.0, watched TypeScript reject `maxResults`, opened the file the Stability section calls the definition of public API, searched 57 KB of it for the replacement — and found neither `pageSize` nor `minQueryLength`.

  There is a props table under **Search → The dialog's props** now, and a check that stops the next rename shipping undocumented: `manifest.test.ts` reads every `…Props` interface out of the emitted `.d.ts` and requires each member to be named in the README. It found seven more the moment it was written — `DocsTocProps.rootMargin` and `.topLabel`, `DocsLinkProps.prefetch`, `DocsImageProps.sizes` and `.loading`, and two of my own — all now documented rather than allowlisted.

  **Six of the dialog's strings turned out to be hardcoded English**, which is the same defect this release fixes everywhere else and was hiding behind a prop list that looked complete: `triggerLabel`, `placeholder` and `dialogLabel` were props from the start, so `search={{ … }}` read as _the_ channel for the dialog's words — while every state message was a literal. They are props now: `hintLabel`, `shortQueryLabel`, `loadingLabel`, `errorLabel`, `emptyLabel`, with `{min}` and `{query}` interpolated.

  **And the live region announced "3 results" in English on every site on earth.** `resultCountLabels` is keyed by plural category rather than being a singular and a plural, because most languages are not English — Polish takes four forms, Arabic six. `Intl.PluralRules` picks, using `locale` or the document's own `<html lang>`, and a category you do not list falls back to `other`. An invalid `lang` is caught rather than thrown: that is the site's typo, not a reason to announce nothing.

  **`hotkey` does not exist and never did.** `DocsLayoutProps.search` listed it among the props an object may carry. The shortcut is ⌘K / Ctrl-K and is not configurable; the docstring says so now. `SearchDialogProps.indexUrl` likewise documented itself in terms of `writeSearchIndex`, which was deleted in 0.3.0.

  **Published figure raised:** search dialog and router wiring, 9.0 → 9.3 KB.

- 114eb3d: **`docs.Layout` no longer breaks `next build` when the route tunes MiniSearch with a function.** It has been doing so since 0.3.0, in exactly the case the option's own capitalised warning tells you to use it for.

  `createDocsRoute({ miniSearchOptions })` and `export default docs.Layout` are the two things the quick start tells you to do, and the layout forwards those options to the dialog because it must — MiniSearch reads `tokenize` and `processTerm` when indexing _and_ when querying, so an index built with one and queried with another matches nothing at all and says nothing. But `docs.Layout` is a Server Component and the dialog is a Client Component, and React serialises what crosses between them. So a `processTerm` in that object took the whole build down:

  ```
  Error: Functions cannot be passed directly to Client Components
    {processTerm: function processTerm}
  ```

  Serialisable overrides — `storeFields`, `boost`, anything under `searchOptions` — were unaffected, which is why this survived two releases: every documented example uses those.

  **The fix is a refusal, not a silent drop.** Forwarding the serialisable half and discarding the rest would rebuild the original defect: an index built with a `processTerm` the query does not share is the zero-results-and-no-error failure the forwarding exists to prevent. `docs.Layout` now throws `invalid-config` instead, naming every offending option — `miniSearchOptions.processTerm`, `miniSearchOptions.searchOptions.filter` — and naming the remedy.

  **The remedy is a client boundary of your own**, which is the only place the two halves can share a function by module reference rather than by prop. Keep it on `createDocsRoute` so the index is still built with it, pass `search={false}`, and render the dialog from a `'use client'` module that imports the same function — `README.md` has the three files under **Search → Functions need a client boundary**. `search={false}` deliberately does not throw: it is the supported path, so it must not be the one that fails.

  **TypeScript now says so at the seam.** `DocsLayoutProps['search']` takes the new `SerializableSearchOptions` rather than MiniSearch's full `Options`, so `<docs.Layout search={{ miniSearchOptions: { tokenize } }}>` does not compile. `DocsSearch` and `SearchDialog` are unchanged and still take everything — they are already client components, which is the whole point. The type is the friendlier half of the guard, not the load-bearing one: a JavaScript caller has no types, and an `Omit` list goes stale the minor MiniSearch adds a callback, so the runtime check walks the values structurally and finds a function wherever it is.

  **`DocsLayoutSearchProps` and `SerializableSearchOptions` are now exported from `@waveso/docs/next`.** Both already appeared in `DocsLayoutProps.search`; until now there was no way to spell either one.

  **Why nothing caught it:** the test asserted on `element.props.search` and so never crossed the boundary it was testing. A props assertion is not an RSC test. The smoke build now checks that the forwarded options reach the flight payload — `pnpm test:smoke` reads them back out of the prerendered HTML — because only a real build can prove the allowed half arrives.

### Patch Changes

- a5136d5: **An alias copied out of the address bar was encoded twice.** An alias _is_ a former URL, so `aliases: [getting%20started]` is the ordinary way to write one — and the route builder encoded the `%` again, producing a redirect source of `/docs/getting%2520started` that no request can ever match. The page moved, the alias was written, and the old URL still 404'd.

  It decodes first now, which makes both spellings round-trip: the pasted form decodes and re-encodes to itself, and the readable `c# guide` has nothing to decode and still becomes `c%23%20guide`. The `.`/`..` and redirect-pattern checks moved to the decoded value too — `%2E%2E` is `..` in disguise and `%28` is `(`, so checking the raw text passed exactly the inputs those checks exist to catch.

  **`basePath: '//docs'` pointed the whole site off itself.** A browser reads a leading `//` as scheme-relative, so `//docs/setup` navigates to a host called `docs` — and `basePath` builds every canonical, every `og:url` and every sitemap entry. Runs of slashes collapse now.

- 511ec6f: **Five documentation claims that were not true, and the tests that stop them rotting again.**

  **`pnpm size` now really does gate `prepublishOnly`.** The paragraph introducing the cost table says every figure is enforced "in CI and again in `prepublishOnly`" — the sentence that makes the whole table worth trusting — and the script ran typecheck, lint, test, build, `check:readme` and `check:package`. Nothing verified the published numbers at the one moment they became published. The claim is now true rather than deleted, and a test compares the two.

  **The README no longer claims CI runs `pnpm shoot --check`.** It never has: the gate was added and removed without running once, because byte-compared PNGs cannot survive a change of operating system — the font stack resolves to SF Pro on the machine that shot them and to DejaVu on a Linux runner, so every text pixel differs and no tolerance rescues glyphs that are different shapes. A test now requires the README and `ci.yml` to agree either way.

  **The screenshots are pinned to a tag whose images they actually are.** The pin said `v0.3.0` while the committed PNGs had been regenerated for 0.4.0's search work, so the README on npm showed a dialog the release it documented had replaced. A test compares the committed bytes against `git show <tag>:docs/media/…` — exact, offline, and skipped only in a shallow clone.

  **`src/react/` does not import nothing from `next/*`.** Two modules do, and are named after the fact: `next-nav` for `usePathname` and `next-search` for `useRouter`. The project-structure listing and the Components paragraph both said otherwise.

  **`SECURITY.md` supports `0.5.x`**, not `0.3.x`.

  And two comments in `next.ts` that misdescribed the code they sit on: `layout.tsx` was called a `'use client'` module — it is a Server Component, and its own docstring has always said so — and the lazy import beside it was justified by that non-fact rather than by the real reason, which is that `layout.tsx` statically imports two client modules that reach `next/navigation` and `next/link`.

- b3c0fa6: **`search={{ className }}` no longer deletes the class the header depends on.** It was applied before the spread, so a host passing a class — the ordinary reason to pass `search` an object — replaced `wave-docs-layout__search` instead of adding to it, and the trigger lost its place in the header grid. Adding a class should not remove one.

  **A declining `imageResolver` no longer emits an unusable src.** Returning `undefined` for a relative image wrote the folded path — `guide/diagram.png` — which the browser resolves against the _route_: `/docs/guide` asks for `/docs/guide/diagram.png` and `/docs/guide/setup` asks for `/docs/guide/setup/guide/diagram.png`, from identical markdown, with a green build. That is the precise failure unconditional folding exists to prevent, surviving in the one branch that skipped the check for it. It is the same `invalid-image` as having no resolver at all, because it is the same situation. A _public_ src that a resolver declines still passes through untouched — "leave it as it is" is a complete answer for one of those.

  **`decoding` and `fetchPriority` reach a custom `Image` component.** `createImage` spreads the tree's attributes into whichever component it was given, under a comment saying those two survive into the optimising branch — and `wrapNextImage` destructures a fixed list, so they did not. They are declared members of `DocsImageProps` now, which is the right shape for a component seam; a comment promising an open one was not.

  **An equal theme pair written two ways no longer builds two highlighters.** The cache key was `JSON.stringify({ langs, themes })`, and `JSON.stringify` preserves insertion order — so `{ light, dark }` and `{ dark, light }` produced two keys and two whole Shiki instances, each loading every grammar. `langs` was already sorted for exactly this reason.

  **`@waveso/docs/highlighter` has tests.** It is a public subpath and had none: the escape hatch a consumer reaches for precisely when the defaults do not fit, and the least likely to be exercised by anything else here. Seven now cover the cache identity, both refusals, every default grammar, and the `cfg / `conf aliases the module exists for — which Shiki resolves against a grammar's own alias list rather than against ours, so registering `ini` under a `cfg` key would not have worked and nothing would have said so.

- f97c345: **`meta.json` is now read the way markdown is.** Four ways it was not, and one of them is a security gap.

  **A hand-written nav entry went round the link allowlist.** `{ "title": "Status", "href": "javascript:alert(1)" }` reached `<a href>` through `DocsSidebar` with nothing looking at its scheme — while a `javascript:` link in the markdown beside it was dropped by a check whose own comment calls it load-bearing. Both paths end at the same anchor, so both now use the same allowlist, and it lives in one module rather than two copies. `meta.json` is refused at parse time rather than dropped at render, because the file is authored and a nav entry that silently vanishes is the quietest possible failure.

  **A `mailto:` entry was announced as opening a new tab.** `external` was "has a scheme", so `mailto:` and `tel:` were given `target="_blank"`, an external-link icon and an "(opens in a new tab)" suffix — describing a tab that never appears, to precisely the reader who cannot see that it did not. The markdown path has always drawn the line at http(s); the sidebar does now too. (The test asserting the old behaviour asserted the bug, and said so in its own name.)

  **A UTF-8 BOM failed the build on a character nobody can see.** `readFile(…, 'utf8')` leaves it in and `JSON.parse` refuses it — `Unexpected token ''`, in the file the author is looking straight at. `readPage` learned this for markdown when `gray-matter` was swapped out; this is the same line for the same reason.

  **A name in `meta.json` is matched in NFC**, because the filenames it is matched against are. `source.ts` normalises at the `readdir` boundary — macOS hands back decomposed forms — so a `meta.json` written on a Mac could list `café` and fail with `lists "café", which does not exist`, beside a list of available names containing a visually identical `café`.

- 0670710: **A YouTube link's timestamp and playlist are no longer dropped.** Only the video id survived the substitution, so `https://youtu.be/x?t=754` — a link to one moment in a two-hour talk, which is most of why anyone deep-links a video — opened at zero. And because the facade passes `autoplay=1`, it did not merely start in the wrong place: it started _playing_ there, leaving the reader to work out that the author had meant somewhere else.

  Every spelling YouTube's own share dialog produces is understood — `t=754`, `t=90s`, `t=1m30s`, `t=1h2m3s`, the older `#t=` fragment, and `start=` on an embed URL — along with `list=`.

  Both go into a URL, so both are checked: a playlist id has to look like one, a timestamp has to parse to a positive number of seconds, and the embed URL is built with `URLSearchParams` rather than by concatenation. Hand-built, a crafted `list=x%26autoplay%3D0` would have decoded into a real `&autoplay=0` and silently turned off the one interaction the facade exists to own.

  `YouTube` takes `start` and `list` props to match. `parseYouTubeId` is now `parseYouTubeRef` and returns the whole reference; it is private, so nothing outside the package moves.

## 0.4.0

### Minor Changes

- The search dialog, corrected by using it. Five defects a reader meets and no test could see, and one rename that follows from the largest of them.

  **`maxResults` is now `pageSize`, and it is a window rather than a ceiling.** It capped the list at 20 (8 in 0.2.0): on a _six-page_ site "docs" matches 18, so results were unreachable, and the live region announced the slice as though it were the total — not a smaller truth but a false one.

  The cap was justified by a claim nobody had measured, and measuring it did not support the claim. On a 300-page corpus (2,100 records) a MiniSearch query costs **1.3–3.0 ms**, and rendering _every_ matching row costs **40 ms**, 128 ms at 4× CPU throttle. The search was never the cost; the DOM only becomes one in the thousands.

  So the list pages. Twenty rows render, and another twenty each time the reader scrolls near the end — the DOM stays bounded and nothing is withheld. The keyboard widens the window too, or `aria-activedescendant` points at an option that is not in the DOM. `aria-setsize` carries the real total on every option, because a listbox rendering 20 of 2,100 that says "20 of 20" tells a reader they have reached the end when they have not.

  **Migration:** rename the prop. `maxResults={20}` becomes `pageSize={20}`, and it now means "reveal this many at a time" rather than "never show more than this".

  **The dialog sizes to its results.** It was 32rem tall in every state — measured 514px with no query, 514px with eight results, 514px with none, of which 392px was an empty results area, so a reader typed into a box floating at the top of a large blank rectangle. A flex container defaults to `align-items: stretch`, so the dialog stretched to the viewport and `max-height` capped it at a constant instead of being the ceiling it was written to be. It is content-height now, and starts scrolling at the same 32rem.

  **Hovering a half-visible result no longer yanks the list.** Pointing at a row clipped by the top or bottom edge set the active option, which fired the scroll-into-view meant for the arrow keys: the row snapped flush, the whole list moved under the cursor, and the cursor was then over a different row. Measured as a 28px jump. Only the keyboard scrolls now, and a new result set explicitly returns to the top — which that effect had been doing by accident.

  **Every result row says where it lands, in the same words.** The second line was a breadcrumb of page and heading names, except on a page's own record — whose heading _is_ its page title — which got no second line at all rather than repeat itself. On a six-page site that is six of twenty-nine records, so the list came out ragged and the barest rows said the least: a row reading only "Wave Docs" told a reader nothing about what it opened.

  Every row now shows the page it lands on: the route, without its anchor. The anchor is slugged from the heading printed directly above it, so it spent the line restating line one. The link keeps it, so a hit still deep-links to its section.

  **Breaking in rendered output:** `.wave-docs-search-result-breadcrumb`, `.wave-docs-search-result-crumb` and `.wave-docs-search-result-crumb-separator` are replaced by a single `.wave-docs-search-result-location`, because a breadcrumb it is not. A screen reader still hears the words — a route read aloud is punctuation — so the option's `aria-label` carries "Layout tokens, Styling" while the visible line carries the address.

  **A query is at least two characters**, settable with `minQueryLength`. Measured on this package's own documentation: `a` matches 100% of the corpus, `i` 97%, `s` 93%. One character is not a query, it is a reader halfway through typing one, and answering it with everything teaches them that search returns noise. Below the floor nothing runs — no search, no index request — and the dialog says "Keep typing" rather than sitting there answering nothing.

  Two rather than three, and the difference matters on a docs site: three would refuse `ts`, `js`, `id`, `h1` and `px`, each a real query here and each selective — 10%, 17%, 14%, 3%, 0%. The noise is at one character, so that is where the floor goes.

## 0.3.0

### Minor Changes

- 3ba341f: A docs site is now four files and a folder of markdown. Search works out of the box, there is a real shell with a mobile drawer, and the public surface is frozen. Several changes are breaking; those come first.

  **The page's content is a `main` landmark.** It was an `<article>`, so the shell rendered a banner, a navigation and a complementary and no `main` at all — a screen-reader user navigating by landmark, which is how you skip a hundred-link sidebar without tabbing, had nothing to jump to. **Breaking in rendered output:** a selector or an assertion targeting `article.wave-docs-layout__main` needs to say `main`.

  **`docs.Layout` renders the whole shell**, as one line in your layout file:

  ```tsx
  // app/docs/layout.tsx
  import "@waveso/docs/styles.css";
  import { docs } from "@/lib/docs";

  export default docs.Layout;
  ```

  Skip link, sticky header, sidebar column, mobile drawer and the grid that arranges them. It is a Server Component and your layout stays one — the two pieces that need a client carry their own boundaries inside the package — and it reads the navigation tree and the search index URL itself, so there is nothing to fetch and nothing to pass. It replaces four files every consumer used to write by hand, including a `'use client'` wrapper around `usePathname` that the README shipped as a recipe. Four props: `title`, `actions`, `search`, `children`. `search` takes the dialog's own props as well as a boolean, which is what makes `miniSearchOptions` reachable at all — MiniSearch reads `tokenize` and `processTerm` when indexing _and_ when querying, so an index built with one and queried with another matches nothing, and while `search` was a bare boolean there was no channel for it. The route's own `miniSearchOptions` are forwarded by default, so the object that built the index is the object that queries it without anyone having to know that.

  **There is a mobile navigation drawer**, which there was not before: on a 390px viewport a reader could previously reach exactly one other page. It is one `<dialog closedby="any">` opened by a server-rendered `<button command="show-modal">`, so it works on the first tap — before hydration, and with JavaScript disabled. Focus moves inside and Tab stays there, Escape closes and restores focus, the backdrop dismisses it, and the page behind does not scroll; all of that is the browser's. At 64rem the same element becomes the sticky sidebar column via `display: contents`, so one navigation serves both breakpoints — one landmark, one copy of the links in the payload.

  **`docs.Page` returns two children now**, the `<article>` and the table of contents, rather than one. They land as direct children of the grid, which is what puts them in separate columns. If you wrapped `docs.Page` in an element expecting a single child, that wrapper needs to go. A page with no headings emits no `<aside>` at all rather than an empty one, because the grid reserves that column with `:has()` and would otherwise give 15rem to nothing.

  **The pipeline has plugin slots**, which it did not before — it was frozen end to end, and both apparent escape hatches are useless (`frozen.use()` throws; `frozen().use(p)` appends, so a plugin runs after Shiki and sees token spans where the author's code was):

  ```ts
  createDocsRoute({
    contentDir: "content/docs",
    remarkPlugins: [remarkMath],
    rehypePlugins: [rehypeKatex],
  });
  ```

  `remarkPlugins` run before link resolution, so what they emit is folded, contained and asserted exactly like authored markdown. `rehypePlugins` run after heading ids exist and before Shiki, so a fence is still the author's text. **The table of contents is now captured last**, after your plugins and everything else, so it describes the same document the search index does — a plugin that adds or removes a heading changes both together, and there is no validation pass because there is nothing left to validate.

  **Every size and speed claim is now measured and budgeted — including the README's own table.** The figures there are ceilings rather than snapshots, and `pnpm size` fails when a measurement passes one, when one promises better than `size-budget.json` enforces, or when a row goes missing. That axis exists because the table had already rotted: it published the sidebar at 1.24 KB against a real 1.67 KB, and a budget raised two commits earlier, under a sentence promising every number was one a build fails over.

  `pnpm size` runs in CI and in `prepublishOnly` across three axes — client bytes per `'use client'` entry, hast-over-the-wire against HTML as a brotli ratio, and highlighting cost against the same corpus unhighlighted. A "What it costs" table sits above the quick start with a budget entry behind every figure. Three numbers in the tree were wrong and are fixed by measuring rather than by picking a side: positions are 33% of the JSON, not the 38% one comment claimed or the 44% the README claimed, and the documented Node floor was 20.19.0 against a real floor of 22.12.0.

  **The shell is translatable.** `docs.Layout` takes a `labels` object with the four strings it renders itself — the navigation landmark's name, the drawer's open and close buttons, the skip link — each falling back on its own, so a partial map is not a half-English shell. `DocsNav` had declared `label` and `closeLabel` props, documented them and defaulted them, while the layout that is the only thing rendering it passed neither and `DocsLayoutProps` had no way to say them: configuration that could not be configured.

  **Two rendering defects that only a screenshot could find.** A code frame's title bar drops its bottom border to join the code below it, and a `<pre>`'s user-agent margin then pushed the two 14px apart — a caption hovering over a gap, and a copy button mis-seated on untitled fences. And the shell painted its own containers but not the grid between them, so in dark mode the sidebar and the table of contents rendered as lighter panels floating on a darker page; light mode hid it because both were white. Both are fixed, both are now pinned by browser tests, and the README carries screenshots taken from a real build so the next one is visible in review.

  **Smaller repairs a reader would notice.** The video facade asks the player to start, so watching a video is one click rather than two — it is still not an autoplaying embed, because the iframe does not exist until the `<details>` opens. A failed copy now _looks_ failed: `data-copied="false"` was written from the beginning and had no rule in the stylesheet, so a screen-reader user was told and a sighted user watched a button do nothing, on the ordinary path of `next dev` opened from a phone over http. The table's horizontal-scroll shadow was hardcoded black and therefore invisible in dark mode. An excluded fence had no `tabindex`, making it the one code block on a page a keyboard could not scroll sideways.

  **The sidebar scrolls the current page into view** — properly. The first version measured the item with `offsetTop - port.offsetTop`, and the navigation column is `position: sticky`, which makes it the `offsetParent`: the offset was already relative to it, so the subtraction removed the header height twice and parked the current page below the fold. Measured in Chromium and fixed with rectangles, and a browser test now asserts the item is inside the visible box rather than that something scrolled. A back-to-top link ends the table of contents. Both move focus rather than only the viewport, and neither uses `scrollIntoView` — which scrolls every scrollable ancestor including the document, so it would jump the article a reader just navigated to. External links in the navigation carry a small icon.

  **Errors are branchable, at `@waveso/docs/errors`.** Every failure already carried a `code` from a 19-member union, and the module documenting that taxonomy also declared itself private — so there was no supported way to use it, and nothing in the README mentioned it. `DocsErrorCode`, `DocsError` and `isDocsError` are exported now, with a troubleshooting table carrying one row per code, and a test that keeps the union, the table and the call sites in step.

  **The YouTube embed ships no JavaScript, and the default component map is now provably server-only.** It was a `'use client'` component mapped unconditionally, so every page of every consumer carried a reference to it whether or not it embedded a video. It is a `<details>` with a lazy iframe now — measured: a closed one issues no request, an open one does — which keeps the click-to-load facade, gains native keyboard support, and removes the hydration root. `src/server-boundary.test.ts` fails the build if anything reachable from the markdown map ever carries the directive again. **Breaking in rendered output:** the facade is a `<details>`/`<summary>` rather than a `<button>`, so styles or assertions targeting the button change with it. The open state hides that summary, which cost the keyboard reader their focus indicator entirely — it comes back on `:focus-visible` as a real control, and its label reads "Hide video" once activating it would hide the video.

  **Sidebar links near the reader prefetch now.** Every link carried `prefetch={false}`, on Pages-Router reasoning that does not hold in the App Router — there it disables the hover and touch paths as well as the viewport one, so the most-clicked control in a docs site made every navigation a cold round-trip. The list holding the current page and the heading of the group around it are warm; the rest of the tree stays off.

  **The table of contents stops at `h3`.** Measured on a synthetic API reference — 8 methods, 3 overloads, 3 subsections each — capturing h2–h6 gave 104 entries against 32. Deeper headings keep their ids and permalinks, so they are still deep-linkable and still open their own sections in search; only the rail entry is dropped. If you want them back, `rehypePlugins` is the escape hatch. **`RenderedDoc.toc` therefore contains less data than before** — if you render it yourself and relied on h4+, that is the change.

  **`gray-matter` is gone**, replaced by `vfile-matter`. It did a bare `require('fs')` for a method this package never calls — the only gratuitous Node requirement in the whole tree — dragged a second copy of js-yaml, and memoised every file body it ever saw in a cache that is never evicted. Frontmatter parsing is unchanged in behaviour, including the UTF-8 BOM, which this package now strips itself.

  **Runtime requirements are documented and asserted.** `render`, `frontmatter`, `highlighter`, `search-index` and the React layer require **no Node builtins at all** — the markdown pipeline runs wherever JavaScript does, and Shiki is loaded through its JavaScript regex engine rather than WASM deliberately. `source` needs `node:fs/promises` and `node:path`; `next` adds `node:crypto`. Every one of those is asserted as an exact set, so a new builtin three modules deep fails CI instead of silently ruling out a runtime.

  **Code blocks have a frame, a title bar and a copy button**, which they did not before — a live render was a bare `<pre>` with no wrapper and no control of any kind:

  ````md
  ```ts title="app/page.tsx"
  export default function Page() {}
  ```
  ````

  The title becomes the caption, the button's accessible name (`Copy code from app/page.tsx`, not eight controls called "Copy code"), and a search hit. Anything else in the meta string passes through to Shiki untouched, so `{1,3-5}` keeps working when transformers land; a `title=` without double quotes now fails the build naming the document, rather than silently truncating at the first space. Copy is **one delegated listener for the page**, mounted by `DocContent` and only when the page has a fence — not a client component per code block — and the button is `visibility: hidden` until that listener attaches, so a reader with JavaScript off sees no button and finds no dead tab stop.

  **`excludeLangs` stops shipping as half a feature.** An excluded fence had no background, border, padding or horizontal scroll anywhere in the stylesheet, so it rendered as UA-default text bleeding out of the reading column. It now gets the same surface as a highlighted block, is deliberately left unframed, and the README carries the Mermaid recipe — including the trap that its `<code>` className is an array where Shiki's is a string.

  **`DocContent` now carries `wave-docs-prose` itself.** Nearly every rule in the stylesheet is scoped under that class, and the hand-rolled route in the README made you type it; forgetting it left a page whose code blocks kept their syntax colours and lost everything else. If you were putting the class on your own `<article>`, drop it — it is emitted once, by the component.

  **Search is on by default, and the quick start includes its route.** `docs.Layout` renders the trigger, so leaving the route file out gave a reader a control that opened onto "Search is unavailable" — a broken box on the flagship path, under a release note promising search out of the box. The route is one of the three files in the quick start now, and a 404 on the index no longer reads as a transient failure: it names the file to create.

  **Search is two files now, and neither is a build script.** The index is a prerendered route handler on the object you already hold, so it is rebuilt by the same `next build` that builds your pages — and in `next dev` it re-reads the disk per request, so a page you add is searchable on the next keystroke instead of at the next time you remember to run a script:

  ```ts
  // app/docs/search-index.json/route.ts — the whole file
  import { docs } from "@/lib/docs";

  export const GET = docs.searchIndex;
  export const dynamic = "force-static";
  ```

  `docs.searchIndexUrl` is derived from your `basePath`, so it is right at `/`, at `/docs`, and under a nested prefix. **`writeSearchIndex` is removed** — it was the only documented way to build an index, and this replaces it; `buildSearchIndex` and `renderAll()` remain for an artifact the route cannot express, and `docs.searchIndex` is asserted byte-identical to them. Verified against a real `next build`: the body prerenders in both output modes and is byte-identical between them, response headers survive into the prerender manifest, and CI now runs that build on every pull request.

  **`export const dynamic = 'force-static'` is not optional, and the handler enforces it.** Without it Next re-renders your entire corpus per request, from markdown that output tracing did not put in the deployment bundle — on a serverless host that throws, at the reader, inside the search dialog, and the build prints no warning. It now fails loudly with `code: 'search-index-dynamic'`, naming the file to edit.

  **`DocsSearch`, at `@waveso/docs/react/next-search`**, is the `'use client'` wrapper around `useRouter()` and `next/link` that every consumer was writing by hand — and skipping `Link` silently cost hover prefetching on every result. `SearchDialog` is unchanged and still host-agnostic.

  **`SearchDialog`'s `searchOptions` prop is now `miniSearchOptions`**, and `createDocsRoute` takes the same name for the same object. MiniSearch's own name for the query defaults is `searchOptions`, so the old prop produced `searchOptions={{ searchOptions: { fuzzy: 0.1 } }}` — a stutter nobody writes, which is why both README examples were written flat, did not compile, and would not have errored at runtime either.

  **Your project is no longer traced into your server bundle.** `contentDir` is a string this package cannot resolve statically, so Turbopack fell back to tracing the whole project — every source file, your entire `public/` folder, your last build's output — into the server output for every docs route. Measured at 332 traced files for a three-page site, of which 39 were the project's own. Nothing here reads markdown at request time, so nothing needs tracing, and now nothing is.

  **Six names are gone**, all pre-1.0. Three are subpaths: the `./react/*` wildcard is enumerated as explicit subpaths, and `./markdown-links` and `./search-options` are no longer exported. Three are options and exports that changed shape, and each needs an edit rather than a rename:

  | Gone                                                                                | What to do                                                                                                                                                                                                                                                                                              |
  | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `createDocsRoute({ contentId })`                                                    | Nothing. The main element always carries `id="docs-content"`, which is what `SkipLink` targets by default. The option could point the skip link at nothing, silently, because `SkipLink` had no matching option to follow it with                                                                       |
  | `createDocsRoute({ rescanPerRequest })` · `createDocsSitemap({ rescanPerRequest })` | Nothing, if you left it at its default: the content directory is re-scanned per request outside `NODE_ENV=production`, exactly as before. **If you set it to `false`, delete it and measure** — you will now pay a scan per non-production request, and `docs.source.invalidate()` is the explicit tool |
  | `toAliasRoute` from `@waveso/docs/source`                                           | Private. It is one line of string handling and was never documented                                                                                                                                                                                                                                     |

  Every subpath in `exports` is listed in the README, and so is every runtime name each one exports — `manifest.test.ts` enumerates both against the built output and fails the build on a name this README does not mention. That test is new in this release, and writing it immediately found five: `DOCS_ERROR_PREFIX`, `DEFAULT_DOCS_THEMES`, `CALLOUT_TYPES`, `defaultMarkdownComponents` and `DOCS_CONTENT_ID` were all public and documented nowhere.

  **The default page is worth looking at.** A 46rem measure and a system font stack, a 1.2 minor-third type scale, tables that scroll instead of shredding the layout, one focus `outline` in place of five `box-shadow` rings (which also deletes the forced-colors block that existed to patch them), and a responsive shell with breakpoints at 64/80/100rem. The element tree, the five layout tokens and the breakpoints are frozen.

  **Three new harnesses, because the old ones could not see these failures.** A browser tier running real Chromium — jsdom reports every width as `0`, so the measure, the type scale, reflow and the table floor were unassertable. A smoke build of a real Next application against the published `exports` map, in both output modes. And `pnpm check:readme`, which type-checks every example in this README as one project: it immediately found `app/docs/layout.tsx` defined twice with different bodies, and an `imageResolver` example calling `imageSize(path)` when `image-size` v2 takes a `Uint8Array`.

## 0.2.0

### Minor Changes

- 7fefb08: Fix 38 defects found in a pre-publish review. Several are behaviour changes; the ones you can notice are listed first.

  **Dark mode is now opt-in.** The tokens used to switch on `prefers-color-scheme` alone, but the stylesheet styles the docs subtree rather than the page — so a light-only site with a `/docs` section served near-white text on the host's white background (1.23:1) to every visitor whose OS was in dark mode. Dark now requires `data-theme="dark"` or `class="dark"` on `<html>`; `data-theme="system"` opts back into following the OS. `color-scheme` is declared, so native scrollbars and form controls match.

  **The `tailwindcss` peer dependency is gone.** Nothing in the package used Tailwind, and declaring it blocked `npm install` outright for any project on Tailwind 3 — npm range-checks an optional peer that happens to be installed. The `@source "./"` directive is gone with it; it was injecting 14 unrequested utilities into every Tailwind consumer's CSS.

  **`zod` is a dependency now, not a peer**, for the same reason and a larger one: it is imported at module scope, and as a peer its `^4.4.3` range refused to install beside roughly 69% of the Zod in the ecosystem — 47% still on 3.x, plus every 4.x below 4.4.3. Your project's Zod is now irrelevant. `z` is re-exported from `@waveso/docs/frontmatter`, so extending `docFrontmatterSchema` needs no install and cannot pick up a second copy.

  **Search indexes the full text of a section.** It previously truncated to 300 characters _before_ indexing, dropping ~80% of a normal corpus, and stored none of it for display either. Tokenisation now uses `Intl.Segmenter`, so CJK text is searchable at all — it previously returned zero hits. Both `buildSearchIndex` and `SearchDialog` accept MiniSearch overrides.

  **Aliases are validated.** `aliases: ['v1:beta']` used to compile to a Next redirect _wildcard_: the build passed, then `/docs/v1-guide` — a real prerendered page — was permanently 308'd away. Metacharacters, relative segments and empty entries are now rejected when the page is read, naming the file. Linking to an alias also fails the build now, naming the page to link instead: an alias is never prerendered, so it was a green build and a hard 404.

  **Relative images fail the build instead of shipping a broken `src`.** Nothing ever rewrote them, so the browser resolved them against the route and identical markdown requested a different file from every page. Absolute and external sources are unaffected.

  **A custom `frontmatterSchema` can no longer drop the package's own fields.** All six — `title`, `description`, `label`, `draft`, `aliases`, `order` — are parsed from the raw YAML and laid back over your schema's output, so a custom schema can only ever _add_. A bare `z.object({ title, … })` type-checks but used to strip `draft` and `aliases`, publishing every draft, submitting them to Google, and returning no redirects. The price is that a `.default()`, `.transform()` or `.coerce` aimed at one of the six is not honoured: the YAML wins.

  **Links to unusual URL schemes are dropped rather than rendered.** `javascript:`, `data:` and `vbscript:` never reach an `href` — including the obfuscated spellings a browser still navigates. The allowlist is GitHub's (`http`, `https`, `mailto`, `tel`, `sms`, `ftp`, `ftps`, `irc`, `ircs`, `xmpp`, `news`, `nntp`, `feed`, `git`, `matrix`); anything else keeps its text, loses its destination, and warns outside production.

  **Absolute internal links are respelled before they are checked.** `/docs/café` and `/docs/caf%C3%A9` are the same page, and only the encoded form used to match — so the human-readable spelling every editor produces failed the build with "no such page exists" for a page that plainly exists.

  Also fixed: `siteUrl` with a path silently truncated out of every canonical and the whole sitemap; ` ```JSON `/` ```Bash ` shipping unhighlighted; the search dialog's focus trap breaking on a click, its Close button navigating on Enter, and IME composition being consumed as "open result"; the search index cached forever against the first `indexUrl`; every focus indicator vanishing under Windows High Contrast; long tokens forcing horizontal scroll at 320px; a `draft: true` index page publishing its title as a public sidebar heading; symlinked and `.MD` files vanishing silently; percent-encoded and NFD filenames failing to resolve; `writeSearchIndex` truncating the served file in place; the TOC scrollspy dying permanently when headings mount late; YouTube re-stealing focus on every re-render; markdown images ignoring an author's `loading`; Shiki splicing an invalid `root` node into the tree; `renderAll` running unbounded; and `docs.source.nav()` being one request stale in dev while every page view scanned the filesystem twice over.

  Every failure now throws with a `code` (`'broken-link'`, `'invalid-alias'`, `'invalid-frontmatter'`, …) and a message naming this package, so a host can branch on the kind of failure instead of matching message text. Where an underlying parser failed — js-yaml on frontmatter, `JSON.parse` on `meta.json` — its own error is attached as `cause`.

  ### API changes

  - `extractSearchRecords(doc)` takes no options; `ExtractSearchRecordsOptions` and `excerptLength` are gone, since full section text is now indexed.
  - `SearchRecord.id` is a slug (`page#anchor`), not an `href` — an href embedded `basePath`, so moving a site from `/docs` to `/reference` changed the identity of every record.
  - `buildSearchIndex(records, options?)` and `<SearchDialog searchOptions={…}>` accept MiniSearch overrides. They must agree.
  - `DocsSource.drafts()` is new, and `DocsRouteOptions` gains `excludeLangs`, which existed on the renderer and was reachable from nothing.
  - Optional properties across the public option types are now spelled `?: T | undefined`, so a consumer with `exactOptionalPropertyTypes` can pass a possibly-undefined value — `siteUrl: process.env.SITE_URL` was previously a compile error.
  - The CSS custom property `--wave-docs-header-height` is now `--wave-docs-scroll-padding`, which is what it actually controls.
  - `engines.node` is `>=22.12.0`. Node 20 reached end of life in April 2026.

## 0.1.0

### Minor Changes

- adddaea: Initial release.

  Markdown documentation for Next.js, from one content directory and one pipeline.
  Markdown becomes hast in Node at build time, so the browser receives a tree of
  nodes and a component map — never `unified`, `remark-parse` or Shiki.

  - `createDocsRoute` wires a content directory to an App Router catch-all, with
    `dynamicParams: false`, a real index route, awaited `params` and a canonical
    URL on every page.
  - Frontmatter is extensible through `frontmatterSchema`, typed as a
    [Standard Schema](https://standardschema.dev) so Zod, Valibot and ArkType all
    work and your fields are inferred with no type argument.
  - Internal `.md` links are rewritten to routes and their targets checked, so a
    link that works on GitHub cannot 404 once published.
  - Table-of-contents ids come from the same `rehype-slug` pass that annotates the
    document, so anchors match by construction rather than by a second parse.
  - GitHub alert syntax, a click-to-load YouTube facade, section-scoped MiniSearch
    records, a sidebar, a scrollspy TOC, a search dialog and a themeable
    stylesheet.

- ed73890: Retheming now works from a plain `:root`, and config files highlight.

  The stylesheet's own guidance — "redefine the tokens in your own `:root`" — could
  not work against it. The dark tokens are `:root:not([data-theme='light'])`, which
  is specificity (0,2,0), so an unlayered `:root` at (0,1,0) lost regardless of load
  order; the cascade never reached source order. Overriding meant `:root:root:root`.

  Every block now lives in a layer — `theme` for tokens, `base` for resets,
  `components` for classes, declared in that order — and unlayered CSS outranks
  every layer whatever its specificity. Inside the layer the dark blocks still beat
  the light one, so OS following and `data-theme` are unchanged. The README gains a
  Theming section, which it did not have.

  Added the `ini` and `toml` grammars, and registered `cfg` and `conf` as aliases of
  `ini`. Shiki resolves a fence against a grammar's own aliases rather than against
  this package's loader keys, and `ini` ships only `properties` — so a `` cfg block
threw `Language 'cfg' not found` and `fallbackLanguage` rendered it as plain text.
The fence an author writes follows the filename: nobody types  ``ini above a file
  called `server.cfg`, and on a FiveM docs site that block is the most-read code on
  the page.
