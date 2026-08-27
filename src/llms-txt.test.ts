/**
 * What the markdown endpoints hand back.
 *
 * The subject is the two edits `toPortableMarkdown` makes and, just as much,
 * everything it must leave alone: this package's argument for these files is
 * that the markdown is the author's, so a test that only checks the rewrite
 * would pass on an implementation that reformatted the whole document.
 */

import { describe, expect, it } from 'vitest';

import {
  buildLlmsFullTxt,
  buildLlmsTxt,
  toPortableMarkdown,
} from './llms-txt.js';
import type { DocFile } from './types.js';

const SITE = 'https://docs.example.com';

function doc(
  overrides: Partial<DocFile> & { content: string; href?: string },
): DocFile {
  const href = overrides.href ?? '/guides/links';
  const segments = href.split('/').filter(Boolean);
  return {
    segments,
    slug: segments.join('/'),
    href,
    filePath: `/repo/content/${segments.join('/')}.md`,
    relativePath: `${segments.join('/')}.md`,
    frontmatter: { title: 'Links' },
    ...overrides,
  } as DocFile;
}

describe('toPortableMarkdown', () => {
  describe('link destinations', () => {
    it('resolves a sibling-relative link against the page it was written on', () => {
      const out = toPortableMarkdown(
        doc({ href: '/guides/links', content: 'See [rewriter](./rewriter).' }),
        { siteUrl: SITE },
      );

      expect(out).toContain(
        '[rewriter](https://docs.example.com/guides/rewriter)',
      );
    });

    it('climbs out of a directory', () => {
      const out = toPortableMarkdown(
        doc({ href: '/guides/links', content: '[api](../api/reference)' }),
        { siteUrl: SITE },
      );

      expect(out).toContain('[api](https://docs.example.com/api/reference)');
    });

    it('gives a bare fragment the page it points into', () => {
      // The one that is worst when it survives: `#rotating-keys` pasted into a
      // chat window points at whatever the reader is looking at.
      const out = toPortableMarkdown(
        doc({ href: '/api/reference', content: '[keys](#rotating-keys)' }),
        { siteUrl: SITE },
      );

      expect(out).toContain(
        '[keys](https://docs.example.com/api/reference#rotating-keys)',
      );
    });

    it('leaves an external URL alone', () => {
      const content = '[spec](https://llmstxt.org/)';
      expect(toPortableMarkdown(doc({ content }), { siteUrl: SITE })).toContain(
        content,
      );
    });

    it('leaves `mailto:` alone', () => {
      // The case a hand-rolled rewriter mangles: no host, so "relative to the
      // page" is meaningless and prefixing an origin produces nonsense.
      const content = '[us](mailto:hi@example.com)';
      expect(toPortableMarkdown(doc({ content }), { siteUrl: SITE })).toContain(
        content,
      );
    });

    it('rewrites an image the same way', () => {
      const out = toPortableMarkdown(
        doc({ href: '/guides/links', content: '![d](./diagram.png)' }),
        { siteUrl: SITE },
      );

      expect(out).toContain(
        '![d](https://docs.example.com/guides/diagram.png)',
      );
    });

    it('rewrites a reference definition', () => {
      const out = toPortableMarkdown(
        doc({
          href: '/guides/links',
          content: 'See [the rewriter][r].\n\n[r]: ./rewriter\n',
        }),
        { siteUrl: SITE },
      );

      expect(out).toContain('[r]: https://docs.example.com/guides/rewriter');
    });

    it('falls back to root-relative paths with no `siteUrl`', () => {
      const out = toPortableMarkdown(
        doc({ href: '/guides/links', content: '[api](../api/reference)' }),
      );

      expect(out).toContain('[api](/api/reference)');
      // And never leaks the placeholder origin the resolution ran against.
      expect(out).not.toContain('docs.invalid');
    });

    it('drops the markdown extension, because the target is a page', () => {
      /*
       * ⚠️ AUTHORS WRITE `./api/auth.md` ON PURPOSE — it resolves on GitHub and
       * in an editor preview — and `/api/auth.md` is not a route. Resolving
       * without trimming produced a corpus whose every internal link 404ed,
       * which is worse than leaving them relative: they look right.
       */
      const out = toPortableMarkdown(
        doc({ href: '/guides/links', content: '[auth](../api/auth.md)' }),
        { siteUrl: SITE },
      );

      expect(out).toContain('[auth](https://docs.example.com/api/auth)');
    });

    it('collapses `index.md` onto its directory’s own page', () => {
      const out = toPortableMarkdown(
        doc({ href: '/guides/links', content: '[api](../api/index.md)' }),
        { siteUrl: SITE },
      );

      expect(out).toContain('[api](https://docs.example.com/api/)');
    });

    it('leaves a foreign `.md` URL alone', () => {
      /*
       * ⚠️ THE TRIM IS FOR OUR OWN PAGES ONLY. A raw file on GitHub, or a spec
       * published as markdown, is a real URL that ends in `.md` — trimming it
       * points at a page that does not exist on a host we do not control.
       */
      const content = '[spec](https://llmstxt.org/index.md)';
      expect(toPortableMarkdown(doc({ content }), { siteUrl: SITE })).toContain(
        content,
      );
    });

    it('keeps a foreign origin absolute when there is no `siteUrl`', () => {
      // Stripping the host here would silently retarget the link at us.
      const content = '[spec](https://llmstxt.org/index.md)';
      expect(toPortableMarkdown(doc({ content }))).toContain(content);
    });
  });

  describe('what it must not touch', () => {
    it('leaves a link inside a fenced code block exactly as written', () => {
      /*
       * ⚠️ THE REASON THIS IS PARSED RATHER THAN REGEXED. A documentation
       * corpus keeps its example URLs in code fences, and `](…)` matches
       * inside one — so a regex rewriter edits the example a reader is meant
       * to copy verbatim.
       */
      const content = [
        'Prose [here](./here).',
        '',
        '```md',
        '[example](./example)',
        '```',
      ].join('\n');

      const out = toPortableMarkdown(doc({ href: '/guides/links', content }), {
        siteUrl: SITE,
      });

      expect(out).toContain('[example](./example)');
      expect(out).toContain('[here](https://docs.example.com/guides/here)');
    });

    it('rewrites the destination and not the label that repeats it', () => {
      /*
       * ⚠️ WHY THE SEARCH RUNS FROM THE END OF THE NODE. `[/guides/x](/guides/x)`
       * is ordinary in a corpus that documents its own routes, and a forward
       * search rewrites the visible text while leaving the target relative —
       * the exact inverse of the job.
       */
      const out = toPortableMarkdown(
        doc({ content: '[/api/reference](/api/reference)' }),
        { siteUrl: SITE, titleHeading: false },
      );

      expect(out).toBe(
        '[/api/reference](https://docs.example.com/api/reference)',
      );
    });

    it('preserves the body byte for byte when nothing needs resolving', () => {
      // The claim the whole feature rests on: this is the author's markdown,
      // not a re-serialisation of it. Deliberately awkward formatting.
      const content = [
        '#   Loosely   spaced',
        '',
        '*   a bullet with three spaces',
        '+   and a different marker',
        '',
        '| a | b |',
        '|---|---|',
        '| 1 | 2 |',
        '',
        'Trailing whitespace lives here:   ',
        '',
        '> a quote',
      ].join('\n');

      expect(toPortableMarkdown(doc({ content }), { siteUrl: SITE })).toBe(
        content,
      );
    });
  });

  describe('the title heading', () => {
    it('prepends the frontmatter title when the body has none', () => {
      const out = toPortableMarkdown(
        doc({
          frontmatter: { title: 'Rotating keys' },
          content: 'Keys rotate every 90 days.',
        }),
      );

      expect(out).toBe('# Rotating keys\n\nKeys rotate every 90 days.');
    });

    it('does not repeat a title the body already carries', () => {
      const content = '# Rotating keys\n\nKeys rotate every 90 days.';
      expect(toPortableMarkdown(doc({ content }))).toBe(content);
    });

    it('prepends when the body opens at `##`, which is the broken outline', () => {
      // A document whose first heading is an `h2` has no title at all once the
      // frontmatter is gone — the same defect `titleHeading` fixes for HTML.
      const out = toPortableMarkdown(
        doc({ frontmatter: { title: 'Links' }, content: '## Rewriting' }),
      );

      expect(out).toBe('# Links\n\n## Rewriting');
    });

    it('can be turned off', () => {
      const content = 'No heading here.';
      expect(
        toPortableMarkdown(doc({ content }), { titleHeading: false }),
      ).toBe(content);
    });
  });
});

describe('buildLlmsTxt', () => {
  const files = [
    doc({
      href: '/getting-started/installation',
      frontmatter: { title: 'Installation', description: 'Add the package.' },
      content: '',
    }),
    doc({
      href: '/guides/links',
      frontmatter: { title: 'Links' },
      content: '',
    }),
  ];

  it('is the llmstxt.org shape', () => {
    const out = buildLlmsTxt(files, {
      title: 'Wave Docs',
      description: 'Documentation for Next, as a package.',
      siteUrl: SITE,
    });

    expect(out).toBe(
      [
        '# Wave Docs',
        '',
        '> Documentation for Next, as a package.',
        '',
        '## Docs',
        '',
        '- [Installation](https://docs.example.com/getting-started/installation): Add the package.',
        '- [Links](https://docs.example.com/guides/links)',
        '',
      ].join('\n'),
    );
  });

  it('omits the summary line rather than emitting an empty blockquote', () => {
    const out = buildLlmsTxt(files, { title: 'Wave Docs', siteUrl: SITE });
    expect(out).not.toContain('>');
  });
});

describe('buildLlmsFullTxt', () => {
  it('labels every page with its own URL and separates them', () => {
    const out = buildLlmsFullTxt(
      [
        doc({
          href: '/a',
          frontmatter: { title: 'A' },
          content: '# A\n\nFirst.',
        }),
        doc({
          href: '/b',
          frontmatter: { title: 'B' },
          content: '# B\n\nSecond.',
        }),
      ],
      { siteUrl: SITE },
    );

    expect(out).toBe(
      [
        '<!-- source: https://docs.example.com/a -->',
        '',
        '# A',
        '',
        'First.',
        '',
        '---',
        '',
        '<!-- source: https://docs.example.com/b -->',
        '',
        '# B',
        '',
        'Second.',
        '',
      ].join('\n'),
    );
  });

  it('resolves each page’s links against that page, not against the first', () => {
    // The bug a single shared base would produce, and it is silent: every
    // link in the corpus resolves, and half of them point at the wrong page.
    const out = buildLlmsFullTxt(
      [
        doc({ href: '/guides/links', content: '[x](./x)' }),
        doc({ href: '/api/reference', content: '[y](./y)' }),
      ],
      { siteUrl: SITE },
    );

    expect(out).toContain('https://docs.example.com/guides/x');
    expect(out).toContain('https://docs.example.com/api/y');
  });
});
