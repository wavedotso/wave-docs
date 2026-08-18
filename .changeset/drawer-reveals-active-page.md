---
'@waveso/docs': minor
---

**The mobile drawer now opens on the page you are reading.** Scroll-the-current-item-into-view had never run on a phone — not intermittently, never.

Below 64rem the sidebar lives inside `<dialog class="wave-docs-layout__drawer">`, which the UA stylesheet keeps at `display: none` until `showModal()`, wrapped in a `.wave-docs-layout__sidebar` that is `display: contents`. An element in a `display: none` subtree generates no boxes at all, so both report `scrollHeight === clientHeight === 0` and the walk for a scrollable ancestor went past the drawer, past the grid, and returned `null`.

The timing is what made it unreachable rather than merely unreliable: the effect was keyed on `pathname` alone, and `DocsNav` closes the drawer on every `pathname` change — so at the one moment it could fire, the drawer was always shut, and nothing re-ran when the reader opened it. Measured in Chromium at 390×800 on a 60-item nav: the active item's bottom edge sat at **1594px in an 800px drawer**, 794px below the fold, on the one navigation where the reader knows exactly what they asked for.

`DocsSidebar` now also positions itself when a `<dialog>` around it opens. It finds that dialog with `closest('dialog')` rather than taking a prop from `DocsNav`, because the condition is "I am inside something that can be hidden and revealed" rather than "I am inside the drawer" — so a consumer who puts `DocsSidebar` in a dialog of their own gets the same behaviour, and nothing in the sidebar has to know what the drawer is.

**Size budgets raised deliberately:** `sidebar` 1.8 → 1.9 KB, `nav` 2.2 → 2.25 KB, `next-nav` 2.25 → 2.34 KB. The cost is one `toggle` listener; the sidebar was sitting at exactly 100% of its old budget, which is a CI failure waiting for the next byte rather than a limit doing any work.

**Why no other tier could see it:** jsdom has no layout and no `showModal`, and the stylesheet read as text says nothing about what `display: contents` does to a scrollport. The new tests assert the premise first — that the item measures zero height while the drawer is closed — so they cannot quietly degrade into tests that pass by measuring nothing.
