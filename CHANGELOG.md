# @waveso/docs

## 0.12.0

### Minor Changes

- 3551951: **The search results and the sidebar say "there is more this way" the same way
  the table does, and hide their scrollbars where they can.**

  Four gradients on the search list, exactly as `.wave-docs-table-scroll` does it:
  the two `local` covers are painted in the surface colour and travel _with_ the
  rows, so each sits over its shadow only while that edge is at rest, and the two
  `scroll` shadows are pinned to the box. A grey edge appears on precisely the side
  that has rows off-screen, with no listener, no state and no hydration.

  ⚠️ IT REPLACED A MASK, WHICH WAS THE WRONG TOOL TWICE OVER. A mask fades content
  to _transparent_, so what showed through was the dialog's own white — a hole
  rather than a shadow. And it cannot be conditional: CSS has no way to ask whether
  there is anything above to scroll to, so the first and last rows were softened
  even at rest.

  ## The sidebar needs its shadow above the content, not behind it

  ⚠️ `.wave-docs-sidebar` PAINTS ITS OWN GROUND, AND MUST. It is in the theme's
  opt-in rule — the one that installs a ground wherever it installs a foreground
  ramp — so a consumer mounting the tree alone gets one, and `styles.browser.test`
  requires the shell to be a single surface. An element's background is painted
  _below_ its children, so the four-gradient trick was covered by a child 480px
  tall: measured 255/255 at the top edge with the nav scrolled — declared,
  computed, and invisible.

  So the navigation's overflow moved to an inner box, `.wave-docs-layout__sidebar-scroll`,
  and the panel keeps only its edges.

  ⚠️ THAT SPLIT IS THE FIX, AND EVERY VERSION BEFORE IT FOUGHT THE SCROLLER. An
  absolutely positioned child of a scroll container is laid out against that
  container's padding box and _joins its scrollable overflow_ — so nothing placed
  inside a scroller is ever pinned to it. `position: sticky` only clamps, and a
  clamp is still a thing that travels until it catches. With the scrolling on an
  inner element the panel is an ordinary positioned box: `top: 0` and `bottom: 0`
  are its own edges, and the bands have no scroll to have a position within.

  The timeline is declared on the scroller and `timeline-scope`d up to the panel,
  because a `scroll-timeline` name is visible to the declaring element's
  descendants and these pseudo-elements belong to its parent.

  ⚠️ AND THE SHADOW BELONGS TO THE PANEL RATHER THAN THE TREE, because
  `.wave-docs-sidebar` paints an opaque ground — it is in the theme's opt-in rule,
  and the shell has to be one surface — so a background on the scroller would be
  painted underneath it. Measured 255/255 when it was.

  ⚠️ AND THE NAV'S FADE IS A LENGTH, NOT A PERCENTAGE OF THE SCROLL. The table's
  keyframes shape their fade in percentages, which are percentages of the
  container's _total_ scroll range — fine on a table, wrong on a navigation. A nav
  with 1000px of scroll turns the same `2%…8%` into 20px…80px, so the shadow spends
  eighty pixels of scrolling arriving at full strength, which reads exactly like it
  is moving with the content rather than pinned to the edge. `animation-range: 0
1rem` makes it the same short distance whatever the nav's height, identical on a
  six-page site and a three-hundred-page one, with plain fades for keyframes
  because the shaping now lives in the range.

  ⚠️ THE SCROLLBAR IS HIDDEN ONLY WHERE THE SHADOW EXISTS. Both live in the same
  `@supports (animation-timeline: scroll())`, so Firefox — where scroll-driven
  animations have not shipped — keeps the thin bar rather than losing the bar and
  the shadow together. A scrollbar is the one cue that a column has more below it,
  and taking it away before something replaces it trades a slab for nothing.

  ⚠️ AND A SECOND TEST LEARNED THAT `getAnimations()` IS NOT "TRANSITIONS". A
  scroll-driven animation's `finished` promise resolves when the _scroll position_
  reaches the end, which is to say never on a panel sitting at the top — so
  awaiting the whole list hung `sidebar.browser.test.tsx` for its full 15s timeout
  the moment this shadow existed. `nav.browser.test.tsx` had already been bitten by
  the table's; this is the second place the assumption lived.

- 70649b8: **Search results get a glyph, a breadcrumb, and no scrollbar.**

  **A page or a section, as an icon.** Which one is read off the `href` rather
  than a new index field — a record with an anchor is a section within a page and
  one without is the page itself, which is what `buildSearchIndex` means by its
  lead record — so the records did not grow by a byte.

  ⚠️ AND THE ICON IS NOT DECORATION, IT IS THE ALIGNMENT. With no icon a result's
  heading sat on the same column as the input's _magnifier_ while the input's own
  text sat 24px right of it: three left edges where a reader expects two, which is
  what made the dialog read as stacked levels rather than as a list under a field.
  The icon takes the magnifier's column and the text takes the input's, so the two
  rows are the same shape. Measured: 18px and 42px, both rows, plus the footer's
  key caps on the 18.

  **The second line is a breadcrumb.** The segments were always a trail from the
  site's root to the page; slashes made them read as a URL to parse and `›` makes
  them read as what they are. ⚠️ SAFE ONLY BECAUSE THAT LINE IS `aria-hidden` —
  more than one screen reader pronounces the character, which is exactly why
  `spokenName` joins with commas instead. The two lines carry the same fact in the
  form each audience can use.

  ⚠️ THE SEPARATOR IS THE PACKAGE'S OWN CHEVRON, NOT A CHARACTER, AND TWO
  CHARACTERS WERE MEASURED AND REJECTED FIRST. `›` (U+203A) inks 4.93px tall in
  the shipped mono face at 11px, against 6.32 for an `s` and 8.51 for a `b` — it
  sat visibly below the words it separated. `❯` (U+276F) inks 8.03 and fixed the
  height _on one machine_: `ui-monospace` resolves to SF Mono here, Consolas on
  Windows, Liberation Mono on Linux, and a glyph missing from one of those falls
  back to another face at another width. U+3009 already demonstrated exactly that,
  measuring 11.24px against the 6.62 cell.

  An SVG has no font to be missing from — and it is the same Lucide chevron the
  sidebar and the pager draw, which is the real argument: everything else here is
  that one set.

  ⚠️ AND THE TRAIL IS SET IN THE SANS, NOT IN THE MONO IT STARTED IN — WHICH IS
  WHAT MADE THE SEPARATOR RELIABLE. A monospace face advances every glyph one
  cell, so the segments marched on a rigid grid an icon could not join, and its
  metrics are whatever the machine resolves: SF Mono here, Consolas on Windows,
  Liberation Mono on Linux. The cap height an inline glyph is sized against
  therefore moved from reader to reader, which is the same portability problem
  that ruled out `›` and `❯` as characters — arriving a second time through the
  face rather than through the glyph. Proportional sans has ordinary spacing and
  one set of metrics to match. `font-size` goes up a notch with it, because a
  mono face reads larger at the same size and holding the number would have
  shrunk the line.

  ⚠️ AND THE `viewBox` IS CROPPED TO THE STROKE, WHICH IS WHAT RETIRED FOUR
  CORRECTIONS. On Lucide's full 24 grid the chevron occupies x 9–15 and y 6–18,
  so a square box around it was five sixths air across and half air down — and
  every one of those gaps had to be subtracted back by hand: a `vertical-align`,
  a negative `margin-inline`, a negative `margin-block`, and a size chosen to
  make the surplus come out right. `8 5 8 14` is the painted extent, caps and
  joins included. The box is the glyph, so it sits on the baseline the way a
  letter does with nothing declared, and the air beside it is one positive
  `margin-inline`.

  ⚠️ AND IT CARRIES `overflow: visible`, WITHOUT WHICH THE POINT IS FLAT. An
  `svg` clips to its viewport by default and this `viewBox` is exactly the
  stroke's extent, so the round join at the tip lands on the box's own edge and
  loses its outermost anti-aliased pixel. Nothing overlaps anything: what spills
  is a fraction of a pixel.

  ## The scrollbar is hidden, and it cannot be conditional

  ⚠️ THERE IS NO CSS WAY TO SHOW A SCROLLBAR ONLY WHILE SCROLLING. That behaviour
  is the platform's: macOS draws overlay scrollbars that fade in on scroll and out
  after it, and this list gets it for free there. Windows and Linux draw a classic
  one that is always present, and the only ways to make it come and go are a
  JavaScript timer toggling a class or a scrollbar drawn from scratch in script —
  which is what a `ScrollArea` component is, and neither belongs in a package whose
  whole argument is what it does _not_ ship to a reader.

  So it is hidden, as `@waveso/app` does with `.scrollbar-none`. What replaces it
  is the keyboard rather than a fade: the footer says `↑ ↓ Select`, the list is
  driven by `aria-activedescendant`, and arrowing past the last visible row scrolls
  it and loads the next page.

  ⚠️ AND `pageSize` STAYS A WINDOW, NOT A CAP. It was a hard ceiling of 8 once, and
  that was removed with measurements: on a six-page site "docs" matches 18, so
  results were unreachable and the live region announced "8 results" — not a
  smaller truth but a false one. Rendering every row of a 300-page corpus costs
  40ms, 128ms at 4x throttle, which is what paging exists to avoid; the ceiling
  was never what made it fast.

  The size budget moves with the glyphs, and the figures the README and the
  installation page publish move with it — a document here may not understate what
  this package costs.

- 78053a6: **Nothing in the search dialog is selected until the reader selects it.**

  Typing lit the first result the instant it arrived, so a row changed under a
  reader for something they had not chosen — and on this package's accent that
  reads as a decision already made. `activeIndex` starts at `-1` now: an arrow key
  or the pointer moving over a row is what selects.

  ⚠️ AND EVERY GUARD FOR IT ALREADY EXISTED, WHICH IS WHY THIS IS ONE NUMBER.
  `hits[-1]` is `undefined`, so no `aria-activedescendant` is written and Enter
  returns without opening anything. The one place that needed teaching is the
  arrow keys: they wrap modulo the list, and `(-1 - 1 + n) % n` is the _second to
  last_, so Up from a fresh query landed one short of the end.

  **The active row is the table header's grey**, easing on the same 150ms the
  sidebar's rows use. Moving the pointer over a result activates it, so hovering
  _is_ this state; there is no second rule for it.

  It has been four things: a 2px accent ring, which read as a component borrowed
  from somewhere else and came and went as a reader arrowed; the trigger's border
  pair, which meant bordering _every_ row to make one edge legible and turned a
  list into a stack of cards; an accent tint, which was the same colour family as
  the field above it. A row is a list item and its state is a colour — the field is
  a control, and that is what wears the trigger's border.

  ⚠️ `bg-subtle` ON `bg` IS ABOUT 1.02:1, SO THE TINT IS A HINT AND NOT AN
  INDICATOR. The marker going `fg-subtle` to `fg` is the part that carries the
  state — text contrast rather than non-text, and the sidebar's own hover. What
  must not happen is the tint being left to carry it alone.

  ## The field stops drawing a ring it could never put down

  ⚠️ A TEXT INPUT MATCHES `:focus-visible` WHENEVER IT IS FOCUSED, HOWEVER FOCUS
  ARRIVED — that is the spec, not a heuristic — and this dialog focuses its input
  the moment it opens. So the accent ring was not a state, it was the field's
  permanent appearance, and it stopped the field looking like the bordered grey
  control the reader clicked to get there.

  The edge darkens to `--wave-docs-border-strong` instead, which is what the
  trigger does under the pointer, so the field is the trigger in both of its
  states.

  ⚠️ AND THE INDICATOR IS NOT LOST WITH IT, BECAUSE A TEXT FIELD HAS ONE OF ITS
  OWN. The caret is the platform's focus indication for a text box, it is in this
  field the whole time the dialog is open, and it is what a reader looks for to see
  where typing goes. That is a different argument from the one this rule used to
  reject: "the dialog frame is the indicator" was a _static_ border that looked
  identical focused and unfocused, and indicated nothing. This edge changes.

  ## The list fades at both edges

  A mask on the scrollport, so the row being cut off is the one that softens. It
  does not travel with the content: a mask paints against the element's own box, so
  the two stops stay at the top and bottom of the _port_ while the rows move under
  them.

  ⚠️ IT IS UNCONDITIONAL, WHICH IS THE ONE THING TO KNOW. CSS cannot ask "is there
  anything above this to scroll to" — the table's shadow answers that with a
  scroll-driven animation whose timeline goes inactive when nothing overflows, and
  a mask has no equivalent. So the first and last rows carry a little of it at
  rest. At `1.25rem` against a row nearer three times that, it costs the top pixel
  or two of a heading and buys never guillotining one.

  ## The field, and the gap under it

  **The field is the trigger, expanded.** Same border, same fill, same radius. It
  was a border with no fill — two frames a few pixels apart — and briefly a fill
  with no border, which is a tinted band rather than a control. The trigger has
  always been both, and both together are what reads as a field.

  ⚠️ THE PADDING IS NOT COPIED WITH THEM. The trigger pays `calc(0.5rem - 1px)`
  because it is a compact control in a sidebar; the field pays
  `calc(0.75rem - 1px)` because its glyph has to land on the column the results
  and the footer sit on. The `- 1px` is the border either way — content inside a
  bordered box starts a border further in.

  The field takes the base radius and the result rows take `-sm`, which is the tier
  system doing what it says: both are controls, and a result row is a list item.

  ⚠️ AND THE GAP UNDER THE FIELD WAS PAID TWICE. The field's margin and the result
  list's top padding both contributed, so the space between the input and the first
  result was double the space above the input — a doubled gap in the one place a
  reader's eye travels on every keystroke. The list drops its top padding; the
  field keeps its margin, because an empty result list is `display: none` and a gap
  paid from there would vanish on the query that matches nothing.

### Patch Changes

- 688a84c: **The search dialog lines up on one column, and its input is a field rather
  than a band.**

  The input row was flush to the dialog's frame, so it could only round the two
  corners it shared with it and needed a rule underneath to separate it from the
  results. Inset by the same margin the results list uses, it is a box like they
  are — all four corners rounded, and the gap does the separating.

  ⚠️ AND ITS RADIUS IS THE DIALOG'S MINUS THE GAP, NOT THE DIALOG'S. A rounded box
  inset inside a rounded box is concentric only at `outer - gap`; equal radii run
  the two corners at different curvatures six pixels apart and the field reads as
  pasted onto the dialog rather than set into it.

  **One column, measured from the bottom up.** The footer's key caps are the
  anchor — the one row whose left edge is a drawn object — and the results' text
  and the input's magnifier are measured to it. All three now start 18px from the
  dialog's inner edge.

  ⚠️ BOXES, NOT INK. A cap's arrow sits its own border and `0.4em` of padding
  inside the cap, so aligning the _glyphs_ would put every other row on a column
  that moves whenever the footer's font size does.

  ⚠️ AND THE INPUT ROW PAYS `calc(0.75rem - 1px)` BECAUSE IT IS THE ONE ROW WITH A
  BORDER. Content inside a bordered box starts a border further in than content
  inside an unbordered one, so equal padding misses by exactly that — the same
  subtraction `--wave-docs-panel-inset` exists for.

## 0.11.0

### Minor Changes

- 5730af3: **The code frame wears the panel.** A fence is now an outer card holding a
  header row — the filename or the language on the left, the copy button on the
  right — and an inset surface with the code on it, dressed by the same
  `.wave-docs-panel` rules as "where to go next".

  ⚠️ THE `<figcaption>` STAYS A DIRECT CHILD OF THE `<figure>`, WHICH IS WHY THIS
  HAS NO HEADER WRAPPER. A `figcaption` has to be the first or last child of its
  figure; inside the `.wave-docs-panel__header` `<div>` that "where to go next"
  uses it captions nothing, the markup is invalid, and a titled block loses the
  accessible name it had. So the frame lays its header out on a grid and shares
  the primitive's _insets_ rather than its header element. The button stays out of
  the caption for the matching reason: a `<button>` inside a `<figcaption>`
  contributes its accessible name to the figure's, so `swap.ts` would announce as
  "swap.ts Copy code from swap.ts".

  ⚠️ AND A TITLE IS WHAT DECIDES WHETHER THERE IS A FRAME AT ALL. With one, the
  figure is a panel: a band carrying the filename and the copy button, and the
  code set into a card below it. With none there is nothing to put in a band, so
  the frame flattens away, the surface becomes the block, and the button sits on
  the code — which is what Mintlify does, and what stops an unnamed fence from
  carrying a reserved slot with nothing in it.

  A language is not a title for this purpose. A fence declaring `ts` and no
  filename is still an untitled fence, and a band holding a two-letter badge is
  the same empty header with a word in it. `data-lang` stays on the figure for
  anyone selecting on it.

  One shape of markup, switched in the stylesheet rather than in the pipeline: two
  markup paths mean two fixtures, and the one that is not on screen is the one
  that rots.

  **The copy button no longer hides until you hover.** It faded in on `:hover` or
  `:focus-within` because it was positioned over the code and had nowhere of its
  own to be. It has a slot in the header row now, and a reserved slot that stays
  empty until you point at it reads as a rendering fault — so the reveal, the
  `@media (hover: none)` exception that existed because a hover-only control does
  not exist on a phone, and the reduced-motion guard on its transition all went
  with it. It is still `visibility: hidden` until the runtime attaches, which is
  the structural promise and is unchanged.

  ## Three things the restructure moved, each of which was a defect

  ⚠️ THE `<pre>` DRAWS NO FRAME OF ITS OWN ANY MORE. It carried the border, the
  radius and the background; inside a `.wave-docs-panel__body` that carries all
  three, that draws the frame twice one pixel apart. `pre:not(.shiki)` keeps its
  own, because an excluded fence is never wrapped.

  ⚠️ AND ITS INLINE PADDING IS `1rem` BECAUSE THAT IS `--wave-docs-panel-inset`,
  not because it is a round number. The label sits at that inset plus the
  surface's border; the code sits at the surface's border plus this. The
  `1.125rem` it was put the first character 2px right of the filename above it —
  visible, and attributable to nothing.

  ⚠️ AND THE FOCUS RING ON THE `<pre>` IS INSET NOW. Shiki gives it
  `tabindex="0"` so a keyboard reader can scroll a wide block, and the surface
  around it is `overflow: hidden` so a square corner cannot poke through the
  frame's rounded one — which clipped a `+2px` outline away to nothing.
  `styles.test.ts` reads rules as text and would have gone on passing.

  ## The panel grew two properties, both to settle a cascade rather than a taste

  `--wave-docs-panel-surface` is the inset surface's ground, and its default lives
  in a `var()` fallback rather than in a declaration. `.wave-docs-code__body` and
  `.wave-docs-panel__body` are both one class, so source order decides and the
  panel is declared later: a code frame asking for the darker code ground got the
  panel's white. Moving the ground to a property did not fix it either — a frame
  wears `.wave-docs-panel` _and_ `.wave-docs-code`, so both rules set that property
  on the same element at the same specificity, and source order handed it back.
  Measured twice as `oklch(1 0 0)` where `oklch(0.975 0.003 262)` was written. In
  the fallback there is no declaration to lose to.

  `--wave-docs-panel-header-row` floors the header. With a label the row is the
  label's height and with none it is the button's, and a page mixing titled and
  untitled fences showed two header heights.

  The frame's markup now has one home — `codeFrameMarkup` — that the browser tier
  mounts and the plugin tier asserts the pipeline agrees with. Written out
  separately in both, a hand-written fixture goes on describing a frame the
  pipeline stopped emitting while every assertion measuring it stays green.

- 793d0f7: **"Where to go next": a question per row, and the page that answers it.** A page
  opts in from its frontmatter:

  ```yaml
  explore:
    - question: How a person is recognised across servers
      href: ./identity.md
    - question: What happens when the network fails
      href: ./delivery.md
  ```

  A sidebar is a structure; this is a router. It says _why_ a reader would go
  somewhere, which no tree of titles can — so the same component is a landing
  page's onboarding and an ordinary page's footnote.

  ⚠️ THE LINK TEXT COMES FROM THE NAVIGATION. An `href` pointing at a page in the
  tree takes that page's own name, so renaming it updates every block that points
  at it — the same tree the sidebar and the pager read. Name a `title` only where
  the tree cannot answer: an external link, or a page kept out of the navigation.

  ⚠️ AND AN HREF THAT RESOLVES TO NEITHER STOPS THE BUILD. Falling back to the
  href renders a URL where a sentence should be — "Where this runs and what that
  buys → /docs/infrastructure" — on a page that builds cleanly, and nothing else
  in the pipeline would notice. The frontmatter is authored and the author is
  right there, so the error names the page and both fixes.

  ⚠️ A LIST, NOT A TABLE, WHICH IS WHAT THE MARKDOWN IT REPLACES HAD TO BE. A
  screen reader announces "table, 2 columns, 7 rows" for what is a list of links
  with descriptions, and asks the reader to navigate it by cell. Two columns of
  sentence-length questions are also cramped in a narrow box, where the rows stack
  instead — a `@container` query, because a host can hand this a 500px panel on a
  1920px monitor.

  One frame with hairlines between the rows rather than a stack of cards: they are
  the same question asked several ways, and separate boxes say several unrelated
  things. The rule is a _top_ border on every row but the first — `:last-child`
  leaves a doubled line the moment anything is appended to the list.

  ## And the frame is a primitive, not this component's furniture

  `.wave-docs-panel` is a framed block with a header and an inset surface — the
  outer card names the thing and carries its controls, the inner one holds the
  content. "Where to go next" is the first thing to wear it; a code frame is the
  obvious next, and two copies of the same three rules is how they drift apart.

  ⚠️ THE TWO RADII ARE NOT INDEPENDENT NUMBERS. A rounded box inside a rounded box
  only looks right when the inner radius is the outer one minus the gap between
  them; anything else runs the corners at different curvatures and the inner box
  reads as _pasted onto_ the frame rather than set into it. The new
  `--wave-docs-radius-lg` is chosen so the arithmetic lands on an existing token:
  `1rem` outer minus `0.5rem` of padding is `--wave-docs-radius`.

  The header sits in the frame's padding and draws no rule of its own — the inset
  surface below already draws the line, and a border there is a second one a pixel
  away from the first.

  ⚠️ AND THE PANEL EXPORTS `--wave-docs-panel-inset`, WHICH IS NOT THE SAME NUMBER
  AS ITS PADDING. The title sits at the frame's padding; anything inside the body
  sits at that padding _plus the body's own border_, so the two columns miss each
  other by a pixel per border. Measured before it existed: the rows started 9px
  right of the heading above them — a number that appears in no rule and reads as
  a design decision. Exported rather than repeated, because the next component to
  wear the panel has to make the same subtraction and will not think to.

  It renders above the pager. The two answer different questions and both belong
  there: this is the semantic answer, the pager the linear one.

  A real `<h2>` names it, not an `aria-label` — a reader moving by heading would
  pass straight over a region named only by an attribute.

  ## The key is `explore`, and neither `next` nor `steps` would do

  `next` is unusable in this package. `src/next.ts` is the Next.js adapter, so
  two files one directory apart would carry the same name for entirely different
  things, and `doc.frontmatter.next` would read like a routing hook rather than
  a block of prose.

  `steps` is wrong for a different reason: these rows are a _branch_, not a
  sequence. A reader picks one and ignores the rest, and none of them is first.
  A numbered "1 -> 2 -> 3" component is a real and separate thing worth building
  later, and `steps` is the name it will need.

  The rendered heading is still "Where to go next" — `next` in prose is fine,
  it is only the identifier that had to move.

  No client JavaScript. New: `DocsExplore` at `@waveso/docs/react/explore`,
  `explore` in frontmatter, and `explore` in `labels`.

- c871d2f: **One radius scale, taken from `@waveso/ui`, retunable from a single line.**

  Three tiers, all `calc()` off one root, so which corner a box gets is decided by
  what _kind_ of box it is rather than by how big it happens to be:

  | Token                   | What takes it                                               |
  | ----------------------- | ----------------------------------------------------------- |
  | `--wave-docs-radius-sm` | inline chips, small controls, focus rings on those          |
  | `--wave-docs-radius`    | controls, overlays, and the panel's inset surface           |
  | `--wave-docs-radius-lg` | every block in the reading flow, and the panel's outer edge |

  ⚠️ THE BLOCK TIER WAS SPLIT. Callouts, images and video embeds sat at the base
  radius while a code frame and a table sat at 19px, so two blocks a paragraph
  apart disagreed by eleven pixels — and a table read as aggressively round next
  to the callout above it. 19 was measured off a reference site, which is a fine
  way to pick a number and a bad way to pick a _system_.

  ⚠️ AND THE NUMBERS ARE `@waveso/ui`'s, NOT NEW ONES. A page running both this
  package and the component library should not show two radius scales a few pixels
  apart, and taking theirs is how that is guaranteed rather than kept in step by
  hand. `--wave-docs-radius-base` is the override point: a host writes
  `--wave-docs-radius-base: var(--radius)` and every corner here follows their app,
  including any theme that moves it. Overriding three tokens separately would be
  three chances to break the arithmetic below.

  ⚠️ `--wave-docs-radius-step` IS LOAD-BEARING. The panel's inset surface takes the
  base radius and its frame takes `-lg`, which is the base plus one step — so the
  two corners are concentric only while the frame's _padding_ is that same step.
  It is paid out of the token rather than written as `4px`, so moving the root
  keeps both true. `--wave-docs-radius-panel` is gone with it: a token whose only
  job is to be another token minus a constant is a number that can drift from its
  own definition.

  ## Squircles, where the browser has them

  `corner-shape` renders every `border-radius` as a continuous superellipse rather
  than a circular arc. `@waveso/ui` ships it and this now matches, including the
  root bump both make under the same `@supports` — a squircle reads tighter at the
  same radius, so the scale moves up to restore the roundness the numbers were
  chosen for. Only the root moves; every tier and the panel's padding follow.

  ⚠️ SCOPED TO ELEMENTS THIS PACKAGE OWNS, AND NOT `*`. `@waveso/ui` can say `*`
  because it is the application's own stylesheet. This one is mounted inside
  somebody else's page, and a bare `*` would reshape every corner the host drew —
  the same trespass as claiming `html` or `body`, which this file already refuses.
  Pills and dots opt back out, because a squircled pill is a lozenge.

  ⚠️ AND THE SOURCE TEST FOR THE CONCENTRIC ARITHMETIC WENT VACUOUS ON THE WAY.
  It regexed three `rem` literals out of the token block; with the tiers as
  `calc()` the regex matched nothing, both sides defaulted to zero, and `0 - 0`
  passed while asserting nothing. It is measured in computed pixels now, which is
  also the only tier that can see the squircle bump. Two browser assertions that
  built an expected radius out of `getPropertyValue` were the same mistake in a
  different shape — a custom property is not computed to pixels, so it hands back
  the `calc()` as written. They compare two computed corners to each other now,
  which is the uniformity claim anyway.

### Patch Changes

- 04b7de7: **A blockquote is a box, not a rule down one edge.**

  Every other block set apart from the prose here — a callout, a code frame, a
  table, an embed — is a bordered box. A single 3px edge made the quote the one
  exception, so next to a callout two paragraphs away it read as a _different kind
  of thing_ rather than as a quieter one.

  It is the callout's box now, minus the hue: the same padding so their text lines
  up, the same block radius, a plain border instead of a tinted one, and no accent
  edge. That is the relationship — **a callout is a quote with a colour** — and it
  finally looks like it.

  Still not italic. The box and the muted colour already say "quotation", a long
  italic passage is measurably slower to read, and markdown authors use
  blockquotes for asides and notes rather than only for speech.

  ⚠️ AND IT HAD TO JOIN THE SQUIRCLE LIST BY NAME. Corner shaping is scoped to
  elements this package owns, matched by our own class prefix — and a `blockquote`
  is the markdown author's tag, with no class of ours on it. It would have been
  the one block on the page still drawing a circular arc.

- 975acba: **A callout draws one uniform border, not a 3px rule down its inline start.**

  The stripe made a callout the exception among blocks set apart from the prose —
  a code frame, a table, an embed and now a blockquote are all boxes with one
  border all the way round — so beside any of them it read as a different kind of
  thing rather than as a coloured one. A thick rule on one side also fights the
  corner it runs into once the box is a squircle.

  ⚠️ THE TYPE IS STILL NOT CONVEYED BY COLOUR ALONE. The stripe was never what
  carried it: the icon and the label — "Note", "Warning" — are the non-colour
  signals, and they are unchanged. The tinted border and ground stay as
  reinforcement rather than as the whole message.

  The table-of-contents rail keeps its 2px inline-start border. That is a
  continuous line an active marker slides along, which is a navigation affordance
  rather than the edge of a box, and a source guard names the two blocks it does
  apply to.

- cd21631: **The copy button draws Lucide icons, like everything else here.**

  It rendered `⧉`, and swapped in `✓` and `×` through CSS `content` — three
  characters drawn by whatever font resolved, at whatever weight and baseline
  that font has, beside a sidebar, a pager, a callout and a search dialog that
  are all Lucide paths at `stroke-width: 2`. It read as a different icon set
  because it was one. Now `copy`, `check` and `x` on the same 24×24 grid.

  ⚠️ THE SWAP IS `display` AND NOT `visibility`, AND THAT IS NOT A PREFERENCE.
  All three icons ship in the markup and the stylesheet picks one — there is no
  component owning this button, so there is no state to re-render. But the button
  is `visibility: hidden` until the runtime attaches, which is what keeps a reader
  with no JavaScript from meeting a control that does nothing and keeps it out of
  the tab order — and `visibility` inherits. An icon rule setting it back to
  `visible` would draw a glyph inside a button that is meant to be invisible.
  `display` does not inherit, so the button's own rule still governs all three.

  Three icons per fence is fifty on a page with fifty of them, and the repeat is
  why that is affordable: byte-identical every time, which is the case gzip
  handles best. The quick start's gzipped payload did not move, and the
  hast-over-the-wire ratio for code and tables went from 1.11× to 1.09×.

  ## And it stops drawing a box around itself

  No border and no ground, in any state. A bordered, filled 2rem box sitting on
  the frame's own band is a third framed rectangle inside a frame that already has
  two, for a control secondary to everything around it. The glyph is the whole
  control, and hover moves its ink to the accent rather than putting a box behind
  it — the same signal every other interactive surface here gives. A ground also
  had nowhere to come from: the subtle ramp _is_ the frame's colour, so the hover
  state it used to have was the colour the button was already sitting on.

  ⚠️ AND IT HAD NO FOCUS INDICATOR AT ALL, WHICH THE BORDER WAS COVERING FOR. A
  1px box is not a focus indicator — it is there whether the control is focused or
  not — so a keyboard reader tabbing onto this button got a `color` change and
  nothing else, and it never appeared in the package's own inventory of focusable
  surfaces. Taking the border away made that visible; it did not create it. There
  is a real `:focus-visible` outline now, and a test that keeps it.

  ⚠️ AND ONE TEST WAS PASSING BY ACCIDENT. `render.test.ts` asserted that a
  GitHub alert produces no octicons by checking the _whole document_ for `<svg>`,
  which was only ever true because nothing else in the pipeline emitted one. It
  now checks the callout's own subtree, which is what it meant.

- d7333cb: **The site's pages stop hand-writing their own "Next" link.** Nineteen of them
  ended with `Next: [Page](./page.md).`, which the pager has rendered from the
  navigation tree since it landed — the same link, twice, a few hundred pixels
  apart, and the hand-written one silently wrong the moment a page moved in the
  tree.

  Documentation-only: no package change.

- 6f0afb7: **A panel title is the size of a column header.**

  "Where to go next" and `Enforced by` are the same kind of thing — the label a
  reader's eye lands on before the content under it — and a page shows both. At
  `0.875rem` against the table's `0.9375rem` they read as two levels rather than
  as one.

  The weight does not follow: a panel title names the block, a column header names
  a column inside one, so the title stays a step heavier. A source guard pins the
  pair, because two literals that have to agree are two literals that drift.

- 8c59155: The navigation stops being lopsided.

  Its rows sat 16px from the inline start and 31px from the end. The 15px was
  `scrollbar-gutter: stable`, which reserves the scrollbar's width whether or not
  it is showing — and that reservation sits _inside_ the padding.

  The jump it prevents is one 15px shift, the first time a nav grows past a
  screen. What it cost was permanent and on every page.

  ⚠️ AND IT IS A NO-OP ON macOS, WHICH IS WHY IT SURVIVED BEING LOOKED AT.
  `scrollbar-gutter` does nothing where overlay scrollbars are the default, so the
  asymmetry was invisible to everyone who built this and plain on every Windows
  and Linux machine that opened it.

  `scrollbar-width: thin` in its place, with `scrollbar-color`, so the scrollbar
  that does appear is narrow and coloured rather than a UA slab against the
  panel's edge. A browser test measures both insets and fails at 15px.

- e94bb67: **A table keeps one frame, at the panel's radius.**

  It wore `.wave-docs-panel` for a while — outer frame, header band, inset card —
  and that was wrong for a reason worth writing down rather than just undoing.

  ⚠️ THE PANEL SEPARATES _CHROME_ FROM _CONTENT_, AND A TABLE'S HEADER ROW IS
  CONTENT. "Where to go next" and a code frame both have chrome to put in the
  band: a title, a language, a copy button. A table's `<thead>` is data. Setting
  the body into a card away from its own header cost three vertical rules down
  each side, stopped the row dividers short of the box and narrowed the reading
  width — on the densest element on a page, for nothing gained. Full-width
  dividers are what let an eye track a row across.

  What is kept is the outer radius: `--wave-docs-radius-lg` rather than
  `--wave-docs-radius`, so a table and a code block read as two of one family
  without the table pretending to chrome it has not got.

  ⚠️ AND AN EMPTY HEADER ROW NOW DRAWS NO BAND, WHICH GFM PRODUCES ROUTINELY. A
  GFM table always has a `<thead>` — the delimiter row is what makes it a table —
  so an author who wants a plain two-column list of facts writes `| | |` and gets
  a header of empty `<th>`s, which rendered as a tinted strip with nothing in it.
  `:empty` and not a text check: GFM emits `<th></th>` with no whitespace inside.
  A header with even one named column keeps its band.

  **And a fence with neither a title nor a language gets no band either.** The
  header row is floored so titled and untitled fences match, which is right when
  there is a label and wrong when there is not: a bare fence had only the copy
  button, adrift in a strip of empty ground. The row is the button now.

## 0.10.0

### Minor Changes

- f52cb99: **Every page links to the ones either side of it.** `docs.Page` renders a pager
  under the prose. Nothing is authored: a page gets one by being in the
  navigation.

  ⚠️ THE ORDER IS THE SIDEBAR'S, NOT THE SLUG LIST'S. `generateStaticParams` has
  every route in it and no opinion about their order; `meta.json` is where the
  author said what comes next, and it is what the reader is looking at. Two
  orderings of the same pages is two answers to one question, and they drift the
  first time a `meta.json` moves — so the pager reads the same tree `DocsSidebar`
  renders and flattens it. A pager that disagrees with the column beside it is
  impossible by construction.

  Separators and external links are not stops: a separator is a label with
  nowhere to go, and a "next page" that lands on npm has ended the sequence
  rather than continued it. A group with an `index.md` contributes its own page
  before its children, which is the order its rows appear in.

  ⚠️ A PAGE OUTSIDE THE TREE GETS NO PAGER, RATHER THAN THE FIRST ONE. `-1` from
  `findIndex` reads as "just before the beginning", so an unguarded lookup hands
  every draft and every route rendered outside the navigation the same first page
  as its "next" — confidently wrong on exactly the pages nobody checks.

  ⚠️ AND AN EMPTY CELL AT EACH END, NOT A MISSING ONE. The two links share a grid
  row; drop the absent side and the survivor slides into the first track, so the
  first page of a site puts "Next" on the left and every other page puts it on
  the right. The one page where the position moves is the one a reader sees
  first.

  Nothing renders at all when there is no neighbour either side — a one-page site
  would otherwise get a navigation landmark containing nothing.

  A chevron on the outer edge of each link points the way it goes.

  ⚠️ AND "OUTWARD" MIRRORS. Under `dir="rtl"` the grid's first track is on the
  right, so the _previous_ link moves there and its arrow has to point right —
  the reverse of the rule that draws it. Same trap as the sidebar's chevron, in a
  component built after it, and `[dir='rtl']` again rather than `:dir(rtl)`.

  No client JavaScript: two links, two captions and two glyphs, rendered on the
  server. Each
  link is named by direction _and_ destination — "Previous: Installation" — since
  a link announced as a bare title says nothing about which way it goes. The
  landmark is named too, because a page now carries three of them.

  New: `DocsPager` at `@waveso/docs/react/pager`, `pager: false` on
  `createDocsRoute` to omit it, and `previousPage`, `nextPage` and `pagination`
  in `labels`.

### Patch Changes

- 09a9369: The sidebar grip says whether it has anything to do.

  Blue when the navigation is hidden or the pointer is on it; grey when the
  sidebar is open and untouched. One rule at every width — a closed sidebar is
  the same request for attention on a phone as on a desktop.

  ⚠️ `:not([data-state='open'])`, NOT `[data-state='closed']`. The attribute is
  absent until the reader chooses, and a server-rendered page has none — so
  matching only the explicit value leaves every first paint below 64rem showing a
  grey grip in front of hidden navigation, which is the one moment the cue is
  for. Above 64rem the default inverts, and a second rule says so.

  ⚠️ AND THE COLOUR IS A CUSTOM PROPERTY, NOT A SELECTOR FIGHT. Three things want
  to set it — the resting style, the pointer, and the sidebar's state — and the
  state lives on an _ancestor_, so `.sidebar[data-state] .trigger::before`
  outranks `.trigger:hover::before` by a whole class. Written as backgrounds that
  is a rule which silently kills hover on the one state that still needs it.
  Properties settle it by inheritance: the state sets them on the sidebar, the
  trigger sets them on itself under `:hover`, and a value on the element always
  beats one it inherited. No specificity ladder, no `!important`.

  The grip is also a full pill now rather than a rounded rectangle.

  ⚠️ TESTED AS MARKUP, BECAUSE A MOUNTED COMPONENT CANNOT SHOW THE UNTOUCHED
  STATE. `DocsNav` resolves the mode on mount and writes `data-state`
  immediately, so every React fixture is already explicit. Two wrong versions
  passed the whole suite against that — matching the explicit value, and dropping
  the wide-layout reset — and both are caught now by a server-shaped fixture with
  no attribute at all.

  Also fixed here: the focus-indicator guard looked up one rule per selector, and
  a selector may legitimately appear in several. The trigger now has one rule
  setting properties on focus and another drawing the ring; taking "the first" or
  "the last" is a coin flip on file order, so it reads every rule and asks for
  one to declare an outline.

## 0.9.2

### Patch Changes

- 6b84354: A separator now rules off the block above it.

  It ends one section as much as it names the next, and 1rem of margin was not
  saying so — the gap read as "these two lists are a bit far apart" rather than as
  a division.

  ⚠️ THE RULE AND THE LABEL SHARE THE LIST'S OWN EDGE, WHICH IS ALSO THE ROWS'. A
  row is full-bleed — its hover surface spans the whole column, and so does the
  search field above it — so a rule on that edge divides the column, while an
  inset one floats inside it. The label sits on the same line, because a heading
  and the rule above it reading as one object is the whole reason the rule exists.

  The label keeps the rows' own content edge — the marker column when there is
  one, the words when `icons={false}` removes it. Those are the same number: a
  row's `padding-inline` is what both modes have in common, so matching it lands
  on whichever is there, with no query and nothing threaded to the stylesheet.

  ⚠️ AND NOT ABOVE THE FIRST CHILD. A `meta.json` may open with
  `"---Reference---"`, and on that tree the very first thing in the navigation
  would otherwise be a hairline above nothing.

  The label also drops from `font-weight: 650` to `500`. At 650 it was heavier
  than the group titles it sits under — a divider out-shouting the navigation it
  divides. Weight rather than colour, because there is no lighter colour to
  reach for: `--wave-docs-fg-subtle` is already the lightest text token at 5.05:1
  against WCAG 1.4.3's 4.5:1 floor, and `--wave-docs-border` — the rule's own
  colour — measures 1.31:1 and is a line colour, not a text one.

- 7e67c5a: The table of contents marks the last section when you reach it.

  Scroll to the foot of a page whose final section is short and nothing happened:
  the entry stayed on the section _above_, and the last one could only be
  highlighted by clicking its own link.

  ⚠️ NO `rootMargin` FIXES THIS, WHICH IS WHY IT LOOKED LIKE A TUNING PROBLEM.
  The default makes the top 40% of the viewport the region that counts as
  current, and that is right while there is document left to scroll — a heading
  rises into the band and takes the highlight. At the end there is none. A short
  trailing section sits on screen, fully readable, below a band it can never
  enter, while the heading above it is still _inside_ that band. The observer was
  giving a correct answer to the wrong question. Any band smaller than the
  viewport has this hole; a bigger one only trades it for a highlight that jumps
  early.

  So the end of the document is handled as what it is — a place where scrolling
  stops answering — and the last heading takes the highlight there. Scroll up and
  the band has it straight back, without waiting for a heading to cross.

  ⚠️ AND BOTH INPUTS GO THROUGH ONE RESOLVER, WHICH IS THE HALF THAT IS EASY TO
  MISS. Left as two `setActiveId` calls they race, and the observer wins — it
  fires last and it still likes the heading above. The first version of this fix
  was measured doing exactly nothing for that reason.

  ⚠️ ONLY WHEN THE DOCUMENT ACTUALLY SCROLLS. On a page that fits, "scrolled to
  the bottom" is true at rest, and the last section would be current before the
  reader had read a word of the first.

  The listener is `passive` and reads two numbers — no `getBoundingClientRect`,
  no layout flush. Like every other scroll reader here it watches the document; a
  host that scrolls an inner pane keeps the observer's behaviour and loses only
  this tail case.

  `toc` grows 0.88 → 1 KB, and the published total 14.5 → 14.6 KB. It is still
  the smallest client component in the package.

## 0.9.1

### Patch Changes

- 80d3db4: The sidebar's handle and the search shortcut stop competing with the page.

  **The handle is 16 × 56 and faded.** It was 20 × 80 at full strength — a solid
  slab beside the reading column, for a control nobody looks at while reading. It
  now sits at 40% until a pointer or a caret reaches it, the same treatment as the
  tree's markers.

  ⚠️ BOTH MARKS FADE, NOT THE PILL ALONE. Fading `::before` by itself leaves crisp
  dots on a washed-out slab, which reads louder than the solid grip it replaced.

  ⚠️ AND NOT ON THE `<button>`, which would take the focus ring down with it —
  `opacity` applies to the whole element, outline included, so a keyboard reader
  would get a 40% indicator on the control they had just moved to. It is on the
  two pseudo-elements, and `:focus-visible` restores both.

  ⚠️ THE TAP TARGET IS UNCHANGED BY ANY OF IT. The button is the whole strip and
  runs the height of the column; the pill is paint. At 16px plus 4px of padding a
  side the strip is 24px wide — WCAG 2.5.8's minimum to the pixel, and a test now
  says so, because the next narrowing is the one that fails it.

  ⚠️ THE DOTS DO NOT SCALE WITH THE PILL. They are `box-shadow` offsets on one
  element, so they span 18px whatever the pill does. Found by shortening it to
  16px tall and watching the outer two render outside it.

  **`⌘K` is levelled with `Search`.** Equal `font-size` in two families is not
  equal type: the label is `ui-sans-serif` and the badge `ui-monospace`, which
  draws 0.7292px of cap per px. `1.012em` is what puts the `K`'s cap on the `S`'s.

  ⚠️ AND THE SYMBOL IS `1.369em`, THE MEASURED INK RATIO — NOT A HAIR MORE. At
  `1.45em` the `⌘` stood 6% above the cap line, and the badge read as _bigger
  type_ than the label: 88 device px of ink against the word's 85, its top three
  higher, its centre 1.5 out. Same letter height, louder cluster. At the ratio,
  `Search` and `⌘K` measure 85 and 85 and share a centre to the device pixel.

  ⚠️ AND `line-height: 0` ON THE SYMBOL, WHICH IS WHAT MADE THE TWO CENTRE. A line
  box is as tall as the tallest inline box in it, so the 20.5px glyph made the
  `<kbd>` 20.55px against the label's 17 — and flex centres them by their _boxes_,
  so the `K` rode 1.9px high inside a box the symbol had stretched.

  Also fixed: the focus-indicator test looked its selectors up with `indexOf`, so
  `…:focus-visible` matched inside `…:focus-visible::before` — a different rule,
  about pseudo-elements, with no business declaring an outline. It reported the
  trigger as having no focus indicator while the trigger's own rule sat further
  down the file declaring one.

- 27f63ec: Sidebar separators keep the case their author wrote them in.

  ⚠️ `text-transform: uppercase` ON A STRING THIS PACKAGE DOES NOT OWN. A
  separator's text comes from a consumer's `meta.json` — `"---Reference---"` —
  and restyling it is this package rewriting words in a language it cannot read.
  Portuguese `Referência` shipped as `REFERÊNCIA`. Turkish trades its dotted and
  dotless `i` for each other under a naive uppercase. No CJK script has a case to
  transform at all, so those authors got the `letter-spacing` and none of the
  effect it existed to rescue.

  The string was already a prop. Its shape was not, and there was no way to turn
  this off short of overriding the rule.

  Reading as a divider rather than as another row is done by size, weight and a
  subtle colour — none of which touch a character. `letter-spacing` goes with the
  caps: it is there to make uppercase legible, and on sentence case it only reads
  as loose.

## 0.9.0

### Minor Changes

- 216f2df: **The search dialog says how to drive it.** A magnifier on the trigger and in
  the input, and a footer carrying `↑` `↓` Select · `↵` Open · `Esc` Close.

  ⚠️ AND IT DELETES A BUTTON THAT SAID `Close` IN HARDCODED ENGLISH. Every other
  user-facing string in this package had been lifted to a prop; that one was
  missed, in the one dialog a reader cannot leave without it — so a Portuguese
  site rendered a Portuguese dialog with an English way out. It is `closeLabel`
  now, alongside `selectLabel` and `openLabel`.

  The key-caps beside them are glyphs and stay untranslated: an arrow is an
  arrow, and `Esc` is `Esc` on a Portuguese keyboard. The props are the verbs,
  which are not.

  ⚠️ THE DISMISS CONTROL IS A BUTTON, NOT A THIRD HINT. Under `(hover: none) and
(pointer: coarse)` the two hints are hidden — on the same reasoning as the
  trigger's `⌘K`, that an instruction to press a key is one a reader on a phone
  cannot follow — and that leaves this as the only pointer route out of the
  dialog. It is not hidden with them.

  ⚠️ IT ALSO MOVED PAST THE RESULTS. The button it replaces sat in the input row,
  so one Tab from the query landed on _Close_ rather than on the first result —
  past every answer the reader had just asked for. Document order is tab order
  here, and a test now holds it.

  The hints are `aria-hidden`: they describe the pointer-free path through a
  listbox that a screen reader already exposes through `role`,
  `aria-activedescendant` and `aria-posinset`, so announcing them adds two lines
  of symbols and no information. The magnifiers are hidden for the reason the
  trigger's own label is pinned — named from content, that button once announced
  as "Search Ctrl K".

  Published sizes rise with it: the quick start's total 14 → 14.3 KB, the search
  dialog 9.3 → 9.5 KB. Budgets raised in `size-budget.json` with the reason.

  ⚠️ AND THE TRIGGER NOW SHARES A COLUMN WITH THE TREE. It sits directly above
  the navigation, so its magnifier is the first thing in the same column as every
  folder and page marker below it and its label starts the same column as every
  title — and both were out, measured at 1280px by 3px and 11px. The trigger was
  spaced as a standalone control: 10px of inline padding against the rows' 8px,
  and a 16px gap against their 8px. It carries a 1px border the rows do not, so
  the fix is `calc(0.5rem - 1px)` rather than `0.5rem` — matching the number
  instead of the content edge leaves it 1px out and looks fixed in a screenshot.
  A browser test measures both columns against the tree's.

  ## The trigger's shortcut is plain text again

  `⌘K` was a bordered chip inside a bordered, filled control — a chip on a chip,
  sharing its fill, for a hint nobody clicks. It kept that border only because
  the footer's key-caps were added to the same rule; the two are separate now,
  and a test holds them apart. There was never a `background` on either: the
  trigger's own `--wave-docs-bg-subtle` showed through, which is what made the
  border read as a filled shape.

  ⚠️ AND THE `⌘` IS ITS OWN ELEMENT, BECAUSE CSS CANNOT SELECT A CHARACTER.
  Measured in the shipped mono stack at 12px, the glyph carries 6.39px of ink
  against the `K`'s 8.75px — a third short of the letter beside it, in one string
  at one size. `1.45em` on the symbol brings it to 9.26px — a hair
  taller than the letter, which is what makes the two read as one mark. `Ctrl` is
  gated out of that rule by an attribute: it is a word set in the same face as
  the `K`, and scaling it makes the hint shout.

  ⚠️ AND SIZE ALONE LEAVES IT FLOATING. `⌘` is drawn around the font's
  mathematical axis rather than standing on the baseline like a capital, so at
  that size its ink centre sits 2.24px above the `K`'s while inline layout aligns
  the two by baseline. `vertical-align: -0.13em` drops it. Measured off a render
  at 8x: both ink boxes centre on the same pixel, with the symbol 5% the taller.

  New public class names: `.wave-docs-search-glyph`, `.wave-docs-search-footer`,
  `.wave-docs-search-hint`, `.wave-docs-search-kbd`, `.wave-docs-search-trigger-mod`.
  `.wave-docs-search-close` survives, restyled — it is a footer control now, not
  a bordered button in the input row.

### Patch Changes

- 5647418: Sidebar groups stop collapsing behind the reader.

  Expand three sections, click a page, and two of them shut. Or: open a section,
  read a page in it, open another section, read a page in _that_ — and the first
  one closes. Both reported from real use, and both the same defect.

  ⚠️ THE CAUSE WAS `setToggled({})` ON EVERY NAVIGATION. The reader's own state
  and the route's default share one map — `toggled[key] ?? hasActive` — so
  clearing it does not "reset the tree to its default" in any useful sense. The
  default is _open only what holds the current page_, so wiping the map collapses
  everything the reader had deliberately opened.

  Navigation now opens whatever holds the page just arrived at, and closes
  nothing. A group closes when the reader closes it.

  ⚠️ AND IT RECORDS `true` RATHER THAN DELETING THE KEY, WHICH IS THE HALF THAT
  IS EASY TO GET WRONG. Deleting also reopens the group — it falls back to
  `hasActive` — and looks correct for exactly one navigation. Read a page in one
  section, then a page in another, and the first section has no entry left and no
  longer holds the route, so it shuts. That is the second report, reproduced by
  the obvious fix.

  The state is also seeded from the first route rather than starting empty, so a
  group open at first paint is open by _record_ rather than by inference. Without
  it, landing on a deep page from a search result and clicking away collapses the
  section you arrived in, while one you had opened by hand would have stayed.

  Kept from the old reset: a group collapsed an hour ago must not hide the page
  just navigated to. It is reopened explicitly.

  It costs 60 gzipped bytes on the sidebar bundle — a walk that names the groups
  holding the current route. The line it replaces cost nothing, which is the
  point: the cheapest possible reset was also the one that threw away everything
  the reader had opened. Published sizes rise with it: the quick start's total
  14.3 → 14.5 KB, the navigation 3 → 3.1 KB.

## 0.8.0

### Minor Changes

- 98f8041: **The sidebar tells a category from a page at a glance.** A folder on every
  group, a page on every page.

  Weight and a chevron were the only difference, and that is not enough to scan:
  a `Reference` group sitting directly above an `Internals` page read as one
  undifferentiated column, and a real tree interleaves the two a dozen times. A
  silhouette is read before any word is.

  Two inline SVG paths, in the same style as the disclosure chevron and the
  external-link mark that were already there. The package still ships no icon
  set and takes no icon dependency — a folder and a page are as generic as the
  chevron beside them.

  `icons={false}` on `DocsSidebar` turns them off, for a host whose own
  navigation has a different vocabulary and does not want a second one.

  ⚠️ AN EXTERNAL LINK'S MARK MOVED TO THE HEAD OF ITS ROW. It used to sit at the
  far end, which cost twice: the leading slot had to be an empty box to stop the
  column going ragged, and the trailing edge carried two unrelated meanings —
  "opens elsewhere" on one row, "expands" on the next. Leading is what a row _is_;
  trailing is what it _does_. With the mark moved, the only thing at the far end
  of any row is a chevron, which is what makes a group legible from across the
  column, and it leaves that edge free for a status dot or an overflow control
  later. A browser test measures the alignment, because the claim is about a
  column and a column is geometry.

  The sr-only "(opens in a new tab)" did **not** move with it — the name is still
  read as "GitHub, opens in a new tab" rather than the other way round.

  ⚠️ AND `icons={false}` PUTS THE MARK BACK ON THE TRAILING EDGE. With no column
  to lead, rendering nothing would leave a link that leaves your site looking
  exactly like one that does not. Turning off a decorative column is not consent
  to drop a warning.

  The markers sit at `opacity: 0.4` and inherit their row's colour rather than
  carrying a grey of their own, so the relationship holds at every weight — a
  bold group title and a muted page title each get a marker a fixed step lighter
  than themselves. Full strength on hover and on the current page.

  New public class names: `.wave-docs-sidebar__icon` and
  `.wave-docs-sidebar__label`. The label wrapper is the flex hook that lets a row
  put a chevron at its far end, and it is present whether or not there is a
  marker beside it.

  ## Your own icons, by name

  The three built-ins are defaults, not a set. Content names an icon; the host
  maps the name to a component:

  ```yaml
  # content/internals.md
  icon: wrench
  ```

  ```json
  // content/reference/meta.json
  { "title": "Reference", "icon": "book" }
  ```

  ```tsx
  <docs.Layout icons={{ wrench: Wrench, book: Book }}>{children}</docs.Layout>
  ```

  Also on `DocsSidebar` and `DocsNav` for a hand-assembled shell.

  ⚠️ A NAME, NEVER ART THIS PACKAGE SHIPS. Content is authored in YAML and JSON
  and cannot carry a React element, and a docs package mounted inside someone
  else's application must not stand its iconography next to theirs. The bundle
  grows by a lookup, not by an icon set — and never will by one.

  ⚠️ EVERY COMPONENT IN THE MAP MUST BE A CLIENT COMPONENT. `docs.Layout` is a
  Server Component and the tree it hands the map to is not, so React serialises a
  _reference_ to each icon; a server component cannot be one. Icons imported from
  a library already satisfy this. The same boundary `search` documents.

  A name with no entry in the map falls back to the built-in marker for that
  node's type — a typo in one file leaves a folder where a book should be, not a
  hole in the column.

### Patch Changes

- 72ad371: The sidebar's disclosure chevron points at the group it belongs to.

  `.wave-docs-sidebar__group-header` is `justify-content: space-between`, so the
  chevron sits flush against the navigation's inline end with the label at the
  other side of the row — and unrotated it aimed at the panel's border. Worse
  than at nothing: a chevron at the _trailing_ edge of a row is the platform
  idiom for "this takes you somewhere else", so it read as navigation on a
  control that only opens a list in place. A collapsed group now points back at
  its own label; an open one still points down at its children.

  ⚠️ AND IT MIRRORS, WHICH A ROTATION DOES NOT DO ON ITS OWN. `rotate` is
  physical — 180deg is left in every writing mode — while every other property
  placing that row is logical. Under `dir="rtl"` the header mirrors, the chevron
  moves to the inline start and the label lands to its right, so a single
  unmirrored rotation would point it out of the panel on the other side: the same
  defect, reflected.

  ⚠️ THE MIRROR IS `[dir='rtl']`, NOT `:dir(rtl)`, AND THAT IS NOT A STYLE
  PREFERENCE. Next compiles this stylesheet with lightningcss, which downlevels
  `:dir(rtl)` into a hardcoded list of right-to-left _languages_ —
  `:is(:lang(ae), :lang(ar), … :lang(yi))`. Direction is not language, and the
  substitution is wrong in both directions: `<html dir="rtl" lang="en">` gets no
  mirror, `lang="ar" dir="ltr"` gets one it never asked for. It is invisible from
  inside this repo, because the tests inject the source text into a `<style>`
  element where `:dir()` behaves perfectly — it was caught by measuring the built
  site. The stylesheet now uses `:dir()` nowhere, and a test enforces that.

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
