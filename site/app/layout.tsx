import '@waveso/docs/styles.css';
import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
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
 * It is still no CSS and no wrapper of its own. If a page here ever needs a
 * layout rule that is not in the package, that is a defect in the package
 * rather than a thing to add locally.
 *
 * ⚠️ `title` AND `actions` ARE HERE BECAUSE THEY ARE THE DOCUMENTED WAY TO PUT
 * CHROME IN THE HEADER, AND NOTHING EXERCISED THEM. The README tells a reader
 * to call `docs.Layout` rather than re-export it when they want a brand and a
 * repository link; until this site did, the two props were covered by unit
 * tests and by no real build. They also cost nothing the harness protects: both
 * are `ReactNode` slots the shell places itself, so this file still declares no
 * layout of its own.
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
        <docs.Layout
          title={<Link href="/">Wave Docs</Link>}
          actions={<a href="https://github.com/wavedotso/wave-docs">GitHub</a>}
        >
          {children}
        </docs.Layout>
      </body>
    </html>
  );
}
