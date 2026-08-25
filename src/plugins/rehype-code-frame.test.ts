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

import { CODE_FRAME_CLASSES } from '../__fixtures__/code/frame-markup.js';
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
      onBrokenAnchors: 'throw',
      externalRoutes: [],
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

    /*
     * ⚠️ DOCUMENT ORDER, NOT DIRECT CHILDREN — and this test asserted the
     * latter until the `<pre>` moved inside `.wave-docs-panel__body`. It went
     * on comparing `indexOf('button')` to `indexOf('pre')` on a list that no
     * longer had a `pre` in it: `-1`, which is less than everything, so the
     * assertion passed for the one reason it must never pass. Tab order is a
     * property of the whole subtree, so the check has to read the whole
     * subtree.
     */
    const order: string[] = [];
    visit(figure, 'element', (node: Element) => {
      order.push(node.tagName);
    });

    expect(order).toContain('pre');
    // Reversed, a keyboard reader tabs into the scrollable code region and
    // out of it again before ever meeting the control that copies it.
    expect(order.indexOf('button')).toBeLessThan(order.indexOf('pre'));
  });

  it('wears the panel, with the code on its inset surface', () => {
    /*
     * The frame is a `.wave-docs-panel` and the code sits on that panel's
     * surface, which is what lets one set of rules dress this and "where to go
     * next" — and, next, a table.
     *
     * ⚠️ THE CLASSES COME FROM THE FIXTURE THE BROWSER TIER MOUNTS. Spelled
     * out again here, a rename would leave `code.browser.test.tsx` measuring a
     * shape the pipeline stopped emitting, with every assertion in it still
     * green.
     */
    for (const figure of figures(doc.hast)) {
      expect(figure.properties.className).toEqual([
        ...CODE_FRAME_CLASSES.figure,
      ]);

      const surface = findAll(figure, 'div').find((node) =>
        Array.isArray(node.properties.className),
      );
      expect(surface?.properties.className).toEqual([
        ...CODE_FRAME_CLASSES.body,
      ]);
      // The `<pre>` is *inside* the surface: one box clips to the frame's
      // radius, the other scrolls a wide line, and neither can do both.
      expect(findAll(surface as Element, 'pre')).toHaveLength(1);
    }
  });

  it('gives an untitled fence no label at all', () => {
    /*
     * ⚠️ A TITLE IS WHAT DECIDES WHETHER THE BLOCK HAS A FRAME, AND THE
     * LANGUAGE IS NOT A LABEL FOR THAT PURPOSE.
     *
     * An untitled fence briefly carried a language badge in the header band —
     * `md`, `json`. But a fence that declares `ts` and no filename is still an
     * untitled fence, and giving it a band to hold a two-letter badge is the
     * empty-header problem with a word in it. The stylesheet flattens the frame
     * away instead, and the copy button sits on the code.
     */
    for (const figure of figures(doc.hast)) {
      const captions = findAll(figure, 'figcaption');
      if (captions.length > 0) continue;

      // A button and a surface, and nothing else with text in it.
      const spans = findAll(figure, 'span').filter(
        (node) =>
          Array.isArray(node.properties.className) &&
          node.properties.className.some(
            (name) => typeof name === 'string' && name.startsWith('wave-docs-'),
          ),
      );
      expect(spans).toHaveLength(0);
      // The language is still on the figure, for anyone selecting on it.
      expect(figure.properties['data-lang']).not.toBe('');
    }
  });

  it('gives a titled fence its filename, and the language only as data', () => {
    const titled = figures(doc.hast).find(
      (figure) => findAll(figure, 'figcaption').length > 0,
    );
    if (titled === undefined) throw new Error('expected a titled figure');

    expect(toText(findAll(titled, 'figcaption')[0] as Element)).toBe(
      'app/page.tsx',
    );
    // `app/page.tsx` beside a `ts` badge is the same fact twice, and the
    // filename is the more precise half.
    expect(titled.properties['data-lang']).toBe('ts');
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
