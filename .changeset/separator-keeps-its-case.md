---
'@waveso/docs': patch
---

Sidebar separators keep the case their author wrote them in.

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
