import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `site/` is the acceptance harness for `docs.Layout`, and this is what makes
 * it one.
 *
 * A documentation site built by the people who wrote the package will work.
 * That proves nothing: they know which class to add when a column collapses,
 * and they add it locally without noticing they have just papered over a defect
 * every consumer will hit. So the site is held to a **hard zero-layout-CSS
 * budget** — it ships no stylesheet of its own, and no inline layout style.
 *
 * Anything the site needs and cannot have is a bug report against
 * `src/styles.css`, filed by construction rather than by goodwill.
 *
 * The site is also where two content-level guarantees get exercised for real:
 * a link to an alias fails the build, and a relative image with no
 * `imageResolver` throws. Both are asserted here as *content* constraints,
 * because the way they surface is a site that stops building — and a harness
 * that cannot build is a harness nobody runs.
 */

const ROOT = path.join(import.meta.dirname, '..');
const SITE = path.join(ROOT, 'site');
const CONTENT = path.join(SITE, 'content');

/** Every file under `site/`, ignoring build output and dependencies. */
function siteFiles(dir: string = SITE): string[] {
  const skip = new Set(['out', '.next', 'node_modules']);
  const found: string[] = [];

  for (const entry of readdirSync(dir)) {
    if (skip.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...siteFiles(full));
      continue;
    }
    found.push(full);
  }
  return found;
}

/**
 * Properties that place or size a box.
 *
 * Deliberately not "every CSS property". `color`, `font-family` and
 * `background` are a host's business and always were — the site is allowed to
 * look like itself. What it may not do is *lay itself out*, because that is the
 * job this package is claiming to have done.
 */
const LAYOUT_PROPERTIES = [
  'display',
  'position',
  'grid',
  'grid-template',
  'grid-column',
  'grid-row',
  'flex',
  'float',
  'width',
  'max-width',
  'min-width',
  'height',
  'max-height',
  'min-height',
  'margin',
  'padding',
  'gap',
  'inset',
  'top',
  'right',
  'bottom',
  'left',
  'overflow',
  'z-index',
];

describe('the site is an acceptance harness', () => {
  it('exists, with the six pages the navigation names', () => {
    // The guard on the guard: a missing directory would make every assertion
    // below iterate over nothing and pass.
    expect(existsSync(CONTENT)).toBe(true);

    const pages = readdirSync(CONTENT)
      .filter((name) => name.endsWith('.md'))
      .map((name) => name.replace(/\.md$/, ''))
      .sort();

    expect(pages).toEqual([
      'index',
      'installation',
      'internals',
      'plugins',
      'reference',
      'styling',
    ]);

    // And `meta.json` orders every one of them, so the sidebar is authored
    // rather than alphabetical.
    const meta = JSON.parse(
      readFileSync(path.join(CONTENT, 'meta.json'), 'utf8'),
    ) as { pages?: string[] };
    expect([...(meta.pages ?? [])].sort()).toEqual(pages);
  });

  it('ships no stylesheet at all', () => {
    /*
     * The strongest form of the budget, and the one worth keeping: not "no
     * layout rules in the site's CSS" but "no site CSS". A file that exists is
     * a file someone will add a `max-width` to at 2am, and the reviewer will
     * see one line rather than the contract it breaks.
     */
    const stylesheets = siteFiles().filter((file) => file.endsWith('.css'));

    expect(stylesheets.map((file) => path.relative(ROOT, file))).toEqual([]);
  });

  it('declares no layout property inline either', () => {
    /*
     * The obvious way round the rule above. `style={{ maxWidth: '60rem' }}` in
     * a route file is the same defect with a different syntax, and it is what
     * someone reaches for precisely because there is no stylesheet to open.
     *
     * Property-level rather than a blanket ban on `style=`: a `--wave-docs-*`
     * token set inline, or a colour, is a host doing host things. Placing a box
     * is not.
     */
    const camel = (property: string): string =>
      property.replace(/-([a-z])/g, (_, letter: string) =>
        letter.toUpperCase(),
      );
    const offenders: string[] = [];

    for (const file of siteFiles().filter((name) => /\.tsx?$/.test(name))) {
      const source = readFileSync(file, 'utf8');
      for (const inline of source.matchAll(/style=\{\{([^}]*)\}\}/g)) {
        const declarations = inline[1] ?? '';
        for (const property of LAYOUT_PROPERTIES) {
          const key = new RegExp(`\\b(${property}|${camel(property)})\\s*:`);
          if (key.test(declarations)) {
            offenders.push(`${path.relative(ROOT, file)}: ${property}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('has a layout-property list worth checking against', () => {
    // The guard on the guard: an empty list would make the test above pass for
    // every inline style there is.
    expect(LAYOUT_PROPERTIES).toContain('display');
    expect(LAYOUT_PROPERTIES).toContain('max-width');
    expect(LAYOUT_PROPERTIES.length).toBeGreaterThan(15);
  });

  it('keeps the route files as thin as the README says they are', () => {
    /*
     * The README's headline is `export default docs.Layout`. If the harness
     * needed a wrapper, a provider or a `<div>` around it, the headline would
     * be a lie and this is where that shows up.
     */
    const layout = readFileSync(
      path.join(SITE, 'app', 'docs', 'layout.tsx'),
      'utf8',
    );

    expect(layout).toContain('export default docs.Layout;');
    // No JSX at all in the docs layout: a wrapper element is exactly the thing
    // that would put the TOC inside the article's grid column.
    expect(layout).not.toContain('<');
  });

  it('links between pages the way the README tells everyone to', () => {
    /*
     * `[text](./other.md)` — resolves on GitHub, in an editor preview, and in
     * the built site, because the pipeline rewrites it and checks the target.
     * A site linking by route instead would be a site whose own broken links
     * cannot fail the build, which is the feature being demonstrated.
     */
    let markdownLinks = 0;

    for (const name of readdirSync(CONTENT)) {
      if (!name.endsWith('.md')) continue;
      const body = readFileSync(path.join(CONTENT, name), 'utf8');

      markdownLinks += [...body.matchAll(/\]\(\.\/[^)]+\.md\)/g)].length;
      // A link straight to `/docs/...` bypasses resolution and would survive a
      // page being renamed or deleted.
      expect([...body.matchAll(/\]\(\/docs\/[^)]*\)/g)]).toEqual([]);
    }

    expect(markdownLinks).toBeGreaterThan(0);
  });

  it('embeds no relative image, which would throw without a resolver', () => {
    /*
     * `imageResolver` is not configured here, and that is the point: markdown
     * carries no dimensions, `next/image` refuses to render without them, and
     * the package raises `invalid-image` rather than guessing. A relative image
     * in this content would stop the site building — so the constraint is
     * asserted here, where the message names the file, rather than discovered
     * in a build log.
     */
    for (const name of readdirSync(CONTENT)) {
      if (!name.endsWith('.md')) continue;
      const body = readFileSync(path.join(CONTENT, name), 'utf8');

      const relative = [...body.matchAll(/!\[[^\]]*\]\((?!https?:)([^)]+)\)/g)];
      expect(relative.map((match) => `${name}: ${match[1]}`)).toEqual([]);
    }
  });

  it('exports statically, which is the mode that catches a dynamic route', () => {
    /*
     * `output: 'export'` is the harder of the two modes and the reason to use
     * it here: a route that quietly went dynamic fails the build rather than
     * silently costing money on a serverless host. If this site builds, the
     * quick start builds anywhere.
     */
    const config = readFileSync(path.join(SITE, 'next.config.ts'), 'utf8');

    expect(config).toContain("output: 'export'");
  });
});
