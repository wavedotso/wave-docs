import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

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

  it('reads the tree once when the rescan is off', async () => {
    const dir = await makeContentDir({
      'index.md': '---\ntitle: Home\n---\n\nOriginal body.\n',
    });
    const built = createDocsRoute({
      contentDir: dir,
      basePath: '/built-docs',
      rescanPerRequest: false,
    });

    expect(JSON.stringify(await built.getPage([]))).toContain('Original body');
    await writeFile(
      path.join(dir, 'index.md'),
      '---\ntitle: Home\n---\n\nEdited body.\n',
      'utf8',
    );
    // A production build must not re-read the tree between pages; the content
    // cannot change while it runs, and caching is the whole point.
    expect(JSON.stringify(await built.getPage([]))).toContain('Original body');
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
