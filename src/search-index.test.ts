import type { Element, ElementContent, Root, RootContent } from 'hast';
import MiniSearch from 'minisearch';
import { beforeAll, describe, expect, it } from 'vitest';
import { renderFixtureDoc } from './__fixtures__/search/render-fixture.js';
import {
  SEARCH_INDEX_OPTIONS,
  mergeSearchOptions,
  tokenizeSearchText,
} from './search-options.js';
import { buildSearchIndex, extractSearchRecords } from './search-index.js';
import type { RenderedDoc, SearchRecord } from './types.js';

let doc: RenderedDoc;
let records: SearchRecord[];

beforeAll(async () => {
  doc = await renderFixtureDoc();
  records = extractSearchRecords(doc);
});

/**
 * Every heading id `rehype-slug` actually put on the fixture tree.
 *
 * Recursive on purpose: the `> [!NOTE]` heading lives inside a `<callout>`, and
 * a top-level-only walk would have quietly agreed with the bug that skipped it.
 */
function headingIds(tree: Root): string[] {
  const ids: string[] = [];
  const walk = (nodes: RootContent[] | ElementContent[]): void => {
    for (const node of nodes) {
      if (node.type !== 'element') continue;
      const id = node.properties?.id;
      if (/^h[1-6]$/.test(node.tagName) && typeof id === 'string') {
        ids.push(id);
      }
      walk(node.children);
    }
  };
  walk(tree.children);
  return ids;
}

/** A section of a synthetic page: one `h2` and one paragraph under it. */
interface FixtureSection {
  heading: string;
  text: string;
}

/** A `RenderedDoc` built straight from hast, for cases `guide.md` cannot show. */
function docOf(
  title: string,
  segments: string[],
  sections: FixtureSection[],
): RenderedDoc {
  const children: Element[] = sections.flatMap(({ heading, text }) => [
    {
      type: 'element' as const,
      tagName: 'h2',
      properties: { id: heading.toLowerCase().replace(/[^a-z0-9]+/g, '-') },
      children: [{ type: 'text' as const, value: heading }],
    },
    {
      type: 'element' as const,
      tagName: 'p',
      properties: {},
      children: [{ type: 'text' as const, value: text }],
    },
  ]);

  return {
    frontmatter: { title },
    hast: { type: 'root', children },
    toc: [],
    segments,
    href: `/docs/${segments.join('/')}`,
  };
}

function loadIndex(json: string): MiniSearch<SearchRecord> {
  return MiniSearch.loadJSON<SearchRecord>(json, SEARCH_INDEX_OPTIONS);
}

describe('extractSearchRecords', () => {
  it('splits the page into a lead record plus one record per h2+', () => {
    expect(
      records.map((record) => [record.heading, record.href]),
    ).toStrictEqual([
      ['Authentication', '/docs/api/auth'],
      ['Installation', '/docs/api/auth#installation'],
      ['Options', '/docs/api/auth#options'],
      ['Configuration', '/docs/api/auth#configuration'],
      ['Options', '/docs/api/auth#options-1'],
      ['Rate limits', '/docs/api/auth#rate-limits'],
    ]);
  });

  it('anchors every record on an id that exists on the tree', () => {
    const ids = new Set(headingIds(doc.hast));
    // Includes the `-1` collision suffix: re-slugging would have produced
    // `options` twice and deep-linked the second section to the first.
    expect(ids.has('options-1')).toBe(true);

    for (const record of records.slice(1)) {
      const anchor = record.href.split('#')[1];
      expect(anchor).toBeDefined();
      expect(ids.has(anchor ?? '')).toBe(true);
    }
  });

  it('gives the lead record the page title and the bare route', () => {
    const lead = records[0];
    expect(lead).toBeDefined();
    expect(lead?.heading).toBe('Authentication');
    expect(lead?.title).toBe('Authentication');
    expect(lead?.ancestors).toStrictEqual([]);
    expect(lead?.href).toBe('/docs/api/auth');
    /*
     * THE ID IS THE SLUG AND THE HREF CARRIES `basePath` — the difference is
     * the point. Storing the route twice per record inflated the one artifact
     * this package is sold on the size of, and tied every record's identity to
     * a base path a site is free to change.
     */
    expect(lead?.id).toBe('api/auth');
    // The `h1` text itself is not prose; the lead carries what follows it.
    expect(lead?.text).toMatch(/^Wave signs every request/);
  });

  it('records the ancestor heading chain, outermost first', () => {
    const byAnchor = new Map(
      records.map((record) => [record.href.split('#')[1], record]),
    );
    expect(byAnchor.get('installation')?.ancestors).toStrictEqual([]);
    expect(byAnchor.get('options')?.ancestors).toStrictEqual(['Installation']);
    expect(byAnchor.get('options-1')?.ancestors).toStrictEqual([
      'Configuration',
    ]);
  });

  it('drops code blocks but keeps inline code', () => {
    const lead = records[0];
    const installation = records[1];
    expect(lead?.text).toContain('createClient()');
    expect(installation?.text).toContain('Install the package');
    // Shiki token spans would otherwise arrive as punctuation soup.
    expect(installation?.text).not.toContain('createClient');
    expect(installation?.text).not.toContain('process.env');
    expect(installation?.text).not.toContain('@waveso/sdk');
  });

  it('keeps table text, which is prose people search for', () => {
    expect(records[3]?.text).toContain('timeout');
  });

  it('indexes the whole section rather than a leading excerpt', () => {
    const configuration = records[3]?.text ?? '';
    // The 300-character cap this replaced dropped ~82% of a normal corpus, and
    // bought nothing back: `storeFields` never carried `text`, so not one
    // character of the kept prefix was ever rendered anywhere.
    expect(configuration.length).toBeGreaterThan(300);
    expect(configuration).not.toContain('…');
    // The last words of the section, ~600 characters in.
    expect(configuration).toContain('10000');
  });

  it('opens a section for a heading inside a callout', () => {
    // `> [!NOTE]` renders to `<callout>`, which `rehypeCaptureToc` walks into
    // and this extractor did not: the TOC listed the heading, no record
    // existed, and its prose folded into the section above — so the one hit
    // that mentioned rate limits deep-linked to the wrong anchor.
    const callout = records[5];
    expect(callout?.heading).toBe('Rate limits');
    expect(callout?.id).toBe('api/auth#rate-limits');
    expect(callout?.ancestors).toStrictEqual(['Configuration']);
    expect(callout?.text).toContain('Sixty requests a minute');
    expect(records[4]?.text).not.toContain('Sixty requests a minute');
  });

  it('folds a heading with no usable id into the enclosing section', () => {
    // `github-slugger` returns the empty string for `## 🚀`, and `rehype-slug`
    // then sets `id=""`. There is nothing to deep-link to, so the heading opens
    // no section — exactly as `rehypeCaptureToc` skips it. The two must agree:
    // one of them throwing would fail a build over an emoji heading.
    const heading: Element = {
      type: 'element',
      tagName: 'h2',
      properties: { id: '' },
      children: [{ type: 'text', value: 'Rate limits' }],
    };
    const paragraph: Element = {
      type: 'element',
      tagName: 'p',
      properties: {},
      children: [{ type: 'text', value: 'Sixty requests a minute.' }],
    };
    const folded: RenderedDoc = {
      ...doc,
      hast: { type: 'root', children: [heading, paragraph] },
    };

    const [lead, ...rest] = extractSearchRecords(folded);
    expect(rest).toEqual([]);
    expect(lead?.href).toBe('/docs/api/auth');
    expect(lead?.text).toBe('Rate limits Sixty requests a minute.');
  });
});

describe('tokenizeSearchText', () => {
  it('segments CJK prose that carries no spaces', () => {
    // The whole clause was one term before, so no query could ever spell it.
    const tokens = tokenizeSearchText('安装客户端软件包。');
    expect(tokens.length).toBeGreaterThan(1);
    expect(tokens.join('')).toBe('安装客户端软件包');
  });

  it('tokenises a query exactly as it tokenised the document', () => {
    // The seam that fails silently: identical tokens on both sides, or an
    // index full of terms no query can spell.
    const inContext = tokenizeSearchText(
      '然后安装客户端软件包，再创建客户端。',
    );
    const asQuery = tokenizeSearchText('客户端');
    expect(asQuery.length).toBeGreaterThan(0);
    for (const token of asQuery) expect(inContext).toContain(token);
  });

  it('splits dotted identifiers, which UAX #29 keeps whole', () => {
    expect(tokenizeSearchText('wave.config.json')).toStrictEqual([
      'wave',
      'config',
      'json',
    ]);
    expect(tokenizeSearchText('baseUrl overrides the host')).toStrictEqual([
      'baseUrl',
      'overrides',
      'the',
      'host',
    ]);
  });

  it('drops punctuation instead of emitting it as a term', () => {
    expect(tokenizeSearchText('—  … ,')).toStrictEqual([]);
  });
});

describe('mergeSearchOptions', () => {
  it('defaults to the shared constant', () => {
    expect(mergeSearchOptions()).toStrictEqual(SEARCH_INDEX_OPTIONS);
  });

  it('keeps combineWith when only part of searchOptions is overridden', () => {
    // A shallow spread would drop AND and silently revert to MiniSearch's OR,
    // which returned 68–131 hits on real queries.
    const merged = mergeSearchOptions({ searchOptions: { fuzzy: 0 } });
    expect(merged.searchOptions?.fuzzy).toBe(0);
    expect(merged.searchOptions?.combineWith).toBe('AND');
    expect(merged.tokenize).toBe(SEARCH_INDEX_OPTIONS.tokenize);
  });
});

describe('buildSearchIndex', () => {
  it('serialises an index whose results carry title, heading and href', () => {
    const [top] = loadIndex(buildSearchIndex(records)).search('baseUrl');
    expect(top).toBeDefined();
    // The storeFields trap: without them at build time these are undefined
    // and the dialog renders empty rows.
    expect(top?.title).toBe('Authentication');
    expect(typeof top?.href).toBe('string');
    expect(typeof top?.heading).toBe('string');
    expect(Array.isArray(top?.ancestors)).toBe(true);
  });

  it('combines terms with AND', () => {
    const loaded = loadIndex(buildSearchIndex(records));
    // `token` appears only in the lead, `disambiguate` only in the fifth
    // section: under the default OR both would match, under AND neither does.
    expect(loaded.search('token disambiguate')).toStrictEqual([]);
    expect(loaded.search('token').length).toBeGreaterThan(0);
  });

  it('finds two terms far apart in one long section', () => {
    // `configuration` opens the section and `timeout` closes it, ~600
    // characters later. Capping the indexed text at 300 dropped the second,
    // and AND then returned nothing at all for the pair.
    const loaded = loadIndex(buildSearchIndex(records));
    const hits = loaded.search('configuration timeout');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.id).toBe('api/auth#configuration');
  });

  it('finds CJK prose, which whitespace splitting could not', () => {
    const cjk = extractSearchRecords(
      docOf(
        'Client',
        ['zh', 'client'],
        [
          {
            heading: 'Install',
            text: '安装客户端软件包，然后创建客户端。软件包会在后台刷新令牌。',
          },
        ],
      ),
    );
    const loaded = loadIndex(buildSearchIndex(cjk));

    for (const query of ['客户端', '安装', '软件包']) {
      expect(loaded.search(query).length, query).toBeGreaterThan(0);
    }
  });

  it('does not let one page fill the result list', () => {
    /*
     * Every section record carries its page's title, so indexing `title`
     * scored all 12 sections of the Configuration page on one title match:
     * seven of the dialog's eight rows were the same page and the page that
     * actually discussed configuration fell off the list. The title is still
     * findable — the lead record's `heading` IS the title.
     */
    const configuration = docOf(
      'Configuration',
      ['configuration'],
      Array.from({ length: 12 }, (_, index) => ({
        heading: `Step ${index + 1}`,
        text: `Nothing of interest in step number ${index + 1}.`,
      })),
    );
    const deployment = docOf(
      'Deployment',
      ['deployment'],
      [
        {
          heading: 'Environment',
          text: 'Copy the configuration file onto it.',
        },
      ],
    );

    const loaded = loadIndex(
      buildSearchIndex([
        ...extractSearchRecords(configuration),
        ...extractSearchRecords(deployment),
      ]),
    );
    const hits = loaded.search('configuration');
    const fromConfigurationPage = hits.filter(
      (hit) => hit.id.split('#')[0] === 'configuration',
    );

    expect(fromConfigurationPage.map((hit) => hit.id)).toStrictEqual([
      'configuration',
    ]);
    // The dialog renders a flat `.slice(0, 8)`, so ranking below that is the
    // same as not existing.
    expect(hits.slice(0, 8).map((hit) => hit.id)).toContain(
      'deployment#environment',
    );
  });

  it('applies overrides over the shared constant', () => {
    const json = buildSearchIndex(records, { fields: ['heading'] });
    const loaded = MiniSearch.loadJSON<SearchRecord>(
      json,
      mergeSearchOptions({ fields: ['heading'] }),
    );
    expect(loaded.search('Installation').length).toBeGreaterThan(0);
    // `text` was not indexed, so its vocabulary is gone.
    expect(loaded.search('createClient')).toStrictEqual([]);
  });

  it('produces stable, unique document ids', () => {
    const ids = records.map((record) => record.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(() => buildSearchIndex(records)).not.toThrow();
  });

  it('serialises byte-identically for identical input', () => {
    // A non-deterministic index dirties the diff on every build, and defeats
    // every cache between here and the reader.
    expect(buildSearchIndex(records)).toBe(buildSearchIndex(records));
  });
});
