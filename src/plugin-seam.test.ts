/**
 * The consumer plugin seam, and the invariant that made its position a design
 * decision rather than an ordering detail.
 *
 * Before this existed, `buildProcessor` was a frozen pipeline with no entry
 * point, and both apparent escape hatches are provably useless: `frozen.use()`
 * throws, and `frozen().use(p)` *appends* — so a plugin would run after Shiki
 * and see several hundred token spans where the author's code used to be.
 *
 * The interesting assertions here are not "the plugin ran". They are that a
 * plugin cannot put the table of contents and the search index out of step,
 * which is what moving the TOC capture to dead last buys.
 */

import type { Element, Root } from 'hast';
import type { Root as MdastRoot } from 'mdast';
import type { Plugin, PluggableList } from 'unified';
import { visit } from 'unist-util-visit';
import { describe, expect, it } from 'vitest';

import { createDocsRenderer } from './render.js';
import { extractSearchRecords } from './search-index.js';
import type { DocFile, RenderedDoc } from './types.js';

function makeDoc(content: string): DocFile {
  return {
    segments: ['guide'],
    slug: 'guide',
    href: '/docs/guide',
    filePath: '/content/guide.md',
    relativePath: 'guide.md',
    frontmatter: { title: 'Guide' },
    content,
  };
}

interface Hooks {
  remarkPlugins?: PluggableList;
  rehypePlugins?: PluggableList;
}

async function render(
  content: string,
  hooks: Hooks = {},
): Promise<RenderedDoc> {
  const renderer = createDocsRenderer({
    config: {
      basePath: '/docs',
      onBrokenLinks: 'ignore',
      onBrokenAnchors: 'throw',
      externalRoutes: [],
    },
    excludeLangs: ['mermaid'],
    titleHeading: false,
    ...hooks,
  });
  return renderer.render(makeDoc(content));
}

/** Every anchor the TOC points at, flattened. */
function tocIds(doc: RenderedDoc): string[] {
  const out: string[] = [];
  const walk = (entries: RenderedDoc['toc']): void => {
    for (const entry of entries) {
      out.push(entry.id);
      walk(entry.children);
    }
  };
  walk(doc.toc);
  return out;
}

/** Every anchor the search index deep-links to, in the same shape. */
function searchAnchors(doc: RenderedDoc): string[] {
  return extractSearchRecords(doc)
    .map((record) => record.id.split('#')[1])
    .filter((anchor): anchor is string => anchor !== undefined);
}

const SOURCE = [
  '## Section A',
  '',
  'Prose.',
  '',
  '## Section B',
  '',
  'More.',
].join('\n');

describe('the plugin seam', () => {
  it('runs a remark plugin, with links still authored markdown', async () => {
    /*
     * The position's whole value: what a plugin emits is indistinguishable
     * from what an author wrote, so it is folded, contained and asserted the
     * same way. Nothing about link resolution has to know plugins exist.
     */
    const addLink: Plugin<[], MdastRoot> = () => (tree: MdastRoot) => {
      tree.children.push({
        type: 'paragraph',
        children: [
          {
            type: 'link',
            url: './other.md',
            children: [{ type: 'text', value: 'other' }],
          },
        ],
      });
    };

    const doc = await render('# Title', { remarkPlugins: [addLink] });
    const hrefs: string[] = [];
    visit(doc.hast, 'element', (node: Element) => {
      if (node.tagName === 'a' && typeof node.properties.href === 'string') {
        hrefs.push(node.properties.href);
      }
    });

    // Resolved against the document, exactly as `[other](./other.md)` would be.
    expect(hrefs).toContain('/docs/other');
  }, 20_000);

  it('throws on an image a plugin emits without a resolver', async () => {
    // The containment half. A relative image has no correct output without a
    // resolver, and that stays true when a plugin is what wrote it.
    const addImage: Plugin<[], MdastRoot> = () => (tree: MdastRoot) => {
      tree.children.push({
        type: 'paragraph',
        children: [{ type: 'image', url: './x.png', alt: 'x' }],
      });
    };

    await expect(
      render('# Title', { remarkPlugins: [addImage] }),
    ).rejects.toMatchObject({ code: 'invalid-image' });
  }, 20_000);

  it('gives a rehype plugin the fence before Shiki touches it', async () => {
    /*
     * The reason there is no after-Shiki slot. Here a plugin can still read
     * `language-ts` and the author's own text; afterwards it would be reading
     * token spans, and the fence language is destroyed in Node with no
     * client-side recovery.
     */
    const seen: string[] = [];
    const inspect: Plugin<[], Root> = () => (tree: Root) => {
      visit(tree, 'element', (node) => {
        if (node.tagName !== 'pre' && node.tagName !== 'code') return;
        const classes = node.properties.className;
        if (Array.isArray(classes)) seen.push(...classes.map(String));
      });
    };

    await render('```ts\nconst a = 1;\n```\n\n```mermaid\ngraph TD;\n```', {
      rehypePlugins: [inspect],
    });

    expect(seen).toContain('language-ts');
    // Excluded fences are not disguised yet either, so a plugin sees every
    // code block the same way regardless of `excludeLangs`.
    expect(seen).toContain('language-mermaid');
  }, 20_000);

  describe('the table of contents and the search index cannot disagree', () => {
    it('agree on the untouched document', async () => {
      const doc = await render(SOURCE);

      expect(tocIds(doc)).toEqual(['section-a', 'section-b']);
      expect(searchAnchors(doc)).toEqual(tocIds(doc));
    }, 20_000);

    it('agree when a plugin deletes a heading id', async () => {
      /*
       * Captured before the hook, this left `toc = ['section-a']` pointing at
       * an id no longer in the DOM, while `extractSearchRecords` silently
       * dropped that section — a TOC link that scrolls nowhere, and a page
       * section that cannot be found. Measured, in that order, before the
       * capture moved.
       */
      const strip: Plugin<[], Root> = () => (tree: Root) => {
        visit(tree, 'element', (node) => {
          if (node.properties.id === 'section-a') delete node.properties.id;
        });
      };

      const doc = await render(SOURCE, { rehypePlugins: [strip] });

      expect(tocIds(doc)).not.toContain('section-a');
      expect(searchAnchors(doc)).toEqual(tocIds(doc));
    }, 20_000);

    it('agree when a plugin adds a heading', async () => {
      // The other direction: a search record for `#added` with no TOC entry.
      const add: Plugin<[], Root> = () => (tree: Root) => {
        tree.children.push({
          type: 'element',
          tagName: 'h2',
          properties: { id: 'added' },
          children: [{ type: 'text', value: 'Added' }],
        });
      };

      const doc = await render(SOURCE, { rehypePlugins: [add] });

      expect(tocIds(doc)).toContain('added');
      expect(searchAnchors(doc)).toEqual(tocIds(doc));
    }, 20_000);

    it('agree when a plugin nests a root, as Shiki does', async () => {
      /*
       * Legal only because `rehypeFlattenRoots` repairs it — and it is exactly
       * what Shiki does, so it is not a hypothetical. Captured immediately
       * after the hook this gave `toc = []` against two search anchors,
       * because the headings were inside a node the walk did not descend into.
       */
      const nest: Plugin<[], Root> = () => (tree: Root) => {
        const children = tree.children.splice(0, tree.children.length);
        tree.children.push({ type: 'root', children } as never);
      };

      const doc = await render(SOURCE, { rehypePlugins: [nest] });

      expect(tocIds(doc)).toEqual(['section-a', 'section-b']);
      expect(searchAnchors(doc)).toEqual(tocIds(doc));
    }, 20_000);
  });

  it('captures heading text without the permalink it now runs after', async () => {
    /*
     * The capture used to precede `rehypeAutolinkHeadings`, so its
     * anchor-stripping filter had nothing to strip and was insurance. It runs
     * after now, so the filter is the only thing between every TOC entry and a
     * trailing `#`.
     */
    const doc = await render(SOURCE);

    expect(doc.toc.map((entry) => entry.text)).toEqual([
      'Section A',
      'Section B',
    ]);
  }, 20_000);
});
