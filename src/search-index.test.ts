import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Element, Root } from 'hast';
import MiniSearch from 'minisearch';
import { beforeAll, describe, expect, it } from 'vitest';
import { renderFixtureDoc } from './__fixtures__/search/render-fixture.js';
import { SEARCH_INDEX_OPTIONS } from './search-options.js';
import {
  buildSearchIndex,
  extractSearchRecords,
  writeSearchIndex,
} from './search-index.js';
import type { RenderedDoc, SearchRecord } from './types.js';

let doc: RenderedDoc;
let records: SearchRecord[];

beforeAll(async () => {
  doc = await renderFixtureDoc();
  records = extractSearchRecords(doc);
});

/** Every heading id `rehype-slug` actually put on the fixture tree. */
function headingIds(tree: Root): string[] {
  const ids: string[] = [];
  for (const node of tree.children) {
    if (node.type !== 'element') continue;
    if (!/^h[1-6]$/.test(node.tagName)) continue;
    const id = node.properties?.id;
    if (typeof id === 'string') ids.push(id);
  }
  return ids;
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
    expect(lead?.titles).toStrictEqual([]);
    expect(lead?.href).toBe('/docs/api/auth');
    expect(lead?.id).toBe('/docs/api/auth');
    // The `h1` text itself is not prose; the lead carries what follows it.
    expect(lead?.text).toMatch(/^Wave signs every request/);
  });

  it('records the ancestor heading chain, outermost first', () => {
    const byAnchor = new Map(
      records.map((record) => [record.href.split('#')[1], record]),
    );
    expect(byAnchor.get('installation')?.titles).toStrictEqual([]);
    expect(byAnchor.get('options')?.titles).toStrictEqual(['Installation']);
    expect(byAnchor.get('options-1')?.titles).toStrictEqual(['Configuration']);
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
    // Read it untruncated — the fixture's long paragraph precedes the table.
    expect(collapsedSectionText(doc)).toContain('timeout');
  });

  it('truncates the excerpt on a word boundary', () => {
    const configuration = records[3];
    expect(configuration).toBeDefined();
    const text = configuration?.text ?? '';
    expect(text.length).toBeLessThanOrEqual(301); // 300 + the ellipsis
    expect(text.endsWith('…')).toBe(true);

    const withoutEllipsis = text.slice(0, -1);
    const source = configuration?.text ?? '';
    expect(source.length).toBeGreaterThan(0);
    // The kept prefix must end where a word ends, not mid-word.
    const original = collapsedSectionText(doc);
    expect(original.startsWith(withoutEllipsis)).toBe(true);
    expect(original.charAt(withoutEllipsis.length)).toBe(' ');
  });

  it('honours a custom excerpt length', () => {
    const short = extractSearchRecords(doc, { excerptLength: 40 });
    for (const record of short) {
      expect(record.text.length).toBeLessThanOrEqual(41);
    }
    expect(short[3]?.text.endsWith('…')).toBe(true);
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

/** The raw (untruncated) prose of the Configuration section. */
function collapsedSectionText(rendered: RenderedDoc): string {
  const long = extractSearchRecords(rendered, { excerptLength: 100_000 });
  return long[3]?.text ?? '';
}

describe('buildSearchIndex', () => {
  it('serialises an index whose results carry title, heading and href', () => {
    const json = buildSearchIndex(records);
    const loaded = MiniSearch.loadJSON<SearchRecord>(
      json,
      SEARCH_INDEX_OPTIONS,
    );

    const [top] = loaded.search('baseUrl');
    expect(top).toBeDefined();
    // The storeFields trap: without them at build time these are undefined
    // and the dialog renders empty rows.
    expect(top?.title).toBe('Authentication');
    expect(typeof top?.href).toBe('string');
    expect(typeof top?.heading).toBe('string');
    expect(Array.isArray(top?.titles)).toBe(true);
  });

  it('combines terms with AND', () => {
    const loaded = MiniSearch.loadJSON<SearchRecord>(
      buildSearchIndex(records),
      SEARCH_INDEX_OPTIONS,
    );
    // `token` appears only in the lead, `disambiguate` only in the last
    // section: under the default OR both would match, under AND neither does.
    expect(loaded.search('token disambiguate')).toStrictEqual([]);
    expect(loaded.search('token').length).toBeGreaterThan(0);
  });

  it('produces stable, unique document ids', () => {
    const ids = records.map((record) => record.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(() => buildSearchIndex(records)).not.toThrow();
  });
});

describe('writeSearchIndex', () => {
  it('creates parent directories and reports the byte size', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'wave-docs-search-'));
    try {
      const outFile = path.join(dir, 'nested', 'deeper', 'search-index.json');
      const size = await writeSearchIndex(records, outFile);

      const written = await readFile(outFile, 'utf8');
      expect(size).toBe(Buffer.byteLength(written, 'utf8'));
      expect((await stat(outFile)).size).toBe(size);
      expect(() => JSON.parse(written) as unknown).not.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
