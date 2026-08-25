---
'@waveso/docs': patch
---

**A blockquote is a box, not a rule down one edge.**

Every other block set apart from the prose here — a callout, a code frame, a
table, an embed — is a bordered box. A single 3px edge made the quote the one
exception, so next to a callout two paragraphs away it read as a *different kind
of thing* rather than as a quieter one.

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
