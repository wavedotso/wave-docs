import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
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

  it('marks a link external only when following it opens a tab', () => {
    /*
     * ⚠️ THIS TEST USED TO ASSERT THE BUG. It read "only protocol and
     * protocol-relative links" and expected `mailto:` to be external, because
     * the implementation tested for a scheme and the test was written from the
     * implementation. `external` is not "has a scheme" — it is what makes
     * `DocsSidebar` render `target="_blank"`, an external-link icon and an
     * "(opens in a new tab)" suffix. Following a `mailto:` opens a mail client
     * and leaves the page exactly where it was, so a reader using a screen
     * reader was told about a tab that never appeared.
     *
     * `tel:` and `sms:` are the same shape, and the markdown path has always
     * drawn the line here — `<a href="mailto:…">` in a document gets no
     * `target` either. The two paths end at the same anchor.
     */
    const meta: DocsMeta = {
      pages: [
        { title: 'Https', href: 'https://example.com' },
        { title: 'Mail', href: 'mailto:hi@example.com' },
        { title: 'Phone', href: 'tel:+15550100' },
        { title: 'Protocol relative', href: '//cdn.example.com/x' },
        { title: 'Root relative', href: '/changelog' },
        { title: 'Relative', href: '../pricing' },
      ],
    };

    const nodes = orderNavEntries(entries, meta, META_PATH, NESTED);
    const external = nodes.map((node) =>
      node.type === 'link' ? node.external : null,
    );

    expect(external).toEqual([true, false, false, true, false, false]);
  });

  it('refuses an href whose scheme is not in the allowlist', () => {
    /*
     * ⚠️ `meta.json` WENT ROUND THE CHECK THE MARKDOWN PATH CALLS LOAD-BEARING.
     * A hand-written nav entry reached `<a href>` through `DocsSidebar` with
     * nothing looking at its scheme, while a `javascript:` link in the markdown
     * beside it was dropped. Both end at the same anchor.
     *
     * Refused at parse time rather than dropped at render: this file is
     * authored, and a nav entry that silently vanishes is the quietest possible
     * failure — the sidebar looks fine and the link is simply gone.
     */
    for (const href of [
      'javascript:alert(1)',
      // The obfuscated forms a browser still executes: a newline and a tab
      // inside the scheme are ignored by the parser and not by a naive regex.
      'java\nscript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'vbscript:msgbox(1)',
    ]) {
      expect(() =>
        parseDocsMeta({ pages: [{ title: 'Bad', href }] }, META_PATH),
      ).toThrow(/scheme/);
    }
  });

  it('keeps the schemes documentation actually uses', () => {
    // The allowlist is GitHub's, and an allowlist of three silently deletes
    // links a technical document legitimately carries.
    for (const href of [
      'https://example.com',
      'mailto:hi@example.com',
      'tel:+15550100',
      'sms:+15550100',
      'ftp://files.example.com',
      'irc://irc.example.com/chan',
      'matrix:r/room:example.com',
      '/changelog',
      '../pricing',
      '#anchor',
    ]) {
      expect(() =>
        parseDocsMeta({ pages: [{ title: 'Fine', href }] }, META_PATH),
      ).not.toThrow();
    }
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

describe('meta.json is read the way markdown is', () => {
  const temp: string[] = [];

  afterAll(async () => {
    await Promise.all(
      temp.map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  /** A directory holding one `meta.json` with exactly these bytes. */
  async function withMeta(body: string): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'wave-docs-meta-'));
    temp.push(dir);
    await writeFile(path.join(dir, 'meta.json'), body, 'utf8');
    return dir;
  }

  it('strips a UTF-8 BOM, as `readPage` does for markdown', async () => {
    /*
     * ⚠️ `readFile(…, 'utf8')` LEAVES IT IN AND `JSON.parse` REFUSES IT. A
     * `meta.json` saved by an editor that emits a BOM — which is most of them on
     * Windows — failed the build with `Unexpected token ''`, on a character
     * nobody can see, in the file the author is looking straight at. The
     * markdown path learned this when `gray-matter` was swapped out; this is the
     * same line for the same reason.
     */
    const dir = await withMeta('\uFEFF{"title":"API"}');

    await expect(readDocsMeta(dir)).resolves.toEqual({ title: 'API' });
  });

  it('matches a name in NFC, because the filenames it is matched against are', async () => {
    /*
     * ⚠️ macOS HANDS BACK DECOMPOSED FILENAMES, AND `source.ts` NORMALISES THEM
     * AT THE `readdir` BOUNDARY — so `entries[].name` is NFC while a `meta.json`
     * written on a Mac is whatever the editor saved. Two spellings of `café`,
     * one in the listing and one in the ordering file, and the lookup missed:
     * the build failed with `lists "café", which does not exist`, beside a list
     * of available names containing a visually identical `café`.
     */
    const decomposed = 'cafe\u0301'; // e + combining acute
    const composed = 'caf\u00e9'; // é
    expect(decomposed).not.toBe(composed);

    const entries: MetaDirEntry[] = [
      {
        // As `source.ts` produces it: normalised.
        name: composed,
        title: 'Café',
        node: { type: 'page', title: 'Café', href: '/docs/cafe', slug: 'cafe' },
      },
    ];

    // As an editor on a Mac may have written it: not.
    const nodes = orderNavEntries(
      entries,
      { pages: [decomposed] },
      META_PATH,
      NESTED,
    );

    expect(nodes).toEqual([
      { type: 'page', title: 'Café', href: '/docs/cafe', slug: 'cafe' },
    ]);
  });
});
