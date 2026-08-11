import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MetaDirEntry } from './meta.js';
import { orderNavEntries, parseDocsMeta, readDocsMeta } from './meta.js';
import type { DocNavNode, DocsMeta } from './types.js';

const META_PATH = '/content/meta.json';
const FIXTURES = path.join(
  import.meta.dirname,
  '__fixtures__',
  'source',
  'basic',
);

function page(
  name: string,
  title: string,
  extra: Partial<MetaDirEntry> = {},
): MetaDirEntry {
  return {
    name,
    title,
    node: { type: 'page', title, href: `/docs/${name}`, slug: name },
    ...extra,
  };
}

function group(
  name: string,
  title: string,
  children: DocNavNode[],
  extra: Partial<MetaDirEntry> = {},
): MetaDirEntry {
  return {
    name,
    title,
    node: { type: 'group', title, children },
    inlineChildren: children,
    ...extra,
  };
}

const titles = (nodes: DocNavNode[]): string[] =>
  nodes.map((node) => `${node.type}:${node.title}`);

describe('orderNavEntries without meta.json', () => {
  it('sorts by order, then title, with orderless entries last', () => {
    const nodes = orderNavEntries(
      [
        page('theming', 'Theming'),
        page('deploying', 'Deploying', { order: 2 }),
        page('caching', 'Caching', { order: 2 }),
        page('intro', 'Intro', { order: 1 }),
        page('appendix', 'Appendix'),
      ],
      undefined,
      META_PATH,
    );

    expect(titles(nodes)).toEqual([
      'page:Intro',
      'page:Caching',
      'page:Deploying',
      'page:Appendix',
      'page:Theming',
    ]);
  });

  it('omits the directory index and drafts', () => {
    const nodes = orderNavEntries(
      [
        page('index', 'Overview', { isIndex: true }),
        page('unreleased', 'Unreleased', { hidden: true }),
        page('guide', 'Guide'),
      ],
      undefined,
      META_PATH,
    );

    expect(titles(nodes)).toEqual(['page:Guide']);
  });

  it('drops directories with no children and no index', () => {
    const nodes = orderNavEntries(
      [group('empty', 'Empty', []), page('guide', 'Guide')],
      undefined,
      META_PATH,
    );

    expect(titles(nodes)).toEqual(['page:Guide']);
  });
});

describe('orderNavEntries with meta.json pages', () => {
  const entries: MetaDirEntry[] = [
    page('index', 'Overview', { isIndex: true }),
    page('intro', 'Intro'),
    page('installation', 'Installation'),
    page('advanced', 'Advanced'),
    page('unreleased', 'Unreleased', { hidden: true }),
    group('api', 'API', [
      { type: 'page', title: 'Auth', href: '/docs/api/auth', slug: 'api/auth' },
      { type: 'page', title: 'Rate', href: '/docs/api/rate', slug: 'api/rate' },
    ]),
  ];

  it('honours every entry form in order', () => {
    const meta: DocsMeta = {
      pages: [
        'index',
        'intro',
        '---Reference---',
        '...api',
        '...',
        { title: 'GitHub', href: 'https://github.com/wavedotso/wave' },
        { title: 'Changelog', href: '/changelog' },
      ],
    };

    const nodes = orderNavEntries(entries, meta, META_PATH);

    expect(titles(nodes)).toEqual([
      'page:Overview',
      'page:Intro',
      'separator:Reference',
      'page:Auth',
      'page:Rate',
      'page:Advanced',
      'page:Installation',
      'link:GitHub',
      'link:Changelog',
    ]);
  });

  it('marks only protocol and protocol-relative links external', () => {
    const meta: DocsMeta = {
      pages: [
        { title: 'Https', href: 'https://example.com' },
        { title: 'Mail', href: 'mailto:hi@example.com' },
        { title: 'Protocol relative', href: '//cdn.example.com/x' },
        { title: 'Root relative', href: '/changelog' },
        { title: 'Relative', href: '../pricing' },
      ],
    };

    const nodes = orderNavEntries(entries, meta, META_PATH);
    const external = nodes.map((node) =>
      node.type === 'link' ? node.external : null,
    );

    expect(external).toEqual([true, true, true, false, false]);
  });

  it('drops unnamed entries when there is no wildcard', () => {
    const nodes = orderNavEntries(entries, { pages: ['intro'] }, META_PATH);
    expect(titles(nodes)).toEqual(['page:Intro']);
  });

  it('skips a named draft instead of failing the build', () => {
    const nodes = orderNavEntries(
      entries,
      { pages: ['unreleased', 'intro'] },
      META_PATH,
    );
    expect(titles(nodes)).toEqual(['page:Intro']);
  });

  it('throws naming the file and the entry when a page is missing', () => {
    expect(() =>
      orderNavEntries(entries, { pages: ['intro', 'inrto'] }, META_PATH),
    ).toThrow(/\/content\/meta\.json lists "inrto", which does not exist/);
  });

  it('lists the available entries in that error', () => {
    expect(() =>
      orderNavEntries(entries, { pages: ['inrto'] }, META_PATH),
    ).toThrow(/Available entries: advanced, api, index, installation, intro/);
  });

  it('throws when an inline expansion does not name a directory', () => {
    expect(() =>
      orderNavEntries(entries, { pages: ['...intro'] }, META_PATH),
    ).toThrow(/is not a subdirectory here\. Subdirectories: api\./);
  });

  it('keeps the expanded directory own page reachable', () => {
    const withIndex = group(
      'api',
      'API',
      [
        {
          type: 'page',
          title: 'Auth',
          href: '/docs/api/auth',
          slug: 'api/auth',
        },
      ],
      {
        indexNode: {
          type: 'page',
          title: 'API',
          href: '/docs/api',
          slug: 'api',
        },
      },
    );

    const nodes = orderNavEntries(
      [withIndex],
      { pages: ['...api'] },
      META_PATH,
    );
    expect(nodes).toEqual([
      { type: 'page', title: 'API', href: '/docs/api', slug: 'api' },
      { type: 'page', title: 'Auth', href: '/docs/api/auth', slug: 'api/auth' },
    ]);
  });

  it('refuses to guess when two entries claim one name', () => {
    expect(() =>
      orderNavEntries(
        [page('guides', 'Guides overview'), group('guides', 'Guides', [])],
        { pages: ['guides'] },
        META_PATH,
      ),
    ).toThrow(
      /cannot address "guides": guides\.md and guides\/ both claim that name/,
    );
  });

  it('throws on a second wildcard', () => {
    expect(() =>
      orderNavEntries(entries, { pages: ['...', 'intro', '...'] }, META_PATH),
    ).toThrow(/more than one "\.\.\." entry/);
  });
});

describe('parseDocsMeta', () => {
  it('accepts a well-formed file', () => {
    expect(
      parseDocsMeta({ title: 'API', pages: ['auth', '...'] }, META_PATH),
    ).toEqual({ title: 'API', pages: ['auth', '...'] });
  });

  it('rejects an unknown key, naming the file', () => {
    expect(() => parseDocsMeta({ page: ['auth'] }, META_PATH)).toThrow(
      /Invalid meta\.json at \/content\/meta\.json/,
    );
  });

  it('rejects a malformed pages entry', () => {
    expect(() =>
      parseDocsMeta({ pages: [{ title: 'GitHub' }] }, META_PATH),
    ).toThrow(/pages\.0/);
  });
});

describe('readDocsMeta', () => {
  it('reads and validates a directory meta.json', async () => {
    await expect(readDocsMeta(path.join(FIXTURES, 'api'))).resolves.toEqual({
      title: 'API reference',
      pages: ['authentication', '...'],
    });
  });

  it('resolves undefined when the directory has none', async () => {
    await expect(
      readDocsMeta(path.join(FIXTURES, 'guides')),
    ).resolves.toBeUndefined();
  });
});
