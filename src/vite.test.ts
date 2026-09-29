/**
 * What the Vite plugin emits.
 *
 * ⚠️ THE ASSERTIONS ARE ABOUT THE THINGS THAT WOULD FAIL SILENTLY. A build
 * plugin that emits the wrong path, emits a page's slug as an empty file name,
 * or quietly inlines the whole corpus into the entry chunk still builds — and
 * on a green build the first two produce a 404 a reader sees and the third
 * produces a bundle nobody measured.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { buildSearchIndex, extractSearchRecords } from './search-index.js';
import type { DocsVitePluginOptions } from './vite.js';
import { WAVE_DOCS_MODULE_ID, waveDocs } from './vite.js';

const BASIC = path.join(import.meta.dirname, '__fixtures__', 'source', 'basic');

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function makeContentDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'wave-docs-vite-'));
  tempDirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    const file = path.join(dir, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body, 'utf8');
  }
  return dir;
}

/** Every asset the plugin emits, as `{ fileName: source }`. */
async function emitted(
  options: DocsVitePluginOptions,
): Promise<Record<string, string>> {
  const plugin = waveDocs(options);
  const files: Record<string, string> = {};
  const context = {
    emitFile: ({
      fileName,
      source,
    }: {
      type: 'asset';
      fileName: string;
      source: string;
    }): void => {
      files[fileName] = source;
    },
  };
  await plugin.buildStart();
  await plugin.generateBundle.call(context);
  return files;
}

/** The generated `virtual:wave-docs` source. */
async function virtualModule(options: DocsVitePluginOptions): Promise<string> {
  const plugin = waveDocs(options);
  const id = plugin.resolveId(WAVE_DOCS_MODULE_ID);
  expect(id).toBeDefined();
  const code = await plugin.load(id as string);
  expect(code).toBeDefined();
  return code as string;
}

describe('the emitted artifacts', () => {
  it('uses the same three paths as the Next adapter', async () => {
    /*
     * ⚠️ NOT COSMETIC. `SearchDialog`'s `indexUrl` and `DocsCopyPage`'s
     * `corpusUrl` default to `<basePath>/search-index.json` and
     * `<basePath>/llms-full.txt`. A component carried from a Next site to a
     * Vite one keeps working only while these agree, and the failure is a
     * fetch that 404s at run time on a build that passed.
     */
    const files = await emitted({
      contentDir: BASIC,
      basePath: '/docs',
      llms: { title: 'Fixture' },
    });

    expect(Object.keys(files)).toContain('docs/search-index.json');
    expect(Object.keys(files)).toContain('docs/llms-full.txt');
    expect(Object.keys(files)).toContain('docs/llms.txt');
  });

  it('never emits an absolute file name', async () => {
    // Rollup resolves `fileName` against `outDir` and rejects a leading slash,
    // so a basePath pasted through unchanged fails the build at the last step.
    const files = await emitted({ contentDir: BASIC, basePath: '/docs' });
    for (const name of Object.keys(files)) {
      expect(name.startsWith('/'), name).toBe(false);
    }
  });

  it('emits no prefix at all for a root mount', async () => {
    const files = await emitted({ contentDir: BASIC, basePath: '/' });
    expect(Object.keys(files)).toContain('search-index.json');
  });

  it('names the index page `index.json`', async () => {
    /*
     * ⚠️ THE ROOT PAGE'S SLUG IS THE EMPTY STRING. Interpolated straight into
     * a file name it emits `.json` — a dotfile, served by nothing, and the one
     * page every site has.
     */
    const files = await emitted({ contentDir: BASIC, basePath: '/docs' });
    expect(Object.keys(files)).toContain('docs/wave-docs/index.json');
  });

  it('emits one tree per published page and none for a draft', async () => {
    const files = await emitted({ contentDir: BASIC, basePath: '/docs' });
    const pages = Object.keys(files)
      .filter((name) => name.startsWith('docs/wave-docs/'))
      .map((name) => name.slice('docs/wave-docs/'.length));

    expect(pages).toContain('installation.json');
    expect(pages).toContain('api/authentication.json');
    // `draft: true` in the fixture, and absent from the HTML build too.
    expect(pages).not.toContain('changelog-draft.json');
  });

  it('keeps a draft out of the corpus as well as out of the pages', async () => {
    const files = await emitted({
      contentDir: BASIC,
      basePath: '/docs',
      llms: { title: 'Fixture' },
    });
    expect(files['docs/llms-full.txt']).not.toContain('changelog-draft');
  });

  it('builds a search index byte-identical to the hand-written pipeline', async () => {
    /*
     * The documented escape hatch is to call `extractSearchRecords` and
     * `buildSearchIndex` yourself. If the plugin's index differs, one of the
     * two is wrong and only a consumer would find out.
     */
    const plugin = waveDocs({ contentDir: BASIC, basePath: '/docs' });
    await plugin.buildStart();
    const files = await emitted({ contentDir: BASIC, basePath: '/docs' });

    const { createDocsSource } = await import('./source.js');
    const { createDocsRenderer } = await import('./render.js');
    const source = createDocsSource({ contentDir: BASIC, basePath: '/docs' });
    const renderer = createDocsRenderer({ config: source.config });
    const docs = await Promise.all(
      (await source.all()).map((file) => renderer.render(file)),
    );
    const byHand = buildSearchIndex(
      docs.flatMap((doc) => extractSearchRecords(doc)),
    );

    expect(files['docs/search-index.json']).toBe(byHand);
  });

  it('emits no index when `search` is false', async () => {
    const files = await emitted({
      contentDir: BASIC,
      basePath: '/docs',
      search: false,
    });
    expect(Object.keys(files)).not.toContain('docs/search-index.json');
  });

  it('emits neither llms file unless configured', async () => {
    // Opt-in for the same reason as the Next adapter: the corpus names your
    // product, and a default would name it wrong.
    const files = await emitted({ contentDir: BASIC, basePath: '/docs' });
    expect(Object.keys(files)).not.toContain('docs/llms-full.txt');
    expect(Object.keys(files)).not.toContain('docs/llms.txt');
  });

  it('emits the corpus without the index when `index` is false', async () => {
    const files = await emitted({
      contentDir: BASIC,
      basePath: '/docs',
      llms: { title: 'Fixture', index: false },
    });
    expect(Object.keys(files)).toContain('docs/llms-full.txt');
    expect(Object.keys(files)).not.toContain('docs/llms.txt');
  });

  it('writes absolute URLs into the corpus when given a siteUrl', async () => {
    const files = await emitted({
      contentDir: BASIC,
      basePath: '/docs',
      llms: { title: 'Fixture', siteUrl: 'https://example.test' },
    });
    expect(files['docs/llms-full.txt']).toContain(
      '<!-- source: https://example.test/docs',
    );
  });
});

describe('the virtual module', () => {
  it('answers only its own specifier', async () => {
    // Resolving anything else would hijack a module the consumer owns.
    const plugin = waveDocs({ contentDir: BASIC });
    expect(plugin.resolveId(WAVE_DOCS_MODULE_ID)).toBeDefined();
    expect(plugin.resolveId('virtual:something-else')).toBeUndefined();
    expect(plugin.resolveId('react')).toBeUndefined();
    await expect(plugin.load('react')).resolves.toBeUndefined();
  });

  it('inlines the navigation and the page list', async () => {
    const code = await virtualModule({ contentDir: BASIC, basePath: '/docs' });
    expect(code).toContain('export const nav =');
    expect(code).toContain('export const pages =');
    expect(code).toContain('Installation');
  });

  it('does NOT inline the rendered pages', async () => {
    /*
     * ⚠️ THE INVARIANT THAT KEEPS THE BUNDLE HONEST. Inlining every page's tree
     * here would put the whole corpus in the entry chunk — the reader downloads
     * two hundred pages to read one — and nothing would fail.
     *
     * ⚠️ THE MARKER IS A SENTENCE FROM A PAGE **BODY**, NOT THE STRING `hast`.
     * Asserting `"hast"` was the first version of this test and it caught
     * nothing: a tree inlined as a pre-serialised string arrives with its quotes
     * escaped (`\\"hast\\"`) and walks straight past. Body prose cannot reach
     * this module by any route — as objects, as strings, or as an escaped blob —
     * unless a page was inlined.
     */
    const code = await virtualModule({ contentDir: BASIC, basePath: '/docs' });
    expect(code).not.toContain('Every supported package manager works');
    expect(code).toContain('export async function loadPage');
  });

  it('points the component defaults at the emitted paths', async () => {
    const code = await virtualModule({ contentDir: BASIC, basePath: '/docs' });
    expect(code).toContain('"/docs/search-index.json"');
    expect(code).toContain('"/docs/llms-full.txt"');
  });

  it('maps the root page to `index.json`, matching the emitted name', async () => {
    // The two spellings are written in different functions, so this is the
    // assertion that keeps them equal.
    const code = await virtualModule({ contentDir: BASIC, basePath: '/docs' });
    const url = new Function(
      `${code.replace(/export /g, '')}; return pageUrl('');`,
    )() as string;
    expect(url).toBe('/docs/wave-docs/index.json');
  });
});

describe('one scan per build', () => {
  it('does not re-read the tree for buildStart and generateBundle', async () => {
    /*
     * A second walk is invisible — same output, twice the build time on a tree
     * where Shiki is the cost. The observable proxy is the source module: it is
     * read once per scan.
     */
    const dir = await makeContentDir({
      'index.md': '---\ntitle: Home\n---\n\nBody.\n',
    });
    const source = await import('./source.js');
    const spy = vi.spyOn(source, 'createDocsSource');

    const plugin = waveDocs({ contentDir: dir });
    await plugin.buildStart();
    await plugin.generateBundle.call({ emitFile: () => undefined });
    await plugin.load(plugin.resolveId(WAVE_DOCS_MODULE_ID) as string);

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('the dev server', () => {
  /** Drive the registered middleware for one URL. */
  async function request(
    options: DocsVitePluginOptions,
    url: string,
  ): Promise<{ body: string | undefined; passedOn: boolean }> {
    const plugin = waveDocs(options);
    let handler:
      | ((
          req: IncomingMessage,
          res: ServerResponse,
          next: (err?: unknown) => void,
        ) => void)
      | undefined;

    plugin.configureServer({
      middlewares: {
        use: (fn) => {
          handler = fn;
        },
      },
      watcher: { on: () => undefined },
      ws: { send: () => undefined },
    });
    expect(handler).toBeDefined();

    return new Promise((resolve) => {
      let body: string | undefined;
      const res = {
        setHeader: () => undefined,
        end: (chunk: string) => {
          body = chunk;
          resolve({ body, passedOn: false });
        },
      } as unknown as ServerResponse;

      (handler as NonNullable<typeof handler>)(
        { url } as IncomingMessage,
        res,
        () => resolve({ body: undefined, passedOn: true }),
      );
    });
  }

  it('serves an emitted asset', async () => {
    const { body, passedOn } = await request(
      { contentDir: BASIC, basePath: '/docs' },
      '/docs/search-index.json',
    );
    expect(passedOn).toBe(false);
    expect(body).toContain('documentCount');
  });

  it('serves a page tree', async () => {
    const { body } = await request(
      { contentDir: BASIC, basePath: '/docs' },
      '/docs/wave-docs/installation.json',
    );
    expect(body).toContain('"hast"');
  });

  it('ignores a query string', async () => {
    // Vite appends `?t=` on reload, and a naive key lookup misses every time.
    const { passedOn } = await request(
      { contentDir: BASIC, basePath: '/docs' },
      '/docs/search-index.json?t=1',
    );
    expect(passedOn).toBe(false);
  });

  it('passes anything it does not own to the next handler', async () => {
    /*
     * ⚠️ THE ONE THAT MAKES THE PLUGIN SAFE TO ADD TO AN EXISTING APP. A
     * middleware that responds to everything replaces the dev server.
     */
    const { passedOn } = await request(
      { contentDir: BASIC, basePath: '/docs' },
      '/index.html',
    );
    expect(passedOn).toBe(true);
  });

  it('drops the cache and reloads when content changes', async () => {
    const dir = await makeContentDir({
      'index.md': '---\ntitle: Home\n---\n\nBody.\n',
    });
    const plugin = waveDocs({ contentDir: dir });
    let watch: ((event: string, file: string) => void) | undefined;
    const send = vi.fn();

    plugin.configureServer({
      middlewares: { use: () => undefined },
      watcher: {
        on: (_event, handler) => {
          watch = handler;
        },
      },
      ws: { send },
    });
    await plugin.buildStart();

    const source = await import('./source.js');
    const spy = vi.spyOn(source, 'createDocsSource');
    (watch as NonNullable<typeof watch>)('change', path.join(dir, 'index.md'));
    await plugin.load(plugin.resolveId(WAVE_DOCS_MODULE_ID) as string);

    expect(send).toHaveBeenCalledWith({ type: 'full-reload', path: '*' });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('ignores a change outside the content directory', async () => {
    const dir = await makeContentDir({
      'index.md': '---\ntitle: Home\n---\n\nBody.\n',
    });
    const plugin = waveDocs({ contentDir: dir });
    let watch: ((event: string, file: string) => void) | undefined;
    const send = vi.fn();

    plugin.configureServer({
      middlewares: { use: () => undefined },
      watcher: {
        on: (_event, handler) => {
          watch = handler;
        },
      },
      ws: { send },
    });

    (watch as NonNullable<typeof watch>)('change', '/somewhere/else/app.tsx');

    expect(send).not.toHaveBeenCalled();
  });
});

describe('link checking still happens', () => {
  it('throws on a broken link, at build time', async () => {
    /*
     * The plugin is where a Vite site gets the guarantee the Next adapter's
     * route gives: a link to a page that does not exist fails the build rather
     * than shipping.
     */
    const dir = await makeContentDir({
      'index.md': '---\ntitle: Home\n---\n\n[gone](./nope.md)\n',
    });

    await expect(
      emitted({ contentDir: dir, onBrokenLinks: 'throw' }),
    ).rejects.toThrow(/nope/);
  });

  it('throws on a broken cross-page anchor', async () => {
    // Only provable once every page is rendered, which is why it lives in the
    // shared build pipeline rather than in `render`.
    const dir = await makeContentDir({
      'index.md': '---\ntitle: Home\n---\n\n[x](./other.md#missing)\n',
      'other.md': '---\ntitle: Other\n---\n\n## Present\n',
    });

    await expect(
      emitted({ contentDir: dir, onBrokenAnchors: 'throw' }),
    ).rejects.toThrow(/missing/);
  });
});
