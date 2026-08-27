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
  // The `next/link` → `DocsLinkProps` adapter *factory*, shared by
  // `@waveso/docs/next` (server, markdown components), `./next-search` and
  // `./next-nav` (client). Private on purpose: it exists to stop those
  // answering the same question differently, not to be another answer — and it
  // takes the component as a parameter precisely so `next.ts`, which must not
  // statically import an optional peer, can use it too.
  //
  // `./react/next-link` IS exported: it is the ready-made component built from
  // this, which is what a consumer composing a shell by hand actually wants.
  'link-adapter',
  // The clipboard write, with its `execCommand` fallback for plain HTTP.
  // Shared by the code button's runtime and `DocsCopyPage`, and private for the
  // same reason as `link-adapter`: it exists so the two cannot answer "did the
  // copy work?" differently, not to be a third answer.
  'clipboard',
  // The shell. `docs.Layout` is the public name for all three, and it has to
  // be, because two of them only work when the route wires them together: the
  // drawer's trigger lives in the sidebar chrome and binds to the dialog by a
  // fixed `id`, and the nav reads a `pathname` the layout never sees.
  // Exporting the pieces would publish a way to render half a shell.
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
  // Every string the shell renders, and their defaults. The *type* is public,
  // through `DocsLayoutProps['labels']` and `DocsRouteOptions['labels']`; the
  // module is not, because the merge is an implementation detail of the route
  // and a second caller would be a second set of defaults — which is the bug it
  // was written to end, not one to publish a new way of having.
  'shell-labels',
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

/**
 * "Nothing undocumented is exported."
 *
 * ⚠️ THE CHANGESET CLAIMED THIS WAS ENFORCED BY A TEST BEFORE THIS TEST
 * EXISTED, and the README states it as a guarantee ("a name that is not in the
 * table above is not importable"). It was neither: five runtime names —
 * `DOCS_ERROR_PREFIX`, `DEFAULT_DOCS_THEMES`, `CALLOUT_TYPES`,
 * `defaultMarkdownComponents`, `DOCS_CONTENT_ID` — shipped as public API
 * documented in no file, so a consumer who imported one was depending on
 * something this package did not consider public and would rename without a
 * major.
 *
 * Two halves, because a guarantee about "importable names" needs both:
 *
 * - every **subpath** in `exports` appears in the README;
 * - every **runtime name** each subpath exports appears in the README.
 *
 * The second half reads `dist/`, which is what makes it real — a name is public
 * when the built module exports it, not when the source says so. It is
 * therefore build-order dependent, and CI runs it in the post-build step rather
 * than the ordinary one.
 */
describe('the documented surface', () => {
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const subpaths = Object.keys(section(manifest, 'exports')).filter(
    // `./package.json` is a resolver convention, and `./styles.css` is a file
    // you import for its side effect — neither is a name anyone calls.
    (key) => key !== '.' && key !== './package.json' && key !== './styles.css',
  );

  it('names every subpath somewhere in the README', () => {
    expect(subpaths.length).toBeGreaterThan(10);

    // Either spelling: the Entry points table writes `@waveso/docs/next`, the
    // Components table writes `react/skip-link` beside the component's name.
    const undocumented = subpaths.filter(
      (key) => !readme.includes(key.slice('./'.length)),
    );

    expect(undocumented).toEqual([]);
  });

  it.skipIf(!existsSync(path.join(ROOT, 'dist')))(
    'names every runtime export somewhere in the README',
    async () => {
      const undocumented: string[] = [];

      for (const key of subpaths) {
        const target = section(manifest, 'exports')[key];
        const file = isRecord(target) ? target.default : target;
        if (typeof file !== 'string' || !file.endsWith('.js')) continue;

        const module: Record<string, unknown> = await import(
          path.join(ROOT, file)
        );
        for (const name of Object.keys(module)) {
          // Word-boundary, so `DocsError` is not credited to a README mention
          // of `DocsErrorCode`.
          if (!new RegExp(`\\b${name}\\b`).test(readme)) {
            undocumented.push(`${key} → ${name}`);
          }
        }
      }

      // The guard on the guard: `import()` returning empty namespaces for every
      // subpath would otherwise make this pass while checking nothing.
      expect(subpaths.length).toBeGreaterThan(10);
      expect(undocumented).toEqual([]);
    },
  );

  /**
   * Every prop of every `…Props` interface, in the README too.
   *
   * ⚠️ THE EXPORT CHECK ABOVE CANNOT SEE PROPS, AND THAT IS WHERE THE GAP WAS.
   * `DocsSearch` was exported and named in the README, so the check passed —
   * while `pageSize` and `minQueryLength`, the two props 0.4.0's changelog told
   * consumers to migrate *to*, appeared nowhere in 57 KB of it. A reader whose
   * `maxResults={20}` stopped compiling went looking for the replacement and
   * found nothing.
   *
   * Read out of the emitted `.d.ts` rather than the source: a prop that fails to
   * survive the build is not a prop, and the declaration file is what a consumer
   * actually resolves.
   */
  it.skipIf(!existsSync(path.join(ROOT, 'dist')))(
    'names every prop of every exported props interface',
    () => {
      const undocumented: string[] = [];
      let checked = 0;

      for (const key of subpaths) {
        const target = section(manifest, 'exports')[key];
        const types = isRecord(target) ? target.types : undefined;
        if (typeof types !== 'string') continue;

        const declaration = readFileSync(path.join(ROOT, types), 'utf8');
        for (const [name, body] of propsInterfaces(declaration)) {
          for (const prop of memberNames(body)) {
            checked += 1;
            if (INTERNAL_PROPS.has(prop)) continue;
            if (!new RegExp(`\\b${prop}\\b`).test(readme)) {
              undocumented.push(`${key} → ${name}.${prop}`);
            }
          }
        }
      }

      // The guard on the guard: a parse that matched nothing would make this
      // pass by checking nothing, which is the failure it exists to prevent.
      expect(checked).toBeGreaterThan(30);
      expect(undocumented).toEqual([]);
    },
  );
});

describe("the README's claims about this repository", () => {
  it('names a publish gate that `prepublishOnly` actually runs', () => {
    /*
     * ⚠️ IT CLAIMED `pnpm size` RAN AT PUBLISH TIME AND IT DID NOT. The
     * paragraph introducing the cost table says every figure is enforced "in CI
     * and again in `prepublishOnly`", which is the sentence that makes the whole
     * table worth trusting — and the script ran typecheck, lint, test, build,
     * check:readme and check:package. Nothing verified the published numbers at
     * the one moment they became published.
     */
    const chain = String(section(manifest, 'scripts').prepublishOnly);

    expect(chain).toContain('pnpm run build');
    expect(chain).toContain('pnpm run size');
  });
});

/**
 * Props that are plumbing rather than API, and so are documented by prose
 * rather than by name.
 *
 * Every entry needs a reason. "It is awkward to document" is not one — that is
 * how `pageSize` came to be undocumented in the first place.
 */
const INTERNAL_PROPS = new Set([
  // React's own, and named by every tutorial ever written.
  'children',
  'className',
  // Seams the Next adapter fills in, so a consumer of `@waveso/docs/next` never
  // types them. The README documents `docs.Layout` and `DocsSearch`, not the
  // host-agnostic components underneath.
  'navigate',
  'Link',
  'Image',
  // Data a component is handed by the layer above it, never written by hand.
  'hast',
  'entries',
  'nodes',
  'nav',
  'pathname',
  'components',
  'searchIndexUrl',
  // Documented as a group under "Translating the chrome" rather than one row
  // per string; `DocsLabels`' own members are checked by `next.test.ts`.
  'labels',
]);

/** `[name, body]` for every `export interface …Props` in a declaration file. */
function propsInterfaces(source: string): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  const pattern = /(?:export )?interface (\w+Props)(?:<[^>]*>)?[^{]*\{/g;

  for (const match of source.matchAll(pattern)) {
    const open = source.indexOf('{', match.index);
    let depth = 0;
    let end = open;
    for (; end < source.length; end += 1) {
      if (source[end] === '{') depth += 1;
      else if (source[end] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    found.push([match[1] as string, source.slice(open + 1, end)]);
  }
  return found;
}

/**
 * Top-level member names of an interface body.
 *
 * Two spaces of indentation exactly, so a member of a nested object type — or a
 * key inside a `Record<…>` written across lines — is not mistaken for a prop of
 * the interface itself.
 */
function memberNames(body: string): string[] {
  return [...body.matchAll(/^ {2}(\w+)\??:/gm)].map(
    (match) => match[1] as string,
  );
}

/**
 * The clauses of the stability policy a test can hold.
 *
 * The policy is in the README, and most of it is a promise about future
 * behaviour that no test can check — "dropping a React major gets its own
 * release" is a commitment, not an invariant. Three parts are checkable, and
 * those are exactly the parts that rot first: a floor that drifts from the
 * documented one, a peer range narrowed without anyone noticing, and a
 * third-party type in a public signature that nobody remembers is now this
 * package's problem too.
 */
describe('the stability policy', () => {
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const policy = readme.slice(readme.indexOf('## Stability'));

  it('exists, and says the thing that matters first', () => {
    // The guard on the guard: a missing section would make every slice below
    // empty and every assertion vacuous.
    expect(policy.length).toBeGreaterThan(500);
    expect(policy).toContain('breaking changes land in minors');
  });

  it('documents the Node floor the manifest actually declares', () => {
    /*
     * Two places said 20.19.0 and 22.12.0 once, and the README was the wrong
     * one. A floor is the first thing a reader checks before installing, so it
     * is the worst single number in the file to have stale.
     */
    const engines = section(manifest, 'engines');
    const declared = String(engines.node ?? '');
    // The version, not the range syntax: the README writes a floor as prose
    // and the manifest as a range, and comparing `>=22.12.0` to "22.12.0"
    // would fail on the punctuation rather than on the number.
    const version = /(\d+\.\d+\.\d+)/.exec(declared)?.[1];

    expect(version).toBeDefined();
    expect(policy).toContain(version as string);
  });

  it('names every peer whose major it promises to treat as breaking', () => {
    /*
     * "Dropping a Next or React major is breaking" is only a promise if the
     * policy names the peers it is about. A peer added later — `next/og`, a
     * future adapter — inherits the promise silently otherwise.
     */
    for (const peer of Object.keys(section(manifest, 'peerDependencies'))) {
      expect(policy.toLowerCase()).toContain(peer.toLowerCase());
    }
  });

  it('claims CSS class names and emitted hast as covered', () => {
    /*
     * The two clauses packages usually omit, and omitting them is how a
     * "patch" reflows everyone's site. Asserted as text because that is what
     * they are — a commitment — and a commitment quietly deleted is the whole
     * failure mode.
     */
    expect(policy).toContain('CSS class names');
    expect(policy).toContain('hast');
    expect(policy).toContain('wave-docs-');
  });

  it('names the third-party types it has adopted', () => {
    /*
     * Each of these appears in a public signature, so that library's next
     * major is this package's major. A type added to the surface without a
     * line here is a break this package would pass on without naming.
     */
    for (const owned of ['PluggableList', 'MiniSearch', 'Root']) {
      expect(policy).toContain(owned);
    }
  });
});
