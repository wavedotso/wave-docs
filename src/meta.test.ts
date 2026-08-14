import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MetaDirEntry } from './meta.js';
import { orderNavEntries, parseDocsMeta, readDocsMeta } from './meta.js';
import type { DocNavNode, DocsMeta } from './types.js';

const META_PATH = '/content/meta.json';
/** Depth of a directory below the content root; the root itself is 0. */
const NESTED = 1;
const ROOT = 0;
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
      NESTED,
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
      NESTED,
    );

    expect(titles(nodes)).toEqual(['page:Guide']);
  });

  /**
   * The root is the case the "never list an index" rule did not consider:
   * nothing encloses it, so no group heading carries its href. Without this the
   * landing page is missing from its own sidebar and a reader who follows any
   * link has no way back — and every install writes a `meta.json` whose only
   * job is to undo the default.
   */
  it('lists the content root own index, which no group heading links', () => {
    const entries = [
      page('index', 'Home', { isIndex: true, order: 1 }),
      page('guide', 'Guide'),
    ];

    expect(
      titles(orderNavEntries(entries, undefined, META_PATH, ROOT)),
    ).toEqual(['page:Home', 'page:Guide']);
    // Still not when it is a draft.
    const draftIndex = [
      page('index', 'Home', { isIndex: true, hidden: true }),
      page('guide', 'Guide'),
    ];
    expect(
      titles(orderNavEntries(draftIndex, undefined, META_PATH, ROOT)),
    ).toEqual(['page:Guide']);
  });

  it('splices the root index into the wildcard too', () => {
    const nodes = orderNavEntries(
      [page('index', 'Home', { isIndex: true, order: 1 }), page('a', 'A')],
      { pages: ['...'] },
      META_PATH,
      ROOT,
    );
    expect(titles(nodes)).toEqual(['page:Home', 'page:A']);
  });

  it('drops directories with no children and no index', () => {
    const nodes = orderNavEntries(
      [group('empty', 'Empty', []), page('guide', 'Guide')],
      undefined,
      META_PATH,
      NESTED,
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

    const nodes = orderNavEntries(entries, meta, META_PATH, NESTED);

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

    const nodes = orderNavEntries(entries, meta, META_PATH, NESTED);
    const external = nodes.map((node) =>
      node.type === 'link' ? node.external : null,
    );

    expect(external).toEqual([true, true, true, false, false]);
  });

  it('drops unnamed entries when there is no wildcard', () => {
    const nodes = orderNavEntries(
      entries,
      { pages: ['intro'] },
      META_PATH,
      NESTED,
    );
    expect(titles(nodes)).toEqual(['page:Intro']);
  });

  it('skips a named draft instead of failing the build', () => {
    const nodes = orderNavEntries(
      entries,
      { pages: ['unreleased', 'intro'] },
      META_PATH,
      NESTED,
    );
    expect(titles(nodes)).toEqual(['page:Intro']);
  });

  it('throws naming the file and the entry when a page is missing', () => {
    expect(() =>
      orderNavEntries(
        entries,
        { pages: ['intro', 'inrto'] },
        META_PATH,
        NESTED,
      ),
    ).toThrow(/\/content\/meta\.json lists "inrto", which does not exist/);
  });

  it('lists the available entries in that error', () => {
    expect(() =>
      orderNavEntries(entries, { pages: ['inrto'] }, META_PATH, NESTED),
    ).toThrow(/Available entries: advanced, api, index, installation, intro/);
  });

  it('throws when an inline expansion does not name a directory', () => {
    expect(() =>
      orderNavEntries(entries, { pages: ['...intro'] }, META_PATH, NESTED),
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
      NESTED,
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
        NESTED,
      ),
    ).toThrow(
      /cannot address "guides": guides\.md and guides\/ both claim that name/,
    );
  });

  it('throws on a second wildcard', () => {
    expect(() =>
      orderNavEntries(
        entries,
        { pages: ['...', 'intro', '...'] },
        META_PATH,
        NESTED,
      ),
    ).toThrow(/more than one "\.\.\." entry/);
  });

  /**
   * A page named twice rendered twice, with both copies highlighted as the
   * current page — and the sidebar keys its items positionally, so React never
   * warned about the duplicate either.
   */
  it('throws when a page is named twice', () => {
    expect(() =>
      orderNavEntries(
        entries,
        { pages: ['intro', 'installation', 'intro'] },
        META_PATH,
        NESTED,
      ),
    ).toThrow(/lists "intro" more than once/);
  });

  it('counts an inline expansion as naming its directory', () => {
    expect(() =>
      orderNavEntries(entries, { pages: ['api', '...api'] }, META_PATH, NESTED),
    ).toThrow(/lists "\.\.\.api" more than once/);
  });

  /**
   * The group a separator labels can empty out — every page in it a draft — and
   * `includeDrafts`, which is how an author previews the site, is exactly the
   * mode where it does not.
   */
  it('drops a separator that ended up labelling nothing', () => {
    const drafted = [
      page('intro', 'Intro'),
      group('api', 'API', []),
      page('unreleased', 'Unreleased', { hidden: true }),
    ];

    expect(
      titles(
        orderNavEntries(
          drafted,
          { pages: ['intro', '---Reference---', 'api', 'unreleased'] },
          META_PATH,
          NESTED,
        ),
      ),
    ).toEqual(['page:Intro']);
  });

  it('drops a separator at the end of the list, and a run of them', () => {
    expect(
      titles(
        orderNavEntries(
          entries,
          { pages: ['---A---', '---B---', 'intro', '---Trailing---'] },
          META_PATH,
          NESTED,
        ),
      ),
    ).toEqual(['separator:B', 'page:Intro']);
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
