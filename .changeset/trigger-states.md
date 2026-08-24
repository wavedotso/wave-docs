---
'@waveso/docs': patch
---

The sidebar grip says whether it has anything to do.

Blue when the navigation is hidden or the pointer is on it; grey when the
sidebar is open and untouched. One rule at every width — a closed sidebar is
the same request for attention on a phone as on a desktop.

⚠️ `:not([data-state='open'])`, NOT `[data-state='closed']`. The attribute is
absent until the reader chooses, and a server-rendered page has none — so
matching only the explicit value leaves every first paint below 64rem showing a
grey grip in front of hidden navigation, which is the one moment the cue is
for. Above 64rem the default inverts, and a second rule says so.

⚠️ AND THE COLOUR IS A CUSTOM PROPERTY, NOT A SELECTOR FIGHT. Three things want
to set it — the resting style, the pointer, and the sidebar's state — and the
state lives on an *ancestor*, so `.sidebar[data-state] .trigger::before`
outranks `.trigger:hover::before` by a whole class. Written as backgrounds that
is a rule which silently kills hover on the one state that still needs it.
Properties settle it by inheritance: the state sets them on the sidebar, the
trigger sets them on itself under `:hover`, and a value on the element always
beats one it inherited. No specificity ladder, no `!important`.

The grip is also a full pill now rather than a rounded rectangle.

⚠️ TESTED AS MARKUP, BECAUSE A MOUNTED COMPONENT CANNOT SHOW THE UNTOUCHED
STATE. `DocsNav` resolves the mode on mount and writes `data-state`
immediately, so every React fixture is already explicit. Two wrong versions
passed the whole suite against that — matching the explicit value, and dropping
the wide-layout reset — and both are caught now by a server-shaped fixture with
no attribute at all.

Also fixed here: the focus-indicator guard looked up one rule per selector, and
a selector may legitimately appear in several. The trigger now has one rule
setting properties on focus and another drawing the ring; taking "the first" or
"the last" is a coin flip on file order, so it reads every rule and asks for
one to declare an outline.
