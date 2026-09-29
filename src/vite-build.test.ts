/**
 * A real `vite build`, driven through Vite's own JavaScript API.
 *
 * ⚠️ THIS IS THE ONLY TEST THAT WOULD FAIL IF THE PLUGIN WERE COMPLETELY
 * BROKEN. `vite.test.ts` calls the hooks directly, so it proves the functions
 * behave — and it would keep passing if `resolveId` returned the wrong shape of
 * id, if Rollup rejected an emitted `fileName`, or if `enforce: 'pre'` were
 * missing and another plugin claimed the specifier first. Every one of those is
 * a green unit suite and a Vite build that fails or, worse, succeeds wrongly.
 *
 * ⚠️ AND IT LIVES IN `pnpm test`, NOT IN `smoke/`. The Next adapter's real build
 * is a separate command, and this repository has already been bitten by a gate
 * that only runs when someone remembers it: `check:readme` is outside
 * `pnpm test` and was failing for hours. A second adapter's only integration
 * check is not going in the same place.
 */

import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { waveDocs } from './vite.js';

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

/** A distinctive sentence, so "is the corpus in the bundle" has an answer. */
const BODY_MARKER = 'Prose that must never reach the entry chunk';

async function project(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'wave-docs-vite-build-'));
  dirs.push(root);

  const content = path.join(root, 'content');
  await mkdir(content, { recursive: true });
  await writeFile(
    path.join(content, 'index.md'),
    `---\ntitle: Home\n---\n\n${BODY_MARKER}.\n\nSee [links](./links.md#anchors).\n`,
    'utf8',
  );
  await writeFile(
    path.join(content, 'links.md'),
    '---\ntitle: Links\n---\n\n## Anchors\n\nBody.\n',
    'utf8',
  );

  // The entry imports the virtual module, so a build that cannot resolve it
  // fails rather than quietly emitting nothing.
  await writeFile(
    path.join(root, 'main.js'),
    `import { nav, pages, searchIndexUrl, corpusUrl, loadPage, pageUrl } from 'virtual:wave-docs';
globalThis.__docs = { nav, pages, searchIndexUrl, corpusUrl, loadPage, pageUrl };
`,
    'utf8',
  );

  return root;
}

/** Every file a build wrote, as a path → contents map. */
async function buildOnce(root: string): Promise<Map<string, string>> {
  const { build } = await import('vite');
  await build({
    root,
    logLevel: 'silent',
    plugins: [
      waveDocs({
        contentDir: path.join(root, 'content'),
        basePath: '/docs',
        llms: { title: 'Fixture', siteUrl: 'https://example.test' },
      }),
    ],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: { input: path.join(root, 'main.js') },
    },
  });

  const out = path.join(root, 'dist');
  const written = new Map<string, string>();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      written.set(
        path.relative(out, full).split(path.sep).join('/'),
        await readFile(full, 'utf8'),
      );
    }
  };
  await walk(out);
  return written;
}

describe('a real vite build', () => {
  it('resolves the virtual module and emits every artifact', async () => {
    const written = await buildOnce(await project());
    const names = [...written.keys()];

    // Rollup accepted each `fileName`, which a leading slash would have failed.
    expect(names).toContain('docs/search-index.json');
    expect(names).toContain('docs/llms-full.txt');
    expect(names).toContain('docs/llms.txt');
    expect(names).toContain('docs/wave-docs/index.json');
    expect(names).toContain('docs/wave-docs/links.json');
  });

  it('does not put the page bodies in the JavaScript bundle', async () => {
    /*
     * ⚠️ THE CLAIM THE README MAKES, CHECKED AGAINST A REAL BUNDLE. Every other
     * assertion about this is on the generated module *source*; a bundler
     * inlining a fetched asset, or a future change that imports the page trees
     * instead of fetching them, would pass those and fail this.
     */
    const written = await buildOnce(await project());
    const js = [...written.entries()]
      .filter(([name]) => name.endsWith('.js'))
      .map(([, source]) => source)
      .join('\n');

    expect(js).not.toBe('');
    expect(js).not.toContain(BODY_MARKER);
    // The navigation *is* inlined, so this proves the bundle was searched at all.
    expect(js).toContain('Links');
  });

  it('writes the page trees already parsed and already highlighted', async () => {
    const written = await buildOnce(await project());
    const page = JSON.parse(
      written.get('docs/wave-docs/index.json') as string,
    ) as { hast: unknown; href: string };

    expect(page.href).toBe('/docs');
    expect(page.hast).toMatchObject({ type: 'root' });
  });

  it('fails the build on a broken link, rather than shipping one', async () => {
    /*
     * The guarantee a Vite site otherwise has no way to get: `contentDir` is
     * outside the module graph, so nothing else in a Vite build has any reason
     * to look at it.
     */
    const root = await project();
    await writeFile(
      path.join(root, 'content', 'index.md'),
      '---\ntitle: Home\n---\n\n[gone](./nope.md)\n',
      'utf8',
    );
    const { build } = await import('vite');

    await expect(
      build({
        root,
        logLevel: 'silent',
        plugins: [
          waveDocs({
            contentDir: path.join(root, 'content'),
            onBrokenLinks: 'throw',
          }),
        ],
        build: {
          outDir: 'dist',
          emptyOutDir: true,
          rollupOptions: { input: path.join(root, 'main.js') },
        },
      }),
    ).rejects.toThrow(/nope/);
  });
});
