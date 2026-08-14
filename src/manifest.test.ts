import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The manifest is the only source file a consumer's package manager reads
 * before any of our code runs, so its mistakes are install-time hard failures
 * that no other test in this suite can reach.
 *
 * Every assertion here pins a defect that shipped in `0.1.0`'s staged manifest
 * and was reproduced against a real `npm install` / `pnpm pack`.
 */

const ROOT = path.join(import.meta.dirname, '..');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson(file: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!isRecord(parsed)) {
    throw new Error(
      `@waveso/docs: ${file} did not parse to an object. Fix the JSON.`,
    );
  }
  return parsed;
}

function section(
  manifest: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = manifest[key];
  return isRecord(value) ? value : {};
}

/** Leading integer of a semver-ish string: `>=22.12.0` → 22, `26` → 26. */
function majorOf(range: string): number {
  const match = /(\d+)/.exec(range);
  if (!match?.[1]) {
    throw new Error(
      `@waveso/docs: cannot read a major version out of "${range}". ` +
        'Write the floor as a plain range such as ">=22.12.0".',
    );
  }
  return Number(match[1]);
}

const manifest = readJson(path.join(ROOT, 'package.json'));

describe('peer dependencies', () => {
  const peers = section(manifest, 'peerDependencies');
  const meta = section(manifest, 'peerDependenciesMeta');

  /**
   * `optional` means "need not be installed" — npm still validates the range
   * against a version that *is* present. A `tailwindcss: ^4` peer therefore
   * ERESOLVE-failed every Tailwind 3 project outright, for a dependency this
   * package never used: `src/styles.css` has no `@apply` and every class in
   * `dist/react/**` is `wave-docs-*` BEM.
   */
  it('does not declare tailwindcss', () => {
    expect(peers).not.toHaveProperty('tailwindcss');
    expect(meta).not.toHaveProperty('tailwindcss');
  });

  /**
   * Only `./frontmatter` and `./meta` build a `z.object` at module scope;
   * `./react/*`, `./search-options`, `./types` and `./markdown-links` all
   * import cleanly in a zod-free install. A hard peer punished every one of
   * those consumers for a range they never touch.
   */
  it('marks zod optional', () => {
    expect(peers.zod).toBe('^4.4.3');
    expect(meta.zod).toEqual({ optional: true });
  });
});

/**
 * npm-packlist force-includes README, LICENCE, COPYING, NOTICE and
 * package.json and nothing else, so a CHANGELOG left out of `files` is absent
 * from the tarball: npmjs.com renders no Changelog tab and Renovate's
 * tarball fallback finds no release notes.
 */
it('ships the changelog', () => {
  const files = manifest.files;
  expect(Array.isArray(files) && files).toContain('CHANGELOG.md');
  expect(existsSync(path.join(ROOT, 'CHANGELOG.md'))).toBe(true);
});

/**
 * A scoped package defaults to `restricted`, and the very first publish of
 * `@waveso/docs` is done by hand — where that default turns into a private
 * package nobody can install.
 */
it('publishes publicly, with provenance', () => {
  expect(section(manifest, 'publishConfig')).toEqual({
    access: 'public',
    provenance: true,
  });
});

describe('node version floors', () => {
  const nvmrc = majorOf(readFileSync(path.join(ROOT, '.nvmrc'), 'utf8').trim());
  const engines = section(manifest, 'engines').node;
  const devRuntime = section(
    section(manifest, 'devEngines'),
    'runtime',
  ).version;

  it('declares both floors as ranges', () => {
    expect(typeof engines).toBe('string');
    expect(typeof devRuntime).toBe('string');
  });

  /**
   * `devEngines` answers "what does a contributor need", which is exactly what
   * `.nvmrc` pins and what both workflows install (`runtime: node@26`).
   * Anything looser is a floor nothing exercises.
   */
  it('pins the development floor to the runtime .nvmrc selects', () => {
    expect(majorOf(String(devRuntime))).toBe(nvmrc);
  });

  /**
   * `engines.node` answers a different question — what a *consumer* must run —
   * so it is deliberately lower than the development floor. It may not name an
   * end-of-life line, though: Node 20 went EOL 2026-04-30, and pnpm fails
   * installs on an engines mismatch by default, so the promise is neither
   * patched nor free.
   */
  it('keeps the consumer floor on a maintained line, at or below .nvmrc', () => {
    const consumer = majorOf(String(engines));
    expect(consumer).toBeGreaterThanOrEqual(22);
    expect(consumer).toBeLessThanOrEqual(nvmrc);
  });
});

describe('exports map', () => {
  /** Every string target in the map, wildcards included. */
  function targets(node: unknown): string[] {
    if (typeof node === 'string') {
      return [node];
    }
    if (isRecord(node)) {
      return Object.values(node).flatMap(targets);
    }
    // `"browser": null` is the deliberate "fail loudly in a client bundle"
    // marker on the Node-only subpaths; it points at no file.
    return [];
  }

  const all = targets(manifest.exports);

  it('resolves every subpath to a path inside the package', () => {
    expect(all.length).toBeGreaterThan(0);
    for (const target of all) {
      expect(target.startsWith('./')).toBe(true);
    }
  });

  /**
   * Skipped rather than failed when `dist/` is absent so the suite does not
   * depend on build order — CI type-checks and tests before it builds.
   */
  it.skipIf(!existsSync(path.join(ROOT, 'dist')))(
    'points every subpath at a file the build actually emits',
    () => {
      const missing = all.flatMap((target) => {
        if (!target.includes('*')) {
          return existsSync(path.join(ROOT, target)) ? [] : [target];
        }
        const [prefix, suffix] = target.split('*');
        if (prefix === undefined || suffix === undefined) {
          return [target];
        }
        // `./dist/react/*.js` splits to a prefix that is already a directory;
        // `path.dirname` on it would climb one level too far and silently
        // pass against the wrong folder.
        const isDir = prefix.endsWith('/');
        const dir = path.join(ROOT, isDir ? prefix : path.dirname(prefix));
        if (!existsSync(dir)) {
          return [target];
        }
        const base = isDir ? '' : path.basename(prefix);
        const matches = readdirSync(dir).filter(
          (name) => name.startsWith(base) && name.endsWith(suffix),
        );
        return matches.length > 0 ? [] : [target];
      });

      expect(missing).toEqual([]);
    },
  );
});
