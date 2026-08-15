import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isValidElement } from 'react';
import { afterAll, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';

import { docFrontmatterSchema } from './frontmatter.js';
import {
  createDocsRedirects,
  createDocsRoute,
  createDocsSitemap,
} from './next.js';

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

  it('gives the article the id the skip link targets, and makes it focusable', async () => {
    // The literal, not the constant the adapter imports: this is the published
    // default, and `SkipLink`'s own test pins the same string on the `href`. Both
    // now derive from `DOCS_CONTENT_ID`, so the pair cannot drift apart — but a
    // change to the value itself is a breaking change and has to fail here.
    //
    // `tabIndex` matters as much as the id: a fragment link moves the scroll
    // position and not always the focus, so an unfocusable target leaves a
    // keyboard reader at the top of the sidebar they were trying to skip.
    const page = await route.Page({
      params: Promise.resolve({ slug: ['getting-started'] }),
    });

    if (!isValidElement<{ id?: string; tabIndex?: number }>(page)) {
      throw new Error('expected `Page` to return an element');
    }
    expect(page.type).toBe('article');
    expect(page.props.id).toBe('docs-content');
    expect(page.props.tabIndex).toBe(-1);
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

  it('warns rather than silently emitting an oversized sitemap', async () => {
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
