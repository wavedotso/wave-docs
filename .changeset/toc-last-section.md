---
'@waveso/docs': patch
---

The table of contents marks the last section when you reach it.

Scroll to the foot of a page whose final section is short and nothing happened:
the entry stayed on the section *above*, and the last one could only be
highlighted by clicking its own link.

⚠️ NO `rootMargin` FIXES THIS, WHICH IS WHY IT LOOKED LIKE A TUNING PROBLEM.
The default makes the top 40% of the viewport the region that counts as
current, and that is right while there is document left to scroll — a heading
rises into the band and takes the highlight. At the end there is none. A short
trailing section sits on screen, fully readable, below a band it can never
enter, while the heading above it is still *inside* that band. The observer was
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
