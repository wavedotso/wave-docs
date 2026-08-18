import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import MiniSearch from 'minisearch';
import type { ReactNode } from 'react';
import { Fragment, createElement, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  afterAll,
  afterEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from 'vitest';
import type { Root as HastRoot } from 'hast';
import { visit } from 'unist-util-visit';
import { z } from 'zod';

import { docFrontmatterSchema } from './frontmatter.js';
import type { DocsLayoutProps } from './next.js';
import type { DocsLabels } from './react/shell-labels.js';
import { DOCS_LABEL_KEYS } from './react/shell-labels.js';
import {
  createDocsRedirects,
  createDocsRoute,
  createDocsSitemap,
} from './next.js';
import { buildSearchIndex, extractSearchRecords } from './search-index.js';
import { mergeSearchOptions } from './search-options.js';
import type { SearchRecord } from './types.js';

const BASIC = path.join(import.meta.dirname, '__fixtures__', 'source', 'basic');

/**
 * Every visible route in the `basic` fixture, as `generateStaticParams` would
 * spell it. `index.md` (segments `[]`) and `changelog-draft.md` (`draft: true`)
 * are deliberately absent.
 */
const VISIBLE_SLUGS = [
  'api',
  'api/authentication',
  'api/rate-limits',
  'api/webhooks',
  'getting-started',
  'guides/caching',
  'guides/deploying',
  'guides/theming',
  'installation',
];

const tempDirs: string[] = [];

/** A throwaway content tree, for cases the shared fixture must not encode. */
async function makeContentDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'wave-docs-next-'));
  tempDirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    const file = path.join(dir, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body, 'utf8');
  }
  return dir;
}

afterAll(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

/**
 * The children of the fragment `docs.Page` returns, with the `null` the TOC
 * slot holds on a page with no headings already dropped.
 *
 * `Children.toArray` is deliberately not used: it discards nulls *and*
 * flattens, so the "no empty aside" assertion could not tell an absent TOC
 * from one nested somewhere unexpected.
 */
function pageChildren(page: ReactNode): ReactNode[] {
  if (!isValidElement<{ children?: ReactNode }>(page)) {
    throw new Error('expected `Page` to return an element');
  }
  expect(page.type).toBe(Fragment);
  const children = page.props.children;
  return (Array.isArray(children) ? children : [children]).filter(
    (child) => child !== null && child !== undefined,
  );
}

describe('createDocsRoute', () => {
  const route = createDocsRoute({ contentDir: BASIC });

  it('exports dynamicParams as literally false', () => {
    // The type matters as much as the value: a `boolean` would let a consumer
    // re-export `true` without a compile error, and an unlisted URL would then
    // reach `fs.readFile` at request time and answer 500 instead of 404.
    const dynamicParams: false = route.dynamicParams;
    expect(dynamicParams).toBe(false);
  });

  it('lists every published page except the root index', async () => {
    const params = await route.generateStaticParams();

    expect(params.map(({ slug }) => slug.join('/')).sort()).toEqual(
      VISIBLE_SLUGS,
    );
    // A catch-all cannot render an empty parameter list; `/docs` is served by
    // `IndexPage` from its own `app/docs/page.tsx`.
    expect(params.every(({ slug }) => slug.length > 0)).toBe(true);
    expect(params).not.toContainEqual({ slug: ['changelog-draft'] });
  });

  it('includes drafts once configured to', async () => {
    const drafts = createDocsRoute({
      contentDir: BASIC,
      includeDrafts: true,
    });
    const params = await drafts.generateStaticParams();

    expect(params).toContainEqual({ slug: ['changelog-draft'] });
  });

  it('sets a canonical URL, title and description', async () => {
    const metadata = await route.generateMetadata({
      params: Promise.resolve({ slug: ['getting-started'] }),
    });

    expect(metadata).toEqual({
      title: 'Getting started with Wave',
      description: 'Install the package and render your first page.',
      alternates: { canonical: '/docs/getting-started' },
      openGraph: {
        type: 'article',
        title: 'Getting started with Wave',
        description: 'Install the package and render your first page.',
        url: '/docs/getting-started',
      },
    });
  });

  it('makes the canonical absolute when siteUrl is set', async () => {
    const published = createDocsRoute({
      contentDir: BASIC,
      siteUrl: 'https://example.com',
    });
    const metadata = await published.generateMetadata({
      params: Promise.resolve({ slug: ['api', 'webhooks'] }),
    });

    expect(metadata.alternates).toEqual({
      canonical: 'https://example.com/docs/api/webhooks',
    });
    expect(metadata.openGraph?.url).toBe(
      'https://example.com/docs/api/webhooks',
    );
  });

  it('serves the root index from params with no slug at all', async () => {
    // `app/docs/page.tsx` has no dynamic segment, so Next resolves `params` to
    // an empty object — the same handler must cope with both route files.
    const metadata = await route.generateMetadata({
      params: Promise.resolve({}),
    });

    expect(metadata.title).toBe('Wave');
    expect(metadata.alternates).toEqual({ canonical: '/docs' });
  });

  it('returns empty metadata for unknown and draft routes', async () => {
    expect(
      await route.generateMetadata({
        params: Promise.resolve({ slug: ['nope'] }),
      }),
    ).toEqual({});
    expect(
      await route.generateMetadata({
        params: Promise.resolve({ slug: ['changelog-draft'] }),
      }),
    ).toEqual({});
  });

  it('rejects a siteUrl that is not absolute', () => {
    expect(() =>
      createDocsRoute({ contentDir: BASIC, siteUrl: '/docs' }),
    ).toThrow(/not an absolute URL/);
  });

  it('renders a page to a serialisable tree with its headings', async () => {
    const doc = await route.getPage(['getting-started']);

    expect(doc?.href).toBe('/docs/getting-started');
    expect(doc?.frontmatter.title).toBe('Getting started with Wave');
    expect(doc?.toc).toEqual([
      { id: 'install', text: 'Install', depth: 2, children: [] },
    ]);
    // The whole point of stopping at hast: it survives the RSC boundary.
    expect(JSON.parse(JSON.stringify(doc?.hast))).toEqual(doc?.hast);
  });

  it('resolves no page for unknown routes or drafts', async () => {
    expect(await route.getPage(['nope'])).toBeUndefined();
    expect(await route.getPage(['changelog-draft'])).toBeUndefined();
  });

  it('renders every published page for the search index', async () => {
    const rendered = await route.renderAll();

    expect(rendered.map((doc) => doc.href).sort()).toEqual(
      ['/docs', ...VISIBLE_SLUGS.map((slug) => `/docs/${slug}`)].sort(),
    );
    expect(rendered.every((doc) => doc.hast.type === 'root')).toBe(true);
  });

  it('picks up edits and new files without a restart', async () => {
    // Markdown is not in Next's module graph, so nothing re-evaluates a route
    // module when a file changes: without a per-request rescan, `next dev`
    // serves what it read on the first request until the server is restarted.
    const dir = await makeContentDir({
      'index.md': '---\ntitle: Home\n---\n\nOriginal body.\n',
    });
    const dev = createDocsRoute({ contentDir: dir, basePath: '/dev-docs' });

    expect(JSON.stringify(await dev.getPage([]))).toContain('Original body');

    await writeFile(
      path.join(dir, 'index.md'),
      '---\ntitle: Home\n---\n\nEdited body.\n',
      'utf8',
    );
    await writeFile(
      path.join(dir, 'added.md'),
      '---\ntitle: Added\n---\n\nBrand new.\n',
      'utf8',
    );

    expect(JSON.stringify(await dev.getPage([]))).toContain('Edited body');
    expect((await dev.getPage(['added']))?.href).toBe('/dev-docs/added');
    expect(await dev.generateStaticParams()).toContainEqual({
      slug: ['added'],
    });
  });

  it('renders the content as the main landmark, focusable and with the skip target', async () => {
    /*
     * `main`, and this is the assertion that keeps it one. The shell renders a
     * `banner`, a `navigation` and a `complementary`; with an `<article>` here
     * it rendered no `main` at all, so a screen-reader user navigating by
     * landmark — the way you skip a hundred-link sidebar without tabbing — had
     * nothing to jump to. The skip link covered the keyboard case and hid the
     * gap behind it.
     *
     * The id is the literal, not the constant the adapter imports: this is the
     * published default, and `SkipLink`'s own test pins the same string on the
     * `href`. Both derive from `DOCS_CONTENT_ID`, so the pair cannot drift
     * apart — but a change to the value itself is breaking and has to fail here.
     *
     * `tabIndex` matters as much as the id: a fragment link moves the scroll
     * position and not always the focus, so an unfocusable target leaves a
     * keyboard reader at the top of the sidebar they were trying to skip.
     */
    const [main] = pageChildren(
      await route.Page({
        params: Promise.resolve({ slug: ['getting-started'] }),
      }),
    );

    if (!isValidElement<{ id?: string; tabIndex?: number }>(main)) {
      throw new Error('expected the first child to be an element');
    }
    expect(main.type).toBe('main');
    expect(main.props.id).toBe('docs-content');
    expect(main.props.tabIndex).toBe(-1);
  });

  it('leaves the prose class to DocContent, exactly once', async () => {
    /*
     * `DocContent` owns `.wave-docs-prose` so the hand-rolled route in the
     * README cannot forget it. That only helps if this stops emitting it too:
     * nested, the measure applies at two levels and `.wave-docs-prose > * + *`
     * starts matching the wrapper as well as the content.
     */
    const [main] = pageChildren(
      await route.Page({
        params: Promise.resolve({ slug: ['getting-started'] }),
      }),
    );

    if (!isValidElement<{ className?: string }>(main)) {
      throw new Error('expected a main element');
    }
    expect(main.props.className).toBe('wave-docs-layout__main');

    const rendered = renderToStaticMarkup(main);
    expect(rendered.split('wave-docs-prose')).toHaveLength(2);
  });

  it('emits the main landmark and the TOC as siblings, not as a nested pair', async () => {
    /*
     * Both have to be DIRECT children of `.wave-docs-layout`, or
     * `grid-template-columns` cannot put them in separate tracks — the TOC
     * would render inside the main column while the third track sits
     * empty above 80rem. `docs.Layout` renders `{children}` with no wrapper
     * and Next adds none of its own, so the only thing that could break this
     * is a wrapper added here.
     */
    const children = pageChildren(
      await route.Page({
        params: Promise.resolve({ slug: ['getting-started'] }),
      }),
    );

    expect(children).toHaveLength(2);
    const toc = children[1];
    if (!isValidElement<{ className?: string }>(toc)) {
      throw new Error('expected a TOC element');
    }
    expect(toc.type).toBe('aside');
    expect(toc.props.className).toBe('wave-docs-layout__toc');
  });

  it('emits no aside at all for a page with no headings', async () => {
    /*
     * Not an empty one. The grid reserves its TOC track with
     * `:has(.wave-docs-layout__toc)`, and `:has()` matches an empty aside just
     * as happily — so a page without headings would give up 15rem to nothing.
     * V-4 measured that exact defect with the sidebar.
     */
    const dir = await makeContentDir({
      'index.md': '---\ntitle: Flat\n---\n\nProse, and not one heading.\n',
    });
    const flat = createDocsRoute({ contentDir: dir });

    const children = pageChildren(await flat.IndexPage());

    expect(children).toHaveLength(1);
    expect(children.filter((child) => child !== null)).toHaveLength(1);
  });

  it('calls `notFound()` for an unknown slug', async () => {
    // `notFound()` signals by throwing a sentinel Next recognises further up
    // the stack, so "rejects with NEXT_HTTP_ERROR_FALLBACK;404" *is* the 404 —
    // there is no return value to assert on. Getting here also proves the
    // lazy `import('next/navigation')` resolved, which is the part that used
    // to be unverifiable while `next` was uninstalled.
    await expect(
      route.Page({ params: Promise.resolve({ slug: ['nope'] }) }),
    ).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });
});

describe('docs.Layout', () => {
  const route = createDocsRoute({ contentDir: BASIC });

  it('is callable with the props Next actually passes', async () => {
    /*
     * Next hands a layout `{ children, params }`. `DocsLayoutProps` declares
     * only `children`, and the extra is ignored — which is the whole reason
     * `export default docs.Layout` works as a one-liner. If this ever needed a
     * wrapper, that one-liner stops being the headline of the README.
     */
    const element = await route.Layout({
      children: null,
      ...({ params: Promise.resolve({}) } as Record<string, unknown>),
    });

    expect(isValidElement(element)).toBe(true);
  });

  it('reads the nav itself, so a consumer never fetches one', async () => {
    const element = await route.Layout({ children: null });

    if (
      !isValidElement<{ nav?: unknown[]; searchIndexUrl?: string }>(element)
    ) {
      throw new Error('expected `Layout` to return an element');
    }
    // Both are derived rather than props on purpose: a nav passed in is a nav
    // that can disagree with the routes, and a hand-written index URL is wrong
    // under every non-default `basePath`.
    expect(element.props.nav?.length).toBeGreaterThan(0);
    expect(element.props.searchIndexUrl).toBe('/docs/search-index.json');
  });

  it('hands the dialog the same MiniSearch options it built the index with', async () => {
    /*
     * ⚠️ THE SILENT FAILURE THIS WHOLE PROP SHAPE EXISTS FOR. MiniSearch reads
     * `tokenize` and `processTerm` when indexing *and* when querying, so an
     * index built with one and queried with another has terms no query can
     * spell — zero results, no error, nothing in the console.
     *
     * `search` was a bare boolean, so there was no channel at all: doing the
     * two things the README says to do (configure the route, render
     * `docs.Layout`) produced exactly that, under a docstring warning about
     * it in capitals.
     *
     * The override is data rather than a function on purpose. Functions cannot
     * cross this seam at all — the `describe` below is what says so — and a
     * `processTerm` here is what the first version of this test used, which is
     * how it managed to pass against a build that could not run.
     */
    const tuned = createDocsRoute({
      contentDir: BASIC,
      miniSearchOptions: { searchOptions: { fuzzy: 0.4 } },
    });

    const element = await tuned.Layout({ children: null });
    if (!isValidElement<{ search?: unknown }>(element)) {
      throw new Error('expected `Layout` to return an element');
    }

    expect(element.props.search).toEqual({
      miniSearchOptions: { searchOptions: { fuzzy: 0.4 } },
    });
  });

  it('lets a host override those options, and still omit the trigger', async () => {
    const tuned = createDocsRoute({
      contentDir: BASIC,
      miniSearchOptions: { searchOptions: { fuzzy: 0.4 } },
    });

    // More specific wins: a host that passes an object has said something the
    // route's default did not.
    const overridden = await tuned.Layout({
      children: null,
      search: { miniSearchOptions: { searchOptions: { fuzzy: 0 } } },
    });
    if (
      !isValidElement<{ search?: { miniSearchOptions?: unknown } }>(overridden)
    ) {
      throw new Error('expected `Layout` to return an element');
    }
    expect(overridden.props.search?.miniSearchOptions).toEqual({
      searchOptions: { fuzzy: 0 },
    });

    // And `false` still means no trigger, rather than a trigger configured
    // with the route's options.
    const off = await tuned.Layout({ children: null, search: false });
    if (!isValidElement<{ search?: unknown }>(off)) {
      throw new Error('expected `Layout` to return an element');
    }
    expect(off.props.search).toBe(false);
  });

  describe('MiniSearch functions, and the client boundary', () => {
    /*
     * ⚠️ THE TEST THE FIRST VERSION OF THIS FEATURE SHOULD HAVE HAD. It
     * asserted on `element.props.search` and therefore never crossed the
     * boundary it was testing, so `docs.Layout` shipped in 0.3.0 and 0.4.0
     * handing `processTerm` to a Client Component — which fails `next build`
     * outright with "Functions cannot be passed directly to Client
     * Components", in exactly the case the option's capitalised warning tells
     * you to use it for. A props assertion is not an RSC test.
     *
     * These assert on the throw instead, which is a claim a unit test can
     * actually make: `Layout` refuses the forward and says what to do, rather
     * than letting React refuse it later and less helpfully.
     */
    const processTerm = (term: string): string => term.replace(/-/g, '');

    it('refuses to forward one, and names it', async () => {
      const tuned = createDocsRoute({
        contentDir: BASIC,
        miniSearchOptions: { processTerm },
      });

      await expect(tuned.Layout({ children: null })).rejects.toMatchObject({
        code: 'invalid-config',
      });
      await expect(tuned.Layout({ children: null })).rejects.toThrow(
        /`miniSearchOptions\.processTerm`/,
      );
    });

    it('names the remedy, not just the problem', async () => {
      const tuned = createDocsRoute({
        contentDir: BASIC,
        miniSearchOptions: { processTerm },
      });

      // A build-time error a human reads once. Both halves of the escape hatch
      // have to be in it or the reader is left to guess the second.
      await expect(tuned.Layout({ children: null })).rejects.toThrow(
        /search=\{false\}/,
      );
      await expect(tuned.Layout({ children: null })).rejects.toThrow(
        /'use client'/,
      );
    });

    it('finds a function nested inside searchOptions', async () => {
      // `searchOptions.filter` is a second level down, and a key-list check
      // written against MiniSearch's top-level options would miss it.
      const tuned = createDocsRoute({
        contentDir: BASIC,
        miniSearchOptions: {
          processTerm,
          searchOptions: { filter: () => true },
        },
      });

      await expect(tuned.Layout({ children: null })).rejects.toThrow(
        /`miniSearchOptions\.searchOptions\.filter`/,
      );
    });

    it('still builds the index with them, and `search={false}` is the way through', async () => {
      /*
       * The supported path, and why the refusal is scoped to the forward rather
       * than to the option: the route keeps the function for the index it
       * builds on the server, and the host renders its own `'use client'`
       * dialog importing the same function. If `search={false}` threw as well,
       * the remedy the error names would not work.
       */
      const tuned = createDocsRoute({
        contentDir: BASIC,
        miniSearchOptions: { processTerm: () => 'zzz' },
      });

      const off = await tuned.Layout({ children: null, search: false });
      if (!isValidElement<{ search?: unknown }>(off)) {
        throw new Error('expected `Layout` to return an element');
      }
      expect(off.props.search).toBe(false);

      // And the function reached the index, which is the half that still works.
      const built = JSON.parse(await (await tuned.searchIndex()).text()) as {
        index: [string, unknown][];
      };
      expect(built.index.map(([term]) => term)).toEqual(['zzz']);
    });

    it('does not compile at the layout seam either', () => {
      /*
       * The type is the earlier, friendlier half of the same guard — a host
       * writing TypeScript is told at the seam rather than at `next build`.
       * Checked by `pnpm run typecheck`, not by running this.
       */
      const rejected: DocsLayoutProps = {
        children: null,
        // @ts-expect-error — a function cannot cross a Server → Client prop.
        search: { miniSearchOptions: { processTerm } },
      };
      expect(rejected).toBeDefined();
    });
  });

  it('takes five props, and a sixth is a deliberate act', () => {
    /*
     * The count is the point. Fumadocs' layout takes eleven, which promotes its
     * internal anatomy to semver-frozen API — two node props can become a slots
     * map later, a slots map cannot become two props. This fails when someone
     * adds the next one, which is exactly when the conversation should happen.
     *
     * It fired once, for `labels`, and the answer was yes. The shell renders
     * four strings of its own — the navigation landmark's name, the drawer's
     * open and close buttons, the skip link — and every one was hardcoded
     * English with no route to it: `DocsNav` declared `label` and `closeLabel`
     * props, documented them, defaulted them, and the layout that is the only
     * caller never passed either. A documentation shell nobody can translate is
     * not one for the whole ecosystem, and four strings behind one prop is the
     * smallest thing that fixes it.
     */
    expectTypeOf<keyof DocsLayoutProps>().toEqualTypeOf<
      'children' | 'title' | 'actions' | 'search' | 'labels'
    >();
  });

  it('passes labels through to the shell', async () => {
    const labels = {
      nav: 'Documenta\u00e7\u00e3o',
      openNav: 'Abrir navega\u00e7\u00e3o',
    };
    const element = await route.Layout({ children: null, labels });

    if (!isValidElement<{ labels?: unknown }>(element)) {
      throw new Error('expected `Layout` to return an element');
    }
    // That the four strings actually reach a reader — through three components
    // and two client boundaries — is `layout.test.tsx`, which can mount them.
    // The shell needs `next/navigation`, so this half stops at the handoff.
    expect(element.props.labels).toEqual(labels);
  });
});

describe('docs.searchIndex', () => {
  const route = createDocsRoute({ contentDir: BASIC });

  it('derives its URL from the base path, root mount included', () => {
    expect(route.searchIndexUrl).toBe('/docs/search-index.json');
    expect(
      createDocsRoute({ contentDir: BASIC, basePath: '/' }).searchIndexUrl,
    ).toBe('/search-index.json');
    expect(
      createDocsRoute({ contentDir: BASIC, basePath: '/product/docs' })
        .searchIndexUrl,
    ).toBe('/product/docs/search-index.json');
  });

  it('serves an index the dialog can load, hit and deep-link from', async () => {
    const response = await route.searchIndex();
    expect(response.headers.get('content-type')).toBe('application/json');

    // Loaded exactly as `search-dialog.tsx` loads it: the same merged options,
    // or the terms in the index are ones no query can spell.
    const index = MiniSearch.loadJSON<SearchRecord>(
      await response.text(),
      mergeSearchOptions(),
    );
    const hits = index.search('authentication');

    expect(hits.length).toBeGreaterThan(0);
    // `basePath` reaches the href, so a hit navigates somewhere that exists.
    expect(hits.every((hit) => String(hit.href).startsWith('/docs'))).toBe(
      true,
    );
    expect(hits.map((hit) => hit.href)).toContain('/docs/api/authentication');
    /*
     * A draft is not a page; indexing one leaks unpublished prose into a
     * dialog that then navigates to a hard 404.
     *
     * ⚠️ ASSERT AN EMPTY RESULT, NOT A PROPERTY OF ONE. This read
     * `index.search('changelog').every((hit) => hit.href !== '/docs/changelog')`
     * and could not fail for two independent reasons: `every` on an empty array
     * is `true`, and the draft's href is `/docs/changelog-draft`, so even a
     * fully leaked index satisfied it. Search the draft's own prose, and prove
     * the query is live by finding the same words on a published page.
     */
    expect(index.search('final').map((hit) => hit.href)).toEqual([]);
    expect(index.search('unreleased').map((hit) => hit.href)).toEqual([]);
    // The control: the index is loaded and answering, so the two empties above
    // are the draft's absence rather than a dead query.
    expect(index.search('install').length).toBeGreaterThan(0);
  });

  it('is byte-identical to the documented escape hatch', async () => {
    // The handler is a convenience over `renderAll()` + these two functions,
    // and this is what pins it there: if it ever grows its own opinion about
    // records or options, anyone who built the index by hand — because they
    // needed a step the handler cannot express — gets a different artifact
    // than their dialog was configured for.
    const byHand = buildSearchIndex(
      (await route.renderAll()).flatMap((doc) => extractSearchRecords(doc)),
    );

    expect(await (await route.searchIndex()).text()).toBe(byHand);
  });

  it('applies miniSearchOptions to the index it builds', async () => {
    const custom = createDocsRoute({
      contentDir: BASIC,
      miniSearchOptions: { storeFields: ['href'] },
    });
    const record = JSON.parse(await (await custom.searchIndex()).text()) as {
      storedFields: Record<string, Record<string, unknown>>;
    };

    // `storeFields` is applied at build time and cannot be recovered on the
    // client, so an override that never reached the index would fail silently.
    expect(Object.keys(Object.values(record.storedFields)[0] ?? {})).toEqual([
      'href',
    ]);
  });

  describe('the force-static guard', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('refuses to render the corpus at request time in production', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('NEXT_PHASE', undefined);

      await expect(route.searchIndex()).rejects.toMatchObject({
        code: 'search-index-dynamic',
      });
      // The message has to name the file to edit — the whole failure is one
      // missing line in a route file nobody looks at twice.
      await expect(route.searchIndex()).rejects.toThrow(
        /app\/docs\/search-index\.json\/route\.ts/,
      );
    });

    it('allows the prerender that writes the file', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('NEXT_PHASE', 'phase-production-build');

      expect((await route.searchIndex()).status).toBe(200);
    });

    it('stays out of the way in development', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('NEXT_PHASE', undefined);

      expect((await route.searchIndex()).status).toBe(200);
    });
  });

  describe('cache headers', () => {
    it('replaces a year of s-maxage with a validator', async () => {
      // Next's default for a `force-static` route is
      // `s-maxage=31536000, stale-while-revalidate` with nothing to revalidate
      // *against*, so a CDN pins one index to a URL that never changes.
      const headers = (await route.searchIndex()).headers;

      expect(headers.get('cache-control')).toBe(
        'public, max-age=0, must-revalidate',
      );
      expect(headers.get('etag')).toMatch(/^"[0-9a-f]{40}"$/);
    });

    it('holds the ETag still while the corpus does, and moves it when it does not', async () => {
      const dir = await makeContentDir({
        'index.md': '---\ntitle: Home\n---\n\nOriginal body.\n',
      });
      const dev = createDocsRoute({ contentDir: dir });
      const etag = async (): Promise<string | null> =>
        (await dev.searchIndex()).headers.get('etag');

      const first = await etag();
      // The stable half is the load-bearing one: `buildSearchIndex` promises
      // byte-stable output, and an ETag that churned would quietly disprove it
      // while turning every revalidation into a full download.
      expect(await etag()).toBe(first);

      await writeFile(
        path.join(dir, 'index.md'),
        '---\ntitle: Home\n---\n\nEdited body.\n',
        'utf8',
      );

      expect(await etag()).not.toBe(first);
    });
  });
});

describe('createDocsRoute with a frontmatterSchema', () => {
  const frontmatterSchema = docFrontmatterSchema.extend({
    audience: z.enum(['user', 'operator']).exactOptional(),
  });

  it('carries the custom fields through the whole route, uninstantiated', async () => {
    const contentDir = await makeContentDir({
      'index.md': '---\ntitle: Ops\naudience: operator\n---\n\nRunbooks.\n',
    });
    // No type argument anywhere below: the shape comes from the schema.
    const docs = createDocsRoute({
      contentDir,
      basePath: '/ops',
      frontmatterSchema,
    });

    const doc = await docs.getPage([]);
    expect(doc?.frontmatter.audience).toBe('operator');
    expectTypeOf(doc?.frontmatter.audience).toEqualTypeOf<
      'user' | 'operator' | undefined
    >();

    const [file] = await docs.source.all();
    expectTypeOf(file?.frontmatter.audience).toEqualTypeOf<
      'user' | 'operator' | undefined
    >();

    const [rendered] = await docs.renderAll();
    expectTypeOf(rendered?.frontmatter.audience).toEqualTypeOf<
      'user' | 'operator' | undefined
    >();

    // The built-ins still drive metadata, which is what the constraint on the
    // schema's output type protects.
    const metadata = await docs.generateMetadata({
      params: Promise.resolve({}),
    });
    expect(metadata.title).toBe('Ops');

    // The sitemap's `lastModified` hook sees the same shape.
    const entries = await createDocsSitemap({
      contentDir,
      siteUrl: 'https://example.com',
      frontmatterSchema,
      lastModified: (file) => {
        expectTypeOf(file.frontmatter.audience).toEqualTypeOf<
          'user' | 'operator' | undefined
        >();
        return file.frontmatter.audience === 'operator'
          ? new Date('2024-01-02T03:04:05.000Z')
          : undefined;
      },
    });
    expect(entries[0]?.lastModified).toEqual(
      new Date('2024-01-02T03:04:05.000Z'),
    );
  });

  it('fails the build on a page the project schema rejects', async () => {
    const contentDir = await makeContentDir({
      'index.md': '---\ntitle: Ops\naudience: sysadmin\n---\n',
    });
    const docs = createDocsRoute({
      contentDir,
      basePath: '/ops-invalid',
      frontmatterSchema,
    });

    await expect(docs.generateStaticParams()).rejects.toThrow(
      /Invalid frontmatter in index\.md/,
    );
  });
});

describe('createDocsSitemap', () => {
  it('emits an absolute URL per published page', async () => {
    const entries = await createDocsSitemap({
      contentDir: BASIC,
      siteUrl: 'https://example.com',
    });

    expect(entries.map((entry) => entry.url).sort()).toEqual([
      'https://example.com/docs',
      ...VISIBLE_SLUGS.map((slug) => `https://example.com/docs/${slug}`),
    ]);
    expect(entries.every((entry) => entry.lastModified instanceof Date)).toBe(
      true,
    );
    // Absent, not `undefined`: an unset `priority` must not serialise.
    expect(entries[0]).not.toHaveProperty('priority');
    expect(entries[0]).not.toHaveProperty('changeFrequency');
  });

  it('honours a caller-supplied lastModified and shared fields', async () => {
    const released = new Date('2024-01-02T03:04:05.000Z');
    const entries = await createDocsSitemap({
      contentDir: BASIC,
      siteUrl: 'https://example.com/',
      lastModified: () => released,
      changeFrequency: 'weekly',
      priority: 0.7,
    });

    expect(entries[0]).toMatchObject({
      lastModified: released,
      changeFrequency: 'weekly',
      priority: 0.7,
    });
  });

  it('rejects a relative siteUrl before producing an invalid sitemap', async () => {
    await expect(
      createDocsSitemap({ contentDir: BASIC, siteUrl: 'example.com' }),
    ).rejects.toThrow(/not an absolute URL/);
  });
});

describe('createDocsRedirects', () => {
  it('turns aliases into permanent redirects under the base path', async () => {
    expect(await createDocsRedirects({ contentDir: BASIC })).toEqual([
      {
        source: '/docs/quickstart',
        destination: '/docs/getting-started',
        permanent: true,
      },
    ]);

    const [redirect] = await createDocsRedirects({
      contentDir: BASIC,
      basePath: 'guide',
    });
    expect(redirect).toEqual({
      source: '/guide/quickstart',
      destination: '/guide/getting-started',
      permanent: true,
    });
  });

  it('normalises the slashes an author actually writes', async () => {
    const contentDir = await makeContentDir({
      'renamed.md': '---\ntitle: Renamed\naliases:\n  - /old/name/\n---\n',
    });

    expect(await createDocsRedirects({ contentDir })).toEqual([
      {
        source: '/docs/old/name',
        destination: '/docs/renamed',
        permanent: true,
      },
    ]);
  });

  it('fails when an alias shadows a real page', async () => {
    const contentDir = await makeContentDir({
      'installation.md': '---\ntitle: Installation\n---\n',
      'setup.md': '---\ntitle: Setup\naliases:\n  - installation\n---\n',
    });

    await expect(createDocsRedirects({ contentDir })).rejects.toThrow(
      /'\/docs\/installation', which is already the route of installation\.md/,
    );
  });

  it('fails when two pages claim the same alias', async () => {
    const contentDir = await makeContentDir({
      'a.md': '---\ntitle: A\naliases:\n  - legacy\n---\n',
      'b.md': '---\ntitle: B\naliases:\n  - legacy\n---\n',
    });

    await expect(createDocsRedirects({ contentDir })).rejects.toThrow(
      /'\/docs\/legacy' is claimed as an alias by both a\.md and b\.md/,
    );
  });

  it('fails on an empty alias rather than redirecting the base path', async () => {
    const contentDir = await makeContentDir({
      'page.md': "---\ntitle: Page\naliases:\n  - '  '\n---\n",
    });

    await expect(createDocsRedirects({ contentDir })).rejects.toThrow(
      /page\.md has an empty entry in its `aliases` frontmatter/,
    );
  });

  it('skips drafts, which have no route to redirect to', async () => {
    const contentDir = await makeContentDir({
      'next-release.md':
        '---\ntitle: Next\ndraft: true\naliases:\n  - upcoming\n---\n',
    });

    expect(await createDocsRedirects({ contentDir })).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
 * Regressions from the pre-publish defect review
 * ---------------------------------------------------------------------- */

describe('siteUrl containment', () => {
  /*
   * `new URL('/docs/x', 'https://example.com/product-docs')` silently discards
   * the base path, so every canonical, every `og:url` and every sitemap entry
   * pointed at a URL that 404s — and a canonical aimed at a 404 is a signal to
   * Google to drop the page.
   */
  it('rejects a siteUrl carrying a path, naming basePath as the fix', async () => {
    const contentDir = await makeContentDir({
      'index.md': '---\ntitle: Home\n---\n',
    });

    expect(() =>
      createDocsRoute({ contentDir, siteUrl: 'https://example.com/product' }),
    ).toThrow(/has a path \('\/product'\).*`basePath`/s);

    await expect(
      createDocsSitemap({
        contentDir,
        siteUrl: 'https://example.com/product/',
      }),
    ).rejects.toThrow(/has a path/);
  });

  it('still accepts an origin with or without a trailing slash', async () => {
    const contentDir = await makeContentDir({
      'index.md': '---\ntitle: Home\n---\n',
    });

    for (const siteUrl of ['https://example.com', 'https://example.com/']) {
      const entries = await createDocsSitemap({ contentDir, siteUrl });
      expect(entries[0]?.url).toBe('https://example.com/docs');
    }
  });
});

describe('links to an alias', () => {
  /*
   * An alias is a redirect, not a page: `generateStaticParams` never emits it,
   * so with `dynamicParams = false` it is a hard 404 — and it only resolves at
   * all once `createDocsRedirects` is wired into `next.config.ts`, which the
   * quick start does not do. Accepting the link built green and broke at
   * runtime; naming the target is advice the author can act on.
   */
  it('fails the build and names the page to link instead', async () => {
    const contentDir = await makeContentDir({
      'index.md': '---\ntitle: Home\n---\n\n[old name](./quickstart)\n',
      'getting-started.md':
        '---\ntitle: Getting started\naliases:\n  - quickstart\n---\n',
    });

    const docs = createDocsRoute({ contentDir });

    await expect(docs.getPage([])).rejects.toThrow(
      /an alias that redirects to '\/docs\/getting-started'.*Link to '\/docs\/getting-started' directly/s,
    );
  });

  it('leaves the alias out of the prerendered route list', async () => {
    const contentDir = await makeContentDir({
      'getting-started.md':
        '---\ntitle: Getting started\naliases:\n  - quickstart\n---\n',
    });

    const params = await createDocsRoute({ contentDir }).generateStaticParams();
    expect(params.map((p) => p.slug.join('/'))).toEqual(['getting-started']);
  });
});

describe('the source handed to layouts', () => {
  /*
   * `docs.source.nav()` is the documented way to feed the sidebar, and it was
   * the one reader that never invalidated: the request after adding a page
   * rendered the new body beside the old sidebar.
   */
  it('sees a new page on the same request that renders it', async () => {
    const contentDir = await makeContentDir({
      'index.md': '---\ntitle: Home\n---\n',
    });
    const docs = createDocsRoute({ contentDir });
    const titles = async (): Promise<string[]> =>
      (await docs.source.nav()).map((node) => node.title);

    expect(await titles()).not.toContain('Added');

    await writeFile(
      path.join(contentDir, 'added.md'),
      '---\ntitle: Added\n---\n',
      'utf8',
    );

    expect(await titles()).toContain('Added');
  });
});

describe('createDocsSitemap staleness', () => {
  /*
   * `createDocsSource` memoises globally by config, so without an explicit
   * invalidate the first scan of the process was the only one — and
   * `app/sitemap.ts` under `next dev` served the page set as it stood at boot.
   */
  it('re-reads the tree between calls by default', async () => {
    const contentDir = await makeContentDir({
      'index.md': '---\ntitle: Home\n---\n',
    });
    const siteUrl = 'https://example.com';

    expect(await createDocsSitemap({ contentDir, siteUrl })).toHaveLength(1);

    await writeFile(
      path.join(contentDir, 'second.md'),
      '---\ntitle: Second\n---\n',
      'utf8',
    );

    expect(await createDocsSitemap({ contentDir, siteUrl })).toHaveLength(2);
  });
});

describe('adapter wiring the renderer depends on', () => {
  /*
   * Mutating `collectRoutes(draftRoutes, drafts)` to a no-op used to leave the
   * whole suite green: `render.ts` had the diagnosis and nothing proved the
   * adapter ever filled the set it reads.
   */
  it('tells a draft link apart from a typo, end to end', async () => {
    const contentDir = await makeContentDir({
      'index.md': '---\ntitle: Home\n---\n[beta](./beta.md)\n',
      'beta.md': '---\ntitle: Beta\ndraft: true\n---\n',
    });

    await expect(createDocsRoute({ contentDir }).getPage([])).rejects.toThrow(
      /a page marked `draft: true`/,
    );
  });

  it('reports a genuine typo as a typo, not as a draft', async () => {
    const contentDir = await makeContentDir({
      'index.md': '---\ntitle: Home\n---\n[nope](./nope.md)\n',
    });

    await expect(createDocsRoute({ contentDir }).getPage([])).rejects.toThrow(
      /no such page exists/,
    );
  });

  /*
   * `excludeLangs` existed on the renderer and on no entry point that reaches
   * it, so the documented way to render a mermaid fence yourself did nothing.
   */
  it('forwards excludeLangs so a fence can escape the highlighter', async () => {
    const contentDir = await makeContentDir({
      'index.md': '---\ntitle: Home\n---\n\n```mermaid\ngraph TD;\n```\n',
    });

    const doc = await createDocsRoute({
      contentDir,
      excludeLangs: ['mermaid'],
    }).getPage([]);

    // Untouched by Shiki: still a plain `<pre><code class="language-mermaid">`
    // for the consumer's own `pre` component to intercept.
    expect(JSON.stringify(doc?.hast)).toContain('language-mermaid');
    expect(JSON.stringify(doc?.hast)).not.toContain('shiki');
  });

  it('stays quiet about a sitemap that fits', async () => {
    /*
     * Renamed to what it asserts. It was called "warns rather than silently
     * emitting an oversized sitemap" while building a one-page site and
     * asserting the warning did *not* fire — a name describing the opposite of
     * the assertion under it, and a branch reachable only by writing 50,001
     * files. The warning itself is `sitemap-limit.test.ts` now; this keeps the
     * integration half, which is a real guard against an inverted comparison
     * making every ordinary build noisy.
     */
    const contentDir = await makeContentDir({
      'index.md': '---\ntitle: Home\n---\n',
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      await createDocsSitemap({
        contentDir,
        siteUrl: 'https://example.com',
      });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('every label reaches a reader', () => {
  /*
   * ⚠️ `DocsLayoutProps.labels` USED TO DOCUMENT ITSELF AS "THE WHOLE OF WHAT A
   * NON-ENGLISH SITE HAS TO SAY" AND COVER FOUR STRINGS OF TWENTY-TWO. A German
   * site built exactly the documented way shipped `aria-label="On this page"`, a
   * visible `Back to top`, `aria-label="Tip"` on every callout, `Copy code` on
   * every fence and `(opens in a new tab)` after every external link — verified
   * in this repository's own `site/out`, which is how it was found.
   *
   * The strings do not share a runtime, which is why one prop could never have
   * reached them: four are the shell's, two the table of contents', nine the
   * markdown component map's, two are baked into the HTML by a rehype plugin at
   * build time, and two are announced by a client-side copy runtime. They are
   * configured in one place — `createDocsRoute({ labels })` — and split by
   * runtime from there.
   *
   * `LABEL_COVERAGE` is what stops this happening twice: every key of
   * `DocsLabels` has to name where it is proven, so a key added to the type
   * without being wired fails here rather than reading as configuration for a
   * release or two.
   */
  const LABEL_COVERAGE: Record<keyof DocsLabels, string> = {
    // Rendered into the page by `docs.Page`, and asserted below.
    toc: 'page markup',
    backToTop: 'page markup',
    externalLink: 'page markup',
    table: 'page markup',
    calloutNote: 'page markup',
    calloutTip: 'page markup',
    calloutImportant: 'page markup',
    calloutWarning: 'page markup',
    calloutCaution: 'page markup',
    youtubeTitle: 'page markup',
    youtubePlay: 'page markup',
    youtubeHide: 'page markup',
    copyCode: 'page markup',
    copyCodeFrom: 'page markup',
    // The shell needs `next/navigation`, so these are mounted where it can be
    // mocked. `layout.test.tsx` renders the real components and reads the DOM.
    nav: 'layout.test.tsx',
    openNav: 'layout.test.tsx',
    closeNav: 'layout.test.tsx',
    skipToContent: 'layout.test.tsx',
    expandGroup: 'layout.test.tsx',
    collapseGroup: 'layout.test.tsx',
    // Announced by the copy runtime, which needs a clipboard and a click.
    copied: 'code-runtime.test.tsx',
    copyFailed: 'code-runtime.test.tsx',
  };

  it('has somewhere that proves each one', () => {
    expect(Object.keys(LABEL_COVERAGE).sort()).toEqual(
      [...DOCS_LABEL_KEYS].sort(),
    );
  });

  it('renders the page half of them, every one', async () => {
    /*
     * Sentinels rather than plausible translations: `'Note'` translated to
     * `'Hinweis'` and then not rendered leaves the English in place, and a test
     * looking for German would pass against a page that had simply kept its
     * default. A string that cannot occur by accident cannot pass by accident.
     */
    const labels: DocsLabels = {
      toc: 'L-TOC',
      backToTop: 'L-TOP',
      externalLink: 'L-EXTERNAL',
      table: 'L-TABLE',
      calloutNote: 'L-NOTE',
      calloutTip: 'L-TIP',
      calloutImportant: 'L-IMPORTANT',
      calloutWarning: 'L-WARNING',
      calloutCaution: 'L-CAUTION',
      youtubeTitle: 'L-VIDEO',
      youtubePlay: 'L-PLAY {title}',
      youtubeHide: 'L-HIDE {title}',
      copyCode: 'L-COPY',
      copyCodeFrom: 'L-COPY-FROM {title}',
    };

    const route = createDocsRoute({
      contentDir: path.join(
        import.meta.dirname,
        '__fixtures__',
        'source',
        'labels',
      ),
      assertLinks: false,
      labels,
    });

    const markup = renderToStaticMarkup(
      createElement(Fragment, null, await route.IndexPage()),
    );

    const missing = Object.entries(labels)
      .filter(([, value]) => !markup.includes(value.replace(' {title}', '')))
      .map(([key]) => key);

    expect(missing).toEqual([]);

    // And the placeholders are filled rather than printed: a `{title}` reaching
    // a reader is worse than an untranslated string, because it looks like a
    // bug in the site rather than a missing translation.
    expect(markup).not.toContain('{title}');
    expect(markup).toContain('L-COPY-FROM config.ts');
    expect(markup).toContain('L-PLAY L-VIDEO');
    expect(markup).toContain('L-HIDE L-VIDEO');
  });

  it('leaves the defaults in place when nothing is set', async () => {
    // The other direction. A forwarding bug that passed `undefined` as a string,
    // or an empty object where a default was expected, would show up as an
    // unnamed region rather than as a failure anywhere else.
    const route = createDocsRoute({
      contentDir: path.join(
        import.meta.dirname,
        '__fixtures__',
        'source',
        'labels',
      ),
      assertLinks: false,
    });

    const markup = renderToStaticMarkup(
      createElement(Fragment, null, await route.IndexPage()),
    );

    expect(markup).toContain('On this page');
    expect(markup).toContain('Back to top');
    expect(markup).toContain('(opens in a new tab)');
    expect(markup).toContain('aria-label="Table"');
    expect(markup).toContain('Copy code');
    expect(markup).toContain('Play video: YouTube video player');
  });
});

describe('the next/image adapter forwards what the component map declares', () => {
  it('carries `fetchPriority` all the way to the rendered img', async () => {
    /*
     * ⚠️ THE HALF `markdown-components.test.tsx` CANNOT SEE. That file supplies
     * its own `Image` component, so it proves `createImage` passes the props on
     * — and `wrapNextImage`, the adapter every consumer of `@waveso/docs/next`
     * actually gets, destructures a fixed list and silently dropped anything
     * outside it, under a comment in `createImage` promising otherwise.
     *
     * ⚠️ AND IT HAS TO BE `fetchPriority`, NOT `decoding`. The first draft used
     * `decoding` and could not fail: `next/image` sets `decoding="async"` on its
     * own, so the attribute was in the output whether the adapter forwarded it
     * or not. `fetchPriority` is next/image's only if we hand it over.
     *
     * Set by a plugin because markdown cannot express it — which is also the
     * real way it arrives, since `rehypePlugins` is the documented seam for
     * exactly this.
     */
    const dir = await makeContentDir({
      'index.md': '---\ntitle: Home\n---\n\n![A diagram](./diagram.png)\n',
    });
    const route = createDocsRoute({
      contentDir: dir,
      assertLinks: false,
      imageResolver: () => ({ src: '/diagram.png', width: 800, height: 600 }),
      rehypePlugins: [
        () => (tree: HastRoot) => {
          visit(tree, 'element', (node) => {
            if (node.tagName === 'img') {
              node.properties.fetchPriority = 'high';
            }
          });
        },
      ],
    });

    const markup = renderToStaticMarkup(
      createElement(Fragment, null, await route.IndexPage()),
    );

    // React 19 lower-cases it on the way to the DOM.
    expect(markup).toMatch(/fetchpriority="high"/i);

    /*
     * The guard on the guard: an assertion that found no image at all would
     * prove nothing. `data-nimg` is `next/image`'s own marker, so this also pins
     * that the adapter under test is the one that ran — the src itself is
     * rewritten to `/_next/image?url=%2Fdiagram.png`, which is the point of it.
     */
    expect(markup).toContain('data-nimg');
    expect(markup).toContain('%2Fdiagram.png');
  });
});
