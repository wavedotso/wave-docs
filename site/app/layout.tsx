import '@waveso/docs/styles.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { docs } from '@/lib/docs';

/*
 * ⚠️ THIS FILE MUST STAY THIS SMALL. The site exists to prove that
 * `docs.Layout` needs no help — `site-budget.test.ts` asserts that no
 * stylesheet here declares a layout property, and a root layout quietly setting
 * a max-width or a grid would make the whole harness a lie while looking like
 * housekeeping.
 *
 * ⚠️ THE SHELL IS IN THE ROOT LAYOUT BECAUSE THE DOCS ARE AT THE ROOT. With
 * `basePath: '/'` there is no `/docs` segment to hang a nested layout on, so the
 * one layout there is renders both. `docs.Layout` does not own `<html>` or
 * `<body>` — that is what makes this composition legal, and it is the same
 * property that lets a consumer put an announcement banner above it.
 *
 * It is still one line of shell with no CSS and no wrapper of its own. If a page
 * here ever needs a layout rule that is not in the package, that is a defect in
 * the package rather than a thing to add locally.
 *
 * `color-scheme` is not layout: it tells the browser which form controls and
 * scrollbars to paint, and omitting it gives a dark page white scrollbars.
 */
export const metadata: Metadata = {
  title: { default: 'Wave Docs', template: '%s · Wave Docs' },
  description:
    'Zero parser bytes in the browser: markdown docs for Next.js, built to hast in Node and rendered as your components.',
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <html lang="en">
      <body>
        <docs.Layout>{children}</docs.Layout>
      </body>
    </html>
  );
}
