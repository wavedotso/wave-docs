---
'@waveso/docs': minor
---

**The search dialog's props are in the README, and the ones that were missing were the ones the changelog told you to migrate to.** A consumer on 0.3.0 with `<DocsSearch maxResults={20} />` upgraded to 0.4.0, watched TypeScript reject `maxResults`, opened the file the Stability section calls the definition of public API, searched 57 KB of it for the replacement — and found neither `pageSize` nor `minQueryLength`.

There is a props table under **Search → The dialog's props** now, and a check that stops the next rename shipping undocumented: `manifest.test.ts` reads every `…Props` interface out of the emitted `.d.ts` and requires each member to be named in the README. It found seven more the moment it was written — `DocsTocProps.rootMargin` and `.topLabel`, `DocsLinkProps.prefetch`, `DocsImageProps.sizes` and `.loading`, and two of my own — all now documented rather than allowlisted.

**Six of the dialog's strings turned out to be hardcoded English**, which is the same defect this release fixes everywhere else and was hiding behind a prop list that looked complete: `triggerLabel`, `placeholder` and `dialogLabel` were props from the start, so `search={{ … }}` read as *the* channel for the dialog's words — while every state message was a literal. They are props now: `hintLabel`, `shortQueryLabel`, `loadingLabel`, `errorLabel`, `emptyLabel`, with `{min}` and `{query}` interpolated.

**And the live region announced "3 results" in English on every site on earth.** `resultCountLabels` is keyed by plural category rather than being a singular and a plural, because most languages are not English — Polish takes four forms, Arabic six. `Intl.PluralRules` picks, using `locale` or the document's own `<html lang>`, and a category you do not list falls back to `other`. An invalid `lang` is caught rather than thrown: that is the site's typo, not a reason to announce nothing.

**`hotkey` does not exist and never did.** `DocsLayoutProps.search` listed it among the props an object may carry. The shortcut is ⌘K / Ctrl-K and is not configurable; the docstring says so now. `SearchDialogProps.indexUrl` likewise documented itself in terms of `writeSearchIndex`, which was deleted in 0.3.0.

**Published figure raised:** search dialog and router wiring, 9.0 → 9.3 KB.
