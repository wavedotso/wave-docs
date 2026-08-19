import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * `/` sends a reader to `/docs`.
 *
 * ⚠️ NOT `redirect()`, WHICH DOES NOT SURVIVE A STATIC EXPORT. It used to be
 * `redirect('/docs')` from `next/navigation`, and under `output: 'export'` that
 * throws `NEXT_REDIRECT` with no server left to act on it — so Next wrote its
 * own error boundary to `out/index.html`. The harness never noticed, because
 * nothing served the output: the site built, the assertion was "it built", and
 * the front page of the deployment was a crash. Found by deploying it.
 *
 * A `<meta http-equiv="refresh">` needs no server and no JavaScript, which is
 * the whole requirement on a static host. The visible link is not decoration:
 * it is what a reader gets if the refresh is blocked, and what a crawler
 * follows.
 *
 * `canonical` points at the destination so the two URLs are not indexed as
 * separate pages with the same content — the duplicate-content problem
 * `[[...slug]]` was rejected for, which it would be odd for this site to commit.
 *
 * This becomes a real landing page when the site gets its own content; the
 * redirect is what `/` should do until there is something there worth reading.
 */
export const metadata: Metadata = {
  title: 'Wave Docs',
  alternates: { canonical: '/docs' },
  robots: { index: false, follow: true },
};

export default function Home(): ReactNode {
  return (
    <>
      <meta httpEquiv="refresh" content="0; url=/docs" />
      <p>
        <a href="/docs">Wave Docs documentation</a>
      </p>
    </>
  );
}
