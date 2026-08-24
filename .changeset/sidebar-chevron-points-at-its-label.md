---
'@waveso/docs': patch
---

The sidebar's disclosure chevron points at the group it belongs to.

`.wave-docs-sidebar__group-header` is `justify-content: space-between`, so the
chevron sits flush against the navigation's inline end with the label at the
other side of the row — and unrotated it aimed at the panel's border. Worse
than at nothing: a chevron at the *trailing* edge of a row is the platform
idiom for "this takes you somewhere else", so it read as navigation on a
control that only opens a list in place. A collapsed group now points back at
its own label; an open one still points down at its children.

⚠️ AND IT MIRRORS, WHICH A ROTATION DOES NOT DO ON ITS OWN. `rotate` is
physical — 180deg is left in every writing mode — while every other property
placing that row is logical. Under `dir="rtl"` the header mirrors, the chevron
moves to the inline start and the label lands to its right, so a single
unmirrored rotation would point it out of the panel on the other side: the same
defect, reflected.

⚠️ THE MIRROR IS `[dir='rtl']`, NOT `:dir(rtl)`, AND THAT IS NOT A STYLE
PREFERENCE. Next compiles this stylesheet with lightningcss, which downlevels
`:dir(rtl)` into a hardcoded list of right-to-left *languages* —
`:is(:lang(ae), :lang(ar), … :lang(yi))`. Direction is not language, and the
substitution is wrong in both directions: `<html dir="rtl" lang="en">` gets no
mirror, `lang="ar" dir="ltr"` gets one it never asked for. It is invisible from
inside this repo, because the tests inject the source text into a `<style>`
element where `:dir()` behaves perfectly — it was caught by measuring the built
site. The stylesheet now uses `:dir()` nowhere, and a test enforces that.
