---
'@waveso/docs': patch
---

**Five documentation claims that were not true, and the tests that stop them rotting again.**

**`pnpm size` now really does gate `prepublishOnly`.** The paragraph introducing the cost table says every figure is enforced "in CI and again in `prepublishOnly`" — the sentence that makes the whole table worth trusting — and the script ran typecheck, lint, test, build, `check:readme` and `check:package`. Nothing verified the published numbers at the one moment they became published. The claim is now true rather than deleted, and a test compares the two.

**The README no longer claims CI runs `pnpm shoot --check`.** It never has: the gate was added and removed without running once, because byte-compared PNGs cannot survive a change of operating system — the font stack resolves to SF Pro on the machine that shot them and to DejaVu on a Linux runner, so every text pixel differs and no tolerance rescues glyphs that are different shapes. A test now requires the README and `ci.yml` to agree either way.

**The screenshots are pinned to a tag whose images they actually are.** The pin said `v0.3.0` while the committed PNGs had been regenerated for 0.4.0's search work, so the README on npm showed a dialog the release it documented had replaced. A test compares the committed bytes against `git show <tag>:docs/media/…` — exact, offline, and skipped only in a shallow clone.

**`src/react/` does not import nothing from `next/*`.** Two modules do, and are named after the fact: `next-nav` for `usePathname` and `next-search` for `useRouter`. The project-structure listing and the Components paragraph both said otherwise.

**`SECURITY.md` supports `0.5.x`**, not `0.3.x`.

And two comments in `next.ts` that misdescribed the code they sit on: `layout.tsx` was called a `'use client'` module — it is a Server Component, and its own docstring has always said so — and the lazy import beside it was justified by that non-fact rather than by the real reason, which is that `layout.tsx` statically imports two client modules that reach `next/navigation` and `next/link`.
