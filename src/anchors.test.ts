/**
 * The anchor checker, and the corpus pass `render` cannot do alone.
 *
 * `render.test.ts` covers the same-page half through a real render, because
 * that is where the line numbers come from. This covers the half that needs
 * every page at once — and the guards that only matter there, which a
 * same-page test cannot fail on: an external fragment is filtered by the
 * same-page comparison whether or not the scheme check exists, so the scheme
 * check has to be exercised here or it is untested.
 */

import type { Root } from 'hast';
import { describe, expect, it } from 'vitest';

import { assertAnchors, collectAnchorIds, splitAnchor } from './anchors.js';
import type { RenderedDoc } from './types.js';

/** A minimal page: headings with ids, and links out of it. */
function page(href: string, ids: string[], links: string[]): RenderedDoc {
  const tree: Root = {
    type: 'root',
    children: [
      ...ids.map((id) => ({
        type: 'element' as const,
        tagName: 'h2',
        properties: { id },
        children: [],
      })),
      ...links.map((target) => ({
        type: 'element' as const,
        tagName: 'a',
        properties: { href: target },
        children: [],
      })),
    ],
  };
  return {
    frontmatter: { title: 'T' },
    hast: tree,
    toc: [],
    segments: [],
    href,
  };
}

/** Every failure `assertAnchors` reports, as `from → href`. */
function check(docs: RenderedDoc[]): string[] {
  const found: string[] = [];
  assertAnchors(docs, (from, link) => {
    found.push(`${from} → ${link.href}`);
  });
  return found;
}

describe('splitAnchor', () => {
  it('splits an internal href at its fragment', () => {
    expect(splitAnchor('/docs/install#setup')).toEqual({
      href: '/docs/install#setup',
      route: '/docs/install',
      fragment: 'setup',
    });
  });

  it('decodes the fragment, because an id can be any text', () => {
    expect(splitAnchor('/docs/x#caf%C3%A9')?.fragment).toBe('café');
  });

  it('ignores an href with no fragment, and an empty one', () => {
    expect(splitAnchor('/docs/install')).toBeUndefined();
    // `#` alone is a jump to the top of the page, which always exists.
    expect(splitAnchor('/docs/install#')).toBeUndefined();
  });

  it("ignores another origin's fragment", () => {
    /*
     * ⚠️ THE GUARD `render.test.ts` CANNOT FAIL ON. There, an external link is
     * filtered by the same-page comparison anyway — its route is never this
     * page's href — so deleting this check breaks nothing that a same-page test
     * can see. It matters in the corpus pass, where a link to
     * `https://spec.example/#section-4` would otherwise be looked up as a route
     * and reported against a page nobody wrote.
     *
     * Linking into a specification by fragment is routine, and an anchor on
     * somebody else's page is theirs to get wrong.
     */
    expect(splitAnchor('https://example.com/spec#section-4')).toBeUndefined();
    expect(splitAnchor('//cdn.example.com/x#y')).toBeUndefined();
    expect(splitAnchor('mailto:hi@example.com#x')).toBeUndefined();
  });

  it('ignores a malformed escape rather than reporting it twice', () => {
    // The link path already reports this one; failing twice for one mistake
    // helps nobody.
    expect(splitAnchor('/docs/x#100%-faster')).toBeUndefined();
  });
});

describe('collectAnchorIds', () => {
  it('takes every id, not only the headings the TOC captures', () => {
    // The TOC stops at `h3`, so checking against it would reject a perfectly
    // good link to an `h4` — or to an id a `rehypePlugins` entry added.
    const tree = page('/x', [], []).hast;
    tree.children.push(
      {
        type: 'element',
        tagName: 'div',
        properties: { id: 'note' },
        children: [],
      },
      {
        type: 'element',
        tagName: 'h4',
        properties: { id: 'deep' },
        children: [],
      },
    );

    expect([...collectAnchorIds(tree)].sort()).toEqual(['deep', 'note']);
  });
});

describe('assertAnchors', () => {
  it('reports a fragment the target page does not own', () => {
    expect(
      check([page('/a', ['intro'], ['/b#missing']), page('/b', ['setup'], [])]),
    ).toEqual(['/a → /b#missing']);
  });

  it('accepts a fragment the target page does own', () => {
    expect(
      check([page('/a', [], ['/b#setup']), page('/b', ['setup'], [])]),
    ).toEqual([]);
  });

  it('leaves same-page links to the render-time check', () => {
    // `render` sees the line number; reporting here as well would name the same
    // mistake twice, once worse.
    expect(check([page('/a', ['intro'], ['#missing'])])).toEqual([]);
  });

  it('says nothing about a route nothing rendered', () => {
    /*
     * That is a broken *link*, and `assertLinks` has already reported it at its
     * own severity. One mistake, one failure — and reporting it here as a
     * broken anchor would name the wrong problem.
     */
    expect(check([page('/a', [], ['/gone#setup'])])).toEqual([]);
  });

  it('says nothing about another origin', () => {
    expect(
      check([page('/a', [], ['https://example.com/spec#section-4'])]),
    ).toEqual([]);
  });
});
