import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';
import { docFrontmatterSchema, parseFrontmatter } from './frontmatter.js';
import { extractSearchRecords } from './search-index.js';
import { createDocsSource, resolveDocsConfig } from './source.js';
import { toAliasRoute } from './route-path.js';
import type { DocFrontmatter, DocNavNode, RenderedDoc } from './types.js';

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

const tempDirs: string[] = [];

/** A markdown file with nothing but frontmatter. */
const doc = (title: string, extra = ''): string =>
  `---\ntitle: ${title}\n${extra}---\n\nBody.\n`;

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'wave-docs-source-'));
  tempDirs.push(dir);
  return dir;
}

/**
 * A throwaway content tree, for shapes the committed fixtures cannot hold:
 * symlinks (which a Windows checkout turns into text files), an upper-case
 * `.MD` (which a case-insensitive filesystem will not let you produce by
 * renaming), and NFD filenames.
 */
async function makeContentDir(files: Record<string, string>): Promise<string> {
  const dir = await makeTempDir();
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

  /**
   * ⚠️ `_scratch.md` IS IN THE FIXTURE TREE AND MUST NOT APPEAR BELOW.
   *
   * `isIgnoredDir` skipped `_` and `.`; `isPageFile` skipped only `.`. So
   * `_drafts/` was excluded while `_notes.md` beside it published — routed, in
   * the sidebar, in the sitemap, in the search index. The underscore is the only
   * way to keep a markdown file in the tree unpublished, and it silently did
   * not work for the file form.
   */
  it('ignores dotfiles, non-markdown files, and underscore files and directories', async () => {
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

/**
 * ⚠️ `entry.isFile()` AND `entry.isDirectory()` ARE BOTH FALSE FOR A SYMLINK,
 * and `readdir` has no follow option — so a symlinked page or section was
 * missing from `all()`, the sidebar, the sitemap and the search index without
 * a word, and the first link to it failed the build with `no such page
 * exists`, pointing the author at a link that was perfectly correct.
 */
describe('symlinks and extension case', () => {
  it('follows a symlinked page and a symlinked directory', async () => {
    const dir = await makeContentDir({
      'index.md': doc('Home'),
      'real/page.md': doc('Real page'),
    });
    await symlink(
      path.join(dir, 'real', 'page.md'),
      path.join(dir, 'linked.md'),
    );
    await symlink(path.join(dir, 'real'), path.join(dir, 'mirror'));

    const source = createDocsSource({ contentDir: dir });
    expect((await source.all()).map((file) => file.slug)).toEqual([
      '',
      'linked',
      'mirror/page',
      'real/page',
    ]);
  });

  it('reads a page whose extension is upper case', async () => {
    const dir = await makeContentDir({
      'index.md': doc('Home'),
      'GUIDE.MD': doc('Guide'),
    });

    const page = await createDocsSource({ contentDir: dir }).find(['GUIDE']);
    expect(page?.frontmatter.title).toBe('Guide');
  });

  it('stops at a symlink that points back into its own tree', async () => {
    const dir = await makeContentDir({
      'index.md': doc('Home'),
      'section/page.md': doc('Page'),
    });
    await symlink(dir, path.join(dir, 'section', 'loop'));

    const source = createDocsSource({ contentDir: dir });
    expect((await source.all()).map((file) => file.slug)).toEqual([
      '',
      'section/page',
    ]);
  });

  it('refuses a broken symlink that names a markdown page', async () => {
    const dir = await makeContentDir({ 'index.md': doc('Home') });
    await symlink(path.join(dir, 'gone.md'), path.join(dir, 'ghost.md'));

    await expect(createDocsSource({ contentDir: dir }).all()).rejects.toThrow(
      /ghost\.md is a broken symbolic link/,
    );
  });
});

describe('route keys', () => {
  it('addresses an NFD filename by its NFC name', async () => {
    // Escapes, not the characters: the two spell `cafe` identically on screen
    // and differently in bytes. NFD — `e` plus a combining acute — is what a
    // macOS zip yields, and an NFC-typed link to one used to fail the build
    // naming two strings a reader cannot tell apart.
    const nfd = 'cafe\u0301';
    const nfc = 'caf\u00e9';
    const dir = await makeContentDir({ [`${nfd}.md`]: doc('Cafe') });

    const page = await createDocsSource({ contentDir: dir }).find([nfc]);
    expect(page).toMatchObject({
      segments: [nfc],
      href: '/docs/caf%C3%A9',
    });
  });

  it('percent-encodes the href, leaving segments and slug raw', async () => {
    const dir = await makeContentDir({
      'c# guide.md': doc('C# guide'),
      '100%-faster.md': doc('Faster'),
    });
    const source = createDocsSource({ contentDir: dir });

    // Raw, because Next decodes route params before they reach `find()`.
    expect(await source.find(['c# guide'])).toMatchObject({
      segments: ['c# guide'],
      slug: 'c# guide',
      // Unencoded this is a fragment, not a path: the sitemap emitted
      // `https://example.com/docs/c#%20guide`, and `alternates.canonical` and
      // `og:url` are built by the same call.
      href: '/docs/c%23%20guide',
    });
    expect((await source.find(['100%-faster']))?.href).toBe(
      '/docs/100%25-faster',
    );
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

  it('does not cache a scan that failed', async () => {
    // Caching the rejected promise makes one transient failure permanent: a
    // dev server would replay the same error for the rest of the session and
    // never touch the disk again.
    const parent = await makeTempDir();
    const contentDir = path.join(parent, 'content');
    const source = createDocsSource({ contentDir });

    await expect(source.all()).rejects.toThrow(
      /Docs content directory not found/,
    );

    await mkdir(contentDir);
    await writeFile(path.join(contentDir, 'index.md'), doc('Home'), 'utf8');

    expect((await source.all()).map((file) => file.slug)).toEqual(['']);
  });
});

/**
 * ⚠️ A DRAFT `index.md` IS NOT A PUBLIC PAGE, AND ITS TITLE IS NOT EITHER.
 *
 * Only the group's `href` used to be gated on visibility, so an unreleased
 * codename was rendered into the sidebar of a production build — with no link
 * on it, so no click reveals it and only view-source shows it at all — and its
 * `order` still positioned the group among published ones.
 */
describe('a directory whose index is a draft', () => {
  const contentDir = path.join(FIXTURES, 'draft-index');

  it('publishes neither its title nor its order to the sidebar', async () => {
    expect(describeNodes(await createDocsSource({ contentDir }).nav())).toEqual(
      [
        'page:Home:/docs',
        'page:Alpha:/docs/alpha',
        // Humanised from the directory name, and last: `order: -5` on the draft
        // index would have put it first.
        'group:Secret:-(page:Ok:/docs/secret/ok)',
      ],
    );
  });

  it('uses both in a preview that includes drafts', async () => {
    const preview = createDocsSource({ contentDir, includeDrafts: true });
    expect(describeNodes(await preview.nav())).toEqual([
      'group:Unreleased Q4 pricing:/docs/secret(page:Ok:/docs/secret/ok)',
      'page:Home:/docs',
      'page:Alpha:/docs/alpha',
    ]);
  });
});

describe('the content root index', () => {
  it('appears in the sidebar without a meta.json naming it', async () => {
    // Nothing encloses the root, so no group heading carries its href: it is
    // the one `index.md` the sidebar has to list itself. Without this the
    // landing page is missing from its own sidebar and a reader who follows a
    // link cannot get back.
    const contentDir = await makeContentDir({
      'index.md': doc('Home', 'order: 0\n'),
      'a.md': doc('A'),
      'nested/index.md': doc('Nested'),
      'nested/child.md': doc('Child'),
    });

    expect(describeNodes(await createDocsSource({ contentDir }).nav())).toEqual(
      [
        'page:Home:/docs',
        'page:A:/docs/a',
        // The nested index stays out: the group heading already links it.
        'group:Nested:/docs/nested(page:Child:/docs/nested/child)',
      ],
    );
  });
});

describe('aliases', () => {
  it('normalises the slashes an author writes, and encodes the rest', () => {
    expect(toAliasRoute(' /old//name/ ', '/docs', 'renamed.md')).toBe(
      '/docs/old/name',
    );
    expect(toAliasRoute('c# guide', '/docs', 'renamed.md')).toBe(
      '/docs/c%23%20guide',
    );
  });

  /**
   * Next compiles every `redirects()` source with `path-to-regexp`, so
   * `v1:beta` installs `/docs/v1([^/]+?)` — a 308 that swallows the genuinely
   * prerendered `/docs/v1-guide`, with no error anywhere. `c++` is the loud
   * sibling: the build aborts naming an offset into a string nobody wrote.
   */
  it('refuses a path-to-regexp metacharacter, naming the file', () => {
    for (const alias of ['v1:beta', 'c++', 'old(1)', 'a*b', 'a?b', 'a{2}']) {
      expect(() => toAliasRoute(alias, '/docs', 'guides/renamed.md')).toThrow(
        /guides\/renamed\.md/,
      );
    }
    expect(() => toAliasRoute('v1:beta', '/docs', 'renamed.md')).toThrow(
      /redirect pattern syntax/,
    );
  });

  it('refuses a dot segment and an empty entry', () => {
    expect(() => toAliasRoute('../escape', '/docs', 'renamed.md')).toThrow(
      /has a '\.' or '\.\.' segment/,
    );
    expect(() => toAliasRoute('./here', '/docs', 'renamed.md')).toThrow(
      /has a '\.' or '\.\.' segment/,
    );
    expect(() => toAliasRoute('  /  ', '/docs', 'renamed.md')).toThrow(
      /empty entry in its/,
    );
  });

  it('rejects one during the scan, naming the markdown file', async () => {
    // Validated where the file is in hand: the adapters call `toAliasRoute`
    // long after the scan, and their error can name no file at all.
    const contentDir = await makeContentDir({
      'index.md': doc('Home'),
      'guides/renamed.md': doc('Renamed', 'aliases:\n  - v1:beta\n'),
    });

    await expect(createDocsSource({ contentDir }).all()).rejects.toThrow(
      /the alias 'v1:beta' in guides\/renamed\.md/,
    );
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
  it('accepts the documented fields', async () => {
    await expect(
      parseFrontmatter(
        { title: 'Auth', aliases: ['old-auth'], order: 2 },
        'api/auth.md',
      ),
    ).resolves.toEqual({ title: 'Auth', aliases: ['old-auth'], order: 2 });
  });

  it('leaves absent optional fields absent', async () => {
    const parsed = await parseFrontmatter({ title: 'Auth' }, 'api/auth.md');
    expect('description' in parsed).toBe(false);
  });

  it('does not cap the description length', async () => {
    const description = 'x'.repeat(400);
    const parsed = await parseFrontmatter(
      { title: 'Auth', description },
      'api/auth.md',
    );
    expect(parsed.description).toBe(description);
  });

  it('reports every bad field path against the file', async () => {
    await expect(
      parseFrontmatter(
        { title: 'Auth', aliases: [1], draft: 'yes' },
        'api/auth.md',
      ),
    ).rejects.toThrow(/aliases\[0\]/);
  });

  it('accepts a caller-extended schema', async () => {
    const schema = docFrontmatterSchema.extend({
      audience: z.enum(['user', 'operator']).exactOptional(),
    });
    await expect(
      parseFrontmatter({ title: 'Auth', audience: 'operator' }, 'a.md', schema),
    ).resolves.toEqual({ title: 'Auth', audience: 'operator' });
  });

  it('awaits a schema whose validation is asynchronous', async () => {
    // Standard Schema allows `~standard.validate` to return a promise, and any
    // schema with an async refinement does. Refusing those would make half the
    // spec silently unsupported.
    const schema = docFrontmatterSchema.refine(async (value) => {
      await Promise.resolve();
      return value.title !== 'Reserved';
    }, 'title "Reserved" is spoken for');

    await expect(
      parseFrontmatter({ title: 'Auth' }, 'api/auth.md', schema),
    ).resolves.toEqual({ title: 'Auth' });
    await expect(
      parseFrontmatter({ title: 'Reserved' }, 'api/auth.md', schema),
    ).rejects.toThrow(/Invalid frontmatter in api\/auth\.md/);
  });
});

/**
 * `frontmatterSchema` is the only way a project's own fields reach
 * `DocFile.frontmatter`, and the generic it drives has to be *inferred* — a
 * consumer who has to write `createDocsSource<MyFrontmatter>(...)` has been
 * handed a second source of truth to keep in step with their schema.
 *
 * The `expectTypeOf` assertions below are checked by `pnpm run typecheck`, not
 * by the test runner: at runtime they are no-ops.
 */
describe('frontmatterSchema', () => {
  const frontmatterSchema = docFrontmatterSchema.extend({
    audience: z.enum(['user', 'operator']).exactOptional(),
  });

  const source = createDocsSource({
    contentDir: path.join(FIXTURES, 'custom-frontmatter'),
    frontmatterSchema,
  });

  it('carries a field the base schema does not declare', async () => {
    const page = await source.find(['tuning']);
    expect(page?.frontmatter).toEqual({
      title: 'Tuning',
      label: 'Tune',
      audience: 'user',
      order: 1,
    });

    const index = await source.find([]);
    expect(index?.frontmatter.audience).toBe('operator');
  });

  it('infers the frontmatter type with no explicit type argument', async () => {
    const page = await source.find(['tuning']);
    expectTypeOf(page?.frontmatter.audience).toEqualTypeOf<
      'user' | 'operator' | undefined
    >();
    // The built-ins survive the extension, which is what keeps nav, redirects
    // and metadata working.
    expectTypeOf(page?.frontmatter.title).toEqualTypeOf<string | undefined>();

    const [first] = await source.all();
    expectTypeOf(first?.frontmatter.audience).toEqualTypeOf<
      'user' | 'operator' | undefined
    >();
  });

  it('still narrows to DocFrontmatter with no schema at all', async () => {
    const plain = createDocsSource({ contentDir: BASIC });
    const page = await plain.find(['installation']);
    expectTypeOf(page?.frontmatter).toEqualTypeOf<DocFrontmatter | undefined>();
    expect(resolveDocsConfig({ contentDir: BASIC })).not.toHaveProperty(
      'frontmatterSchema',
    );
  });

  it('rejects a schema that drops the fields the package needs', () => {
    createDocsSource({
      contentDir: BASIC,
      // @ts-expect-error - no `title`, so nav, `<h1>` and `<title>` would break
      frontmatterSchema: z.object({ audience: z.string() }),
    });
  });

  it('does not share a scan between two different schemas', async () => {
    const dir = path.join(FIXTURES, 'custom-frontmatter');
    // Same directory, same defaults, different schema: sharing the memoised
    // scan would hand this caller frontmatter parsed by the other's schema.
    const plain = createDocsSource({ contentDir: dir });
    expect(plain).not.toBe(source);
    expect((await plain.find(['tuning']))?.frontmatter).not.toHaveProperty(
      'audience',
    );

    // Identity, not structure: an equivalent schema is still a different scan.
    const twin = docFrontmatterSchema.extend({
      audience: z.enum(['user', 'operator']).exactOptional(),
    });
    expect(
      createDocsSource({ contentDir: dir, frontmatterSchema: twin }),
    ).not.toBe(source);
    expect(createDocsSource({ contentDir: dir, frontmatterSchema })).toBe(
      source,
    );
  });

  it('names the file and the field path when a custom field is invalid', async () => {
    const broken = createDocsSource({
      contentDir: path.join(FIXTURES, 'bad-custom-frontmatter'),
      frontmatterSchema,
    });
    const error = await broken.all().catch((err: unknown) => err);
    expect(String(error)).toContain('Invalid frontmatter in tuning.md');
    expect(String(error)).toContain('audience:');
    // Whose schema rejected it: without this the author has no idea the rule is
    // their own and not the package's.
    expect(String(error)).toContain('`frontmatterSchema`');
  });

  it('feeds the search index without a type argument', async () => {
    // `extractSearchRecords` reads nothing outside `DocFrontmatter`, so it stays
    // non-generic; a custom `RenderedDoc` has to remain assignable to it.
    const doc: RenderedDoc<{ title: string; audience?: 'user' }> = {
      frontmatter: { title: 'Tuning', audience: 'user' },
      hast: { type: 'root', children: [] },
      toc: [],
      segments: ['tuning'],
      href: '/docs/tuning',
    };
    expect(extractSearchRecords(doc)).toHaveLength(1);
  });
});
