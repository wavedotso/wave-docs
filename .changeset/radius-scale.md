---
'@waveso/docs': minor
---

**One radius scale, taken from `@waveso/ui`, retunable from a single line.**

Three tiers, all `calc()` off one root, so which corner a box gets is decided by
what *kind* of box it is rather than by how big it happens to be:

| Token | What takes it |
| --- | --- |
| `--wave-docs-radius-sm` | inline chips, small controls, focus rings on those |
| `--wave-docs-radius` | controls, overlays, and the panel's inset surface |
| `--wave-docs-radius-lg` | every block in the reading flow, and the panel's outer edge |

⚠️ THE BLOCK TIER WAS SPLIT. Callouts, images and video embeds sat at the base
radius while a code frame and a table sat at 19px, so two blocks a paragraph
apart disagreed by eleven pixels — and a table read as aggressively round next
to the callout above it. 19 was measured off a reference site, which is a fine
way to pick a number and a bad way to pick a *system*.

⚠️ AND THE NUMBERS ARE `@waveso/ui`'s, NOT NEW ONES. A page running both this
package and the component library should not show two radius scales a few pixels
apart, and taking theirs is how that is guaranteed rather than kept in step by
hand. `--wave-docs-radius-base` is the override point: a host writes
`--wave-docs-radius-base: var(--radius)` and every corner here follows their app,
including any theme that moves it. Overriding three tokens separately would be
three chances to break the arithmetic below.

⚠️ `--wave-docs-radius-step` IS LOAD-BEARING. The panel's inset surface takes the
base radius and its frame takes `-lg`, which is the base plus one step — so the
two corners are concentric only while the frame's *padding* is that same step.
It is paid out of the token rather than written as `4px`, so moving the root
keeps both true. `--wave-docs-radius-panel` is gone with it: a token whose only
job is to be another token minus a constant is a number that can drift from its
own definition.

## Squircles, where the browser has them

`corner-shape` renders every `border-radius` as a continuous superellipse rather
than a circular arc. `@waveso/ui` ships it and this now matches, including the
root bump both make under the same `@supports` — a squircle reads tighter at the
same radius, so the scale moves up to restore the roundness the numbers were
chosen for. Only the root moves; every tier and the panel's padding follow.

⚠️ SCOPED TO ELEMENTS THIS PACKAGE OWNS, AND NOT `*`. `@waveso/ui` can say `*`
because it is the application's own stylesheet. This one is mounted inside
somebody else's page, and a bare `*` would reshape every corner the host drew —
the same trespass as claiming `html` or `body`, which this file already refuses.
Pills and dots opt back out, because a squircled pill is a lozenge.

⚠️ AND THE SOURCE TEST FOR THE CONCENTRIC ARITHMETIC WENT VACUOUS ON THE WAY.
It regexed three `rem` literals out of the token block; with the tiers as
`calc()` the regex matched nothing, both sides defaulted to zero, and `0 - 0`
passed while asserting nothing. It is measured in computed pixels now, which is
also the only tier that can see the squircle bump. Two browser assertions that
built an expected radius out of `getPropertyValue` were the same mistake in a
different shape — a custom property is not computed to pixels, so it hands back
the `calc()` as written. They compare two computed corners to each other now,
which is the uniformity claim anyway.
