/**
 * The shared build pipeline.
 *
 * ⚠️ THE FIRST TEST IS THE REASON THIS MODULE EXISTS. Every other assertion here
 * is ordinary; that one fails when a render-affecting option is added to the
 * package and not forwarded, which is a bug with no other failing test — each
 * adapter's own suite passes, because neither suite knows the option is there.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  collectDocRoutes,
  docsRendererOptions,
  renderDocs,
  reportBrokenAnchor,
} from './docs-build.js';
import type { DocsRenderer } from './render.js';
import type { DocFile, DocFrontmatter, RenderedDoc } from './types.js';

const SOURCE = readFileSync(
  path.join(import.meta.dirname, 'docs-build.ts'),
  'utf8',
);

const CONFIG = {
  basePath: '/docs',
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  externalRoutes: [],
} as const;

const NO_ROUTES = {
  knownRoutes: new Set<string>(),
  draftRoutes: new Set<string>(),
  aliasRoutes: new Map<string, string>(),
};

function file(
  relativePath: string,
  frontmatter: DocFrontmatter = { title: 'Page' },
): DocFile<DocFrontmatter> {
  const slug = relativePath.replace(/\.md$/, '').replace(/\/index$/, '');
  const segments = slug === '' ? [] : slug.split('/');
  return {
    segments,
    slug,
    href: `/docs${slug === '' ? '' : `/${slug}`}`,
    filePath: `/tmp/${relativePath}`,
    relativePath,
    frontmatter,
    content: '',
  };
}

describe('docsRendererOptions', () => {
  it('forwards every option the interface declares', () => {
    /*
     * ⚠️ READ OUT OF THE SOURCE RATHER THAN LISTED HERE, BECAUSE A LIST IS A
     * SECOND PLACE TO FORGET. A hand-written array of option names passes
     * forever after someone adds an eleventh option to `DocsBuildRenderOptions`
     * and wires it into neither adapter — which is precisely the failure this
     * module was extracted to make impossible.
     */
    const interfaceBody =
      /export interface DocsBuildRenderOptions \{([\s\S]*?)\n\}/.exec(
        SOURCE,
      )?.[1];
    expect(interfaceBody).toBeDefined();

    const declared = [
      ...(interfaceBody as string).matchAll(/^\s{2}(\w+)\?:/gm),
    ].map((match) => match[1] as string);
    // A guard on the guard: a regex that matched nothing would pass silently.
    expect(declared.length).toBeGreaterThan(8);

    const body = /export function docsRendererOptions\([\s\S]*?\n\}/.exec(
      SOURCE,
    )?.[0];
    expect(body).toBeDefined();

    const unforwarded = declared.filter(
      (name) => !(body as string).includes(`options.${name}`),
    );
    expect(unforwarded).toEqual([]);
  });

  it('omits an absent option rather than passing undefined', () => {
    /*
     * ⚠️ NOT PEDANTRY. Under `exactOptionalPropertyTypes` — which this package
     * compiles with — `{ themes: undefined }` and `{}` are different types, and
     * at run time the first overwrites the renderer's own default with
     * `undefined` instead of leaving it alone. The observable difference is a
     * site whose theme silently stops resolving.
     */
    const result = docsRendererOptions(CONFIG, NO_ROUTES, {});

    expect(Object.keys(result).sort()).toEqual([
      'aliasRoutes',
      'config',
      'draftRoutes',
      'knownRoutes',
    ]);
    expect('themes' in result).toBe(false);
    expect('highlighter' in result).toBe(false);
  });

  it('passes a provided option through', () => {
    const result = docsRendererOptions(CONFIG, NO_ROUTES, {
      titleHeading: false,
      excludeLangs: ['bash'],
    });

    expect(result.titleHeading).toBe(false);
    expect(result.excludeLangs).toEqual(['bash']);
  });

  it('wires all three route sets', () => {
    const knownRoutes = new Set(['/docs/a']);
    const draftRoutes = new Set(['/docs/b']);
    const aliasRoutes = new Map([['/docs/old', '/docs/a']]);

    const result = docsRendererOptions(
      CONFIG,
      { knownRoutes, draftRoutes, aliasRoutes },
      {},
    );

    expect(result.knownRoutes).toBe(knownRoutes);
    expect(result.draftRoutes).toBe(draftRoutes);
    expect(result.aliasRoutes).toBe(aliasRoutes);
  });
});

describe('collectDocRoutes', () => {
  it('records every page href', () => {
    const known = new Set<string>();
    collectDocRoutes(
      known,
      new Map(),
      [file('installation.md'), file('guides/theming.md')],
      '/docs',
    );

    expect([...known]).toEqual(['/docs/installation', '/docs/guides/theming']);
  });

  it('keeps an alias out of the known routes', () => {
    /*
     * ⚠️ THE BUG THIS SEPARATION FIXED. An alias only resolves once the consumer
     * has wired redirects up, which a quick start never does, and no adapter
     * emits a static route for one — so treating an alias as a known route let a
     * page link a sibling's alias, build green, and 404 for every reader.
     */
    const known = new Set<string>();
    const aliases = new Map<string, string>();
    collectDocRoutes(
      known,
      aliases,
      [file('installation.md', { title: 'Installation', aliases: ['/setup'] })],
      '/docs',
    );

    expect([...known]).toEqual(['/docs/installation']);
    expect(aliases.get('/docs/setup')).toBe('/docs/installation');
  });
});

describe('reportBrokenAnchor', () => {
  it('says nothing when ignoring', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    reportBrokenAnchor('ignore', 'nope');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('warns without throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    reportBrokenAnchor('warn', 'a message');
    expect(warn).toHaveBeenCalledWith('a message');
    warn.mockRestore();
  });

  it('throws a coded error', () => {
    // The code is the public contract; a host branches on it, not on the text.
    expect(() => reportBrokenAnchor('throw', 'a message')).toThrow(/a message/);
    try {
      reportBrokenAnchor('throw', 'a message');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('broken-anchor');
    }
  });
});

describe('renderDocs', () => {
  /** A renderer that returns one heading id per page. */
  function rendererFor(ids: Record<string, string[]>): DocsRenderer {
    return {
      render: <TFrontmatter extends DocFrontmatter>(
        doc: DocFile<TFrontmatter>,
      ): Promise<RenderedDoc<TFrontmatter>> =>
        Promise.resolve({
          frontmatter: doc.frontmatter,
          hast: {
            type: 'root',
            children: (ids[doc.href] ?? []).map((id) => ({
              type: 'element' as const,
              tagName: 'h2',
              properties: { id },
              children: [],
            })),
          },
          toc: [],
          segments: doc.segments,
          href: doc.href,
        }),
    };
  }

  it('renders every file it is given', async () => {
    const rendered = await renderDocs(
      [file('a.md'), file('b.md')],
      rendererFor({}),
      () => undefined,
    );

    expect(rendered.map((doc) => doc.href)).toEqual(['/docs/a', '/docs/b']);
  });

  it('preserves input order despite a concurrency pool', async () => {
    // The pool renders out of order by design; the pager and the search index
    // both read this array positionally, so the order is load-bearing.
    const files = Array.from({ length: 40 }, (_, i) => file(`p${i}.md`));
    const rendered = await renderDocs(files, rendererFor({}), () => undefined);

    expect(rendered.map((doc) => doc.href)).toEqual(
      files.map((doc) => doc.href),
    );
  });

  /**
   * `a.md` links `/docs/b#<fragment>`; `b.md` has one heading, `present`.
   *
   * ⚠️ BOTH PAGES HAVE TO BE RENDERED FOR THE CHECK TO RUN AT ALL. `assertAnchors`
   * skips a link whose *route* it has not seen (anchors.ts:118) — a link to a page
   * that does not exist is the broken-**link** check's business, and reporting it
   * here too would name the same mistake twice, in two severities.
   */
  async function anchorReports(fragment: string): Promise<string[]> {
    const reported: string[] = [];
    await renderDocs(
      [file('a.md'), file('b.md')],
      {
        render: (<TFrontmatter extends DocFrontmatter>(
          doc: DocFile<TFrontmatter>,
        ) =>
          Promise.resolve({
            frontmatter: doc.frontmatter,
            hast: {
              type: 'root',
              children:
                doc.href === '/docs/a'
                  ? [
                      {
                        type: 'element' as const,
                        tagName: 'a',
                        properties: { href: `/docs/b#${fragment}` },
                        children: [],
                      },
                    ]
                  : [
                      {
                        type: 'element' as const,
                        tagName: 'h2',
                        properties: { id: 'present' },
                        children: [],
                      },
                    ],
            },
            toc: [],
            segments: doc.segments,
            href: doc.href,
          })) as DocsRenderer['render'],
      },
      (message) => reported.push(message),
    );
    return reported;
  }

  it('reports a cross-page anchor that does not exist', async () => {
    const reported = await anchorReports('missing');

    expect(reported).toHaveLength(1);
    // The page that holds the bad link, the target route, and the fragment.
    expect(reported[0]).toContain('/docs/a');
    expect(reported[0]).toContain('/docs/b');
    expect(reported[0]).toContain('missing');
  });

  it('accepts a cross-page anchor that resolves', async () => {
    expect(await anchorReports('present')).toEqual([]);
  });

  it('suggests the near miss', async () => {
    // The whole reason the message goes through `describeSuggestion`: a renamed
    // heading is the usual cause, and the new name is the useful half.
    expect((await anchorReports('presnt'))[0]).toContain('present');
  });

  it('says nothing when every anchor resolves', async () => {
    const reported: string[] = [];
    await renderDocs(
      [file('a.md'), file('b.md')],
      rendererFor({ '/docs/b': ['present'] }),
      (message) => reported.push(message),
    );

    expect(reported).toEqual([]);
  });
});
