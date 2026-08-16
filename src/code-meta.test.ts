import { describe, expect, it } from 'vitest';

import { parseCodeMeta } from './code-meta.js';

const PATH = 'content/docs/guide.md';

describe('parseCodeMeta', () => {
  it('reads a quoted title, spaces and all', () => {
    expect(parseCodeMeta('title="app/page.tsx"', PATH)).toEqual({
      title: 'app/page.tsx',
    });
    // The reason quotes are required: an unquoted title would end at `Request`.
    expect(parseCodeMeta('title="Request body"', PATH)).toEqual({
      title: 'Request body',
    });
  });

  it('finds the title wherever the author put it', () => {
    expect(parseCodeMeta('showLineNumbers title="a.ts"', PATH)).toEqual({
      title: 'a.ts',
    });
    expect(parseCodeMeta('title="a.ts" twoslash', PATH)).toEqual({
      title: 'a.ts',
    });
  });

  it('ignores what it does not understand, without complaint', () => {
    /*
     * Shiki's meta string is an open namespace it shares with its own
     * transformers. An author pasting `twoslash` or `{1,3}` out of another
     * project's documentation gets a code block, not a failed build.
     */
    expect(parseCodeMeta('twoslash', PATH)).toEqual({});
    expect(parseCodeMeta('{1,3-5}', PATH)).toEqual({});
    expect(parseCodeMeta('showLineNumbers {2} /foo/', PATH)).toEqual({});
    expect(parseCodeMeta('', PATH)).toEqual({});
    expect(parseCodeMeta(undefined, PATH)).toEqual({});
  });

  it('does not mistake another key ending in title', () => {
    // `subtitle="x"` is not a title, and a regex without the leading boundary
    // would read it as one.
    expect(parseCodeMeta('subtitle="x"', PATH)).toEqual({});
  });

  it('treats an empty title as no title', () => {
    // Rather than an empty caption bar with a border and 0.5rem of padding.
    expect(parseCodeMeta('title=""', PATH)).toEqual({});
  });

  it('throws on a title it cannot read, naming the document', () => {
    /*
     * The one place silence is wrong. Ignoring this ships a caption that
     * truncates at the first space, or no caption at all — and the author sees
     * their fence render fine, just without the bar they asked for.
     */
    for (const meta of ['title=app/page.tsx', "title='a.ts'", 'title="a.ts']) {
      expect(() => parseCodeMeta(meta, PATH)).toThrow(/guide\.md/);
      try {
        parseCodeMeta(meta, PATH);
      } catch (error) {
        expect((error as { code?: string }).code).toBe('invalid-code-meta');
      }
    }
  });

  it('does not consume what it read', () => {
    /*
     * The whole reason this takes a string and returns a value rather than
     * rewriting `code.data.meta`: Shiki forwards the raw string to its
     * transformers as `meta.__raw`, which is how `{1,3-5}` and
     * `showLineNumbers` work when they land. A parser that stripped what it
     * recognised would disable every feature it had not been taught yet — and
     * nothing about the caption it produced would look wrong.
     */
    const meta = 'title="a.ts" {1,3-5}';
    parseCodeMeta(meta, PATH);

    expect(meta).toBe('title="a.ts" {1,3-5}');
  });
});
