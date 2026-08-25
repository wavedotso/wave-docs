/**
 * The reading order, which is the sidebar's order and must stay so.
 *
 * Every case here is a shape the tree really produces — a group with an index
 * page, one without, a hand-written internal link, an external one, a
 * separator — because the pager's whole claim is that it cannot disagree with
 * the column a reader is looking at.
 */

import { describe, expect, it } from 'vitest';

import { neighbours, readingOrder, stepTitle } from './nav-order.js';
import type { DocNavNode } from './types.js';

const nav: DocNavNode[] = [
  { type: 'page', title: 'Overview', href: '/docs', slug: '' },
  { type: 'separator', title: 'Reference' },
  {
    type: 'group',
    title: 'API',
    href: '/docs/api',
    children: [
      { type: 'page', title: 'Auth', href: '/docs/api/auth', slug: 'api/auth' },
      {
        type: 'group',
        title: 'Webhooks',
        children: [
          {
            type: 'page',
            title: 'Signatures',
            href: '/docs/api/webhooks/signatures',
            slug: 'api/webhooks/signatures',
          },
        ],
      },
    ],
  },
  { type: 'link', title: 'Handbook', href: '/handbook', external: false },
  { type: 'link', title: 'npm', href: 'https://npmjs.com', external: true },
];

describe('readingOrder', () => {
  it('is the order a reader meets the rows, depth first', () => {
    expect(readingOrder(nav).map((stop) => stop.href)).toEqual([
      '/docs',
      // The group's own page comes before its children, because its row does.
      '/docs/api',
      '/docs/api/auth',
      '/docs/api/webhooks/signatures',
      '/handbook',
    ]);
  });

  /**
   * ⚠️ A SEPARATOR IS A LABEL WITH NOWHERE TO GO, and an external link has
   * left the documentation. A "next page" landing on npm has ended the
   * sequence rather than continued it.
   */
  it('skips separators and external links', () => {
    const hrefs = readingOrder(nav).map((stop) => stop.href);
    expect(hrefs).not.toContain('https://npmjs.com');
    expect(hrefs).toHaveLength(5);
  });

  /** A group with no index page is a heading, not a stop. */
  it('gives an unlinked group no stop of its own', () => {
    expect(readingOrder(nav).map((stop) => stop.title)).not.toContain(
      'Webhooks',
    );
  });
});

describe('neighbours', () => {
  it('walks the sequence in both directions', () => {
    expect(neighbours(nav, '/docs/api/auth')).toEqual({
      previous: { title: 'API', href: '/docs/api' },
      next: { title: 'Signatures', href: '/docs/api/webhooks/signatures' },
    });
  });

  it('omits the end that does not exist', () => {
    expect(neighbours(nav, '/docs')).toEqual({
      next: { title: 'API', href: '/docs/api' },
    });
    expect(neighbours(nav, '/handbook')).toEqual({
      previous: {
        title: 'Signatures',
        href: '/docs/api/webhooks/signatures',
      },
    });
  });

  it('treats a trailing slash as the same page', () => {
    expect(neighbours(nav, '/docs/api/auth/')).toEqual(
      neighbours(nav, '/docs/api/auth'),
    );
  });

  /**
   * ⚠️ `findIndex` RETURNS -1, WHICH READS AS "JUST BEFORE THE BEGINNING".
   * Left unguarded, `stops[at + 1]` hands every draft, every page excluded
   * from the navigation and every route rendered outside the tree the same
   * first page as its "next" — a pager that is confidently wrong on exactly
   * the pages nobody checks.
   */
  it('gives a page outside the tree no pager at all', () => {
    expect(neighbours(nav, '/docs/draft')).toEqual({});
  });

  it('gives an empty tree no pager either', () => {
    expect(neighbours([], '/docs')).toEqual({});
  });
});

describe('stepTitle', () => {
  const stops = readingOrder(nav);

  it("takes the navigation's name for a page in the tree", () => {
    expect(stepTitle(stops, { href: '/docs/api/auth' })).toBe('Auth');
  });

  it('prefers a title the author wrote', () => {
    expect(
      stepTitle(stops, { href: '/docs/api/auth', title: 'Signing in' }),
    ).toBe('Signing in');
  });

  it('treats a trailing slash as the same page', () => {
    expect(stepTitle(stops, { href: '/docs/api/auth/' })).toBe('Auth');
  });

  /**
   * ⚠️ `undefined`, SO THE CALLER CAN THROW. Falling back to the href renders a
   * URL where a sentence should be — "Where this runs and what that buys →
   * /docs/infrastructure" — on a page that builds cleanly, and nothing else in
   * the pipeline would notice.
   */
  it('resolves nothing for an href the tree does not own', () => {
    expect(stepTitle(stops, { href: 'https://example.com' })).toBeUndefined();
    expect(stepTitle(stops, { href: '/docs/draft' })).toBeUndefined();
  });
});
