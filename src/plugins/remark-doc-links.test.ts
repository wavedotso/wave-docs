import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { describe, expect, it } from 'vitest';
import { VFile } from 'vfile';
import type { DocLinkRef } from './remark-doc-links.js';
import { remarkDocLinks, resolveMarkdownLink } from './remark-doc-links.js';

interface Run {
  urls: string[];
  refs: DocLinkRef[];
}

/**
 * Run the plugin over a document and report what the links became. One frozen
 * processor across every case, which is also the reuse the plugin is designed
 * for.
 */
function run(
  markdown: string,
  document: { segments: string[]; dirSegments: string[] },
  options: Parameters<typeof remarkDocLinks>[0] = { basePath: '/docs' },
): Run {
  const processor = unified().use(remarkParse).use(remarkDocLinks, options);
  const file = new VFile({ value: markdown, path: 'test.md' });
  file.data.docLinkContext = document;
  const tree = processor.runSync(processor.parse(file), file);

  const urls: string[] = [];
  visit(tree, ['link', 'definition'], (node) => {
    if (node.type === 'link' || node.type === 'definition') {
      urls.push(node.url);
    }
  });
  return { urls, refs: file.data.docLinks ?? [] };
}

const FROM_PAGE = { segments: ['guide', 'setup'], dirSegments: ['guide'] };

describe('remarkDocLinks', () => {
  it('rewrites relative markdown links to routes', () => {
    const { urls } = run(
      [
        '[a](./install.md)',
        '[b](../api/auth.md)',
        '[c](../api/index.md)',
        '[d](nested/deep.md)',
      ].join('\n\n'),
      FROM_PAGE,
    );

    expect(urls).toEqual([
      '/docs/guide/install',
      '/docs/api/auth',
      '/docs/api',
      '/docs/guide/nested/deep',
    ]);
  });

  it('rewrites extensionless relative links the same way', () => {
    // These are the ones authors think are safe; they break identically.
    const { urls } = run('[u](../api/users) [s](./install)', FROM_PAGE);
    expect(urls).toEqual(['/docs/api/users', '/docs/guide/install']);
  });

  it('preserves anchors and queries', () => {
    const { urls } = run(
      '[a](./install.md#requirements) [b](../api/auth.md?tab=js#bearer)',
      FROM_PAGE,
    );
    expect(urls).toEqual([
      '/docs/guide/install#requirements',
      '/docs/api/auth?tab=js#bearer',
    ]);
  });

  it('leaves external, absolute and in-page links alone', () => {
    const source = [
      '[a](https://example.com/x.md)',
      '[b](//cdn.example.com/x)',
      '[c](mailto:hi@example.com)',
      '[d](tel:+15551234)',
      '[e](/docs/api/auth)',
      '[f](#section)',
      '[g](../assets/logo.svg)',
      // Path-less: addresses this page, and has nothing to resolve. Recording
      // it as unresolvable would fail the build with advice — "use a path
      // relative to this file" — that cannot be followed.
      '[h](?tab=json)',
    ].join('\n\n');
    const { urls, refs } = run(source, FROM_PAGE);

    expect(urls).toEqual([
      'https://example.com/x.md',
      '//cdn.example.com/x',
      'mailto:hi@example.com',
      'tel:+15551234',
      '/docs/api/auth',
      '#section',
      '../assets/logo.svg',
      '?tab=json',
    ]);
    // None of them are documentation pages, so none are asserted against.
    expect(refs).toEqual([]);
  });

  it('resolves against the directory, not the route, for index pages', () => {
    // `api/index.md` and `api.md` share the route segments `['api']` but sit
    // in different directories — the whole reason dirSegments exists.
    const fromIndex = run('[a](./auth.md)', {
      segments: ['api'],
      dirSegments: ['api'],
    });
    const fromLeaf = run('[a](./auth.md)', {
      segments: ['api'],
      dirSegments: [],
    });

    expect(fromIndex.urls).toEqual(['/docs/api/auth']);
    expect(fromLeaf.urls).toEqual(['/docs/auth']);
  });

  it('rewrites reference-style link definitions', () => {
    const { urls } = run(
      ['See [the guide][g].', '', '[g]: ../api/auth.md'].join('\n'),
      FROM_PAGE,
    );
    // The url lives on the `definition` node; the reference in the prose is a
    // `linkReference` with no url of its own.
    expect(urls).toEqual(['/docs/api/auth']);
  });

  it('records unresolvable links instead of throwing', () => {
    const { urls, refs } = run('[a](../../../outside.md)', FROM_PAGE);

    expect(refs).toEqual([
      { raw: '../../../outside.md', href: undefined, line: 1 },
    ]);
    // Left as authored: the caller decides whether a dead link fails the build.
    expect(urls).toEqual(['../../../outside.md']);
  });

  it('collects every resolved href with its source line', () => {
    const { refs } = run('intro\n\n[a](./install.md)\n', FROM_PAGE);
    expect(refs).toEqual([
      { raw: './install.md', href: '/docs/guide/install', line: 3 },
    ]);
  });

  it('honours a custom LinkResolver for every relative link', () => {
    const { urls, refs } = run(
      '[a](./install.md) [b](../assets/logo.svg)',
      FROM_PAGE,
      {
        basePath: '/docs',
        resolve: (href, from) =>
          href.endsWith('.md') ? `/x/${from.join('-')}` : undefined,
      },
    );

    expect(urls).toEqual(['/x/guide-setup', '../assets/logo.svg']);
    expect(refs.map((ref) => ref.href)).toEqual(['/x/guide-setup', undefined]);
  });

  it('throws when the document context is missing', () => {
    const processor = unified().use(remarkParse).use(remarkDocLinks, {
      basePath: '/docs',
    });
    const file = new VFile({ value: '[a](./b.md)', path: 'broken.md' });

    expect(() => processor.runSync(processor.parse(file), file)).toThrow(
      /docLinkContext.*broken\.md/s,
    );
  });

  it('handles an empty base path', () => {
    expect(resolveMarkdownLink('./b.md', ['a'], '')).toBe('/a/b');
    expect(resolveMarkdownLink('./index.md', [], '')).toBe('/');
    expect(resolveMarkdownLink('./index.md', [], '/docs/')).toBe('/docs');
  });
});
