---
'@waveso/docs': minor
---

**"Where to go next": a question per row, and the page that answers it.** A page
opts in from its frontmatter:

```yaml
explore:
  - question: How a person is recognised across servers
    href: ./identity.md
  - question: What happens when the network fails
    href: ./delivery.md
```

A sidebar is a structure; this is a router. It says *why* a reader would go
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
things. The rule is a *top* border on every row but the first — `:last-child`
leaves a doubled line the moment anything is appended to the list.

## And the frame is a primitive, not this component's furniture

`.wave-docs-panel` is a framed block with a header and an inset surface — the
outer card names the thing and carries its controls, the inner one holds the
content. "Where to go next" is the first thing to wear it; a code frame is the
obvious next, and two copies of the same three rules is how they drift apart.

⚠️ THE TWO RADII ARE NOT INDEPENDENT NUMBERS. A rounded box inside a rounded box
only looks right when the inner radius is the outer one minus the gap between
them; anything else runs the corners at different curvatures and the inner box
reads as *pasted onto* the frame rather than set into it. The new
`--wave-docs-radius-lg` is chosen so the arithmetic lands on an existing token:
`1rem` outer minus `0.5rem` of padding is `--wave-docs-radius`.

The header sits in the frame's padding and draws no rule of its own — the inset
surface below already draws the line, and a border there is a second one a pixel
away from the first.

⚠️ AND THE PANEL EXPORTS `--wave-docs-panel-inset`, WHICH IS NOT THE SAME NUMBER
AS ITS PADDING. The title sits at the frame's padding; anything inside the body
sits at that padding *plus the body's own border*, so the two columns miss each
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

`steps` is wrong for a different reason: these rows are a *branch*, not a
sequence. A reader picks one and ignores the rest, and none of them is first.
A numbered "1 -> 2 -> 3" component is a real and separate thing worth building
later, and `steps` is the name it will need.

The rendered heading is still "Where to go next" — `next` in prose is fine,
it is only the identifier that had to move.

No client JavaScript. New: `DocsExplore` at `@waveso/docs/react/explore`,
`explore` in frontmatter, and `explore` in `labels`.
