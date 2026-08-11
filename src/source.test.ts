import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { docFrontmatterSchema, parseFrontmatter } from './frontmatter.js';
import { createDocsSource, resolveDocsConfig } from './source.js';
import type { DocNavNode } from './types.js';

// Counting `readdir` is how the scan-once guarantee is asserted: one scan of
// the `basic` fixture is exactly four directory reads.
const { readdirCalls } = vi.hoisted(() => ({ readdirCalls: { count: 0 } }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readdir: (...args: Parameters<typeof actual.readdir>) => {
      readdirCalls.count += 1;
      // Overloaded signature; the cast keeps the pass-through honest.
      return (actual.readdir as (...a: unknown[]) => unknown)(...args);
    },
  };
});

const FIXTURES = path.join(import.meta.dirname, '__fixtures__', 'source');
const BASIC = path.join(FIXTURES, 'basic');

const describeNodes = (nodes: DocNavNode[]): string[] =>
  nodes.map((node) => {
    if (node.type === 'group') {
      return `group:${node.title}:${node.href ?? '-'}(${describeNodes(
        node.children,
      ).join('|')})`;
    }
    if (node.type === 'link') {
      return `link:${node.title}:${node.href}:${node.external}`;
    }
    if (node.type === 'separator') {
      return `separator:${node.title}`;
    }
    return `page:${node.title}:${node.href}`;
  });

describe('resolveDocsConfig', () => {
  it('applies the documented defaults', () => {
    const resolved = resolveDocsConfig({ contentDir: 'content' });
    expect(resolved).toEqual({
      contentDir: path.resolve(process.cwd(), 'content'),
      basePath: '/docs',
      includeDrafts: false,
      assertLinks: true,
    });
  });

  it('normalises basePath, collapsing a root mount to the empty string', () => {
    expect(
      resolveDocsConfig({ contentDir: '.', basePath: 'guide/' }).basePath,
    ).toBe('/guide');
    expect(resolveDocsConfig({ contentDir: '.', basePath: '/' }).basePath).toBe(
      '',
    );
  });
});

describe('createDocsSource', () => {
  const source = createDocsSource({ contentDir: BASIC });

  it('reuses one source per resolved config', () => {
    expect(createDocsSource({ contentDir: BASIC })).toBe(source);
    expect(
      createDocsSource({ contentDir: BASIC, basePath: '/guide' }),
    ).not.toBe(source);
  });

  it('maps index.md to its directory route and strips the extension', async () => {
    const root = await source.find([]);
    expect(root).toMatchObject({
      segments: [],
      slug: '',
      href: '/docs',
      relativePath: 'index.md',
    });

    const nested = await source.find(['api']);
    expect(nested).toMatchObject({
      href: '/docs/api',
      relativePath: 'api/index.md',
    });

    const page = await source.find(['api', 'authentication']);
    expect(page).toMatchObject({
      slug: 'api/authentication',
      href: '/docs/api/authentication',
      relativePath: 'api/authentication.md',
    });
  });

  it('carries the body so rendering never re-reads the file', async () => {
    const page = await source.find(['api', 'webhooks']);
    expect(page?.content.trim()).toBe('Signed with HMAC-SHA256.');
    expect(page?.content).not.toContain('title:');
  });

  it('ignores dotfiles, non-markdown files and underscore directories', async () => {
    const slugs = (await source.all()).map((file) => file.slug);
    expect(slugs).toEqual([
      '',
      'getting-started',
      'installation',
      'api',
      'api/authentication',
      'api/rate-limits',
      'api/webhooks',
      'guides/caching',
      'guides/deploying',
      'guides/theming',
    ]);
  });

  it('excludes drafts from all() and slugs() but not from find()', async () => {
    const slugs = await source.slugs();
    expect(slugs).not.toContainEqual(['changelog-draft']);
    expect(slugs[0]).toEqual([]);

    const draft = await source.find(['changelog-draft']);
    expect(draft?.frontmatter.draft).toBe(true);
  });

  it('includes drafts everywhere when configured', async () => {
    const withDrafts = createDocsSource({
      contentDir: BASIC,
      includeDrafts: true,
    });
    const slugs = (await withDrafts.all()).map((file) => file.slug);
    expect(slugs).toContain('changelog-draft');
    expect(describeNodes(await withDrafts.nav())).toContain(
      'page:Unreleased changes:/docs/changelog-draft',
    );
  });

  it('builds the nav from every meta.json entry form', async () => {
    expect(describeNodes(await source.nav())).toEqual([
      'page:Wave:/docs',
      'page:Get started:/docs/getting-started',
      'separator:Reference',
      // `"...api"` drops the group wrapper but not the directory's own page:
      // /docs/api is a published route and has to be reachable from the nav.
      'page:API:/docs/api',
      'page:Authentication:/docs/api/authentication',
      'page:Rate limits:/docs/api/rate-limits',
      'page:Webhooks:/docs/api/webhooks',
      'group:Guides:-(page:Caching:/docs/guides/caching|page:Deploying:/docs/guides/deploying|page:Theming:/docs/guides/theming)',
      'page:Installation:/docs/installation',
      'link:GitHub:https://github.com/wavedotso/wave:true',
      'link:Changelog:/changelog:false',
    ]);
  });
});

describe('a directory and a same-named page', () => {
  // `guides.md` beside `guides/` (which has no `index.md`) is the one shape
  // where a page and a directory answer to the same `meta.json` name. Before
  // the merge, a `Map` keyed on that name kept the directory and `/docs/guides`
  // vanished from the sidebar while remaining a published route.
  const source = createDocsSource({
    contentDir: path.join(FIXTURES, 'dir-page'),
  });

  it('publishes the page and links the group heading at it', async () => {
    expect((await source.all()).map((file) => file.slug)).toContain('guides');
    expect(describeNodes(await source.nav())).toEqual([
      'page:Home:/docs',
      'group:Guides overview:/docs/guides(page:Caching:/docs/guides/caching)',
      // `solo/` publishes nothing (its only page is a draft), so `solo.md` is a
      // plain link: a group here would render a toggle onto an empty list.
      'page:Solo:/docs/solo',
    ]);
  });
});

describe('scan caching', () => {
  it('scans once no matter how many callers race', async () => {
    // A distinct basePath keeps this off the memoised source other tests use.
    const source = createDocsSource({
      contentDir: BASIC,
      basePath: '/cache-probe',
    });
    readdirCalls.count = 0;

    await Promise.all([
      source.all(),
      source.all(),
      source.nav(),
      source.slugs(),
      source.find(['api']),
    ]);
    await source.all();

    // basic, basic/api, basic/empty, basic/guides — one pass, not five.
    expect(readdirCalls.count).toBe(4);
  });
});

describe('build-time failures', () => {
  it('names the file and the entry when meta.json lists a missing page', async () => {
    const source = createDocsSource({
      contentDir: path.join(FIXTURES, 'broken-meta'),
    });
    await expect(source.nav()).rejects.toThrow(
      /broken-meta[/\\]meta\.json lists "missing-page", which does not exist/,
    );
  });

  it('names the offending markdown file when frontmatter is invalid', async () => {
    const source = createDocsSource({
      contentDir: path.join(FIXTURES, 'bad-frontmatter'),
    });
    const error = await source.all().catch((err: unknown) => err);
    expect(String(error)).toContain('Invalid frontmatter in no-title.md');
    expect(String(error)).toContain('title:');
    expect(String(error)).toContain('order:');
  });

  it('explains a missing content directory', async () => {
    const source = createDocsSource({
      contentDir: path.join(FIXTURES, 'does-not-exist'),
    });
    await expect(source.all()).rejects.toThrow(
      /Docs content directory not found/,
    );
  });
});

describe('parseFrontmatter', () => {
  it('accepts the documented fields', () => {
    expect(
      parseFrontmatter(
        { title: 'Auth', aliases: ['old-auth'], order: 2 },
        'api/auth.md',
      ),
    ).toEqual({ title: 'Auth', aliases: ['old-auth'], order: 2 });
  });

  it('leaves absent optional fields absent', () => {
    const parsed = parseFrontmatter({ title: 'Auth' }, 'api/auth.md');
    expect('description' in parsed).toBe(false);
  });

  it('does not cap the description length', () => {
    const description = 'x'.repeat(400);
    expect(
      parseFrontmatter({ title: 'Auth', description }, 'api/auth.md')
        .description,
    ).toBe(description);
  });

  it('reports every bad field path against the file', () => {
    expect(() =>
      parseFrontmatter(
        { title: 'Auth', aliases: [1], draft: 'yes' },
        'api/auth.md',
      ),
    ).toThrow(/aliases\[0\]/);
  });

  it('accepts a caller-extended schema', () => {
    const schema = docFrontmatterSchema.extend({
      audience: z.enum(['user', 'operator']).exactOptional(),
    });
    expect(
      parseFrontmatter({ title: 'Auth', audience: 'operator' }, 'a.md', schema),
    ).toEqual({ title: 'Auth', audience: 'operator' });
  });
});
