import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { docsError } from './docs-error.js';
import { isDocsError } from './errors.js';

const SRC = import.meta.dirname;

/** Every shipped module, excluding tests and fixtures. */
async function sourceFiles(dir = SRC): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__fixtures__') {
        continue;
      }
      files.push(...(await sourceFiles(full)));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !entry.name.includes('.test.') &&
      !entry.name.endsWith('.d.ts')
    ) {
      files.push(full);
    }
  }
  return files;
}

describe('docsError', () => {
  it('prefixes the package name exactly once', () => {
    expect(docsError('broken-link', 'the link is broken.').message).toBe(
      '@waveso/docs: the link is broken.',
    );
    // Messages written before the helper existed already carry the prefix, and
    // must not gain a second one.
    expect(
      docsError('broken-link', '@waveso/docs: already prefixed.').message,
    ).toBe('@waveso/docs: already prefixed.');
  });

  it('carries a branchable code without changing how the error serialises', () => {
    const error = docsError('draft-link', 'links to a draft.');

    expect(error.code).toBe('draft-link');
    expect(error).toBeInstanceOf(Error);
    // Non-enumerable, so a spread or a JSON round-trip sees what it always saw.
    expect(Object.keys(error)).not.toContain('code');
    expect(JSON.parse(JSON.stringify(error))).toEqual({});
  });

  it('keeps the cause and the stack', () => {
    const cause = new Error('js-yaml said so');
    const error = docsError('invalid-meta', 'bad meta.json.', { cause });

    expect(error.cause).toBe(cause);
    // Flattening the stack would hide the frames a maintainer needs.
    expect(error.stack).toContain('docs-error.test');
  });

  it('narrows an unknown caught value', () => {
    expect(isDocsError(docsError('internal', 'x'))).toBe(true);
    expect(isDocsError(new Error('@waveso/docs: not ours'))).toBe(false);
    expect(isDocsError('a string')).toBe(false);
    expect(isDocsError(null)).toBe(false);
  });

  /*
   * The class guard. Half of this package's throw sites — 13 of 26, before the
   * fixes that added more — omitted the package prefix, and none carried a
   * code, so a consumer wanting to branch on a failure had only the message
   * text and `startsWith('@waveso/docs:')` was not even a reliable filter. A
   * source scan is what keeps the next throw from quietly rejoining that group.
   *
   * The pattern deliberately catches every `Error` subclass, not just `Error`:
   * a bare `throw new URIError(...)` on the asset-link path sailed past an
   * earlier version of this test and reached consumers with no code, no file
   * and no line — past the very check that exists to make failures locatable.
   */
  it('is the only way this package throws', async () => {
    const BARE_THROW = /throw new (?!DocsError)\w*Error\(/;
    /*
     * `decodeSegment` raises a `URIError` as an internal signal: every caller
     * inside the plugin catches it and re-throws a `docsError` carrying the
     * file and line, which a decoding helper cannot know. It is also the
     * documented failure of the exported `resolveMarkdownLink`, where `URIError`
     * is the honest type — it is what `decodeURIComponent` itself throws.
     */
    const EXEMPT = new Set(['plugins/remark-doc-links.ts']);
    const offenders: string[] = [];

    for (const file of await sourceFiles()) {
      const relative = path.relative(SRC, file);
      if (EXEMPT.has(relative)) {
        continue;
      }
      const source = await readFile(file, 'utf8');
      if (BARE_THROW.test(source)) {
        offenders.push(relative);
      }
    }

    expect(offenders).toEqual([]);
  });
});
