/**
 * What `npx @waveso/docs init` writes.
 *
 * ⚠️ THE ASSERTIONS ARE ABOUT THE LINES THAT FAIL SILENTLY, NOT ABOUT THE
 * PROSE. A scaffold is only worth shipping if it gets right the things a
 * consumer gets wrong invisibly: a `dynamicParams` that is not a literal
 * `false`, a route handler without `force-static`, an index page nobody
 * created, and a root layout that renders no `<html>`. Every one of those
 * produces an application that builds.
 *
 * The whole scaffold is also built by a real Next in both mount shapes — that
 * check lives outside this file, because it costs a build.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { docsScaffold, initDocs, run } from './cli.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

async function project(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'wave-docs-init-'));
  dirs.push(dir);
  return dir;
}

/** The scaffold as `{ file: contents }`, for readable assertions. */
function byFile(options?: Parameters<typeof docsScaffold>[0]) {
  return Object.fromEntries(
    docsScaffold(options).map(({ file, contents }) => [file, contents]),
  );
}

describe('docsScaffold', () => {
  it('mounts the route files under the base path', () => {
    // The URLs are under the mount, so the folders are too.
    expect(Object.keys(byFile())).toEqual([
      'lib/docs.ts',
      'app/docs/layout.tsx',
      'app/docs/page.tsx',
      'app/docs/[...slug]/page.tsx',
      'app/docs/search-index.json/route.ts',
      'app/docs/llms-full.txt/route.ts',
      'app/layout.tsx',
    ]);
  });

  it('puts them at the top of `app` for a root mount', () => {
    expect(Object.keys(byFile({ basePath: '/' }))).toEqual([
      'lib/docs.ts',
      'app/layout.tsx',
      'app/page.tsx',
      'app/[...slug]/page.tsx',
      'app/search-index.json/route.ts',
      'app/llms-full.txt/route.ts',
    ]);
  });

  it('writes `dynamicParams` as a literal `false`', () => {
    /*
     * ⚠️ NOT `docs.dynamicParams`. Next parses route segment config out of the
     * module before any of it runs, so a value it would have to execute an
     * import to learn is no value at all — and the failure is a build that
     * succeeds while unlisted URLs render on demand.
     */
    expect(byFile()['app/docs/[...slug]/page.tsx']).toContain(
      'export const dynamicParams = false;',
    );
  });

  it('freezes every route handler with a literal `force-static`', () => {
    // Without it Next re-renders the whole corpus per request, from markdown
    // that output tracing did not put in the deployment bundle.
    const files = byFile({ llmsIndex: true });
    for (const file of Object.keys(files).filter((f) =>
      f.endsWith('route.ts'),
    )) {
      expect(files[file], file).toContain(
        "export const dynamic = 'force-static';",
      );
    }
  });

  it('gives the index its own page, which `[...slug]` cannot serve', () => {
    expect(byFile()).toHaveProperty('app/docs/page.tsx');
    expect(byFile()['app/docs/page.tsx']).toContain('docs.IndexPage');
  });

  describe('the root layout', () => {
    it('owns `<html>` and `<body>` at a root mount, and renders the shell', () => {
      /*
       * ⚠️ `docs.Layout` IS NOT A ROOT LAYOUT — it deliberately does not own
       * those elements, which is what lets a host wrap it. At a root mount
       * there is no other layout to own them, so this file must.
       */
      const layout = byFile({ basePath: '/' })['app/layout.tsx'] ?? '';
      expect(layout).toContain('<html');
      expect(layout).toContain('<body');
      expect(layout).toContain('<docs.Layout>');
      // The UA's own 8px, which would start the sidebar's divider below the
      // top edge. The package styles nothing outside `.wave-docs-*`.
      expect(layout).toContain('margin: 0');
    });

    it('is a one-liner under a sub-mount, with a root layout beside it', () => {
      const files = byFile();
      expect(files['app/docs/layout.tsx']).toContain(
        'export default docs.Layout;',
      );
      // Offered rather than assumed: `create-next-app` writes this and the
      // scaffold skips it, but a bare project without one cannot build.
      expect(files['app/layout.tsx']).toContain('<html');
    });
  });

  it('imports the stylesheet exactly once', () => {
    // Twice is harmless and reads as a mistake; never is a site with no CSS.
    const files = byFile();
    const importers = Object.values(files).filter((c) =>
      c.includes("import '@waveso/docs/styles.css';"),
    );
    expect(importers).toHaveLength(1);
  });

  it('omits `llms.txt` unless asked, because the corpus is the one that earns a file', () => {
    // `llms-full.txt` carries every page *and* its URL, so an agent that finds
    // it has everything; the index is a convenience, and the copy button reads
    // the corpus.
    expect(Object.keys(byFile())).not.toContain('app/docs/llms.txt/route.ts');
    expect(Object.keys(byFile({ llmsIndex: true }))).toContain(
      'app/docs/llms.txt/route.ts',
    );
  });

  it('carries the options into the config', () => {
    const config =
      byFile({
        contentDir: 'docs',
        siteUrl: 'https://x.test',
        title: 'Acme',
      })['lib/docs.ts'] ?? '';
    expect(config).toContain("contentDir: 'docs'");
    expect(config).toContain("siteUrl: 'https://x.test'");
    expect(config).toContain("title: 'Acme'");
  });

  describe('placeholders', () => {
    /*
     * ⚠️ ONE RULE, AND IT WAS BROKEN TWO LINES AFTER BEING WRITTEN. A
     * placeholder that *builds* is worse than a missing value: nothing ever
     * forces anyone to fix it, so it ships. `siteUrl` was commented out for
     * exactly this reason and then `title: 'Your product'` was written anyway
     * — a corpus telling every agent the product is called "Your product".
     */
    it('comments `siteUrl` out rather than inventing an origin', () => {
      expect(byFile()['lib/docs.ts']).toContain('// siteUrl:');
      expect(byFile()['lib/docs.ts']).not.toMatch(/^ {2}siteUrl:/m);
    });

    it('omits the whole `llms` block rather than inventing a name', () => {
      const config = byFile()['lib/docs.ts'] ?? '';
      expect(config).not.toMatch(/^ {2}llms: \{/m);
      // And says how to turn it on, since the button depends on it.
      expect(config).toContain("llms: { title: 'Your product' }");
    });

    it('writes `llms` once a real name is known', () => {
      expect(byFile({ title: 'acme-docs' })['lib/docs.ts']).toMatch(
        /^ {2}llms: \{/m,
      );
    });

    it('escapes a name containing a quote', () => {
      // `"name": "l'app"` is legal in package.json and would otherwise close
      // the string early and write a config that does not parse.
      expect(byFile({ title: "l'app" })['lib/docs.ts']).toContain(
        "title: 'l\\'app'",
      );
    });
  });
});

describe('initDocs', () => {
  it('writes the scaffold to disk', async () => {
    const dir = await project();

    const result = await initDocs(dir, { basePath: '/' });

    expect(result.skipped).toEqual([]);
    expect(result.written).toContain('lib/docs.ts');
    await expect(
      readFile(path.join(dir, 'lib', 'docs.ts'), 'utf8'),
    ).resolves.toContain('createDocsRoute');
  });

  it('never overwrites, so a second run is safe', async () => {
    /*
     * ⚠️ THE ONE BEHAVIOUR THAT MAKES A SCAFFOLD SAFE TO RUN. A project that
     * already has an `app/layout.tsx` must not lose it to a tool someone ran
     * to see what it would do.
     */
    const dir = await project();
    await initDocs(dir, { basePath: '/' });
    await writeFile(path.join(dir, 'lib', 'docs.ts'), 'MINE\n', 'utf8');

    const second = await initDocs(dir, { basePath: '/' });

    expect(second.written).toEqual([]);
    expect(second.skipped).toContain('lib/docs.ts');
    await expect(
      readFile(path.join(dir, 'lib', 'docs.ts'), 'utf8'),
    ).resolves.toBe('MINE\n');
  });
});

describe('the project name', () => {
  it('comes from `package.json`, which is at least true', async () => {
    const dir = await project();
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'acme-docs' }),
      'utf8',
    );

    const result = await initDocs(dir, { basePath: '/' });

    expect(result.needsTitle).toBeUndefined();
    await expect(
      readFile(path.join(dir, 'lib', 'docs.ts'), 'utf8'),
    ).resolves.toContain("title: 'acme-docs'");
  });

  it('is reported as missing rather than guessed', async () => {
    const dir = await project();

    const result = await initDocs(dir, { basePath: '/' });

    expect(result.needsTitle).toBe(true);
    await expect(
      readFile(path.join(dir, 'lib', 'docs.ts'), 'utf8'),
    ).resolves.not.toMatch(/^ {2}llms: \{/m);
  });

  it('survives a `package.json` that does not parse', async () => {
    // A scaffold is not worth failing over someone's broken JSON; it lands in
    // the same place as a missing name.
    const dir = await project();
    await writeFile(path.join(dir, 'package.json'), '{ nope', 'utf8');

    const result = await initDocs(dir, { basePath: '/' });

    expect(result.needsTitle).toBe(true);
  });
});

describe('the command line', () => {
  /** Run `argv` and collect what it printed. */
  async function cli(argv: string[], cwd: string) {
    const lines: string[] = [];
    const code = await run(argv, cwd, (line) => lines.push(line));
    return { code, output: lines.join('\n') };
  }

  it('scaffolds on `init`', async () => {
    const dir = await project();

    const { code, output } = await cli(['init', '--base-path', '/'], dir);

    expect(code).toBe(0);
    expect(output).toContain('created  lib/docs.ts');
  });

  it('prints usage and fails with no command', async () => {
    // Exit code, not just text: a scaffolder wired into someone's setup script
    // has to be able to tell that nothing happened.
    const { code, output } = await cli([], await project());
    expect(code).toBe(1);
    expect(output).toContain('Usage');
  });

  it('prints usage and succeeds on `--help`', async () => {
    const { code, output } = await cli(['--help'], await project());
    expect(code).toBe(0);
    expect(output).toContain('Usage');
  });

  it('refuses an unknown command by name', async () => {
    const { code, output } = await cli(['bulid'], await project());
    expect(code).toBe(1);
    expect(output).toContain('bulid');
  });

  it('refuses an unknown flag rather than ignoring it', async () => {
    // Silently ignoring `--base-paths` writes the scaffold to the wrong place
    // and reports success.
    const { code, output } = await cli(
      ['init', '--base-paths', '/'],
      await project(),
    );
    expect(code).toBe(1);
    expect(output).toContain('Usage');
  });
});
