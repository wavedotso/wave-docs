import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Element, Root } from 'hast';
import { toString as toText } from 'hast-util-to-string';
import { visit } from 'unist-util-visit';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDocsRenderer } from './render.js';
import type { DocFile, RenderedDoc, TocEntry } from './types.js';

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '__fixtures__',
  'pipeline',
);

const KNOWN_ROUTES = new Set([
  '/docs/api/auth',
  '/docs/api/users',
  '/docs/guide/changelog',
  '/docs/guide/getting-started',
]);

async function readFixture(relativePath: string): Promise<DocFile> {
  const filePath = path.join(FIXTURES, relativePath);
  const content = await readFile(filePath, 'utf8');
  return makeDoc(content, relativePath, filePath);
}

function makeDoc(
  content: string,
  relativePath = 'guide/getting-started.md',
  filePath = path.join(FIXTURES, relativePath),
): DocFile {
  const segments = relativePath.replace(/\.mdx?$/, '').split('/');
  return {
    segments,
    slug: segments.join('/'),
    href: `/docs/${segments.join('/')}`,
    filePath,
    relativePath,
    frontmatter: { title: 'Getting started' },
    content,
  };
}

function findAll(tree: Root, tagName: string): Element[] {
  const found: Element[] = [];
  visit(tree, 'element', (node) => {
    if (node.tagName === tagName) {
      found.push(node);
    }
  });
  return found;
}

/** Every heading id in document order, straight off the rendered tree. */
function headingIds(tree: Root): string[] {
  const ids: string[] = [];
  visit(tree, 'element', (node) => {
    if (
      /^h[1-6]$/.test(node.tagName) &&
      typeof node.properties.id === 'string'
    ) {
      ids.push(node.properties.id);
    }
  });
  return ids;
}

function flattenToc(entries: readonly TocEntry[]): TocEntry[] {
  return entries.flatMap((entry) => [entry, ...flattenToc(entry.children)]);
}

/** Does any element of `tagName` contain an `<img>`? */
function hasImageInside(tree: Root, tagName: string): boolean {
  let found = false;
  visit(tree, 'element', (node) => {
    if (node.tagName !== tagName) {
      return;
    }
    visit(node, 'element', (inner) => {
      if (inner.tagName === 'img') {
        found = true;
      }
    });
  });
  return found;
}

describe('createDocsRenderer', () => {
  let doc: RenderedDoc;

  beforeAll(async () => {
    const renderer = createDocsRenderer({
      config: { basePath: '/docs', assertLinks: true },
      knownRoutes: KNOWN_ROUTES,
    });
    doc = await renderer.render(await readFixture('guide/getting-started.md'));
  }, 20_000);

  it('nests the table of contents and skips h1', () => {
    expect(doc.toc.map((entry) => entry.text)).toEqual([
      'Install',
      'Usage',
      'Usage',
    ]);
    const [, , secondUsage] = doc.toc;
    expect(secondUsage?.children.map((entry) => entry.text)).toEqual([
      'Options',
    ]);
    // h4 nests under the h3 that precedes it, not the h2.
    expect(
      secondUsage?.children[0]?.children.map((entry) => entry.text),
    ).toEqual(['Deeply nested']);
    expect(doc.toc.every((entry) => entry.depth === 2)).toBe(true);
  });

  it('gives duplicate headings ids that match their anchors exactly', () => {
    const ids = flattenToc(doc.toc).map((entry) => entry.id);
    expect(ids).toEqual([
      'install',
      'usage',
      'options',
      'usage-1',
      'options-1',
      'deeply-nested',
    ]);
    // The `-1` suffixes are where a second slugging pass drifts. Assert
    // against the tree, not against a recomputed slug.
    expect(headingIds(doc.hast)).toEqual(['getting-started', ...ids]);

    const anchors = findAll(doc.hast, 'a').filter((node) =>
      String(node.properties.href).startsWith('#'),
    );
    expect(anchors.map((node) => node.properties.href)).toEqual([
      '#getting-started',
      ...ids.map((id) => `#${id}`),
    ]);
    expect(anchors.every((node) => toText(node) === '#')).toBe(true);
    expect(anchors[0]?.properties.className).toEqual(['heading-anchor']);
  });

  it('excludes the permalink from the captured heading text', () => {
    expect(
      flattenToc(doc.toc).every((entry) => !entry.text.includes('#')),
    ).toBe(true);
  });

  it('rewrites internal links and leaves the rest alone', () => {
    const hrefs = findAll(doc.hast, 'a')
      .map((node) => node.properties.href)
      .filter((href): href is string => !String(href).startsWith('#'));

    expect(hrefs).toEqual([
      '/docs/api/auth',
      '/docs/api/users',
      '/docs/guide/changelog#v2',
      'https://example.com/spec',
      'mailto:hi@example.com',
      '../assets/logo.svg',
    ]);
  });

  it('turns a GitHub alert into a bare callout element', () => {
    const callouts = findAll(doc.hast, 'callout');
    expect(callouts).toHaveLength(1);
    const callout = callouts[0];
    expect(callout?.properties).toEqual({ type: 'warning' });
    expect(callout === undefined ? '' : toText(callout)).toContain(
      'cannot be undone',
    );
    // No octicons, no GitHub classes: the React layer owns the presentation.
    expect(findAll(doc.hast, 'svg')).toEqual([]);
    expect(findAll(doc.hast, 'blockquote')).toEqual([]);
  });

  it('highlights code blocks with Shiki', () => {
    const pre = findAll(doc.hast, 'pre')[0];
    expect(pre?.properties.class).toContain('shiki');
    // Dual themes are what emit the CSS variables the stylesheet switches on.
    expect(String(pre?.properties.style)).toContain('--shiki-dark');

    const tokens = findAll(doc.hast, 'span').filter((node) =>
      String(node.properties.style).includes('--shiki-dark'),
    );
    expect(tokens.length).toBeGreaterThan(1);
    expect(pre === undefined ? '' : toText(pre)).toContain(
      'npm install @waveso/docs',
    );
  });

  it('unwraps a lone image but leaves one that sits in prose', () => {
    const images = findAll(doc.hast, 'img');
    expect(images.map((node) => node.properties.alt)).toEqual([
      'Architecture',
      'icon',
    ]);
    // The lone image is a direct child of the root; the inline one is not.
    const roots = doc.hast.children.filter(
      (child): child is Element =>
        child.type === 'element' && child.tagName === 'img',
    );
    expect(roots).toHaveLength(1);
    expect(hasImageInside(doc.hast, 'p')).toBe(true);
  });

  it('resolves image sources and dimensions when a resolver is given', async () => {
    const renderer = createDocsRenderer({
      config: { basePath: '/docs', assertLinks: false },
      imageResolver: (src, from) => ({
        src: `/assets/${path.basename(src)}?from=${from.dirSegments.join('/')}`,
        width: 1200,
        height: 630,
      }),
    });
    const rendered = await renderer.render(
      makeDoc('![Architecture](../assets/architecture.png)\n'),
    );
    const [img] = findAll(rendered.hast, 'img');

    expect(img?.properties).toMatchObject({
      src: '/assets/architecture.png?from=guide',
      width: 1200,
      height: 630,
    });
  });

  /**
   * ⚠️ THE CONTAINMENT GAP, AND IT IS THE REASON THE ARGUMENT CHANGED SHAPE.
   *
   * `remarkDocLinks` visits `link` and `definition` and never `image`, so an
   * image src reached the resolver EXACTLY AS AUTHORED while every link on the
   * same page was folded and bounded by `foldSegments`. A resolver that joins
   * its argument onto a directory — which is the documented job — was therefore
   * reachable with `../../../../.env`.
   */
  it('folds an image src against the page directory before the resolver sees it', async () => {
    const seen: string[] = [];
    const renderer = createDocsRenderer({
      config: { basePath: '/docs', assertLinks: false },
      imageResolver: (src) => {
        seen.push(src);
        return { src: '/ok.png' };
      },
    });

    await renderer.render(makeDoc('![a](../assets/architecture.png)\n'));

    // From `guide/getting-started.md`, `../assets/…` folds to `assets/…`.
    expect(seen).toEqual(['assets/architecture.png']);
  });

  it('refuses an image src that climbs above the content root', async () => {
    const renderer = createDocsRenderer({
      config: { basePath: '/docs', assertLinks: false },
      imageResolver: (src) => ({ src }),
    });

    await expect(
      renderer.render(makeDoc('![a](../../../../.env)\n')),
    ).rejects.toThrow(/climbs above the content root/);
  });

  it('leaves an absolute or external image src alone', async () => {
    const seen: string[] = [];
    const renderer = createDocsRenderer({
      config: { basePath: '/docs', assertLinks: false },
      imageResolver: (src) => {
        seen.push(src);
        return undefined;
      },
    });

    await renderer.render(
      makeDoc('![a](/logo.png)\n\n![b](https://example.com/x.png)\n'),
    );

    expect(seen).toEqual(['/logo.png', 'https://example.com/x.png']);
  });

  it('does not pass raw HTML through', async () => {
    const renderer = createDocsRenderer({
      config: { basePath: '/docs', assertLinks: false },
    });
    const rendered = await renderer.render(
      makeDoc('<script>alert(1)</script>\n\nAfter.\n'),
    );

    expect(findAll(rendered.hast, 'script')).toEqual([]);
    expect(toText(rendered.hast)).not.toContain('alert(1)');
  });

  it('fails the build on a link to a page that does not exist', async () => {
    const renderer = createDocsRenderer({
      config: { basePath: '/docs', assertLinks: true },
      knownRoutes: KNOWN_ROUTES,
    });

    await expect(
      renderer.render(makeDoc('intro\n\n[gone](./removed.md)\n')),
    ).rejects.toThrow(
      /guide\/getting-started\.md:3 links to '\.\/removed\.md'.*\/docs\/guide\/removed/s,
    );
  });

  it('fails the build on a link that escapes the content root', async () => {
    const renderer = createDocsRenderer({
      config: { basePath: '/docs', assertLinks: true },
    });

    await expect(
      renderer.render(makeDoc('[out](../../elsewhere.md)\n')),
    ).rejects.toThrow(/does not resolve to a documentation page/);
  });

  it('carries frontmatter and identity through unchanged', () => {
    expect(doc.frontmatter).toEqual({ title: 'Getting started' });
    expect(doc.segments).toEqual(['guide', 'getting-started']);
    expect(doc.href).toBe('/docs/guide/getting-started');
    // The tree survives the RSC / virtual-module boundary as plain JSON.
    expect(JSON.parse(JSON.stringify(doc.hast))).toEqual(doc.hast);
  });

  it('reuses one processor across files', async () => {
    const renderer = createDocsRenderer({
      config: { basePath: '/docs', assertLinks: false },
    });
    const first = await renderer.render(makeDoc('## One\n'));
    const second = await renderer.render(makeDoc('## Two\n'));

    // Per-file state must not leak between renders through the shared vfile
    // data keys.
    expect(first.toc.map((entry) => entry.text)).toEqual(['One']);
    expect(second.toc.map((entry) => entry.text)).toEqual(['Two']);
  });
});
