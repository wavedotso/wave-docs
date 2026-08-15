/**
 * Guards on the shipped stylesheet: the contrast of its tokens, the cascade
 * contract it promises in its own header, and the handful of declarations that
 * decide whether an indicator can be seen at all.
 *
 * These are asserted against the CSS text rather than from a mounted component
 * because jsdom's CSSOM drops `@layer` blocks outright — `getComputedStyle`
 * reports `position: static; transform: none` for the sheet as shipped, so a
 * computed-style assertion in a DOM test would pass no matter what the CSS said.
 *
 * ---
 *
 * Contrast guard for the shipped theme.
 *
 * The tokens in `styles.css` are the theme a consumer gets without touching
 * anything, so a token that fails WCAG 1.4.3 ships to every reader of every
 * site using this package. None of the text these pairs paint is "large text"
 * in the WCAG sense — the callout labels are 16px/650, the search breadcrumbs
 * 12px, the sidebar separators 12px — so the threshold is 4.5:1 throughout and
 * 3:1 is never enough.
 *
 * The colour maths is implemented here rather than pulled in as a dependency:
 * it is the OKLab matrix and the WCAG relative-luminance formula, thirty lines
 * between them, and a runtime dependency in this package would have to be
 * justified to every consumer.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const STYLESHEET = path.join(import.meta.dirname, 'styles.css');

/**
 * The three token blocks: the light ramp, the OS-following opt-in, the explicit
 * one. Every block that installs a foreground token appears here, which is what
 * `the theme is opt-in` below asserts.
 */
const BLOCK_SELECTORS = [
  ':root {',
  ":root[data-theme='system']",
  ":root[data-theme='dark']",
] as const;

/**
 * The preludes allowed to define a `--wave-docs-fg*` token, whitespace
 * collapsed. Anything else — `:root:not([data-theme='light'])` above all —
 * installs the dark ramp on a page whose background this sheet never painted.
 */
const THEME_PRELUDES: ReadonlySet<string> = new Set([
  ':root',
  ":root[data-theme='system']",
  ":root[data-theme='dark'], :root.dark",
]);

type Oklch = readonly [number, number, number];

/**
 * The declarations of the brace block that starts at `from`.
 *
 * Brace counting rather than a regex: the media query nests, and a lazy
 * `\{([^}]*)\}` stops at the inner block's closing brace.
 */
function readBlock(css: string, from: number): string {
  const open = css.indexOf('{', from);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open, i);
    }
  }
  throw new Error(`Unterminated block at offset ${from} in ${STYLESHEET}`);
}

function readTokens(css: string, selector: string): Map<string, Oklch> {
  const at = css.indexOf(selector);
  expect(at, `${selector} not found in styles.css`).toBeGreaterThan(-1);

  const tokens = new Map<string, Oklch>();
  const pattern = /(--wave-docs-[a-z-]+)\s*:\s*oklch\(([^)]*)\)/g;
  for (const match of readBlock(css, at).matchAll(pattern)) {
    const name = match[1];
    const value = match[2];
    if (name === undefined || value === undefined) continue;
    const parts = (value.split('/')[0] ?? '').trim().split(/\s+/).map(Number);
    const [l, c, h] = parts;
    if (l === undefined || c === undefined || h === undefined) {
      throw new Error(`Could not parse oklch() for ${name}: ${value}`);
    }
    tokens.set(name.replace('--wave-docs-', ''), [l, c, h]);
  }
  return tokens;
}

/** OKLCh to linear sRGB, via OKLab. */
function toLinearSrgb([lightness, chroma, hue]: Oklch): [
  number,
  number,
  number,
] {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);

  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/**
 * WCAG relative luminance.
 *
 * Linear sRGB is already the "un-gamma'd" space the formula wants, so the
 * channels go straight in — clamped, because an oklch() outside the sRGB gamut
 * is what the browser paints clamped too.
 */
function luminance(color: Oklch): number {
  const [r, g, b] = toLinearSrgb(color);
  const clamp = (channel: number): number => Math.min(1, Math.max(0, channel));
  return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(b);
}

function contrast(foreground: Oklch, background: Oklch): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Every background a `--wave-docs-fg*` token is ever painted on. */
const SURFACES = [
  ['bg', 'the page'],
  ['bg-subtle', 'table headers, sidebar hover, kbd, the search trigger'],
  ['accent-subtle', 'the active sidebar link and the highlighted result'],
  ['callout-note-bg', 'a note callout'],
  ['callout-tip-bg', 'a tip callout'],
  ['callout-important-bg', 'an important callout'],
  ['callout-warning-bg', 'a warning callout'],
  ['callout-caution-bg', 'a caution callout'],
] as const;

/**
 * Every foreground/background pair the stylesheet actually composes.
 *
 * Each one names the rule that puts them together, because the list is only
 * trustworthy if it can be re-derived from the CSS.
 *
 * The three foregrounds are crossed with every surface rather than enumerated
 * pair by pair: `fg-subtle` paints `li::marker` and `.heading-anchor`, both of
 * which appear *inside* a callout as readily as in body prose, and the
 * hand-written list had no entry for that composition — it measured 4.21:1 in
 * dark and nothing caught it.
 */
const PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  ...(['fg', 'fg-muted', 'fg-subtle'] as const).flatMap((foreground) =>
    SURFACES.map(([surface, where]) => [foreground, surface, where] as const),
  ),
  ['accent', 'bg', 'links'],
  ['accent', 'bg-subtle', 'links on a tinted row'],
  ['accent', 'accent-subtle', 'active sidebar link'],
  ['accent-hover', 'bg', 'hovered links'],
  ['accent-fg', 'accent', 'skip link'],
  ['code-fg', 'code-bg', 'inline code'],
  ['callout-caution', 'bg', 'search error text'],
  ...(['note', 'tip', 'important', 'warning', 'caution'] as const).map(
    (kind) =>
      [
        `callout-${kind}`,
        `callout-${kind}-bg`,
        `${kind} callout label`,
      ] as const,
  ),
];

/**
 * Pairs that carry a *state*, not text.
 *
 * WCAG 1.4.11 asks 3:1 of a non-text indicator. The active search result is the
 * whole reason this tier exists: every result is `tabindex="-1"` so
 * `:focus-visible` can never fire on one, which leaves the active class as the
 * only signal of where the keyboard is, and a tint alone measured 1.12:1.
 */
const STATE_PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  ['accent', 'bg', 'active-result outline against the results list'],
  ['accent', 'accent-subtle', 'active-result outline against its own tint'],
];

/**
 * The sheet with comments stripped.
 *
 * Every structural check below runs against this rather than the raw file: the
 * comments quote the very selectors and declarations being asserted about (they
 * name `:root:not([data-theme='light'])`, `html { scroll-behavior: smooth }`
 * and `display: none` among others), so a text search over the raw source
 * reports the prose, not the CSS.
 */
const rawSheet = await readFile(STYLESHEET, 'utf8');

/** Comments stripped, so a selector match cannot be a sentence about one. */
const sheet = rawSheet.replace(/\/\*[\s\S]*?\*\//g, '');

interface StyleRule {
  /** Selector list or at-rule prelude, whitespace collapsed. */
  readonly prelude: string;
  /** Offset of the rule's `{`, or -1 for a statement closed by `;`. */
  readonly at: number;
  /** 0 at the top level of the sheet, 1 inside one block, and so on. */
  readonly depth: number;
}

/**
 * Every rule in the sheet, by brace walk.
 *
 * `depth` is the point of it: `depth === 0` means the rule is outside every
 * `@layer`, and unlayered CSS beats every layer regardless of specificity — so
 * a single rule that escapes a layer here silently repaints another package's
 * markup on any page that loads both.
 */
function readRules(source: string): StyleRule[] {
  const collapse = (text: string): string => text.trim().replace(/\s+/g, ' ');
  const rules: StyleRule[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') {
      rules.push({ prelude: collapse(source.slice(start, i)), at: i, depth });
      depth += 1;
      start = i + 1;
    } else if (char === '}') {
      depth -= 1;
      start = i + 1;
    } else if (char === ';') {
      // A declaration ends here as far as the next prelude is concerned; only
      // the top-level ones (`@layer a, b, c;`) are rules in their own right.
      if (depth === 0) {
        rules.push({
          prelude: collapse(source.slice(start, i)),
          at: -1,
          depth,
        });
      }
      start = i + 1;
    }
  }
  return rules;
}

/**
 * Split a selector list on its top-level commas.
 *
 * `String.split(',')` would tear `:is(a, button)` in half and hand back two
 * fragments that are not selectors, so a focus inventory built from it could
 * never be compared against anything.
 */
function splitSelectors(prelude: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < prelude.length; i += 1) {
    const char = prelude[i];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(prelude.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(prelude.slice(start).trim());
  return parts;
}

/**
 * The selectors whose *subject* is the focused element.
 *
 * `.wave-docs-youtube__facade:is(:hover, :focus-visible) .play-bg` mentions
 * focus but styles a descendant's fill, and it needs no indicator of its own —
 * hence the anchor at the end of the selector rather than a substring test.
 * `:has(… :focus-visible)` ends in a paren and is deliberately included.
 */
function focusSelectors(rules: readonly StyleRule[]): string[] {
  return rules
    .flatMap((rule) => splitSelectors(rule.prelude))
    .filter((selector) => /:focus(-visible)?\)?$/.test(selector));
}

/**
 * Focus rules whose indicator is drawn by a different rule: the search input's
 * ring lives on the row around it, because a ring on a borderless full-width
 * input reads as an error state.
 */
const INDICATOR_ELSEWHERE: ReadonlySet<string> = new Set([
  '.wave-docs-search-input:focus',
]);

const RULES = readRules(sheet);

describe.each(BLOCK_SELECTORS)('tokens in %s', (selector) => {
  const tokens = readTokens(sheet, selector);

  it.each(PAIRS)('%s on %s clears 4.5:1 (%s)', (fg, bg) => {
    const foreground = tokens.get(fg);
    const background = tokens.get(bg);
    if (foreground === undefined || background === undefined) {
      throw new Error(`${selector} defines neither ${fg} nor ${bg}`);
    }
    // Rounded to two decimals so a failure reports the number a contrast
    // checker would show, not 4.499999999.
    const ratio = Math.round(contrast(foreground, background) * 100) / 100;
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it.each(STATE_PAIRS)(
    '%s on %s clears 3:1 as a state indicator (%s)',
    (fg, bg) => {
      const foreground = tokens.get(fg);
      const background = tokens.get(bg);
      if (foreground === undefined || background === undefined) {
        throw new Error(`${selector} defines neither ${fg} nor ${bg}`);
      }
      const ratio = Math.round(contrast(foreground, background) * 100) / 100;
      expect(ratio).toBeGreaterThanOrEqual(3);
    },
  );
});

describe('the cascade contract', () => {
  it('declares nothing outside a @layer', () => {
    const top = RULES.filter((rule) => rule.depth === 0);
    expect(top.length).toBeGreaterThan(0);

    for (const rule of top) {
      // The header of styles.css promises that "everything this file declares
      // lives in a @layer". Seven `.shiki` rules once did not, and they erased
      // the syntax colours of any other package rendering Shiki output on the
      // same page — unlayered CSS outranks every layer.
      expect(rule.prelude, `${rule.prelude} escapes every @layer`).toMatch(
        /^@layer\b/,
      );
    }
  });

  it('keeps every .shiki rule scoped to our own prose', () => {
    const shiki = RULES.flatMap((rule) => splitSelectors(rule.prelude)).filter(
      (selector) => selector.includes('.shiki'),
    );
    expect(shiki.length).toBeGreaterThan(0);

    for (const selector of shiki) {
      expect(selector, `${selector} styles .shiki globally`).toContain(
        '.wave-docs-prose .shiki',
      );
    }
  });

  it('needs no !important anywhere', () => {
    // `defaultColor: false` in render.ts is what earns this: Shiki emits only
    // `--shiki-light`/`--shiki-dark` custom properties and no inline `color`,
    // so nothing here has an inline style to outrank. An `!important` would now
    // only outrank the consumer.
    expect(sheet).not.toContain('!important');
  });

  it('claims no element the host owns', () => {
    // `html { scroll-behavior: smooth }` fought Next 16's route transitions —
    // it only de-animates them when `<html>` carries
    // `data-scroll-behavior="smooth"`, which only the host can set — and
    // `scroll-padding-top` on bare `html` assumed a sticky header we cannot see.
    expect(sheet).not.toContain('scroll-behavior');

    const bare = RULES.flatMap((rule) => splitSelectors(rule.prelude)).filter(
      (selector) => selector === 'html' || selector === 'body',
    );
    expect(bare).toEqual([]);
  });

  it('injects no Tailwind sources', () => {
    // `@source "./"` scraped the package's compiled JS for anything that looked
    // like a class name and handed 14 unrequested utilities — `.container`,
    // `.table`, `.hidden`, `.block` — to every Tailwind consumer, in a layer
    // that outranks their own components. `dist/` contains no Tailwind classes
    // at all, so the directive could only ever cost.
    expect(sheet).not.toContain('@source');
  });
});

describe('the theme is opt-in', () => {
  it('installs a foreground ramp only where it installs a ground with it', () => {
    const defining = RULES.filter(
      (rule) =>
        // Selector rules only: the enclosing `@layer theme` and its `@media`
        // both contain the tokens too, and neither is a selector that can put
        // a foreground on a page.
        rule.at > -1 &&
        !rule.prelude.startsWith('@') &&
        readBlock(sheet, rule.at).includes('--wave-docs-fg:'),
    );
    expect(defining.length).toBe(THEME_PRELUDES.size);

    for (const rule of defining) {
      expect(
        THEME_PRELUDES.has(rule.prelude),
        `${rule.prelude} installs a foreground ramp from outside the opt-in set`,
      ).toBe(true);
      // A ramp without its own ground is the 1.23:1 bug: near-white text on
      // whatever the host's page happens to paint.
      expect(readBlock(sheet, rule.at)).toContain('--wave-docs-bg:');
    }
  });

  it('follows the OS only for a host that asked it to', () => {
    // `:root:not([data-theme='light'])` matched the default document of every
    // light-only site with a /docs section, and of every next-themes consumer
    // on its default `attribute="class"`, which sets `.dark` and never
    // `data-theme`.
    expect(sheet).not.toContain(":root:not([data-theme='light'])");

    for (const [index, rule] of RULES.entries()) {
      if (!rule.prelude.includes('prefers-color-scheme: dark')) continue;
      const nested = RULES.slice(index + 1).filter(
        (candidate) =>
          candidate.at > rule.at &&
          candidate.at < rule.at + readBlock(sheet, rule.at).length,
      );
      expect(nested.length).toBeGreaterThan(0);
      for (const child of nested) {
        expect(
          child.prelude,
          `${child.prelude} takes the dark ramp from the OS alone`,
        ).toContain("[data-theme='system']");
      }
    }
  });

  it('paints the ground it composes its ramp against', () => {
    // A contrast ratio is a claim about two colours. Without a background of
    // our own the second one belongs to the host's page, and every assertion
    // in this file would be about a colour nobody declared.
    const painted = RULES.filter(
      (rule) =>
        rule.at > -1 &&
        readBlock(sheet, rule.at).includes('background: var(--wave-docs-bg);'),
    ).flatMap((rule) => splitSelectors(rule.prelude));

    for (const container of [
      '.wave-docs-prose',
      '.wave-docs-sidebar',
      '.wave-docs-toc',
    ]) {
      expect(painted, `${container} composes on an unpainted ground`).toContain(
        container,
      );
    }
    // …and never `body`, which belongs to the host.
    expect(painted).not.toContain('body');
  });

  it('tells the UA which scheme it painted', () => {
    // Without `color-scheme`, native scrollbars, form controls and the
    // overscroll canvas stay light on a dark page — the one part of the render
    // no token can reach.
    expect(readBlock(sheet, sheet.indexOf(':root {'))).toContain(
      'color-scheme: light',
    );
    for (const selector of [
      ":root[data-theme='system']",
      ":root[data-theme='dark']",
    ]) {
      expect(readBlock(sheet, sheet.indexOf(selector))).toContain(
        'color-scheme: dark',
      );
    }
  });

  it('spells the two dark blocks identically', () => {
    // They exist twice only because `@media` and an attribute selector cannot
    // be combined into one selector list; a token that drifts between them is
    // a theme that changes when the OS does.
    const viaOs = readTokens(sheet, ":root[data-theme='system']");
    const explicit = readTokens(sheet, ":root[data-theme='dark']");
    expect(Object.fromEntries(explicit)).toEqual(Object.fromEntries(viaOs));
  });
});

describe('callout hues', () => {
  const light = readTokens(sheet, ':root {');
  const dark = readTokens(sheet, ":root[data-theme='dark']");

  it.each(['note', 'tip', 'important', 'warning', 'caution'] as const)(
    '%s is one hue in both themes',
    (kind) => {
      // Warning used to be 72 in light and 82 in dark, with its own background
      // on the other hue in each — the only callout whose colour was not a
      // lightness ramp along a single hue, and the only one that read as a
      // different family after a theme switch.
      const hues = [
        light.get(`callout-${kind}`),
        light.get(`callout-${kind}-bg`),
        dark.get(`callout-${kind}`),
        dark.get(`callout-${kind}-bg`),
      ].map((token) => {
        if (token === undefined) {
          throw new Error(`styles.css defines no callout-${kind} pair`);
        }
        return token[2];
      });

      expect(new Set(hues).size, `callout-${kind} spans hues ${hues}`).toBe(1);
    },
  );
});

describe('focus indicators', () => {
  const declared = focusSelectors(RULES);

  it('has one for every focusable surface in the package', () => {
    // The skip link, prose links, the sidebar, the TOC, the YouTube facade, the
    // table scroll region, the Shiki `<pre>` (Shiki gives it `tabindex="0"`),
    // the search trigger, its input row and the close button.
    expect(declared.length).toBeGreaterThanOrEqual(9);
  });

  it('covers the Shiki <pre>, which Shiki makes focusable', () => {
    // `tabindex="0"` on the `<pre>` is Shiki's own doing, so a keyboard reader
    // can scroll a wide block. It was the one hole in the inventory.
    expect(declared).toContain('.wave-docs-prose .shiki:focus-visible');
  });

  it('puts the search input ring on the row around it', () => {
    // Every computed property of `.wave-docs-search-input` was byte-identical
    // focused and unfocused, and the comment's premise — that the dialog frame
    // is the indicator — was a static 1.31:1 border that does not change on
    // focus.
    expect(declared).toContain(
      '.wave-docs-search-input-row:has(.wave-docs-search-input:focus-visible)',
    );
  });

  /**
   * Replaces the forced-colors assertion this file used to carry, and is a
   * stronger invariant than it was.
   *
   * The old test checked that every focus rule had a matching entry in a
   * `@media (forced-colors: active)` block — necessary only because every ring
   * was a `box-shadow`, which that mode drops. It could not tell whether the
   * *normal* indicator was visible; a rule declaring `outline: none` with no
   * shadow passed it. This one reads the declarations: forced-colors forces
   * `outline-color` to a system colour by itself, so an outline that is visible
   * here is visible there, and there is nothing left to keep in step.
   */
  it('draws a real outline, so forced colours need no second list', () => {
    expect(sheet).not.toContain('--wave-docs-ring');
    expect(sheet).not.toContain('outline: 2px solid transparent');

    for (const selector of declared) {
      if (INDICATOR_ELSEWHERE.has(selector)) continue;
      const block = readBlock(sheet, sheet.indexOf(`${selector}`));
      expect(block, `${selector} declares no outline`).toMatch(
        /outline:\s*\d+px solid (?!transparent)/,
      );
    }
  });

  it('marks the active search result with more than a tint', () => {
    // Every result is `tabindex="-1"` — `:focus-visible` cannot fire on one —
    // so the active class is the only indication of where the keyboard is, and
    // `.wave-docs-search-result-link:focus-visible` was dead CSS.
    const active = readBlock(
      sheet,
      sheet.indexOf('.wave-docs-search-result-active {'),
    );
    expect(active).toContain('outline: 2px solid var(--wave-docs-accent)');
    expect(active).toContain('outline-offset: -2px');
    expect(sheet).not.toContain('.wave-docs-search-result-link:focus-visible');
  });
});

describe('the reading column', () => {
  /** A non-colour token's raw value; `readTokens` parses only `oklch()`. */
  function rawToken(name: string): string {
    const at = sheet.indexOf(`${name}:`);
    expect(at, `${name} not declared`).toBeGreaterThan(-1);
    return sheet.slice(at + name.length + 1, sheet.indexOf(';', at)).trim();
  }

  /**
   * `.wave-docs-prose` carried no `max-width` and a comment saying the docs
   * shell owned column width. No shell shipped, so every consumer's first
   * override was the same container CSS — and on a 1440px viewport the default
   * was a ~140-character line.
   */
  it('constrains the measure, through a token', () => {
    const prose = readBlock(sheet, sheet.indexOf('.wave-docs-prose {'));
    expect(prose).toContain('max-width: var(--wave-docs-measure)');
    expect(rawToken('--wave-docs-measure')).toBe('46rem');
  });

  /**
   * Inheriting the family means a host that never set one renders its
   * documentation in the UA serif, which reads as broken rather than as
   * unstyled. The opt-out is the token, not a cascade accident.
   */
  it('ships a typeface on every root it owns', () => {
    expect(rawToken('--wave-docs-font-sans')).toMatch(
      /ui-sans-serif|system-ui/,
    );

    const declaration = 'font-family: var(--wave-docs-font-sans)';
    const at = sheet.indexOf(declaration);
    expect(at, 'nothing applies the sans token').toBeGreaterThan(-1);

    // The prelude of the rule that applies it: back to the `{` that opens the
    // block, then to the end of the comment or `}` before its selector list.
    const open = sheet.lastIndexOf('{', at);
    const prior = Math.max(
      sheet.lastIndexOf('*/', open),
      sheet.lastIndexOf('}', open),
    );
    const prelude = sheet.slice(prior + 2, open);

    for (const root of [
      '.wave-docs-prose',
      '.wave-docs-sidebar',
      '.wave-docs-toc',
      '.wave-docs-skip-link',
      '.wave-docs-search-trigger',
      '.wave-docs-search-dialog',
    ]) {
      expect(prelude, `${root} does not get the typeface`).toContain(root);
    }
  });

  /**
   * Both are settable layout tokens from `docs/adr/001-shell-contract.md`, and
   * they are layered — so a consumer's own unlayered `:root` still wins, which
   * is the promise the README makes.
   */
  it('leaves both overridable from an unlayered :root', () => {
    for (const token of ['--wave-docs-measure', '--wave-docs-font-sans']) {
      const layer = sheet.lastIndexOf('@layer', sheet.indexOf(`${token}:`));
      expect(sheet.slice(layer, layer + 13)).toBe('@layer theme ');
    }
  });
});

describe('the type scale', () => {
  /** A declaration's value inside one rule, by selector. */
  function decl(selector: string, property: string): string | undefined {
    const at = sheet.indexOf(`${selector} {`);
    expect(at, `${selector} not found`).toBeGreaterThan(-1);
    const block = readBlock(sheet, at);
    const match = new RegExp(`${property}:\\s*([^;]+);`).exec(block);
    return match?.[1]?.trim();
  }

  const LEVELS = [
    '.wave-docs-prose h1',
    '.wave-docs-prose h2',
    '.wave-docs-prose h3',
    '.wave-docs-prose h4',
    '.wave-docs-prose :is(h5, h6)',
  ] as const;

  /**
   * The old scale shared `line-height: 1.25` across all six levels, so the 36px
   * h1 floated apart and the 16px h5 crowded. Leading has to fall as size
   * rises; a single shared value is the signature of a scale nobody set.
   */
  it('gives every level its own leading, rising as size falls', () => {
    const leading = LEVELS.map((selector) => {
      const value = decl(selector, 'line-height');
      expect(value, `${selector} declares no line-height`).toBeDefined();
      return Number(value);
    });

    expect(new Set(leading).size, `shared leading: ${leading}`).toBe(
      leading.length,
    );
    for (let i = 1; i < leading.length; i += 1) {
      expect(
        leading[i],
        `${LEVELS[i]} does not lead looser than ${LEVELS[i - 1]}`,
      ).toBeGreaterThan(leading[i - 1] as number);
    }
  });

  /**
   * h5 and h6 were the same size and weight as body text, differing only in
   * colour — a coloured paragraph, not a hierarchy level. Two more steps of a
   * 1.2 scale would land inside a rounding error of the body, so the
   * distinction moves to a different axis.
   */
  it('makes h5/h6 an eyebrow rather than a fifth indistinguishable size', () => {
    const eyebrow = readBlock(
      sheet,
      sheet.indexOf('.wave-docs-prose :is(h5, h6) {'),
    );
    expect(eyebrow).toContain('text-transform: uppercase');
    expect(eyebrow).toContain('letter-spacing');
    expect(decl('.wave-docs-prose :is(h5, h6)', 'font-size')).not.toBe('1rem');
  });

  /**
   * A full-width hairline under every h2 is the loudest "rendered GitHub
   * README" signal a page carries. The opt-in ships in the same commit as the
   * deletion, because otherwise the first consumer who wants rules forks.
   */
  it('rules no h2, and offers the opt-in that replaces it', () => {
    const h2 = readBlock(sheet, sheet.indexOf('.wave-docs-prose h2 {'));
    expect(h2).not.toContain('border-block-end');

    const optIn = readBlock(
      sheet,
      sheet.indexOf('.wave-docs-prose[data-rules] > h2 {'),
    );
    expect(optIn).toContain('border-block-end');
  });

  it('does not italicise blockquotes', () => {
    // The rule and the muted colour already say "quotation", and markdown
    // authors use blockquotes for asides, not only for speech.
    const quote = readBlock(
      sheet,
      sheet.indexOf('.wave-docs-prose blockquote {'),
    );
    expect(quote).toContain('font-style: normal');
  });

  it('sizes only the h1 fluidly', () => {
    // Fluid type against a fixed measure means characters-per-line drifts and
    // the measure token stops meaning what it says — but a fixed h1 wraps an
    // ordinary title to three lines at 390px.
    expect(decl('.wave-docs-prose h1', 'font-size')).toContain('clamp(');
    for (const selector of LEVELS.slice(1)) {
      expect(decl(selector, 'font-size')).not.toContain('clamp(');
    }
  });
});

describe('tables', () => {
  const table = readBlock(sheet, sheet.indexOf('.wave-docs-table {'));
  const scroll = readBlock(sheet, sheet.indexOf('.wave-docs-table-scroll {'));

  /**
   * `width: 100%` is not a floor. Auto table layout floors at min-content, and
   * `.wave-docs-prose a { overflow-wrap: anywhere }` collapses a link-bearing
   * column's min-content to about one character — `anywhere` affects intrinsic
   * sizing where `break-word` does not (CSS Text 3). So an API table fitted
   * 320px without overflowing, at five lines per row.
   */
  it('declares a minimum width, not just a percentage', () => {
    expect(table).toContain('width: 100%');
    expect(table).toContain('min-width: 40rem');

    /*
     * NOT `min(100%, 40rem)`. That spelling looks like the same floor and is a
     * no-op at exactly the widths it governs: the `100%` resolves against the
     * box being floored, so in a 318px scroll container it computes to 318px —
     * the container's own width — and the table squeezes exactly as it did
     * before. The browser tier caught it at 318 vs 318; this keeps it from
     * coming back as a tidy-up.
     */
    expect(table).not.toContain('min(100%');
  });

  /**
   * The comment is the finding. Without it the next reader sees a link rule and
   * a table rule with no connection between them, and `anywhere` looks like a
   * safe tidy-up.
   */
  it('records why the link rule is what sizes the table', () => {
    expect(sheet).toContain('overflow-wrap: anywhere');
    // Against the raw sheet: this assertion is *about* the comment.
    const documented = readBlock(
      rawSheet,
      rawSheet.indexOf('.wave-docs-table {'),
    );
    expect(documented).toMatch(/anywhere/);
    expect(documented).toMatch(/intrinsic/);
  });

  /** With `border-collapse: collapse` the border belongs to the table, so it
   * scrolls out from under a sticky header. */
  it('holds the header down with a shadow rather than a border', () => {
    const head = readBlock(sheet, sheet.indexOf('.wave-docs-table thead th {'));
    expect(head).toContain('position: sticky');
    expect(head).toContain('box-shadow: inset');
    expect(head).not.toContain('border-block-end');
  });

  /**
   * Four gradients, two `local` and two `scroll`, are what make the affordance
   * stateless — the covers travel with the content and uncover the shadow only
   * on the side that has more to show. Losing either pair silently turns it
   * into a permanent shadow on both edges.
   */
  it('shows which way a wide table scrolls, without JavaScript', () => {
    expect(scroll.match(/no-repeat local/g)).toHaveLength(2);
    expect(scroll.match(/no-repeat scroll/g)).toHaveLength(2);
  });
});

describe('reflow at 320px', () => {
  /** The declarations of a rule, by selector. */
  function readRule(selector: string): string {
    const at = sheet.indexOf(`${selector} {`);
    expect(at, `${selector} not found in styles.css`).toBeGreaterThan(-1);
    return readBlock(sheet, at);
  }

  it('breaks a long token rather than the page', () => {
    // Measured at 320x640 before this landed: a sha256 digest in a paragraph
    // took the page to scrollWidth 553, a long heading word to 784, a long word
    // in a list item to 537. WCAG 1.4.10 fails at the width it names.
    expect(readRule('.wave-docs-prose')).toContain('overflow-wrap: break-word');
    // A link label is often a single unbreakable token (`/api/v1/some/path`),
    // and `break-word` only breaks a word that would overflow a line of its own.
    expect(readRule('.wave-docs-prose a')).toContain('overflow-wrap: anywhere');
  });

  it('never reaches for word-break', () => {
    // A bare autolinked URL already breaks after `/` under UAX#14, and
    // `word-break: keep-all` would take that away while `break-all` would chop
    // ordinary prose mid-syllable.
    expect(sheet).not.toContain('word-break');
  });
});

describe('the skip link', () => {
  /**
   * The declarations of a rule. The first match wins, which is the base rule:
   * the only later repeat of a skip-link selector is inside the reduced-motion
   * query, and it sets nothing but a transition.
   */
  function readRule(selector: string): string {
    const at = sheet.indexOf(`${selector} {`);
    expect(at, `${selector} not found in styles.css`).toBeGreaterThan(-1);
    return readBlock(sheet, at);
  }

  it('is moved out of view rather than hidden, so it stays focusable', () => {
    const resting = readRule('.wave-docs-skip-link');

    expect(resting).toContain('transform: translateY(-150%)');
    // `display: none` and `visibility: hidden` both remove an element from the
    // tab order, and a skip link nobody can focus is worse than none.
    expect(resting).not.toContain('display: none');
    expect(resting).not.toContain('visibility: hidden');
  });

  it('comes back into view on plain focus, not only focus-visible', () => {
    // A host that focuses this link on a client-side route change does so
    // programmatically, and `:focus-visible` does not match a programmatic focus
    // that followed a pointer interaction — the reader would have a focused
    // control parked off-screen with no indicator anywhere on the page.
    expect(readRule('.wave-docs-skip-link:focus')).toContain(
      'transform: translateY(0)',
    );
    expect(sheet).not.toContain('.wave-docs-skip-link:focus-visible');
  });
});

describe('the converter itself', () => {
  it('bounds out at the definitional 21:1', () => {
    expect(contrast([0, 0, 0], [1, 0, 0])).toBeCloseTo(21, 5);
  });

  it('keeps a neutral colour neutral', () => {
    // A zero-chroma OKLCh is grey, and its linear channels are L³ — which only
    // holds if each row of the OKLab→linear-sRGB matrix sums to 1. A single
    // mistyped coefficient shows up here as a colour cast.
    for (const channel of toLinearSrgb([0.5, 0, 0])) {
      expect(channel).toBeCloseTo(0.125, 6);
    }
  });

  it('matches the ratio computed by hand from the brand hex', () => {
    // `--wave-docs-accent` in light is Wave Blue darkened to #006EC8. By hand:
    // linear g = ((110/255 + 0.055)/1.055)^2.4 = 0.1560, linear b = 0.5776, so
    // luminance = 0.7152·0.1560 + 0.0722·0.5776 = 0.1533 and the ratio against
    // white is 1.05/0.2033 = 5.16.
    const accent = readTokens(sheet, ':root {').get('accent');
    if (accent === undefined) {
      throw new Error('styles.css defines no --wave-docs-accent in :root');
    }
    expect(contrast(accent, [1, 0, 0])).toBeCloseTo(5.16, 1);
  });
});
