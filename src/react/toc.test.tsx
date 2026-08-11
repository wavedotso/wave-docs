import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { TocEntry } from '../types.js';
import { SkipLink } from './skip-link.js';
import { DocsToc } from './toc.js';

const entries: TocEntry[] = [
  {
    id: 'install',
    text: 'Install',
    depth: 2,
    children: [
      { id: 'usage', text: 'Usage', depth: 3, children: [] },
      // A duplicate heading gets a collision suffix from rehype-slug; the TOC
      // must carry the suffixed id, not a re-slugged guess at it.
      { id: 'usage-1', text: 'Usage', depth: 3, children: [] },
    ],
  },
];

describe('DocsToc', () => {
  it('renders a labelled landmark of in-page anchors', () => {
    const html = renderToStaticMarkup(<DocsToc entries={entries} />);
    expect(html).toContain('aria-label="On this page"');
    expect(html).toContain('href="#install"');
    expect(html).toContain('href="#usage"');
    expect(html).toContain('href="#usage-1"');
  });

  it('exposes the heading depth for indentation', () => {
    const html = renderToStaticMarkup(<DocsToc entries={entries} />);
    expect(html).toContain('data-depth="2"');
    expect(html).toContain('data-depth="3"');
  });

  it('renders nothing at all for a page with no headings', () => {
    expect(renderToStaticMarkup(<DocsToc entries={[]} />)).toBe('');
  });

  it('claims no active entry before the observer has run', () => {
    // `aria-current="location"` on the server would be a lie: nothing has been
    // scrolled to yet, and it would flip on hydration.
    const html = renderToStaticMarkup(<DocsToc entries={entries} />);
    expect(html).not.toContain('aria-current');
  });
});

describe('SkipLink', () => {
  it('links to the documented default target', () => {
    const html = renderToStaticMarkup(<SkipLink />);
    expect(html).toContain('href="#docs-content"');
    expect(html).toContain('Skip to content');
    expect(html).toContain('wave-docs-skip-link');
  });
});
