/**
 * The slug → title map a search result's trail reads.
 *
 * The subject is the case the navigation makes awkward: a group has a title
 * and no slug, so its directory has to come from the pages under it.
 */

import { describe, expect, it } from 'vitest';

import { buildCrumbTitles } from './nav-crumbs.js';
import type { DocNavNode } from './types.js';

const page = (slug: string, title: string): DocNavNode => ({
  type: 'page',
  title,
  href: `/${slug}`,
  slug,
});

const group = (title: string, children: DocNavNode[]): DocNavNode => ({
  type: 'group',
  title,
  children,
});

describe('buildCrumbTitles', () => {
  it('names a directory from the title on its group', () => {
    /*
     * ⚠️ THE GROUP HAS NO SLUG. `DocNavGroup` is a title, a children array and
     * an optional `href` — nothing names its directory — so the path comes
     * from the first page under it, cut at the depth the group sits at.
     */
    const titles = buildCrumbTitles([
      group('Getting started', [
        page('getting-started/installation', 'Installation'),
        page('getting-started/quick-start', 'Quick start'),
      ]),
    ]);

    expect(titles).toEqual({
      'getting-started': 'Getting started',
      'getting-started/installation': 'Installation',
      'getting-started/quick-start': 'Quick start',
    });
  });

  it('keys the cumulative path, not the bare segment', () => {
    /*
     * ⚠️ TWO DIRECTORIES CAN SHARE A NAME. `guides/api` and `reference/api`
     * are both `api`, and keyed by the segment alone the second would silently
     * rename the first — a trail reading "Reference" under Guides.
     */
    const titles = buildCrumbTitles([
      group('Guides', [group('API', [page('guides/api/auth', 'Auth')])]),
      group('Reference', [
        group('API reference', [page('reference/api/errors', 'Errors')]),
      ]),
    ]);

    expect(titles['guides/api']).toBe('API');
    expect(titles['reference/api']).toBe('API reference');
  });

  it('reaches a page nested below an intermediate group', () => {
    // The first descendant is found depth first, so a group whose own children
    // are groups still names its directory.
    const titles = buildCrumbTitles([
      group('Guides', [group('API', [page('guides/api/auth', 'Auth')])]),
    ]);

    expect(titles.guides).toBe('Guides');
  });

  it('includes the root page under the empty string', () => {
    // What a result for the site's own index has instead of a trail.
    expect(buildCrumbTitles([page('', 'Overview')])).toEqual({
      '': 'Overview',
    });
  });

  it('names nothing for a group with no pages under it', () => {
    // Correct rather than defensive: nothing links there, so no trail can
    // reach it.
    const titles = buildCrumbTitles([
      group('Empty', []),
      group('Links only', [
        {
          type: 'link',
          title: 'GitHub',
          href: 'https://example.com',
          external: true,
        },
      ]),
    ]);

    expect(titles).toEqual({});
  });

  it('ignores separators and external links', () => {
    const titles = buildCrumbTitles([
      { type: 'separator', title: 'Links' },
      {
        type: 'link',
        title: 'npm',
        href: 'https://example.com',
        external: true,
      },
      page('internals', 'Internals'),
    ]);

    expect(titles).toEqual({ internals: 'Internals' });
  });
});
