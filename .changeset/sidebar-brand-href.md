---
'@waveso/docs': minor
---

**`docs.Layout` takes a `brandHref`: where the sidebar's brand links, usually the site's root.**

Optional. Unset, the brand renders as before, not a link. Set, it is wrapped in a plain anchor, `.wave-docs-layout__brand-link`, in the text's own color with no underline and the shell's focus ring. A plain anchor rather than a router link, so the page loads in full: the root is usually outside the docs, and the host's own landing runs there.

⚠️ Do not set it when the node you pass is already a link — the two nest an
anchor inside an anchor, which a browser unnests. Pass the mark and let
`brandHref` wrap it, or keep your own link and leave `brandHref` unset.

The brand's wrapper now lays its content out — `display: flex`,
`align-items: center`, `gap: 0.5rem` — rather than only spacing itself. That is
what keeps a linked brand and an unlinked one identical, since the content sits
one level deeper inside the anchor. **It also reaches a brand that was already
on 0.16.0**: one passing several children, such as `<><Logo /> Acme</>`, gains
the row and the gap it previously had to supply itself. A brand that is a single
element of its own is unchanged.
