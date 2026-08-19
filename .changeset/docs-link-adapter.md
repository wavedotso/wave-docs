---
'@waveso/docs': minor
---

**New subpath `@waveso/docs/react/next-link`, exporting `DocsLink`** — `next/link` already adapted, so composing a shell by hand no longer needs a cast.

Passing `next/link` straight into `DocsSidebar` does not type-check under `exactOptionalPropertyTypes`: Next's `LinkProps` re-declares `onClick?`, `onMouseEnter?` and `onTouchStart?` *without* `| undefined` while React's anchor props include it, so the two declaration files disagree over three props `next/link` accepts perfectly well at run time. It is a disagreement between dependencies, true of every `next/link` call site in a project with that flag on, and nothing the shape of `DocsLinkProps` can fix without breaking the plain-`<a>` fallback that keeps these components host-agnostic.

`docs.Layout` and `DocsSearch` have always absorbed it internally, so it only bit someone building their own shell — who was told in Troubleshooting to write `Link={Link as DocsLinkComponent}` and wait for a Next-wired component to ship. This is that component; the cast is retired and the note now shows the import.

```tsx
'use client';
import { DocsLink } from '@waveso/docs/react/next-link';
import { DocsSidebar } from '@waveso/docs/react/sidebar';

<DocsSidebar nav={nav} pathname={pathname} Link={DocsLink} />
```

It carries `'use client'` — not for a hook, there is none, but because `DocsLink` is a function and a function cannot be handed from a Server Component to a Client one. Without the directive it would be a server reference and `next build` would refuse it, which is the same boundary this release fixed for MiniSearch options.

The private adapter factory it is built from is renamed `link-adapter.ts`, so the two are not one letter apart in the same directory. 180 bytes gzipped, with a 300-byte budget: it should stay the thinnest thing this package ships to a browser.
