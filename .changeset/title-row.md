---
'@waveso/docs': patch
---

**The "Copy page" button is centred on the title's line, not top-aligned with it.**

⚠️ TWO BOXES OF DIFFERENT HEIGHTS SHARING A TOP EDGE ARE NOT ALIGNED. The header
started at the title's `y` and the button is the shorter of the two, so it sat
3px high against the line box and 6.4px high against the title's actual ink —
small, and visible.

The header now matches the title's line box and centres inside it, which is what
`align-items: center` would do if the heading were ours to put in a flex row.
Both the height and the leading come from tokens the `h1` reads too —
`--wave-docs-page-title-line` and `--wave-docs-h1-line-height` — so the two
cannot drift. Measured: both centres at 73.3px, off by zero.

`styles.test.ts` resolves the leading through the token rather than parsing the
declaration, for the same reason it already follows `--wave-docs-h1-size`: the
invariant is that leading rises as size falls, and moving the number into a
token did not change it.
