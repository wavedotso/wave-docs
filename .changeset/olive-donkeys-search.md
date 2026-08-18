---
'@waveso/docs': minor
---

The search dialog, corrected by using it. Five defects a reader meets and no test could see, and one rename that follows from the largest of them.

**`maxResults` is now `pageSize`, and it is a window rather than a ceiling.** It capped the list at 20 (8 in 0.2.0): on a *six-page* site "docs" matches 18, so results were unreachable, and the live region announced the slice as though it were the total — not a smaller truth but a false one.

The cap was justified by a claim nobody had measured, and measuring it did not support the claim. On a 300-page corpus (2,100 records) a MiniSearch query costs **1.3–3.0 ms**, and rendering *every* matching row costs **40 ms**, 128 ms at 4× CPU throttle. The search was never the cost; the DOM only becomes one in the thousands.

So the list pages. Twenty rows render, and another twenty each time the reader scrolls near the end — the DOM stays bounded and nothing is withheld. The keyboard widens the window too, or `aria-activedescendant` points at an option that is not in the DOM. `aria-setsize` carries the real total on every option, because a listbox rendering 20 of 2,100 that says "20 of 20" tells a reader they have reached the end when they have not.

**Migration:** rename the prop. `maxResults={20}` becomes `pageSize={20}`, and it now means "reveal this many at a time" rather than "never show more than this".

**The dialog sizes to its results.** It was 32rem tall in every state — measured 514px with no query, 514px with eight results, 514px with none, of which 392px was an empty results area, so a reader typed into a box floating at the top of a large blank rectangle. A flex container defaults to `align-items: stretch`, so the dialog stretched to the viewport and `max-height` capped it at a constant instead of being the ceiling it was written to be. It is content-height now, and starts scrolling at the same 32rem.

**Hovering a half-visible result no longer yanks the list.** Pointing at a row clipped by the top or bottom edge set the active option, which fired the scroll-into-view meant for the arrow keys: the row snapped flush, the whole list moved under the cursor, and the cursor was then over a different row. Measured as a 28px jump. Only the keyboard scrolls now, and a new result set explicitly returns to the top — which that effect had been doing by accident.

**Every result row says where it lands, in the same words.** The second line was a breadcrumb of page and heading names, except on a page's own record — whose heading *is* its page title — which got no second line at all rather than repeat itself. On a six-page site that is six of twenty-nine records, so the list came out ragged and the barest rows said the least: a row reading only "Wave Docs" told a reader nothing about what it opened.

Every row now shows the page it lands on: the route, without its anchor. The anchor is slugged from the heading printed directly above it, so it spent the line restating line one. The link keeps it, so a hit still deep-links to its section.

**Breaking in rendered output:** `.wave-docs-search-result-breadcrumb`, `.wave-docs-search-result-crumb` and `.wave-docs-search-result-crumb-separator` are replaced by a single `.wave-docs-search-result-location`, because a breadcrumb it is not. A screen reader still hears the words — a route read aloud is punctuation — so the option's `aria-label` carries "Layout tokens, Styling" while the visible line carries the address.

**A query is at least two characters**, settable with `minQueryLength`. Measured on this package's own documentation: `a` matches 100% of the corpus, `i` 97%, `s` 93%. One character is not a query, it is a reader halfway through typing one, and answering it with everything teaches them that search returns noise. Below the floor nothing runs — no search, no index request — and the dialog says "Keep typing" rather than sitting there answering nothing.

Two rather than three, and the difference matters on a docs site: three would refuse `ts`, `js`, `id`, `h1` and `px`, each a real query here and each selective — 10%, 17%, 14%, 3%, 0%. The noise is at one character, so that is where the floor goes.
