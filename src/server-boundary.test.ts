/**
 * Nothing reachable from `defaultMarkdownComponents` may be a client
 * component.
 *
 * That map is rendered on every page of every consumer, so one `'use client'`
 * anywhere under it puts a client reference in the flight stream and a chunk in
 * the browser's manifest for every reader — including the ones whose page uses
 * none of it. It happened: `youtube: YouTube` was mapped unconditionally while
 * `youtube.tsx` began with `'use client'`, and none of 536 tests noticed. On
 * the smoke build, over a corpus containing no YouTube URL at all, its code
 * was in a client chunk referenced from the prerendered HTML and the flight
 * payload of every page. (The chunk was 12.70 KB brotli, but shared — the
 * component's own byte contribution was small. What matters is that a client
 * boundary sat on the path every consumer renders.)
 *
 * ⚠️ SCOPED TO `defaultMarkdownComponents`, NOT TO `DocContent`. `DocContent`
 * renders a client child on purpose — the copy-button runtime — and only when
 * the page it was handed actually contains a code frame. Widening this to the
 * whole React entry set would fail on that by design, and the honest way to
 * express "the markdown map is server-only" is to check the markdown map.
 *
 * Runs against `dist/`, because the directive is a property of the built
 * output: a bundler that dropped it would leave the source looking correct.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DIST = path.join(import.meta.dirname, '..', 'dist');

/** The entry every consumer's pages render through. */
const ENTRY = path.join(DIST, 'react', 'markdown-components.js');

/** A module known to be a client component, to prove the walk can fail. */
const KNOWN_CLIENT = path.join(DIST, 'react', 'sidebar.js');

const IMPORT = /(?:^|\n)\s*(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;

function hasUseClient(source: string): boolean {
  return /^\s*(['"])use client\1/.test(source);
}

/**
 * Every local module reachable from `entry`, transitively.
 *
 * ⚠️ A REGEX WALK CANNOT SEE `import()`. That is a real limit and it is not
 * hypothetical here — `next.ts` loads `next/link` through a dynamic import
 * precisely so it stays off the static graph. Nothing under the markdown map
 * does, and if something starts to, this will not notice. Bare specifiers are
 * skipped too: a dependency's own `'use client'` is its business, and none of
 * this package's dependencies ship React components.
 */
function reachable(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);

    const source = readFileSync(file, 'utf8');
    for (const pattern of [IMPORT, SIDE_EFFECT_IMPORT]) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        const specifier = match[1];
        if (specifier === undefined || !specifier.startsWith('.')) continue;
        const resolved = path.resolve(path.dirname(file), specifier);
        if (existsSync(resolved)) queue.push(resolved);
      }
    }
  }
  return [...seen];
}

describe.skipIf(!existsSync(DIST))('the server component boundary', () => {
  it('actually reaches the modules the map renders', () => {
    /*
     * The guard on the guard. The assertion below is "no module in this set is
     * a client component", which passes trivially against a set of one — a
     * walk that silently resolved nothing would look exactly like a clean bill
     * of health.
     *
     * Named modules rather than a count: `toBeGreaterThan(3)` was the first
     * version and it failed against a correct walk, because the true reachable
     * set here IS three files. The property is "it follows relative imports
     * into the components the map points at", and that is what this says.
     */
    const reached = reachable(ENTRY).map((file) => path.relative(DIST, file));

    expect(reached).toContain(path.join('react', 'callout.js'));
    expect(reached).toContain(path.join('react', 'youtube.js'));
  });

  it('pulls no client component onto every page', () => {
    const client = reachable(ENTRY).filter((file) =>
      hasUseClient(readFileSync(file, 'utf8')),
    );

    expect(
      client.map((file) => path.relative(DIST, file)),
      'these ship to every reader, on every page, used or not',
    ).toEqual([]);
  });

  it('would notice one, which is the only reason to trust the two above', () => {
    // Pointed at a module that IS a client component. If this ever passes, the
    // detection is broken and the assertions above mean nothing.
    const client = reachable(KNOWN_CLIENT).filter((file) =>
      hasUseClient(readFileSync(file, 'utf8')),
    );

    expect(client.length).toBeGreaterThan(0);
  });
});
