---
'@waveso/docs': patch
---

**Three radii, and which one a box takes is decided by what kind of box it is
rather than by how big it happens to be.**

| Tier | Value | What takes it |
| --- | --- | --- |
| `--wave-docs-radius-sm` | 6px | inline chips, small controls, their focus rings |
| `--wave-docs-radius` | 8px | controls, overlays, **and the panel's inset surface** |
| `--wave-docs-radius-lg` | 12px | every block in the reading flow |

⚠️ THE BLOCK TIER WAS SPLIT, AND THAT IS WHAT THIS FIXES. Callouts, images and
video embeds sat at the base radius while a code frame and a table sat at 19px,
so two blocks a paragraph apart disagreed by eleven pixels — and a table read as
aggressively round next to the callout above it. 19 was measured off a reference
site, which is a fine way to pick a number and a bad way to pick a *system*.

Callouts, images, embeds, excluded fences, tables, code frames framed or not,
and the panel's outer edge are now one number.

⚠️ AND `--wave-docs-radius-panel` IS GONE, BECAUSE IT WAS A TOKEN WHOSE ONLY JOB
WAS TO BE ANOTHER TOKEN MINUS A CONSTANT. The panel's inset surface has to be
the frame's radius minus the frame's padding, or the corners run at different
curvatures and the surface reads as pasted onto the frame rather than set into
it. `12 - 4 = 8` is the base radius, so the arithmetic the README already
claimed now literally lands, and there is no second number to drift from its own
definition.

A source guard lists the blocks. A new block in the reading flow belongs on it;
a new *control* does not, and that is the distinction to defend.
