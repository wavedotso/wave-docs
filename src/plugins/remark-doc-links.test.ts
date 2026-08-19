import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { describe, expect, it } from 'vitest';
import { VFile } from 'vfile';
import type { DocLinkContext } from '../types.js';
import type { DocLinkRef } from './remark-doc-links.js';
import { remarkDocLinks, resolveMarkdownLink } from './remark-doc-links.js';

interface Run {
  urls: string[];
  refs: DocLinkRef[];
}

/**
 * Run the plugin over a document and report what the links became. One frozen
 * processor across every case, which is also the reuse the plugin is designed
 * for.
 */
function run(
  markdown: string,
  document: DocLinkContext,
  options: Parameters<typeof remarkDocLinks>[0] = { basePath: '/docs' },
): Run {
  const processor = unified().use(remarkParse).use(remarkDocLinks, options);
  const file = new VFile({ value: markdown, path: 'test.md' });
  file.data.docLinkContext = document;
  const tree = processor.runSync(processor.parse(file), file);

  const urls: string[] = [];
  visit(tree, ['link', 'definition'], (node) => {
    if (node.type === 'link' || node.type === 'definition') {
      urls.push(node.url);
    }
  });
  return { urls, refs: file.data.docLinks ?? [] };
}

const FROM_PAGE: DocLinkContext = {
  segments: ['guide', 'setup'],
  dirSegments: ['guide'],
  relativePath: 'guide/setup.md',
};

/**
 * The pair the resolver contract was changed for.
 *
 * `api/index.md` and `api.md` have IDENTICAL route segments and DIFFERENT
 * directories, so a resolver handed only the route cannot resolve
 * `./auth.md` correctly from both. These two fixtures differ in exactly the
 * field that separates them.
 */
const FROM_DIR_INDEX: DocLinkContext = {
  segments: ['api'],
  dirSegments: ['api'],
  relativePath: 'api/index.md',
};

const FROM_DIR_PAGE: DocLinkContext = {
  segments: ['api'],
  dirSegments: [],
  relativePath: 'api.md',
};

describe('remarkDocLinks', () => {
  it('rewrites relative markdown links to routes', () => {
    const { urls } = run(
      [
        '[a](./install.md)',
        '[b](../api/auth.md)',
        '[c](../api/index.md)',
        '[d](nested/deep.md)',
      ].join('\n\n'),
      FROM_PAGE,
    );

    expect(urls).toEqual([
      '/docs/guide/install',
      '/docs/api/auth',
      '/docs/api',
      '/docs/guide/nested/deep',
    ]);
  });

  it('rewrites extensionless relative links the same way', () => {
    // These are the ones authors think are safe; they break identically.
    const { urls } = run('[u](../api/users) [s](./install)', FROM_PAGE);
    expect(urls).toEqual(['/docs/api/users', '/docs/guide/install']);
  });

  it('preserves anchors and queries', () => {
    const { urls } = run(
      '[a](./install.md#requirements) [b](../api/auth.md?tab=js#bearer)',
      FROM_PAGE,
    );
    expect(urls).toEqual([
      '/docs/guide/install#requirements',
      '/docs/api/auth?tab=js#bearer',
    ]);
  });

  it('leaves external and in-page links alone', () => {
    const source = [
      '[a](https://example.com/x.md)',
      '[b](//cdn.example.com/x)',
      '[c](mailto:hi@example.com)',
      '[d](tel:+15551234)',
      '[f](#section)',
      // Path-less: addresses this page, and has nothing to resolve. Recording
      // it as unresolvable would fail the build with advice — "use a path
      // relative to this file" — that cannot be followed.
      '[h](?tab=json)',
      // Absolute, but outside the base path: someone else's route.
      '[i](/login)',
    ].join('\n\n');
    const { urls, refs } = run(source, FROM_PAGE);

    expect(urls).toEqual([
      'https://example.com/x.md',
      '//cdn.example.com/x',
      'mailto:hi@example.com',
      'tel:+15551234',
      '#section',
      '?tab=json',
      '/login',
    ]);
    // None of them are documentation pages, so none are asserted against.
    expect(refs).toEqual([]);
  });

  /**
   * ⚠️ `/docs/api/auht` SHIPPED A 404 WITH A GREEN BUILD.
   *
   * An absolute internal link needs no rewriting, so it was never recorded and
   * therefore never asserted — while a typo in one is exactly as likely as a
   * typo in a relative link. Only the rewriting differs.
   */
  it('records an absolute link under the base path, so it can be asserted', () => {
    const { urls, refs } = run(
      '[a](/docs/api/auth) [b](/docs) [c](/docs/api/auth#bearer)',
      FROM_PAGE,
    );

    // Unchanged: it is already a route.
    expect(urls).toEqual(['/docs/api/auth', '/docs', '/docs/api/auth#bearer']);
    expect(refs.map((ref) => ref.href)).toEqual([
      '/docs/api/auth',
      '/docs',
      '/docs/api/auth#bearer',
    ]);
  });

  /*
   * Absolute links are compared against route keys, and `source.ts` spells those
   * with `encodeURIComponent` per segment. Recording the author's raw text made
   * the comparison spelling-sensitive, so the human-readable `/docs/café` —
   * what every editor and GitHub's own UI produce — failed the build with "no
   * such page exists" for a page that plainly exists.
   */
  it('respells an absolute link the way route keys are spelled', () => {
    const { urls, refs } = run(
      '[a](/docs/café) [b](/docs/caf%C3%A9) [c](/docs/api/../café)',
      FROM_PAGE,
    );

    // All three spellings collapse onto the one the source layer publishes —
    // in the emitted href as well as in the recorded ref, so the page ships a
    // canonically-encoded URL and a folded path rather than the author's.
    expect(urls).toEqual([
      '/docs/caf%C3%A9',
      '/docs/caf%C3%A9',
      '/docs/caf%C3%A9',
    ]);
    expect(refs.map((ref) => ref.href)).toEqual([
      '/docs/caf%C3%A9',
      '/docs/caf%C3%A9',
      '/docs/caf%C3%A9',
    ]);
  });

  it('reports a malformed escape in an absolute link with the file and line', () => {
    expect(() => run('[a](/docs/100%-faster)', FROM_PAGE)).toThrow(
      /whose percent-encoding is malformed/,
    );
  });

  it('records an absolute link at a root mount, marked as unverifiable', () => {
    /*
     * ⚠️ IT USED TO DROP THESE ON THE FLOOR, AND THAT WAS THE WHOLE PROBLEM.
     * With no prefix, `/login` cannot be proved to be a documentation route —
     * nor proved not to be — so the plugin recorded nothing and `assertLinks`
     * never saw it. A typo in an absolute link shipped.
     *
     * It is recorded and marked now. The plugin still refuses to guess; the
     * decision moves to `onUnverifiableLinks`, which the *site* answers,
     * because only the site knows whether it serves anything but documentation.
     */
    const { refs, urls } = run('[a](/login)', FROM_PAGE, { basePath: '' });

    expect(refs).toEqual([
      { raw: '/login', href: '/login', line: 1, unverifiable: true },
    ]);
    // Recorded, not rewritten: an absolute link is already a route.
    expect(urls).toEqual(['/login']);
  });

  it('leaves another origin alone at a root mount', () => {
    // `//host/x` is protocol-relative — somebody else's site, never ours, and
    // the one absolute-looking form that must not be collected.
    const { refs } = run('[a](//cdn.example.com/x)', FROM_PAGE, {
      basePath: '',
    });

    expect(refs).toEqual([]);
  });

  /**
   * ⚠️ `./schema.json` MEANT TWO DIFFERENT FILES.
   *
   * Assets were returned untouched, so the browser resolved them against the
   * ROUTE: from `guide/index.md` that is `/docs/guide/schema.json`, from
   * `guide/setup.md` it is `/docs/guide/setup/schema.json` — from markdown that
   * previews identically in both places.
   */
  it('folds a relative asset link, and marks it as not a page', () => {
    const fromIndex = run('[s](./schema.json)', FROM_DIR_INDEX);
    const fromLeaf = run('[s](../assets/logo.svg)', FROM_PAGE);

    expect(fromIndex.urls).toEqual(['/docs/api/schema.json']);
    expect(fromLeaf.urls).toEqual(['/docs/assets/logo.svg']);
    // `asset: true` is what keeps `assertLinks` from checking a download
    // against the set of published routes, which it will never be a member of.
    expect(fromLeaf.refs).toEqual([
      {
        raw: '../assets/logo.svg',
        href: '/docs/assets/logo.svg',
        line: 1,
        asset: true,
      },
    ]);
  });

  it('resolves against the directory, not the route, for index pages', () => {
    // `api/index.md` and `api.md` share the route segments `['api']` but sit
    // in different directories — the whole reason dirSegments exists.
    //
    // This covered the BUILT-IN resolver, which is why the built-in was always
    // right. The custom-resolver equivalent below it is the one that was
    // missing, and the one the contract change exists for.
    const fromIndex = run('[a](./auth.md)', FROM_DIR_INDEX);
    const fromLeaf = run('[a](./auth.md)', FROM_DIR_PAGE);

    expect(fromIndex.urls).toEqual(['/docs/api/auth']);
    expect(fromLeaf.urls).toEqual(['/docs/auth']);
  });

  it('rewrites reference-style link definitions', () => {
    const { urls } = run(
      ['See [the guide][g].', '', '[g]: ../api/auth.md'].join('\n'),
      FROM_PAGE,
    );
    // The url lives on the `definition` node; the reference in the prose is a
    // `linkReference` with no url of its own.
    expect(urls).toEqual(['/docs/api/auth']);
  });

  it('records unresolvable links instead of throwing', () => {
    const { urls, refs } = run('[a](../../../outside.md)', FROM_PAGE);

    expect(refs).toEqual([
      { raw: '../../../outside.md', href: undefined, line: 1 },
    ]);
    // Left as authored: the caller decides whether a dead link fails the build.
    expect(urls).toEqual(['../../../outside.md']);
  });

  it('collects every resolved href with its source line', () => {
    const { refs } = run('intro\n\n[a](./install.md)\n', FROM_PAGE);
    expect(refs).toEqual([
      { raw: './install.md', href: '/docs/guide/install', line: 3 },
    ]);
  });

  /**
   * ⚠️ THE REGRESSION TEST FOR THE RESOLVER CONTRACT.
   *
   * A custom resolver used to receive route segments only. `api/index.md` and
   * `api.md` share the route `['api']`, so the two calls below were
   * INDISTINGUISHABLE — and `./auth.md` means `api/auth` from one and `auth`
   * from the other. No resolver could have told them apart, whatever it did.
   *
   * Reverting the argument to `context.segments` makes both expectations equal
   * and this fails on the second.
   */
  it('gives a custom resolver the directory, so a dir-index page resolves siblings correctly', () => {
    const resolve = (href: string, from: DocLinkContext): string =>
      `/x/${[...from.dirSegments, href.replace('./', '')].join('/')}`;

    const fromIndex = run('[a](./auth.md)', FROM_DIR_INDEX, {
      basePath: '/docs',
      resolve,
    });
    const fromPage = run('[a](./auth.md)', FROM_DIR_PAGE, {
      basePath: '/docs',
      resolve,
    });

    expect(fromIndex.urls).toEqual(['/x/api/auth.md']);
    expect(fromPage.urls).toEqual(['/x/auth.md']);
  });

  it('gives a custom resolver the source path, for its own error messages', () => {
    const { urls } = run('[a](./auth.md)', FROM_DIR_INDEX, {
      basePath: '/docs',
      resolve: (_href, from) => `/x/${from.relativePath}`,
    });

    expect(urls).toEqual(['/x/api/index.md']);
  });

  it('honours a custom LinkResolver for every relative link', () => {
    const { urls, refs } = run(
      '[a](./install.md) [b](../assets/logo.svg)',
      FROM_PAGE,
      {
        basePath: '/docs',
        resolve: (href, from) =>
          href.endsWith('.md') ? `/x/${from.segments.join('-')}` : undefined,
      },
    );

    expect(urls).toEqual(['/x/guide-setup', '../assets/logo.svg']);
    expect(refs.map((ref) => ref.href)).toEqual(['/x/guide-setup', undefined]);
  });

  it('throws when the document context is missing', () => {
    const processor = unified().use(remarkParse).use(remarkDocLinks, {
      basePath: '/docs',
    });
    const file = new VFile({ value: '[a](./b.md)', path: 'broken.md' });

    expect(() => processor.runSync(processor.parse(file), file)).toThrow(
      /docLinkContext.*broken\.md/s,
    );
  });

  /**
   * ⚠️ A `definition` CANNOT TELL YOU WHAT REFERS TO IT.
   *
   * `[l]: ./logo.png` is a link target for `[text][l]` and an image source for
   * `![alt][l]`, and the node is identical. Handed to a custom resolver it
   * either failed the build with a message about a link that is not a link, or
   * silently rewrote the image `src` to a page route — which nothing downstream
   * can undo, because the leading `/` makes the image folder pass it straight
   * through and the `imageResolver` never sees it.
   */
  it('leaves a definition that an image reference points at', () => {
    const { urls, refs } = run(
      ['![logo][l]', '', '[l]: ./logo.png'].join('\n'),
      FROM_PAGE,
      { basePath: '/docs', resolve: (href) => `/x/${href}` },
    );

    expect(urls).toEqual(['./logo.png']);
    expect(refs).toEqual([]);
  });

  it('still resolves a definition used only as a link', () => {
    const { urls } = run(
      ['[the guide][l]', '', '[l]: ./install.md'].join('\n'),
      FROM_PAGE,
    );
    expect(urls).toEqual(['/docs/guide/install']);
  });

  /**
   * ⚠️ `[gs](./getting%20started.md)` IS WHAT GITHUB'S UI WRITES for a file
   * with a space in its name — and without decoding, the segment stayed
   * `getting%20started`, matched no page, and hard-failed the build on a link
   * GitHub renders correctly.
   *
   * Re-encoding on the way out is the other half: `source.ts` spells every
   * published href with `encodeURIComponent`, and `assertLinks` compares the
   * two strings.
   */
  it('decodes a percent-encoded link and re-encodes the route', () => {
    const { urls } = run(
      // The angle-bracket form is how CommonMark spells a literal space in a
      // destination; both must land on the same route.
      '[a](./getting%20started.md) [b](<./getting started.md>)',
      FROM_PAGE,
    );

    expect(urls).toEqual([
      '/docs/guide/getting%20started',
      '/docs/guide/getting%20started',
    ]);
  });

  it('decodes before folding, so an encoded `..` is still contained', () => {
    const { refs } = run('[a](%2E%2E/%2E%2E/outside.md)', FROM_PAGE);
    expect(refs.map((ref) => ref.href)).toEqual([undefined]);
  });

  it('names the document when a link is not valid percent-encoding', () => {
    expect(() => run('intro\n\n[a](./100%-faster.md)\n', FROM_PAGE)).toThrow(
      /guide\/setup\.md:3 links to '\.\/100%-faster\.md'.*percent-encoding/s,
    );
  });

  it('handles an empty base path', () => {
    expect(resolveMarkdownLink('./b.md', ['a'], '')).toBe('/a/b');
    expect(resolveMarkdownLink('./index.md', [], '')).toBe('/');
    expect(resolveMarkdownLink('./index.md', [], '/docs/')).toBe('/docs');
  });
});
