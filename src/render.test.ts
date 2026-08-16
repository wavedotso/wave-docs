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

/** Is any `<needle>` nested inside a `<haystack>` anywhere in the tree? */
function hasNested(tree: Root, haystack: string, needle: string): boolean {
  let found = false;
  visit(tree, 'element', (node) => {
    if (node.tagName !== haystack) {
      return;
    }
    visit(node, 'element', (inner) => {
      if (inner.tagName === needle) {
        found = true;
      }
    });
  });
  return found;
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
      // A relative image src has no correct output without one of these, so
      // the fixture — which has two — cannot render without it.
      imageResolver: (src) => ({ src: `/${src}` }),
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
    expect(doc.toc.every((entry) => entry.depth === 2)).toBe(true);
  });

  it('stops at h3, and leaves everything deeper linkable anyway', () => {
    /*
     * The capture is capped at h2+h3 — measured on a synthetic API page, h2–h6
     * gave 104 entries and 6,797 bytes of flight payload against 32 and 2,321.
     * A rail with a hundred entries is the page again in a narrower column,
     * and every comparator caps here too.
     *
     * The second half is the justification for cutting at *capture* rather
     * than at render: an h4 keeps its id and its permalink, so it is still
     * deep-linkable and still opens its own section in the search index. The
     * entry is dropped; the heading is not.
     */
    expect(flattenToc(doc.toc).every((entry) => entry.depth <= 3)).toBe(true);
    expect(flattenToc(doc.toc).map((entry) => entry.text)).not.toContain(
      'Deeply nested',
    );

    expect(headingIds(doc.hast)).toContain('deeply-nested');
    const anchors = findAll(doc.hast, 'a').map((node) => node.properties.href);
    expect(anchors).toContain('#deeply-nested');
  });

  it('gives duplicate headings ids that match their anchors exactly', () => {
    const ids = flattenToc(doc.toc).map((entry) => entry.id);
    expect(ids).toEqual([
      'install',
      'usage',
      'options',
      'usage-1',
      'options-1',
    ]);
    /*
     * The `-1` suffixes are where a second slugging pass drifts. Assert
     * against the tree, not against a recomputed slug — and against the tree's
     * FULL heading list, which is a superset of the TOC now that the capture
     * caps at h3. That superset relationship is the guarantee: every id the
     * TOC names exists in the document, whether or not the document has
     * headings the TOC skipped.
     */
    const inDocument = headingIds(doc.hast);
    expect(inDocument[0]).toBe('getting-started');
    for (const id of ids) {
      expect(inDocument).toContain(id);
    }

    const anchors = findAll(doc.hast, 'a').filter((node) =>
      String(node.properties.href).startsWith('#'),
    );
    expect(anchors.map((node) => node.properties.href)).toEqual(
      inDocument.map((id) => `#${id}`),
    );
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
      // An asset is folded like everything else: left relative it would mean a
      // different file on every page that linked to it.
      '/docs/assets/logo.svg',
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

  /**
   * ⚠️ THE FOUR `!important`s IN `styles.css` WERE THIS.
   *
   * Without `defaultColor: false` every `<pre>` carries
   * `background-color:#fff;color:#24292e` INLINE, from whichever theme Shiki
   * calls the default. An inline style beats every rule that is not
   * `!important`, so the light theme's paper-white background was painted onto
   * code blocks in dark mode and no stylesheet — layered or otherwise — could
   * take it back.
   */
  it('leaves code-block colours to CSS, with no inline paint', () => {
    const style = String(findAll(doc.hast, 'pre')[0]?.properties.style);

    expect(style).toContain('--shiki-light');
    expect(style).toContain('--shiki-dark');
    expect(style).not.toMatch(/(^|;)\s*color:/);
    expect(style).not.toMatch(/(^|;)\s*background-color:/);
  });

  /**
   * ⚠️ ```JSON, ```Bash AND ```TSX SHIPPED MONOCHROME AND LOOKED FINE.
   *
   * `@shikijs/rehype` tests `getLoadedLanguages().includes(lang)` with no case
   * folding and this pipeline's `fallbackLanguage: 'text'` swallows the miss,
   * so the `<pre>` properties are IDENTICAL to a highlighted block — there is
   * nothing in the markup to grep for. Only a token count sees it.
   */
  it('highlights a fence whose language is capitalised', async () => {
    const renderer = createDocsRenderer({
      config: { basePath: '/docs', assertLinks: false },
    });

    const counts: Record<string, number> = {};
    for (const lang of ['ts', 'TS', 'JSON', 'Bash', 'TSX']) {
      const rendered = await renderer.render(
        makeDoc(`\`\`\`${lang}\nconst a = {b: 1};\n\`\`\`\n`),
      );
      counts[lang] = findAll(rendered.hast, 'span').filter((node) =>
        String(node.properties.style).includes('--shiki-dark'),
      ).length;
    }

    expect(Object.values(counts).every((count) => count > 1)).toBe(true);
    // Case is the only difference, so the token counts must match exactly.
    expect(counts.TS).toBe(counts.ts);
  });

  /**
   * The fence language is destroyed in Node, so there is no client-side
   * workaround: a `pre` override that cannot see it cannot add a language
   * badge, or label a copy button with the file type.
   */
  it('keeps the fence language on the highlighted code element', () => {
    const code = findAll(doc.hast, 'code')[0];
    expect(code?.properties.class).toContain('language-bash');
  });

  it('routes an excluded language past the highlighter untouched', async () => {
    const renderer = createDocsRenderer({
      config: { basePath: '/docs', assertLinks: false },
      excludeLangs: ['mermaid'],
    });

    const rendered = await renderer.render(
      makeDoc('```mermaid\ngraph TD;\n```\n'),
    );
    const [pre] = findAll(rendered.hast, 'pre');
    const [code] = findAll(rendered.hast, 'code');

    expect(String(pre?.properties.class ?? '')).not.toContain('shiki');
    expect(code?.properties.className).toEqual(['language-mermaid']);
    // The disguise the exclusion is built on must never reach the output.
    expect(JSON.stringify(rendered.hast)).not.toContain('excluded-pre');
  });

  /**
   * ⚠️ SHIKI ASSIGNS A `root` OVER THE `<pre>` — `parent.children[index] =
   * fragment` — so `hast.children.map(c => c.type)` read `['element','root']`
   * for any document with a code block. `RenderedDoc.hast` is published as
   * `Root`, `@types/hast` states `RootContent` has no `root` member, and
   * `types.ts` invites consumers to walk the tree: one written against the
   * declared type drops every code block on the floor.
   */
  it('never leaves a nested root in the tree', () => {
    const roots = JSON.stringify(doc.hast).match(/"type":"root"/g) ?? [];
    expect(roots).toHaveLength(1);
    // Widened through `{ type: string }` for the same reason the plugin's own
    // `isNestedRoot` does: comparing a `RootContent` against `'root'` is a
    // TS2367 "no overlap", because the declared type is what this repairs. The
    // assertion has to be able to express the bug to be able to pin it.
    const types: readonly { type: string }[] = doc.hast.children;
    expect(types.some((child) => child.type === 'root')).toBe(false);
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

  /**
   * ⚠️ THE ASSERTION THAT WOULD HAVE CAUGHT THE HYDRATION MISMATCH, and the
   * reason these tests are here rather than in `doc-content.test.tsx`.
   *
   * The old ones built an `<a>` at the hast root and checked the anchor
   * component swapped it — true, and blind to the only thing that mattered:
   * markdown wraps that link in a `<p>`, and the component returned a `<div>`.
   * `<p><div></div></p>` is invalid HTML, the browser's parser hoists the div,
   * and React 19 calls that a mismatch and re-renders the root.
   *
   * Going through the real pipeline from markdown is what makes the paragraph
   * exist to assert about.
   */
  it('lifts a bare YouTube link out of its paragraph', async () => {
    const renderer = createDocsRenderer({
      config: { basePath: '/docs', assertLinks: false },
    });

    const doc = await renderer.render(
      makeDoc('https://www.youtube.com/watch?v=dQw4w9WgXcQ\n'),
    );

    expect(findAll(doc.hast, 'youtube')).toHaveLength(1);
    expect(hasNested(doc.hast, 'p', 'youtube')).toBe(false);
  });

  it('accepts the youtu.be form', async () => {
    const renderer = createDocsRenderer({
      config: { basePath: '/docs', assertLinks: false },
    });

    const doc = await renderer.render(
      makeDoc('https://youtu.be/dQw4w9WgXcQ\n'),
    );
    const [video] = findAll(doc.hast, 'youtube');

    expect(video?.properties).toMatchObject({ id: 'dQw4w9WgXcQ' });
  });

  it('leaves a labelled YouTube link as a link', async () => {
    const renderer = createDocsRenderer({
      config: { basePath: '/docs', assertLinks: false },
    });

    const doc = await renderer.render(
      makeDoc('[the intro](https://youtu.be/dQw4w9WgXcQ)\n'),
    );

    expect(findAll(doc.hast, 'youtube')).toHaveLength(0);
    expect(findAll(doc.hast, 'a')).toHaveLength(1);
  });

  it('leaves a YouTube link with prose beside it alone', async () => {
    const renderer = createDocsRenderer({
      config: { basePath: '/docs', assertLinks: false },
    });

    const doc = await renderer.render(
      makeDoc('Watch https://youtu.be/dQw4w9WgXcQ for the setup.\n'),
    );

    expect(findAll(doc.hast, 'youtube')).toHaveLength(0);
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

  /**
   * ⚠️ THE CONTAINMENT CHECK WAS DEAD CODE IN THE DEFAULT CONFIGURATION.
   *
   * Folding was gated on `imageResolver` — the option nobody sets first — so
   * under the quickstart config nothing ever touched an `<img src>`. The throw
   * above never fired, and `assertLinks` could not cover for it either:
   * `remarkDocLinks` visits `link` and `definition`, never `image`.
   */
  it('contains a climbing image src with no resolver configured', async () => {
    const renderer = createDocsRenderer({
      config: { basePath: '/docs', assertLinks: true },
    });

    await expect(
      renderer.render(makeDoc('![a](../../../../.env)\n')),
    ).rejects.toThrow(/climbs above the content root/);
  });

  /**
   * The failure this replaces was silent: `![d](./diagram.png)` shipped
   * byte-for-byte as authored, and the BROWSER resolved it against the route —
   * `/docs/guide` asked for `/docs/diagram.png` while `/docs/guide/setup` asked
   * for `/docs/guide/diagram.png`, from identical markdown, with a green build.
   */
  it('refuses a relative image src when no imageResolver is configured', async () => {
    const renderer = createDocsRenderer({
      config: { basePath: '/docs', assertLinks: false },
    });

    await expect(
      renderer.render(makeDoc('![d](./diagram.png)\n')),
    ).rejects.toThrow(
      /image "\.\/diagram\.png" in guide\/getting-started\.md.*imageResolver/s,
    );
  });

  it('leaves absolute and external image srcs alone with no resolver', async () => {
    const renderer = createDocsRenderer({
      config: { basePath: '/docs', assertLinks: false },
    });

    const rendered = await renderer.render(
      makeDoc('![a](/logo.png)\n\n![b](https://example.com/x.png)\n'),
    );

    expect(findAll(rendered.hast, 'img').map((node) => node.properties.src)) //
      .toEqual(['/logo.png', 'https://example.com/x.png']);
  });

  it('keeps the fold when the resolver declines the image', async () => {
    const renderer = createDocsRenderer({
      config: { basePath: '/docs', assertLinks: false },
      imageResolver: () => undefined,
    });

    const rendered = await renderer.render(
      makeDoc('![a](../assets/architecture.png)\n'),
    );

    // Not `../assets/architecture.png`: "I have no public URL for this" is not
    // "put the author's `../` back".
    expect(findAll(rendered.hast, 'img')[0]?.properties.src).toBe(
      'assets/architecture.png',
    );
  });

  it('rejects a resolver result that is not a resolved image', async () => {
    const renderer = createDocsRenderer({
      config: { basePath: '/docs', assertLinks: false },
      // @ts-expect-error — a type stops at the JavaScript boundary, and a host
      // reading dimensions out of a manifest is exactly where this arrives.
      imageResolver: (src) => ({ src, width: '1200' }),
    });

    await expect(
      renderer.render(makeDoc('![a](../assets/architecture.png)\n')),
    ).rejects.toThrow(
      /non-numeric `width`.*architecture\.png" in guide\/getting-started\.md/s,
    );
  });

  it('names the document when the resolver itself throws', async () => {
    const renderer = createDocsRenderer({
      config: { basePath: '/docs', assertLinks: false },
      imageResolver: () => {
        throw new Error('ENOENT: no such file');
      },
    });

    const failure = renderer.render(
      makeDoc('![a](../assets/architecture.png)\n'),
    );

    await expect(failure).rejects.toThrow(/in guide\/getting-started\.md/);
    // The resolver's own diagnosis is the useful half; it must survive.
    await expect(failure).rejects.toMatchObject({
      cause: expect.objectContaining({ message: 'ENOENT: no such file' }),
    });
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

  /**
   * The generic message — "no such page exists, add an `aliases` entry" — is
   * advice that cannot be followed for a file plainly sitting on disk. Failing
   * the build is still right; the diagnosis was not.
   */
  it('blames drafts when a link points at an unpublished page', async () => {
    const renderer = createDocsRenderer({
      config: { basePath: '/docs', assertLinks: true },
      knownRoutes: KNOWN_ROUTES,
      draftRoutes: new Set(['/docs/guide/unreleased']),
    });

    const failure = renderer.render(makeDoc('[soon](./unreleased.md)\n'));

    await expect(failure).rejects.toThrow(/draft: true/);
    await expect(failure).rejects.toThrow(/includeDrafts/);
    await expect(failure).rejects.not.toThrow(/aliases/);
  });

  it('still adds the title heading when the only h1 is inside a callout', async () => {
    const renderer = createDocsRenderer({
      config: { basePath: '/docs', assertLinks: false },
    });

    const rendered = await renderer.render(
      makeDoc('> [!NOTE]\n> # Callout title\n'),
    );
    const [first] = rendered.hast.children;

    // A whole-tree scan found the callout's h1 and suppressed this one, so the
    // page title appeared nowhere in the body — the exact `page-has-heading-one`
    // failure `titleHeading` exists to prevent.
    expect(first?.type === 'element' && first.tagName).toBe('h1');
    expect(first?.type === 'element' ? toText(first) : '').toBe(
      'Getting started',
    );
  });

  /**
   * `github-slugger` strips emoji, so `## 🎉` slugs to `''` — and RECORDS the
   * empty slug as taken, so `## 🚀` below it became `-1` and the next `-2`.
   * Those ids move whenever an emoji heading is inserted above them.
   */
  it('gives headings that slug to nothing stable ids of their own', async () => {
    const renderer = createDocsRenderer({
      config: { basePath: '/docs', assertLinks: false },
    });

    const rendered = await renderer.render(
      makeDoc('## 🎉\n\n## 🚀\n\n## Section 1\n'),
    );

    expect(rendered.toc.map((entry) => entry.id)).toEqual([
      // `section-1` is taken by a heading that genuinely slugs to it, so the
      // fallbacks step over it rather than duplicating an id.
      'section-2',
      'section-3',
      'section-1',
    ]);
    // The prepended title heading carries no id, so these are all of them.
    expect(headingIds(rendered.hast)).toEqual([
      'section-2',
      'section-3',
      'section-1',
    ]);
  });

  /**
   * ⚠️ THE TOC AND THE SEARCH INDEX HAVE TO AGREE ABOUT WHAT A SECTION IS.
   *
   * `extractSearchRecords` opens a section only for a heading reached through
   * `isTransparentContainer`; the TOC walked the whole tree. A `## ` inside a
   * list item therefore got a TOC entry with no search record behind it, and
   * its prose folded into the section above under the wrong breadcrumb.
   * `callout` is in that set and `li` deliberately is not, so this is the pair
   * that separates the two rules.
   */
  it('captures a heading in a callout but not one inside a list item', async () => {
    const renderer = createDocsRenderer({
      config: { basePath: '/docs', assertLinks: false },
    });

    const rendered = await renderer.render(
      makeDoc('> [!NOTE]\n> ## In a callout\n\n- ## In a list item\n'),
    );

    expect(rendered.toc.map((entry) => entry.text)).toEqual(['In a callout']);
    // The heading is still IN the document with its id — it is addressable,
    // just not a section. Only the two indexes' agreement is at stake.
    expect(headingIds(rendered.hast)).toEqual([
      'in-a-callout',
      'in-a-list-item',
    ]);
  });

  it('carries frontmatter and identity through unchanged', () => {
    expect(doc.frontmatter).toEqual({ title: 'Getting started' });
    expect(doc.segments).toEqual(['guide', 'getting-started']);
    expect(doc.href).toBe('/docs/guide/getting-started');
    // The tree survives the RSC / virtual-module boundary as plain JSON.
    expect(JSON.parse(JSON.stringify(doc.hast))).toEqual(doc.hast);
  });

  /**
   * ⚠️ A TYPO IN CONFIG USED TO KILL THE BUILD WORKER.
   *
   * `createDocsHighlighter` validates synchronously, but the call sat inside an
   * async `buildProcessor` whose promise nobody was awaiting yet — so the throw
   * became a floating rejection, and an unhandled rejection terminates the
   * Next.js worker before a `try`/`catch` around the constructor OR around
   * `render()` can ever see it.
   */
  it('throws from the constructor on an unknown theme', () => {
    expect(() =>
      createDocsRenderer({
        config: { basePath: '/docs', assertLinks: false },
        // @ts-expect-error — the runtime check is there for JavaScript callers
        // and for names that arrive from JSON config, which is what this is.
        themes: { light: 'solarized-hot-pink', dark: 'github-dark' },
      }),
    ).toThrow(/unknown Shiki theme/);
  });

  it('surfaces a failing highlighter from render(), not as a floating rejection', async () => {
    const renderer = createDocsRenderer({
      config: { basePath: '/docs', assertLinks: false },
      highlighter: Promise.reject(new Error('grammar import failed')),
    });

    // The macrotask is the point: without the no-op `.catch`, Node reports the
    // rejection as unhandled in this gap and takes the process with it.
    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(renderer.render(makeDoc('hi\n'))).rejects.toThrow(
      'grammar import failed',
    );
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
