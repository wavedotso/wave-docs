---
'@waveso/docs': minor
---

**The search dialog says how to drive it.** A magnifier on the trigger and in
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
so one Tab from the query landed on *Close* rather than on the first result —
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
