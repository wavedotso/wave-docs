import '@waveso/docs/styles.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { docs } from '@/lib/docs';
import { siteIcons } from './icons';

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
 * ⚠️ `title` AND `actions` WERE HERE, AND EXERCISING THEM IS WHAT KILLED THEM.
 * This file passed a brand and a repository link because the README documented
 * them as the way to put chrome in the header — and doing it for real surfaced
 * three defects in one afternoon, then the question of why a documentation
 * package renders a header at all. At 0.7.0 it does not. The two props are
 * gone, the brand is the index page's own title, and a repository link
 * belongs in this file, around `docs.Layout`, not inside it.
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
      {/*
       * ⚠️ THE UA'S OWN 8px, AND REMOVING IT IS THE SITE'S JOB RATHER THAN THE
       * PACKAGE'S. Every browser ships `body { margin: 8px }`, and without this
       * the docs region starts 8px in — so the sidebar's divider stops short of
       * the top edge instead of running the height of the screen.
       *
       * `@waveso/docs` must never do this itself. It styles nothing outside
       * `.wave-docs-*`, and a package that resets `body` would move a host
       * application's entire page to fix its own corner of it.
       *
       * Not a layout property in the sense `site-budget.test.ts` forbids: it
       * lays nothing out, it clears a UA default, and it is the same class of
       * housekeeping as `lang="en"`. Every Next starter ships it in a
       * `globals.css`; this site has no stylesheet, so it goes here.
       */}
      <body style={{ margin: 0 }}>
        <docs.Layout icons={siteIcons}>{children}</docs.Layout>
      </body>
    </html>
  );
}
