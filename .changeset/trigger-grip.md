---
'@waveso/docs': patch
---

**The sidebar trigger is a grip, not three dots.**

⚠️ THE DOTS SAID THE WRONG THING. Three of them read as *more options* in most
interfaces and as a texture to grab in the rest — and this control is neither a
menu nor a drag handle in the resizing sense: it is a toggle on the seam between
two panes, with `aria-expanded` and an accessible name that changes with it.
Parallel bars are unambiguously a handle.

A chevron was the other candidate and it loses on shape. The control is a 16px
pill and an arrow wants to be square, so it either crowds the pill's edges or
shrinks below the rest of the icon set. Lines are narrow by nature: two 2px bars 4px apart is 6px of ink with 5px clear either side.

Still one element and a `box-shadow` copy, the way the dots were — no markup,
and it follows `currentcolor` through the hover state for free. The element is
shifted half the gap off centre so the *pair* is centred rather than the first
bar being.
