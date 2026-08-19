/**
 * The code frame, measured through the real pipeline rather than against a
 * hand-built tree.
 *
 * That distinction is the point here more than usual. This plugin's whole
 * correctness claim is about its *position* — after the step that folds the
 * language and disguises excluded fences, before the step that destroys
 * `code.data.meta` — and a unit test that hands it a fabricated `<pre>` proves
 * nothing about any of that.
 */

import type { Element, Root } from 'hast';
import { toString as toText } from 'hast-util-to-string';
import { visit } from 'unist-util-visit';
import { beforeAll, describe, expect, it } from 'vitest';

import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

import { CODE_FRAME_ATTRIBUTE, hasCodeFrame } from '../code-frame.js';
import { rehypeCodeFrame } from './rehype-code-frame.js';
import { rehypeNormalizeCodeLanguage } from './rehype-code-language.js';
import { createDocsRenderer } from '../render.js';
import type { DocFile, RenderedDoc } from '../types.js';

function makeDoc(content: string, relativePath = 'guide/code.md'): DocFile {
  const segments = relativePath.replace(/\.mdx?$/, '').split('/');
  return {
    segments,
    slug: segments.join('/'),
    href: `/docs/${segments.join('/')}`,
    filePath: `/content/${relativePath}`,
    relativePath,
    frontmatter: { title: 'Code' },
    content,
  };
}

/**
 * The pipeline up to and including the frame, without Shiki.
 *
 * The only way to observe `code.data.meta` at all: Shiki replaces the
 * `<pre><code>` subtree, and `data` goes with it.
 */
async function runToFrame(content: string): Promise<Root> {
  const processor = unified()
    .use(remarkParse)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeNormalizeCodeLanguage, { exclude: ['mermaid'] })
    .use(rehypeCodeFrame);

  return processor.run(processor.parse(content)) as Promise<Root>;
}

async function render(content: string): Promise<RenderedDoc> {
  const renderer = createDocsRenderer({
    config: {
      basePath: '/docs',
      onBrokenLinks: 'ignore',
      onUnverifiableLinks: 'ignore',
    },
    excludeLangs: ['mermaid'],
  });
  return renderer.render(makeDoc(content));
}

function findAll(tree: Root | Element, tagName: string): Element[] {
  const found: Element[] = [];
  visit(tree, 'element', (node) => {
    if (node.tagName === tagName) found.push(node);
  });
  return found;
}

function figures(tree: Root): Element[] {
  return findAll(tree, 'figure');
}

/**
 * A node's classes, however they are spelled.
 *
 * ⚠️ SHIKI WRITES `properties.class`, A STRING — not `properties.className`,
 * the array every other plugin in this pipeline uses. Reading only `className`
 * makes "is this block highlighted?" answer *no* for every highlighted block,
 * so a test filtering on it silently inverts and then passes against the
 * wrong set.
 */
function classesOf(node: Element): string {
  const { class: cls, className } = node.properties;
  return [cls, className].flat().filter(Boolean).join(' ');
}

function isHighlighted(node: Element): boolean {
  return classesOf(node).includes('shiki');
}

describe('rehypeCodeFrame', () => {
  let doc: RenderedDoc;

  beforeAll(async () => {
    doc = await render(
      [
        '```ts title="app/page.tsx"',
        'const a = 1;',
        '```',
        '',
        '```JSON',
        '{ "a": 1 }',
        '```',
        '',
        '```mermaid',
        'graph TD;',
        '```',
        '',
        '```',
        'a bare fence',
        '```',
      ].join('\n'),
    );
  }, 20_000);

  it('frames every fence Shiki highlighted, and only those', () => {
    const framed = figures(doc.hast);

    // Three: the titled `ts`, the `JSON`, and the bare fence. The `mermaid`
    // one is excluded, and `render.ts` promises it reaches the consumer's
    // component untouched.
    expect(framed).toHaveLength(3);
    for (const figure of framed) {
      expect(figure.properties[CODE_FRAME_ATTRIBUTE]).toBe('');
      expect(findAll(figure, 'pre')).toHaveLength(1);
      expect(findAll(figure, 'button')).toHaveLength(1);
    }

    expect(findAll(doc.hast, 'pre').filter(isHighlighted)).toHaveLength(3);
  });

  it('leaves an excluded fence unwrapped', () => {
    /*
     * The `excludeLangs` contract is that the `<pre>` reaches your component
     * untouched. A copy button around a rendered Mermaid diagram copies the
     * diagram's source, which is not what the reader clicked, and the wrapper
     * would break the one promise the option makes.
     */
    const bare = findAll(doc.hast, 'pre').filter(
      (node) => !isHighlighted(node),
    );

    expect(bare).toHaveLength(1);
    expect(toText(bare[0] as Element)).toContain('graph TD;');

    for (const figure of figures(doc.hast)) {
      expect(toText(figure)).not.toContain('graph TD;');
    }
  });

  it('puts the fence title in a figcaption and in the button name', () => {
    const titled = figures(doc.hast).find(
      (figure) => findAll(figure, 'figcaption').length > 0,
    );
    if (titled === undefined) throw new Error('expected a titled figure');

    expect(toText(findAll(titled, 'figcaption')[0] as Element)).toBe(
      'app/page.tsx',
    );
    // Eight code blocks on a page all called "Copy code" is eight identical
    // entries in a screen reader's control list.
    expect(findAll(titled, 'button')[0]?.properties['aria-label']).toBe(
      'Copy code from app/page.tsx',
    );
  });

  it('falls back to a plain name where there is no title', () => {
    const untitled = figures(doc.hast).filter(
      (figure) => findAll(figure, 'figcaption').length === 0,
    );

    expect(untitled).toHaveLength(2);
    for (const figure of untitled) {
      expect(findAll(figure, 'button')[0]?.properties['aria-label']).toBe(
        'Copy code',
      );
    }
  });

  it('puts the button before the code, so Tab reaches it first', () => {
    const [figure] = figures(doc.hast);
    if (figure === undefined) throw new Error('expected a figure');

    const tags = figure.children
      .filter((child): child is Element => child.type === 'element')
      .map((child) => child.tagName);

    // Reversed, a keyboard reader tabs into the scrollable code region and
    // out of it again before ever meeting the control that copies it.
    expect(tags.indexOf('button')).toBeLessThan(tags.indexOf('pre'));
  });

  it('carries the folded language, and none for a bare fence', () => {
    /*
     * ` ```JSON ` yields `json`, because step 12 folds the class before this
     * runs. A consumer writing `[data-lang="JSON"]` would otherwise get a
     * selector that silently never matches — and their fence is spelled that
     * way in their editor and on GitHub.
     */
    const langs = figures(doc.hast).map(
      (figure) => figure.properties['data-lang'],
    );

    expect(langs).toContain('ts');
    expect(langs).toContain('json');
    expect(langs).not.toContain('JSON');
    // A bare fence declares nothing, so the attribute is absent rather than
    // `"text"` — which keeps a published badge rule free of an exception.
    expect(langs).toContain(undefined);
  });

  it('splices no nested root into the tree', async () => {
    /*
     * `rehypeFlattenRoots` exists because Shiki splices a `root` node in where
     * the `<pre>` was. This plugin is the first thing to put that `root`
     * inside an *element* rather than at the top level, so "flatten recurses
     * into element children" stopped being defensive and became load-bearing
     * the day this landed.
     */
    let nested = 0;
    visit(doc.hast, (node) => {
      if (node.type === 'root' && node !== doc.hast) nested += 1;
    });

    expect(nested).toBe(0);
  });

  it('reports a frame to DocContent only when there is one', async () => {
    // A page with no fences must ship zero extra client bytes, not a runtime
    // that mounts and finds nothing to do.
    expect(hasCodeFrame(doc.hast)).toBe(true);
    expect(hasCodeFrame((await render('Just prose.')).hast)).toBe(false);
    expect(
      hasCodeFrame((await render('```mermaid\ngraph TD;\n```')).hast),
    ).toBe(false);
  }, 20_000);

  it('fails the build on a title it cannot read, naming the document', async () => {
    await expect(
      render('```ts title=app/page.tsx\nconst a = 1;\n```'),
    ).rejects.toMatchObject({ code: 'invalid-code-meta' });

    await expect(
      render('```ts title=app/page.tsx\nconst a = 1;\n```'),
    ).rejects.toThrow(/guide\/code\.md/);
  }, 20_000);

  it('leaves the rest of the meta string for Shiki', async () => {
    /*
     * The assertion that parsing did not *consume* what it read. Shiki
     * forwards the raw meta to its own transformers, which is how `{1,3-5}`
     * and `showLineNumbers` will work when they land — and a parser that
     * stripped what it recognised would disable every feature it had not been
     * taught about yet, with nothing about the caption looking wrong.
     *
     * Asserted against the tree BEFORE Shiki, because Shiki replaces the
     * `<pre><code>` subtree wholesale and `code.data` does not survive it.
     * There is nothing to read on the far side.
     */
    const before = await runToFrame(
      '```ts title="a.ts" {1,3-5} showLineNumbers\nconst a = 1;\n```',
    );
    const code = findAll(before, 'code')[0];

    expect(toText(findAll(before, 'figcaption')[0] as Element)).toBe('a.ts');
    expect((code?.data as { meta?: string } | undefined)?.meta).toBe(
      'title="a.ts" {1,3-5} showLineNumbers',
    );
  });
});
