/**
 * Exactly which Node builtins each published entry point requires.
 *
 * The markdown pipeline is runtime-agnostic, and not by accident:
 * `highlighter.ts` picked Shiki's JavaScript regex engine over the WASM one
 * deliberately, so there is no `.wasm` either. That is a real differentiator
 * given away for free by not being written down — and it is the kind of
 * property that breaks silently, because adding one `node:crypto` import to a
 * file three modules deep costs nothing locally and rules out every
 * non-Node runtime at once.
 *
 * ⚠️ `toEqual`, NEVER `toContain`. A subset assertion passes when a new
 * builtin appears, which defeats the entire purpose of the file.
 *
 * This measures *requirements*, not blessings. A bundle that resolves is not a
 * runtime, and the README says so in the same words.
 */

import { existsSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { rolldown } from 'rolldown';
import { describe, expect, it } from 'vitest';

const ROOT = path.join(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');

/**
 * The exact builtin set per entry.
 *
 * `render` and `highlighter` at zero is the headline. `source` needs the
 * filesystem because reading a content directory is what it is for. `next`
 * inherits `source`'s two and adds `node:crypto` for the search index's ETag.
 */
const EXPECTED: Record<string, readonly string[]> = {
  types: [],
  frontmatter: [],
  highlighter: [],
  render: [],
  'search-index': [],
  source: ['node:fs/promises', 'node:path'],
  next: ['node:crypto', 'node:fs/promises', 'node:path'],
};

/**
 * Node builtins, in both spellings.
 *
 * The bare form is the one that matters historically: `gray-matter@4` did
 * `require('fs')` — not `node:fs` — for a `matter.read()` this package never
 * called, and that single bare specifier was the only gratuitous Node
 * requirement in the whole tree. A check that only looked for the `node:`
 * prefix would have reported the package clean while it was not.
 */
const BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

/** Every builtin `entry` pulls in, transitively, with dependencies bundled. */
async function builtinsOf(entry: string): Promise<string[]> {
  const bundle = await rolldown({
    input: path.join(DIST, `${entry}.js`),
    // Not `node`: the question is what this needs *without* assuming a Node
    // runtime, so nothing may be resolved away as "obviously available".
    platform: 'neutral',
    logLevel: 'silent',
    // The peers. They are the consumer's to provide on any runtime, and
    // bundling `next` here would measure Next's requirements, not ours.
    external: [/^react($|\/)/, /^next($|\/)/],
  });

  const { output } = await bundle.generate({ format: 'esm' });
  await bundle.close();

  /*
   * Across every emitted chunk, not just the first. `unbundle` output splits
   * into several, and a builtin imported only by the second one would
   * otherwise be invisible — the assertion would pass by looking in the wrong
   * place, which is worse than not existing.
   */
  const found = new Set<string>();
  for (const chunk of output) {
    if (chunk.type !== 'chunk') continue;
    for (const specifier of chunk.imports) {
      if (BUILTINS.has(specifier)) found.add(specifier);
    }
  }
  return [...found].sort();
}

describe.skipIf(!existsSync(DIST))('runtime requirements', () => {
  for (const [entry, expected] of Object.entries(EXPECTED)) {
    it(`${entry} requires ${expected.length === 0 ? 'no builtins at all' : expected.join(', ')}`, async () => {
      expect(await builtinsOf(entry)).toEqual([...expected]);
    }, 60_000);
  }

  it('is measuring something, rather than passing on an empty walk', async () => {
    /*
     * The guard on the guard. Every expectation above is a set equality, and
     * five of them are the empty set — so a bundler call that silently
     * returned nothing would make this file's most valuable assertions pass
     * for the wrong reason. `source` genuinely needs two builtins, and that is
     * what proves the walk sees anything at all.
     */
    expect(await builtinsOf('source')).toHaveLength(2);
  }, 60_000);
});
