import type { StandardSchemaV1 } from '@standard-schema/spec';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { docFrontmatterSchema, parseFrontmatter } from './frontmatter.js';
import type {
  DocFrontmatter,
  DocNavGroup,
  DocsConfig,
  DocsMeta,
  ImageResolver,
} from './types.js';

/**
 * A schema written from scratch rather than as `docFrontmatterSchema.extend`.
 *
 * This is the shape the whole suite below is about: it type-checks, because
 * `TFrontmatter extends DocFrontmatter` only constrains `title` — every other
 * built-in is optional — and it declares none of the fields the package reads.
 */
const bareSchema = z.object({
  title: z.string().min(1),
  audience: z.enum(['user', 'operator']).exactOptional(),
});

/**
 * A validator that declares a `DocFrontmatter` output and returns none of it.
 *
 * The cast below is the only one in this file and it is the finding in
 * miniature: writing a validator that drops `title` takes a cast, and *passing*
 * one takes none — a schema built by a helper, or handed over from JavaScript,
 * arrives exactly like this. `parseFrontmatter` is the only thing between it
 * and an `undefined` `<title>`.
 */
const titleless: StandardSchemaV1<unknown, DocFrontmatter> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: () => ({ value: {} as DocFrontmatter }),
  },
};

describe('parseFrontmatter', () => {
  describe('a custom schema cannot drop the fields the package reads', () => {
    it('keeps `draft`, so an unpublished page is not published', async () => {
      const parsed = await parseFrontmatter(
        { title: 'Tuning', draft: true, audience: 'user' },
        'tuning.md',
        bareSchema,
      );
      // Without the overlay this is `undefined`, which every caller reads as
      // "not a draft": the page enters `all()`, `nav()`,
      // `generateStaticParams` and the sitemap.
      expect(parsed.draft).toBe(true);
      expect(parsed.audience).toBe('user');
    });

    it('keeps `aliases`, so a rename does not become a 404', async () => {
      const parsed = await parseFrontmatter(
        { title: 'Auth', aliases: ['old-auth', 'legacy/auth'] },
        'api/auth.md',
        bareSchema,
      );
      expect(parsed.aliases).toEqual(['old-auth', 'legacy/auth']);
    });

    it('keeps `order`, so the sidebar keeps its authored order', async () => {
      const parsed = await parseFrontmatter(
        { title: 'Auth', order: 2 },
        'api/auth.md',
        bareSchema,
      );
      expect(parsed.order).toBe(2);
    });

    it('keeps `label`, so a narrow sidebar keeps its short name', async () => {
      const parsed = await parseFrontmatter(
        { title: 'Authentication', label: 'Auth' },
        'api/auth.md',
        bareSchema,
      );
      expect(parsed.label).toBe('Auth');
    });

    it('keeps `description`, so `<meta>` and search keep theirs', async () => {
      const parsed = await parseFrontmatter(
        { title: 'Auth', description: 'Bearer tokens.' },
        'api/auth.md',
        bareSchema,
      );
      expect(parsed.description).toBe('Bearer tokens.');
    });

    it('keeps `title` even when the schema returns none at all', async () => {
      const parsed = await parseFrontmatter(
        { title: 'Auth' },
        'api/auth.md',
        titleless,
      );
      expect(parsed.title).toBe('Auth');
    });
  });

  describe('a custom schema cannot corrupt them either', () => {
    it('rejects a built-in the YAML types wrongly, undeclared or not', async () => {
      // `bareSchema` declares no `draft`, so it strips `draft: 'yes'` without
      // complaint. The package reads that string as truthy and hides a page
      // whose author wrote the word "yes" meaning nothing of the sort.
      const error = await parseFrontmatter(
        { title: 'Tuning', draft: 'yes' },
        'tuning.md',
        bareSchema,
      ).catch((err: unknown) => err);

      expect(String(error)).toContain('Invalid frontmatter in tuning.md');
      expect(String(error)).toContain('draft:');
      expect(String(error)).toContain('@waveso/docs reads these fields itself');
    });

    it('ignores a `.default()` aimed at a built-in, but not a rule', async () => {
      const overriding = docFrontmatterSchema.extend({
        // The YAML wins: the overlay reads `draft` from the raw block.
        draft: z.boolean().default(true),
      });
      const parsed = await parseFrontmatter(
        { title: 'Tuning', draft: false },
        'tuning.md',
        overriding,
      );
      expect(parsed.draft).toBe(false);

      // A *stricter* rule still fails the build — the overlay runs after the
      // custom schema, it does not run instead of it.
      const strict = docFrontmatterSchema.extend({ title: z.string().max(4) });
      await expect(
        parseFrontmatter({ title: 'Authentication' }, 'a.md', strict),
      ).rejects.toThrow(/Invalid frontmatter in a\.md/);
    });

    it('names the file when nothing at all supplies a title', async () => {
      const error = await parseFrontmatter(
        { audience: 'user' },
        'api/auth.md',
        titleless,
      ).catch((err: unknown) => err);

      expect(String(error)).toContain('Invalid frontmatter in api/auth.md');
      expect(String(error)).toContain('no `title`');
    });

    it('lets a custom schema supply a title the YAML does not carry', async () => {
      const defaulted = z.object({
        title: z.string().default('Untitled'),
      });
      const parsed = await parseFrontmatter({}, 'api/auth.md', defaulted);
      expect(parsed.title).toBe('Untitled');
    });
  });

  it('does not resurrect a built-in the file never declared', async () => {
    const parsed = await parseFrontmatter(
      { title: 'Auth', audience: 'user' },
      'api/auth.md',
      bareSchema,
    );
    // `'draft' in parsed` is what `resolveDocsConfig`-style spreads and
    // `toEqual` assertions elsewhere depend on: the overlay merges values, not
    // keys.
    expect('draft' in parsed).toBe(false);
    expect('aliases' in parsed).toBe(false);
    expect(parsed).toEqual({ title: 'Auth', audience: 'user' });
  });

  it('awaits a validator that returns a promise, overlay included', async () => {
    // Standard Schema permits `~standard.validate` to return a promise, and
    // this is the hand-rolled case — not a Zod schema with an async refinement,
    // so nothing but the `await` in `parseFrontmatter` unwraps it.
    const asyncSchema: StandardSchemaV1<unknown, { title: string }> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: async (value) => {
          await Promise.resolve();
          if (
            typeof value === 'object' &&
            value !== null &&
            'title' in value &&
            typeof value.title === 'string'
          ) {
            return { value: { title: value.title } };
          }
          return {
            issues: [{ message: 'expected a string', path: ['title'] }],
          };
        },
      },
    };

    const parsed = await parseFrontmatter(
      { title: 'Auth', draft: true },
      'api/auth.md',
      asyncSchema,
    );
    expect(parsed).toEqual({ title: 'Auth', draft: true });

    await expect(
      parseFrontmatter({ title: 7 }, 'api/auth.md', asyncSchema),
    ).rejects.toThrow(/title: expected a string/);
  });
});

/**
 * `exactOptionalPropertyTypes` is on in this package's own tsconfig and in
 * `@tsconfig/strictest`, so a consumer who has it on cannot pass
 * `basePath: process.env.DOCS_BASE_PATH` to an interface whose optionals are
 * spelled `?: string`. These assertions are checked by `pnpm run typecheck`,
 * not by the runner: at runtime they are no-ops.
 */
describe('optional properties accept an explicit undefined', () => {
  const maybeString: string | undefined = process.env.DOCS_BASE_PATH;
  const maybeNumber: number | undefined = undefined;

  it('on DocsConfig, from an env var read straight through', () => {
    const config: DocsConfig = {
      contentDir: 'content/docs',
      basePath: maybeString,
      includeDrafts: undefined,
      assertLinks: undefined,
      frontmatterSchema: undefined,
    };
    expect(config.contentDir).toBe('content/docs');
  });

  it('on DocFrontmatter, DocNavGroup, DocsMeta and ImageResolver', () => {
    const frontmatter: DocFrontmatter = {
      title: 'Auth',
      description: maybeString,
      label: maybeString,
      draft: undefined,
      aliases: undefined,
      order: maybeNumber,
    };
    const group: DocNavGroup = {
      type: 'group',
      title: 'API',
      href: maybeString,
      children: [],
    };
    const meta: DocsMeta = { title: maybeString, pages: undefined };
    const resolveImage: ImageResolver = () => ({
      src: '/logo.png',
      width: maybeNumber,
      height: maybeNumber,
    });

    expect([frontmatter.title, group.title, meta.title]).toHaveLength(3);
    expect(
      resolveImage('/logo.png', {
        segments: [],
        dirSegments: [],
        relativePath: 'index.md',
      }),
    ).toEqual({ src: '/logo.png', width: undefined, height: undefined });
  });

  it('accepts a schema built with `.optional()`, not `.exactOptional()`', async () => {
    // The inferred output is `{ description?: string | undefined }`. Against a
    // `DocFrontmatter` whose optionals lack `| undefined`, this is a nine-line
    // TS2322 through Standard Schema's internals — and then every read site
    // reports `Property 'audience' does not exist on type 'DocFrontmatter'`,
    // because inference collapses to the default.
    const loose = docFrontmatterSchema.extend({
      description: z.string().optional(),
      audience: z.enum(['user', 'operator']).optional(),
    });
    const parsed = await parseFrontmatter({ title: 'Auth' }, 'a.md', loose);
    expectTypeOf(parsed.audience).toEqualTypeOf<
      'user' | 'operator' | undefined
    >();
    expect(parsed.title).toBe('Auth');
  });
});

/**
 * Checked by `pnpm run typecheck`, not by the runner.
 */
describe('the frontmatter type cannot be named without a schema', () => {
  interface Mine extends DocFrontmatter {
    audience?: 'user' | 'operator' | undefined;
  }

  it('is a compile error, and a schema still passes through undefined', () => {
    // Nothing would validate `Mine`: `audience` would be `undefined` at
    // runtime and typed as present. The overloads make it unsayable.
    // @ts-expect-error - a named type argument requires the schema that proves it
    void parseFrontmatter<Mine>({ title: 'Auth' }, 'a.md');

    // …while a `DocsConfig`'s own optional schema still passes straight
    // through, which is what an earlier attempt at this broke.
    const config: DocsConfig<Mine> = { contentDir: 'content' };
    void parseFrontmatter<Mine>(
      { title: 'Auth' },
      'a.md',
      config.frontmatterSchema,
    );
    expect(config.contentDir).toBe('content');
  });
});
