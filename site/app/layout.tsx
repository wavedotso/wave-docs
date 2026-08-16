import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

/*
 * ⚠️ THIS FILE MUST STAY THIS SMALL. The site exists to prove that
 * `docs.Layout` needs no help — `site.test.ts` asserts that no stylesheet here
 * declares a layout property, and a root layout quietly setting a max-width or
 * a grid would make the whole harness a lie while looking like housekeeping.
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
      <body>{children}</body>
    </html>
  );
}
