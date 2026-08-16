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
  const dependencies = section(manifest, 'dependencies');

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
   * `frontmatter.ts` and `meta.ts` import Zod at module scope, which is what a
   * dependency is. As a peer — even an optional one, which npm still
   * range-checks whenever the package is present — `^4.4.3` refused to install
   * beside the Zod that ~69% of the ecosystem was on at the time of writing:
   * 47% still on 3.x, plus every 4.x below 4.4.3. Owning the copy also makes
   * the `.extend()` instance-identity guarantee structural rather than
   * documented, via the `z` re-exported from `./frontmatter`.
   */
  it('depends on zod rather than demanding it', () => {
    expect(dependencies.zod).toBe('^4.4.3');
    expect(peers).not.toHaveProperty('zod');
    expect(meta).not.toHaveProperty('zod');
  });

  /** A dependency must not also be a devDependency; the two would drift. */
  it('does not duplicate a dependency into devDependencies', () => {
    const dev = section(manifest, 'devDependencies');
    for (const name of Object.keys(dependencies)) {
      expect(dev).not.toHaveProperty(name);
    }
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

/**
 * React modules that are deliberately NOT importable, each with the reason.
 *
 * Empty today. It exists because the shell work adds `layout`, `nav`,
 * `next-nav` and `code-runtime` to `src/react/`, none of which is the public
 * API — `docs.Layout` is, and `DocsSidebar` is. Without this the enumeration
 * below would be silently completed by whoever adds the first one.
 */
const INTERNAL_REACT_MODULES = new Set<string>([
  // The `next/link` → `DocsLinkProps` adapter, shared by `@waveso/docs/next`
  // (server, markdown components) and `./next-search` (client, search
  // results). Private on purpose: it exists to stop those two answering the
  // same question differently, not to be a third answer.
  'next-link',
  // The shell. `docs.Layout` is the public name for all three, and it has to
  // be, because two of them only work when the route wires them together: the
  // drawer's trigger lives in the header and binds to the dialog by a fixed
  // `id`, and the nav reads a `pathname` the layout never sees. Exporting the
  // pieces would publish a way to render half a shell.
  'layout',
  'nav',
  'next-nav',
  // The copy runtime. `DocContent` mounts it, and only when the tree contains
  // a code frame — exporting it would publish a second way to mount it, which
  // is the way that double-announces to a screen reader.
  'code-runtime',
  // The scroll geometry behind the sidebar's scroll-into-view. Pure, and
  // separate from the component so it can be tested exhaustively — jsdom
  // reports every rectangle as zero, so nothing driving the effect could.
  'nearest-scroll-top',
]);

describe('exports map', () => {
  /** Every string target in the map. */
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
   * Two subpaths were deleted rather than kept for symmetry, and must not
   * return. `./markdown-links` froze six names to make one reachable — the
   * plugin among them throws `docsError('internal')` unless the caller sets an
   * undocumented vfile field, so it was surface with no use. `./search-options`
   * froze `tokenizeSearchText`, an `Intl.Segmenter` policy with a feature-detect
   * fallback, i.e. the function most likely to change; and it was doing nothing
   * even internally, since both readers import it relatively.
   *
   * `resolveMarkdownLink` survives, from `./render`: six public names became
   * one, and it is the only one a `linkResolver` author cannot hand-roll.
   */
  it('does not re-expose the deleted plumbing subpaths', () => {
    const keys = Object.keys(section(manifest, 'exports'));
    expect(keys).not.toContain('./markdown-links');
    expect(keys).not.toContain('./search-options');
  });

  /**
   * Wildcards are gone on purpose, and must not come back. Node's `exports`
   * wildcard does not check that the target exists, so `"./react/*"` made every
   * file that ever lands in `src/react/` public API on the day it is typed —
   * verified: a throwaway module dropped into `dist/react/` imported cleanly.
   * The stability policy promises nothing undocumented is exported, and a
   * wildcard makes that promise unkeepable rather than merely unkept.
   */
  it('enumerates every subpath rather than wildcarding', () => {
    for (const key of Object.keys(section(manifest, 'exports'))) {
      expect(key).not.toContain('*');
    }
    for (const target of all) {
      expect(target).not.toContain('*');
    }
  });

  /**
   * Skipped rather than failed when `dist/` is absent so the suite does not
   * depend on build order — CI type-checks and tests before it builds.
   */
  it.skipIf(!existsSync(path.join(ROOT, 'dist')))(
    'points every subpath at a file the build actually emits',
    () => {
      const missing = all.filter(
        (target) => !existsSync(path.join(ROOT, target)),
      );

      expect(missing).toEqual([]);
    },
  );

  /**
   * The other half of the enumeration: a component added to `src/react/` and
   * forgotten in the map ships unimportable, which no other test would catch.
   * A module that is genuinely internal goes on the allowlist WITH the reason —
   * the package already keeps `docs-error`, `map-pooled` and `section-boundary`
   * out of the map entirely, and `src/react/` now works the same way.
   */
  it('exports every react module, or names it internal', () => {
    // `.ts` as well as `.tsx`: a module in here that happens to use
    // `createElement` instead of JSX is no less public a name.
    const modules = readdirSync(path.join(ROOT, 'src', 'react'))
      .filter((name) => /\.tsx?$/.test(name) && !name.includes('.test.'))
      .map((name) => name.replace(/\.tsx?$/, ''));

    const exported = new Set(
      Object.keys(section(manifest, 'exports'))
        .filter((key) => key.startsWith('./react/'))
        .map((key) => key.slice('./react/'.length)),
    );

    const unaccounted = modules.filter(
      (name) => !exported.has(name) && !INTERNAL_REACT_MODULES.has(name),
    );

    expect(unaccounted).toEqual([]);

    // An allowlist entry for a module that no longer exists is a stale comment
    // pretending to be a decision.
    const stale = [...INTERNAL_REACT_MODULES].filter(
      (name) => !modules.includes(name),
    );
    expect(stale).toEqual([]);
  });

  /**
   * `'use client'` has to survive the build, as the FIRST statement.
   *
   * It is the only thing that makes a component a client boundary, and losing
   * it is completely silent: the module still compiles, still renders, still
   * type-checks. What changes is that the boundary moves up into whatever
   * imported it — a consumer's `app/docs/layout.tsx` becomes a client
   * component, dragging the whole subtree with it, and nothing anywhere says
   * so. `tsdown` keeps directives only because `unbundle` is on and Rolldown
   * tracks them; a bundling config, a minifier, or a plugin that rewrites the
   * prologue all drop it.
   *
   * Skipped when `dist/` is absent so the suite still runs on a clean
   * checkout — CI builds before `check:package`, which is where this matters.
   */
  it.skipIf(!existsSync(path.join(ROOT, 'dist', 'react')))(
    'keeps the use-client directive through the build',
    () => {
      const sourceDir = path.join(ROOT, 'src', 'react');
      const clientModules = readdirSync(sourceDir)
        .filter((name) => name.endsWith('.tsx') && !name.includes('.test.'))
        .filter((name) =>
          readFileSync(path.join(sourceDir, name), 'utf8').startsWith(
            "'use client'",
          ),
        )
        .map((name) => name.replace(/\.tsx$/, '.js'));

      // A guard on the guard: if the filter ever matches nothing — a rename, a
      // changed quote style — this test would pass by testing an empty list.
      expect(clientModules.length).toBeGreaterThan(0);

      const stripped = clientModules.filter((name) => {
        const built = readFileSync(path.join(ROOT, 'dist', 'react', name), {
          encoding: 'utf8',
        });
        return !/^['"]use client['"];/.test(built.trimStart());
      });

      expect(stripped).toEqual([]);
    },
  );
});
