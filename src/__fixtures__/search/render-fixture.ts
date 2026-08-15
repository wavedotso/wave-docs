/**
 * Renders `guide.md` the way the real pipeline does, for search tests.
 *
 * Tests here need a tree with genuine `rehype-slug` ids (including a `-1`
 * collision suffix) and genuine Shiki-shaped code blocks; hand-writing hast
 * would let the assertions agree with a fiction. This deliberately does not
 * import `src/render.ts` — the search extractor should be provable against
 * the hast contract alone.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Element, ElementContent, Root } from 'hast';
import {
  type DefaultBuildType,
  rehypeGithubAlerts,
} from 'rehype-github-alerts';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import type { RenderedDoc } from '../../types.js';

const FIXTURE_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Stand-in for `@shikijs/rehype`: rewrites every `pre > code` into the
 * `span.line` / `span` token soup Shiki emits, which is precisely the shape
 * the extractor has to refuse to index.
 */
function rehypeFakeShiki(): (tree: Root) => undefined {
  return (tree) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'pre') return;
      const lines = elementText(node).split('\n');
      node.properties = { ...node.properties, className: ['shiki'] };
      node.children = [
        {
          type: 'element',
          tagName: 'code',
          properties: {},
          children: lines.map((line) => ({
            type: 'element' as const,
            tagName: 'span',
            properties: { className: ['line'] },
            children: line
              .split(/(\s+)/)
              .filter((token) => token !== '')
              .map((token) => ({
                type: 'element' as const,
                tagName: 'span',
                properties: { style: 'color:#79C0FF' },
                children: [{ type: 'text' as const, value: token }],
              })),
          })),
        },
      ];
    });
    return undefined;
  };
}

/**
 * The same `<callout>` element `src/render.ts` builds, rather than
 * `rehype-github-alerts`' default octicon-and-CSS-class markup.
 *
 * Copied instead of imported for the reason above: the extractor is proved
 * against the hast contract, and a `> [!NOTE]` wrapping a heading is part of
 * that contract — the heading is real, it gets a real id, and it has to open a
 * real section.
 */
const buildCallout: DefaultBuildType = (alert, children): Element => ({
  type: 'element',
  tagName: 'callout',
  properties: { type: alert.keyword.toLowerCase() },
  children,
});

function elementText(node: ElementContent): string {
  if (node.type === 'text') return node.value;
  if (node.type !== 'element') return '';
  return node.children.map(elementText).join('');
}

/** The rendered fixture document, mounted at `/docs/api/auth`. */
export async function renderFixtureDoc(): Promise<RenderedDoc> {
  const source = await readFile(path.join(FIXTURE_DIR, 'guide.md'), 'utf8');
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    // Before slugging, as in the real pipeline, so a heading inside a callout
    // is slugged in its final position.
    .use(rehypeGithubAlerts, { build: buildCallout })
    .use(rehypeSlug)
    .use(rehypeFakeShiki);
  const hast = await processor.run(processor.parse(source));

  return {
    frontmatter: {
      title: 'Authentication',
      description: 'Signing requests with short-lived tokens.',
    },
    hast,
    // The extractor never reads `toc`; filling it in would only assert that
    // some other module built it correctly.
    toc: [],
    segments: ['api', 'auth'],
    href: '/docs/api/auth',
  };
}
