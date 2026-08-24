'use client';

import type { ReactNode } from 'react';

/**
 * The site's own sidebar markers, and the reason this file exists at all.
 *
 * `@waveso/docs` ships three glyphs — a folder, a page, an external arrow —
 * and no icon set, because it is mounted inside applications that already have
 * one. Anything beyond those three comes from the site, keyed by the `icon`
 * names its content authors in frontmatter and `meta.json`.
 *
 * ⚠️ `'use client'`, AND NOT AS A FORMALITY. `docs.Layout` is a Server
 * Component and the tree it hands this map to is not, so the map crosses that
 * boundary: React can serialise a *reference* to a client component and cannot
 * serialise a server one. Drop this directive and the build fails at the
 * boundary with an error about the map, not about the icons.
 *
 * No `style` attribute anywhere, per the site's zero-layout-CSS budget — these
 * size themselves with `100%` inside the 1rem box the package draws, and take
 * their colour from the row with `currentColor`.
 */
function Glyph({ children }: { children: ReactNode }): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      width="100%"
      height="100%"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const siteIcons = {
  book: () => (
    <Glyph>
      <path d="M12 7v14" />
      <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
    </Glyph>
  ),
  compass: () => (
    <Glyph>
      <circle cx="12" cy="12" r="10" />
      <path d="m16.24 7.76-1.8 5.41a2 2 0 0 1-1.27 1.27l-5.41 1.8 1.8-5.41a2 2 0 0 1 1.27-1.27z" />
    </Glyph>
  ),
  wrench: () => (
    <Glyph>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </Glyph>
  ),
  rocket: () => (
    <Glyph>
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91 0z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </Glyph>
  ),
};
