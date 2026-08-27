---
'@waveso/docs': patch
---

**The sidebar trigger's hover is the sidebar's own tint.**

⚠️ IT WAS A BLUE ARRIVED AT INDEPENDENTLY. `color-mix(in oklab,
var(--wave-docs-accent) 30%, transparent)` sat directly against a navigation
column whose active row is `--wave-docs-accent-subtle` — two tints of one accent
a few pixels apart, neither able to follow the other when a host retunes the
palette.

Now both read the same token. Measured: `lab(95.3453 -2.89604 -8.75145)` on the
strip and on the current page's row.
