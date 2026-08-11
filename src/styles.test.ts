/**
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

/** The three token blocks: `:root`, the media query, the attribute override. */
const BLOCK_SELECTORS = [
  ':root {',
  ":root:not([data-theme='light'])",
  ":root[data-theme='dark']",
] as const;

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

/**
 * Every foreground/background pair the stylesheet actually composes.
 *
 * Each one names the rule that puts them together, because the list is only
 * trustworthy if it can be re-derived from the CSS.
 */
const PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  ['fg', 'bg', 'prose body'],
  ['fg', 'bg-subtle', 'table headers, sidebar hover, kbd'],
  ['fg-muted', 'bg', 'blockquotes, search status'],
  ['fg-muted', 'bg-subtle', 'sidebar links'],
  ['fg-subtle', 'bg', 'list markers, TOC, search breadcrumbs'],
  ['fg-subtle', 'bg-subtle', 'search trigger kbd hint'],
  ['fg-subtle', 'accent-subtle', 'breadcrumb of the highlighted result'],
  ['fg', 'accent-subtle', 'heading of the highlighted result'],
  ['accent', 'bg', 'links'],
  ['accent', 'bg-subtle', 'links on a tinted row'],
  ['accent', 'accent-subtle', 'active sidebar link'],
  ['accent-hover', 'bg', 'hovered links'],
  ['accent-fg', 'accent', 'skip link'],
  ['code-fg', 'code-bg', 'inline code'],
  ['callout-caution', 'bg', 'search error text'],
  ...(['note', 'tip', 'important', 'warning', 'caution'] as const).flatMap(
    (kind) =>
      [
        [`callout-${kind}`, `callout-${kind}-bg`, `${kind} callout label`],
        ['fg', `callout-${kind}-bg`, `${kind} callout body`],
      ] as const,
  ),
];

const css = await readFile(STYLESHEET, 'utf8');

describe.each(BLOCK_SELECTORS)('tokens in %s', (selector) => {
  const tokens = readTokens(css, selector);

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
    const accent = readTokens(css, ':root {').get('accent');
    if (accent === undefined) {
      throw new Error('styles.css defines no --wave-docs-accent in :root');
    }
    expect(contrast(accent, [1, 0, 0])).toBeCloseTo(5.16, 1);
  });
});
