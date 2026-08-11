import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { DocNavNode } from '../types.js';
import { DocsSidebar } from './sidebar.js';

/**
 * A tree with one of each node kind, and a nested group whose only page is the
 * one the tests treat as active.
 */
const nav: DocNavNode[] = [
  { type: 'page', title: 'Introduction', href: '/docs', slug: '' },
  { type: 'separator', title: 'Reference' },
  {
    type: 'group',
    title: 'API',
    href: '/docs/api',
    children: [
      {
        type: 'page',
        title: 'Authentication',
        href: '/docs/api/authentication',
        slug: 'api/authentication',
      },
    ],
  },
  {
    type: 'group',
    title: 'Guides',
    children: [
      {
        type: 'page',
        title: 'Caching',
        href: '/docs/guides/caching',
        slug: 'guides/caching',
      },
    ],
  },
  {
    type: 'link',
    title: 'Changelog',
    href: 'https://example.com/changelog',
    external: true,
  },
];

function render(pathname: string): string {
  return renderToStaticMarkup(<DocsSidebar nav={nav} pathname={pathname} />);
}

describe('DocsSidebar', () => {
  it('marks only the active page with aria-current', () => {
    const html = render('/docs/api/authentication');
    expect(html).toContain(
      'href="/docs/api/authentication" aria-current="page"',
    );
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it('opens the group containing the active page and leaves the others shut', () => {
    const html = render('/docs/api/authentication');
    expect(html).toContain('Authentication');
    // A collapsed group renders no children at all — not hidden ones.
    expect(html).not.toContain('Caching');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-expanded="false"');
  });

  it('names the icon-only toggle, and only that one', () => {
    // A linked group's toggle is a bare chevron beside the link, so it needs
    // its own name. An unlinked group's button contains the title already —
    // labelling it too would announce the group name twice.
    const html = render('/docs/api/authentication');
    expect(html).toContain('aria-label="Collapse API"');
    expect(html).not.toContain('aria-label="Expand Guides"');
    expect(html).toContain(
      '<span class="wave-docs-sidebar__group-title">Guides</span>',
    );
  });

  it('gives the toggle an aria-controls only while its list exists', () => {
    const html = render('/docs/api/authentication');
    const ids = [...html.matchAll(/aria-controls="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(ids).toHaveLength(1);
    // Pointing at an id that is not in the document is worse than omitting it.
    for (const id of ids) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('sends external links to a new tab with an accessible warning', () => {
    const html = render('/docs');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('(opens in a new tab)');
  });

  it('renders a separator as inert text, never as a heading or a link', () => {
    const html = render('/docs');
    expect(html).toContain(
      '<span class="wave-docs-sidebar__separator">Reference</span>',
    );
    expect(html).not.toMatch(/<h[1-6][^>]*>Reference/);
  });

  it('treats a trailing slash on the route as the same page', () => {
    expect(render('/docs/api/authentication/')).toContain(
      'aria-current="page"',
    );
  });
});
