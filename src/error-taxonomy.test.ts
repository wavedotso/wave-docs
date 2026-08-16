/**
 * The error codes, the troubleshooting table and the call sites, kept in step
 * by reading all three rather than by remembering to.
 *
 * The taxonomy is public API now, which means a code is a promise: a host
 * branching on `search-index-dynamic` has written a `switch` this package can
 * break. Three ways it rots, all silent — a code added to the union and never
 * documented, a code documented and never thrown, and a code deleted while its
 * troubleshooting row survives to send a reader hunting for an error that
 * cannot happen.
 *
 * The same mechanism `styles.test.ts` uses for its focus inventory: parse the
 * source, compare the sets.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { DocsErrorCode } from './errors.js';

const ROOT = path.join(import.meta.dirname, '..');

/** Every member of the `DocsErrorCode` union, straight out of the source. */
function unionMembers(): string[] {
  const source = readFileSync(path.join(ROOT, 'src', 'errors.ts'), 'utf8');
  const union = source.slice(
    source.indexOf('export type DocsErrorCode ='),
    source.indexOf(';', source.indexOf('export type DocsErrorCode =')),
  );
  return [...union.matchAll(/'([a-z-]+)'/g)].map((match) => match[1] as string);
}

/** Every code with a row in the README's troubleshooting table. */
function documentedCodes(): string[] {
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const table = readme.slice(readme.indexOf('### Troubleshooting'));
  return [...table.matchAll(/^\| `([a-z-]+)` \|/gm)].map(
    (match) => match[1] as string,
  );
}

/** Every code passed to a `docsError(` call outside the tests. */
function thrownCodes(): Set<string> {
  const found = new Set<string>();
  const sources = [
    'src/frontmatter.ts',
    'src/highlighter.ts',
    'src/meta.ts',
    'src/next.ts',
    'src/render.ts',
    'src/route-path.ts',
    'src/source.ts',
    'src/code-meta.ts',
    'src/plugins/remark-doc-links.ts',
    'src/react/search-dialog.tsx',
  ];
  for (const file of sources) {
    const source = readFileSync(path.join(ROOT, file), 'utf8');
    for (const match of source.matchAll(/docsError\(\s*'([a-z-]+)'/g)) {
      found.add(match[1] as string);
    }
  }
  return found;
}

describe('the error taxonomy', () => {
  it('parses the union at all', () => {
    // The guard on the guard: every assertion below compares against this
    // list, and an empty one would make all of them pass.
    expect(unionMembers().length).toBeGreaterThan(10);
    expect(unionMembers()).toContain('broken-link');
  });

  it('documents every code, and invents none', () => {
    /*
     * Set equality in both directions. A code with no row is an error a
     * consumer can catch and cannot look up; a row with no code sends them
     * looking for a failure that cannot occur.
     */
    expect([...documentedCodes()].sort()).toEqual([...unionMembers()].sort());
  });

  it('throws every code it documents, except the one nothing throws', () => {
    const thrown = thrownCodes();
    const unused = unionMembers().filter((code) => !thrown.has(code));

    /*
     * `search-index-unavailable` is raised by the dialog on a failed fetch,
     * which is a `docsError` call inside a `catch` this walk does see — so the
     * expected answer is none at all. A code nothing throws is either dead
     * surface or a call site that lost its code in a refactor.
     */
    expect(unused).toEqual([]);
  });

  it('exports the union as a type a switch can be exhaustive over', () => {
    // Not a `string`: the whole point of publishing the taxonomy is that a
    // typo in a consumer's `switch` is a compile error rather than a branch
    // that silently never runs.
    const code: DocsErrorCode = 'broken-link';
    expect(code).toBe('broken-link');

    // @ts-expect-error — not a member of the union.
    const invalid: DocsErrorCode = 'not-a-real-code';
    expect(invalid).toBe('not-a-real-code');
  });
});
