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
import { CODE_ICON_PATHS, CODE_ICON_STATES } from './code-frame.js';

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

describe('the dark ramp', () => {
  /**
   * ⚠️ EVERY COLOUR TOKEN THE LIGHT BLOCK DEFINES, REDEFINED IN BOTH DARK
   * BLOCKS. Nothing checked this, and the way the gap showed up was not a
   * missing token at all — the table's horizontal-scroll shadow was written as
   * a literal `oklch(0 0 0 / 0.12)` inside the rule, so there was no token to
   * miss. Black at 12% over a `0.19` background is invisible, which left a dark
   * reader with no indication that a wide table scrolled sideways.
   *
   * Making it a token fixed that instance. This is what stops the next one:
   * a colour that only exists in the light block is a colour some reader sees
   * the light version of.
   */
  const light = readTokens(sheet, ':root {');

  it.each([":root[data-theme='system']", ":root[data-theme='dark']"])(
    '%s redefines every colour token the light block sets',
    (selector) => {
      const dark = readTokens(sheet, selector);
      const missing = [...light.keys()].filter((name) => !dark.has(name));

      // The guard on the guard: an empty light ramp would make this vacuous.
      expect(light.size).toBeGreaterThan(20);
      expect(missing).toEqual([]);
    },
  );

  /**
   * Literal colours that are right in both themes, each for a stated reason.
   *
   * An allowlist rather than an exemption for whole rules: a new literal has to
   * be argued for here, which is the conversation the table's invisible shadow
   * never had.
   */
  const THEME_INDEPENDENT: ReadonlySet<string> = new Set([
    // Player chrome, over a video thumbnail rather than over the page. A
    // letterbox is black, YouTube's play badge is dark grey with a white
    // arrow, and it turns YouTube red on hover — in every theme, because the
    // reader is looking at a video, not at the page.
    'oklch(0 0 0)',
    'oklch(0.3 0 0 / 0.75)',
    'oklch(1 0 0)',
    'oklch(0.55 0.22 27)',
    // Modal scrims, for the drawer and the search dialog. A scrim dims what is
    // behind it, and dimming is dark on a light page and dark on a dark one —
    // inverting it on the dark ramp would brighten the page under a modal.
    'oklch(0.2 0.02 262 / 0.55)',
    'oklch(0.2 0.02 265 / 0.5)',
  ]);

  it('leaves no bare oklch() outside the token blocks', () => {
    /*
     * The rule that actually bit. A literal colour in a component rule cannot
     * respond to the theme, so it is right in exactly one of them — and the
     * test above cannot see it, because it is not a token.
     *
     * `transparent`, `currentColor` and `color-mix()` are all theme-following
     * and stay allowed; this is only about a fixed `oklch()`.
     */
    const blocks = BLOCK_SELECTORS.map((selector) =>
      readBlock(sheet, sheet.indexOf(selector)),
    );
    const outside = blocks.reduce(
      (rest, block) => rest.replace(block, ''),
      sheet,
    );

    const literals = [...outside.matchAll(/oklch\([^)]*\)/g)]
      .map((match) => match[0])
      .filter((colour) => !THEME_INDEPENDENT.has(colour));

    expect(literals).toEqual([]);
  });
});

describe('the copy button', () => {
  /*
   * By prelude rather than by `indexOf`, because the built sheet wraps a long
   * selector across lines and a `toContain` on the spelling here fails against
   * a rule that is present and correct. `readRules` collapses the whitespace
   * for exactly this.
   */
  const iconRule = (state: string, icon: string) =>
    RULES.find(
      (rule) =>
        rule.prelude.includes(`[data-copied='${state}']`) &&
        rule.prelude.includes(`[data-state='${icon}']`),
    );

  /**
   * Both states the runtime writes have a rule, not just the happy one.
   *
   * ⚠️ `data-copied="false"` HAD NONE. The runtime set it from the beginning
   * and announced "Copy failed. Select the code and press Control or Command +
   * C." into a live region — so a screen-reader user was told and a sighted
   * user watched a button do nothing at all. The most common way to reach it is
   * not exotic: `next dev` opened from a phone over `http://192.168.x.x:3000`
   * is not a secure context, `navigator.clipboard` is undefined there, and no
   * amount of pressing again will help.
   *
   * The attribute reaching the DOM is `code-runtime.test.tsx`; that CSS acts on
   * it is here, because the two halves fail independently and each looks
   * correct on its own.
   */
  it.each([
    ['true', 'copied'],
    ['false', 'failed'],
  ])('gives data-copied="%s" a visible treatment', (state, icon) => {
    const selector = `.wave-docs-code__copy[data-copied='${state}']`;
    expect(sheet).toContain(`${selector} {`);

    const block = readBlock(sheet, sheet.indexOf(`${selector} {`));
    // A colour, so the button changes rather than merely carrying an
    // attribute — and its own icon, so the change is not colour alone
    // (WCAG 1.4.1).
    expect(block).toMatch(/color:/);
    expect(
      iconRule(state, icon),
      `no rule shows the ${icon} icon`,
    ).toBeDefined();
  });

  /**
   * ⚠️ `display`, NOT `visibility`, AND THE DIFFERENCE IS A REAL DEFECT.
   *
   * The button is `visibility: hidden` until the runtime attaches — which is
   * what keeps a reader with no JavaScript from meeting a control that does
   * nothing, and keeps it out of the tab order. `visibility` inherits, so an
   * icon rule setting it back to `visible` would draw a glyph inside a button
   * that is supposed to be invisible. `display` does not inherit.
   */
  it('swaps its icons with a property that does not inherit', () => {
    for (const [state, icon] of [
      ['true', 'copied'],
      ['false', 'failed'],
    ] as const) {
      const rule = iconRule(state, icon);
      if (rule === undefined) throw new Error(`no rule for ${icon}`);

      const shown = readBlock(sheet, rule.at);
      expect(shown).toContain('display:');
      expect(shown).not.toContain('visibility:');
    }
  });

  it('tells the two states apart by more than colour', () => {
    // Success is a tick and failure a cross; identical glyphs would make the
    // pair distinguishable only by hue.
    expect(CODE_ICON_PATHS.check).not.toEqual(CODE_ICON_PATHS.x);
    // And all three states draw something, so none of them is a blank button.
    for (const [, name] of CODE_ICON_STATES) {
      expect(CODE_ICON_PATHS[name].length).toBeGreaterThan(0);
    }
  });
});

describe('the label sizes', () => {
  /**
   * ⚠️ A PANEL TITLE AND A COLUMN HEADER ARE THE SAME SIZE, AND A PAGE SHOWS
   * BOTH.
   *
   * "Where to go next" and `Enforced by` are the same kind of thing: the label
   * a reader's eye lands on before the content under it. At 14px against the
   * table's 15px they read as two different levels rather than as one.
   *
   * Pinned rather than tokenised: one shared value across two components does
   * not earn a token, but two literals that have to agree are two literals that
   * drift, so this is the thing that notices.
   */
  it('sizes a panel title like a column header', () => {
    const title = readBlock(sheet, sheet.indexOf('.wave-docs-panel__title {'));
    const table = readBlock(sheet, sheet.indexOf('.wave-docs-table {'));

    const size = (block: string): string | undefined =>
      /font-size:\s*([^;]+);/.exec(block)?.[1]?.trim();

    expect(size(title)).toBeDefined();
    expect(size(title)).toBe(size(table));
  });

  /**
   * The weight does not follow. A panel title names the block; a column header
   * names a column inside one, so the title sits one step heavier.
   */
  it('keeps the title a step heavier than the header', () => {
    const title = readBlock(sheet, sheet.indexOf('.wave-docs-panel__title {'));
    const header = readBlock(sheet, sheet.indexOf('.wave-docs-table th {'));

    const weight = (block: string): number =>
      Number.parseInt(/font-weight:\s*(\d+)/.exec(block)?.[1] ?? '0', 10);

    expect(weight(title)).toBeGreaterThan(weight(header));
  });
});

describe('the radius tiers', () => {
  /**
   * ⚠️ WHICH RADIUS A BOX TAKES IS DECIDED BY WHAT KIND OF BOX IT IS, NOT BY
   * HOW BIG IT HAPPENS TO BE — AND THE BLOCK TIER WAS SPLIT.
   *
   * Callouts, images and embeds sat at the base radius while a code frame and a
   * table sat at `-lg`, which was 19px. Two blocks a paragraph apart disagreed
   * by eleven pixels, and a table read as aggressively round next to the
   * callout above it. 19 was measured off a reference site, which is a fine way
   * to pick a number and a bad way to pick a system.
   *
   * This is the list. A new block in the reading flow belongs on it; a new
   * *control* does not, and that is the distinction to defend.
   */
  it.each([
    '.wave-docs-prose blockquote',
    '.wave-docs-callout',
    '.wave-docs-image',
    '.wave-docs-youtube',
    '.wave-docs-prose pre:not(.shiki)',
    '.wave-docs-table-scroll',
    '.wave-docs-panel',
  ])('gives %s the block radius', (selector) => {
    const block = readBlock(sheet, sheet.indexOf(`${selector} {`));
    expect(block).toContain('border-radius: var(--wave-docs-radius-lg)');
  });

  /**
   * The panel's inset surface is the frame minus the frame's padding, or the
   * corners run at different curvatures and the surface reads as pasted onto
   * the frame rather than set into it. `12 - 4 = 8` is the base radius, which
   * is why there is no token of its own for it any more: a
   * `--wave-docs-radius-panel` whose only job is to be another token minus a
   * constant is a number that can drift from its own definition.
   */
  /**
   * ⚠️ THE TIERS ARE DERIVED FROM ONE ROOT, WHICH IS THE OVERRIDE POINT.
   *
   * A host already running `@waveso/ui` writes `--wave-docs-radius-base:
   * var(--radius)` and the whole scale follows their app. Three separate
   * literals would be three chances to break the concentric arithmetic and
   * three lines for that host to keep in step by hand.
   */
  it('derives every tier from the root rather than declaring three numbers', () => {
    const root = readBlock(sheet, sheet.indexOf(':root {'));

    expect(root).toContain('--wave-docs-radius-base:');
    for (const tier of ['--wave-docs-radius-sm:', '--wave-docs-radius-lg:']) {
      const line = root.slice(root.indexOf(tier));
      expect(line.slice(0, line.indexOf(';'))).toContain(
        'var(--wave-docs-radius-base)',
      );
    }
    expect(root).toContain('--wave-docs-radius: var(--wave-docs-radius-base)');

    // One token whose only job was to be another token minus a constant.
    expect(sheet).not.toContain('--wave-docs-radius-panel');
  });

  /**
   * ⚠️ THE PANEL'S PADDING IS THE STEP TOKEN, NOT A LITERAL THAT MATCHES IT.
   *
   * The inset surface takes the base radius and the frame takes `-lg`, which is
   * the base plus one step — so the two corners are concentric only while the
   * padding *is* that step. As `4px` they agree today and drift the first time
   * anyone retunes the scale, including the squircle bump below. The pixels are
   * measured in the browser tier; this is the construction.
   */
  it('pays the panel its padding out of the same step the tiers use', () => {
    const panel = readBlock(sheet, sheet.indexOf('.wave-docs-panel {'));
    expect(panel).toContain('padding: var(--wave-docs-radius-step)');
  });

  /**
   * ⚠️ A SQUIRCLE READS TIGHTER, SO THE ROOT MOVES — AND ONLY THE ROOT.
   *
   * `@waveso/ui` bumps `--radius` under the same `@supports`, to the same
   * value, and the two have to agree or a page running both shows two corners.
   * Every tier is a `calc()` off the root and the padding is the step, so the
   * arithmetic survives the bump untouched.
   */
  it('moves only the root when squircles are live', () => {
    const at = RULES.find((rule) =>
      rule.prelude.includes('corner-shape: squircle'),
    );
    expect(at, 'no @supports for corner-shape').toBeDefined();

    const block = readBlock(sheet, at?.at ?? 0);
    expect(block).toContain('--wave-docs-radius-base:');
    expect(block).not.toContain('--wave-docs-radius-sm:');
    expect(block).not.toContain('--wave-docs-radius-lg:');
  });

  /**
   * ⚠️ THE SQUIRCLE RULE IS SCOPED TO ELEMENTS THIS PACKAGE OWNS, NOT `*`.
   *
   * `@waveso/ui` can say `*` because it is the application's own stylesheet.
   * This one is mounted inside somebody else's page, and a bare `*` would
   * reshape every corner the host drew — the same trespass as claiming `html`
   * or `body`, which this file already refuses.
   */
  it('shapes only its own corners', () => {
    /*
     * Leaf rules only. `readBlock` on an at-rule returns everything nested
     * inside it, so `@layer components` "contains" `corner-shape` and the
     * first spelling of this test failed on the layer that holds the rule.
     */
    const selectors = RULES.filter((rule) => {
      if (rule.prelude.startsWith('@')) return false;
      const block = readBlock(sheet, rule.at);
      return block.includes('corner-shape:') && block.indexOf('{', 1) === -1;
    }).flatMap((rule) => splitSelectors(rule.prelude));

    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector, `${selector} is not ours`).toMatch(/wave-docs-/);
    }
  });
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
      /*
       * The property is "`.wave-docs-prose` is an ancestor scope", not "the
       * two class names are adjacent in the selector". This asserted the
       * literal substring `.wave-docs-prose .shiki` until the code frame
       * landed, at which point a correctly-scoped
       * `.wave-docs-prose .wave-docs-code:has(…) .shiki` failed it — a rule
       * that was doing exactly what this test exists to require.
       *
       * What must never appear is a `.shiki` selector that does not name our
       * prose at all: unlayered or not, it would restyle the output of any
       * other package rendering Shiki on the same page.
       */
      expect(selector, `${selector} styles .shiki globally`).toMatch(
        /(^|[\s,])\.wave-docs-prose[\s.:[]/,
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
    //
    // At a property boundary, not as a substring: `overscroll-behavior`
    // contains `scroll-behavior` and is a different property doing a different
    // job — it is what stops the sidebar chaining its scroll into the article.
    expect(sheet).not.toMatch(/(^|[\s;{])scroll-behavior\s*:/);

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

describe('blocks set apart from the prose', () => {
  /**
   * ⚠️ ONE UNIFORM BORDER, NOT A RULE DOWN ONE EDGE.
   *
   * A blockquote drew a 3px rule down its inline start and a callout drew one
   * in its accent, so the two blocks a reader meets most often were the only
   * ones that were not boxes — and beside a code frame or a table they read as
   * a different kind of thing rather than as quieter ones. A thick rule on one
   * side also fights the corner it runs into once the box is a squircle.
   *
   * The table-of-contents rail is deliberately not on this list: it is a
   * continuous line that an active marker slides along, which is a navigation
   * affordance rather than the edge of a box.
   */
  it.each(['.wave-docs-prose blockquote', '.wave-docs-callout'])(
    'gives %s the same border on every side',
    (selector) => {
      const block = readBlock(sheet, sheet.indexOf(`${selector} {`));

      expect(block).toMatch(/border:\s*1px solid/);
      for (const side of [
        'border-inline-start:',
        'border-inline-end:',
        'border-block-start:',
        'border-block-end:',
        'border-left:',
        'border-right:',
      ]) {
        expect(block, `${selector} overrides ${side}`).not.toContain(side);
      }
    },
  );
});

describe('focus indicators', () => {
  const declared = focusSelectors(RULES);

  it('has one for every focusable surface in the package', () => {
    // The skip link, prose links, the sidebar, the TOC, the YouTube facade, the
    // table scroll region, the Shiki `<pre>` (Shiki gives it `tabindex="0"`),
    // the search trigger, its input row, the close button and the copy button.
    expect(declared.length).toBeGreaterThanOrEqual(10);
  });

  /**
   * ⚠️ A BORDER IS NOT A FOCUS INDICATOR, AND THIS CONTROL HAD ONLY A BORDER.
   *
   * The copy button drew a 1px box at rest — present whether it was focused or
   * not — so a keyboard reader tabbing onto it got a `color` change and nothing
   * else, and it never appeared in this inventory. Taking the border away for
   * the design made the hole visible; it did not create it.
   */
  it('covers the copy button, which had none behind its border', () => {
    expect(declared).toContain('.wave-docs-code__copy:focus-visible');
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

      /*
       * ⚠️ EVERY RULE FOR THIS SELECTOR, NOT THE FIRST ONE.
       *
       * Twice now a second rule for a focus selector has broken this. First
       * `indexOf` matched `…:focus-visible` *inside* `…:focus-visible::before`
       * — a different rule, about pseudo-elements. Pinning it to a whole
       * selector fixed that and left the real problem: a selector may
       * legitimately appear in several rules, and the sidebar trigger now has
       * one that sets custom properties on focus and one that draws the ring.
       * Taking either "the first" or "the last" is a coin flip on file order.
       *
       * The claim is that the indicator exists *somewhere*, so read them all
       * and ask for one.
       */
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const blocks = [
        ...sheet.matchAll(new RegExp(`${escaped}\\s*[,{]`, 'g')),
      ].map((match) => readBlock(sheet, match.index ?? 0));

      expect(blocks.length, `${selector} has no rule`).toBeGreaterThan(0);
      expect(
        blocks.some((block) =>
          /outline:\s*\d+px solid (?!transparent)/.test(block),
        ),
        `${selector} declares no outline in any of its ${blocks.length} rule(s)`,
      ).toBe(true);
    }
  });

  /**
   * ⚠️ THE ACTIVE RESULT IS MARKED BY MORE THAN ITS TINT, AND WHAT CARRIES THAT
   * HAS BEEN THREE THINGS.
   *
   * Every result is `tabindex="-1"` — `:focus-visible` cannot fire on one — so
   * the active class is the only indication of where the keyboard is. It was a
   * 2px accent ring, which read as a component borrowed from somewhere else and
   * came and went as a reader arrowed. It was briefly the trigger's border pair,
   * which meant bordering *every* row to make one edge legible — a list turned
   * into a stack of cards. It is a tint and an ink now.
   *
   * ⚠️ AND THE INK IS THE PART THAT KEEPS THE STATE PERCEIVABLE. A tint alone is
   * 1.12:1, under the 3:1 WCAG 1.4.11 asks of a state indicator; `accent` on
   * `accent-subtle` is 4.60:1 light and 6.30:1 dark, which is text contrast
   * rather than non-text and is the pair the sidebar's current-page row ships.
   * What this forbids is the tint being left to carry the state alone.
   */
  it('marks the active search result with more than a tint', () => {
    const active = readBlock(
      sheet,
      sheet.indexOf('.wave-docs-search-result-active {'),
    );
    expect(active).toContain('background: var(--wave-docs-accent-subtle)');

    const ink = RULES.filter(
      (rule) =>
        rule.prelude.includes('.wave-docs-search-result-active') &&
        rule.prelude.includes('.wave-docs-search-result-heading'),
    );
    expect(ink, 'the active heading takes no accent ink').toHaveLength(1);
    expect(readBlock(sheet, ink[0]?.at ?? 0)).toContain(
      'color: var(--wave-docs-accent)',
    );

    /*
     * A row is a list item and its state is a colour; the field above it is a
     * control and wears the trigger's border. Bordering rows to mark one of
     * them is what turned the list into a stack of cards.
     */
    const base = readBlock(sheet, sheet.indexOf('.wave-docs-search-result {'));
    expect(base).not.toContain('border:');

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
   * Both are public tokens a consumer may set, and they are layered — so a
   * consumer's own unlayered `:root` still wins, which is the promise the
   * README makes.
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

  /**
   * ⚠️ NO RULE AND NO TINT UNDER THE HEADER, AND IT HAD BOTH.
   *
   * It was `--wave-docs-bg-subtle` — which is the panel frame's own tone, so
   * inside the frame it painted a band of the frame's colour immediately
   * within the surface's border — plus a `box-shadow: inset 0 -1px 0`, making
   * three horizontal lines inside about six pixels. Weight is what says
   * "header", the same way "where to go next" gives its title neither.
   *
   * ⚠️ AND IF A RULE EVER COMES BACK IT MUST NOT BE `border-block-end`. With
   * `border-collapse: collapse` the border belongs to the table rather than to
   * the cell, so it scrolls out from under a sticky header instead of staying
   * with it — which is why the thing that was here was a shadow.
   */
  /**
   * ⚠️ THE TABLE DOES NOT WEAR `.wave-docs-panel`, AND IT DID FOR FIVE COMMITS.
   *
   * The panel — frame, header band, inset card — exists to separate *chrome*
   * from *content*. "Where to go next" and a code frame both have chrome for
   * that band: a title, a language, a copy button. A table's header row is
   * data. Setting the body into a card away from its own header cost three
   * vertical rules down each side, stopped the row dividers short of the box
   * and narrowed the reading width, on the densest element on a page.
   *
   * What is kept is the outer radius, so a table and a code block still read as
   * two of one family. This pins that: one frame, at the panel's radius.
   */
  it('draws one frame, at the panel radius rather than a panel', () => {
    expect(scroll).toContain('border: 1px solid var(--wave-docs-border)');
    expect(scroll).toContain('var(--wave-docs-radius-lg)');
    expect(scroll).not.toContain('wave-docs-panel');

    // With `border-collapse: collapse` a border belongs to the table rather
    // than the cell, so it scrolls out from under a sticky header — which is
    // why the header's own separator is a shadow.
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

describe('the responsive shell', () => {
  const widthQueries = RULES.filter((rule) =>
    /^@container wave-docs \(min-width/.test(rule.prelude),
  ).map((rule) => rule.prelude);

  /**
   * ⚠️ `@container`, AND NOT ONE WIDTH-BASED `@media` ANYWHERE.
   *
   * This package is mounted at `/docs` inside applications that own the rest of
   * the page. `@media` asks how wide the *screen* is, which is the wrong
   * question: a host who puts this in a 700px panel on a 1920px monitor gets
   * the wide layout and a reading column of about 60px — the same class of
   * failure as the fixed header, arriving from a direction no breakpoint can
   * see.
   *
   * The other half of the assertion is that no width `@media` sneaks back in
   * beside them, because one that disagrees with a container query is a layout
   * nobody can reproduce.
   */
  it('adapts to its container, never to the viewport', () => {
    expect(widthQueries.length).toBeGreaterThanOrEqual(2);
    for (const prelude of widthQueries) {
      // `rem`, so a reader who raises their base font size gets the
      // single-column layout at a proportionally larger container.
      expect(prelude, `${prelude} is not in rem`).toMatch(/\d+rem/);
    }

    const media = RULES.filter((rule) =>
      /^@media[^{]*\((min|max)-width/.test(rule.prelude),
    ).map((rule) => rule.prelude);
    expect(media).toEqual([]);
  });

  /**
   * `1fr` is `minmax(auto, 1fr)`, and `auto` floors at the content's
   * min-content width — so one wide table pushes the track past the viewport
   * and takes the document into horizontal scroll, with the prose column
   * computing to 0. Invisible to every unit test; the browser tier is what
   * proves the geometry, and this is what stops the shorthand coming back.
   */
  it('never sizes a content track with a bare 1fr', () => {
    const tracks = [...sheet.matchAll(/grid-template-columns:\s*([^;]+);/g)];
    expect(tracks.length).toBeGreaterThan(0);

    /*
     * ⚠️ THE RULE IS "NO BARE `1fr`", NOT "ALWAYS `minmax(0, 1fr)`", AND THIS
     * ASSERTED THE SECOND.
     *
     * It was written when every grid in the sheet was the shell, where a `1fr`
     * content track is the defect it measures. The table scroller is a grid
     * now too and its track is `max-content` — not a bare `1fr`, not capable of
     * the failure, and rejected anyway by a test that required a spelling
     * rather than forbidding one. Widening it to what it means costs nothing:
     * a bare `1fr` still fails, everywhere.
     */
    for (const [, value] of tracks) {
      // The `1fr` inside `minmax(0, 1fr)` is the correct one, so remove every
      // minmax before looking for a bare one.
      const outside = (value ?? '').replace(/minmax\([^)]*\)/g, '');
      expect(outside, `bare 1fr in "${value?.trim()}"`).not.toContain('1fr');
    }

    /*
     * And the shell's own tracks — the ones the 1048px-in-1024px overflow was
     * measured against — still carry the guard rather than having quietly lost
     * it to the rule above.
     *
     * Scoped by selector, not by "any track mentioning 1fr". The table scroller
     * is a grid too and uses `minmax(max-content, 1fr)`, which is correct there
     * and cannot cause the shell's failure: it lives inside `overflow-x: auto`,
     * so what it overflows is clipped and scrolled rather than escaping to the
     * document.
     */
    const shellTracks = RULES.filter((rule) =>
      splitSelectors(rule.prelude).some((selector) =>
        selector.startsWith('.wave-docs-layout'),
      ),
    )
      .map((rule) => readBlock(sheet, rule.at))
      .filter((block) => block.includes('grid-template-columns'));

    expect(shellTracks.length).toBeGreaterThan(0);
    for (const block of shellTracks) {
      expect(block, 'a shell track lost minmax(0, 1fr)').toContain(
        'minmax(0, 1fr)',
      );
    }

    expect(
      readBlock(sheet, sheet.indexOf('.wave-docs-layout__main {')),
    ).toContain('min-width: 0');
  });

  /**
   * The TOC element is in the DOM at every width and only its `display`
   * changes, so a top-level `:has()` reserves a column of nothing on a phone —
   * measured, it squeezed the article to 94px at 390px.
   */
  it('reserves the TOC column only inside its breakpoint', () => {
    const at = sheet.indexOf('.wave-docs-layout:has(');
    expect(at, ':has() rule missing').toBeGreaterThan(-1);

    const query = sheet.lastIndexOf('@container wave-docs (min-width', at);
    expect(query, ':has() is not inside a width query').toBeGreaterThan(-1);
    expect(sheet.slice(query, sheet.indexOf('{', query))).toContain('80rem');
  });

  /**
   * `vh` is the viewport with a mobile URL bar retracted, so anything sized
   * against it is taller than what the reader can see: the last nav items sit
   * under the browser chrome, unreachable.
   */
  it('measures the viewport with dvh, never vh', () => {
    expect(sheet).not.toMatch(/\d\s*vh\b/);
    expect(sheet).toMatch(/dvh\b/);
  });

  /** Sticky columns scroll independently, and must not chain into the article. */
  it('contains the overscroll on every column that scrolls', () => {
    /*
     * ⚠️ FOUND BY THE PREDICATE, NOT BY POSITION. This used to take the first
     * `@media (min-width: 64rem)` in the file and then the first
     * `.wave-docs-layout__sidebar {` after it — which broke the moment a second
     * 64rem query was added earlier in the sheet for `--wave-docs-scroll-padding`,
     * and pointed at the strip shape instead of the column.
     *
     * The subject was never "the rule inside that query". It is every rule that
     * makes a container scroll, because that is what has overscroll to contain
     * and a viewport height to subtract. The strip is sticky and does not
     * scroll, so it is correctly not one of them.
     */
    const scrolling = RULES.filter((rule) => {
      const block = readBlock(sheet, rule.at);
      return (
        !rule.prelude.startsWith('@') &&
        block.includes('overflow-y: auto') &&
        /*
         * ⚠️ NOT `position: sticky`, AND THAT IS THE CHANGE. The sidebar's
         * scroller used to be the sticky box itself; it is the navigation
         * *inside* the sticky shell now, so a `sticky` predicate stopped seeing
         * it and this test went quietly down to one column.
         *
         * The subject is every rule that makes a *column* scroll. The search
         * results list scrolls too and is not one: it is inside a modal, which
         * has no page behind it to leak into — which is exactly what the
         * absence of `overscroll-behavior` on it says.
         */
        block.includes('overscroll-behavior: contain')
      );
    });

    const selectors = scrolling.flatMap((rule) => splitSelectors(rule.prelude));
    expect(selectors).toContain('.wave-docs-layout__sidebar-nav');
    expect(selectors).toContain('.wave-docs-layout__toc');

    /*
     * ⚠️ THE SCROLLER AND THE STICKY BOX ARE THE SAME ELEMENT AGAIN — AND THAT
     * IS THE SECOND TIME THIS MOVED, SO CHECK IT RATHER THAN ASSUMING.
     * The sidebar shell is the page's column and is not sticky at all; the
     * navigation inside it is sticky, one screen tall, and its own scroller.
     */
    for (const selector of [
      '.wave-docs-layout__sidebar-nav',
      '.wave-docs-layout__toc',
    ]) {
      // By predicate, not by first occurrence: `__toc` has two rules, and the
      // first is the `display: none` default with nothing in it to assert.
      const sticky = RULES.filter((rule) => {
        const block = readBlock(sheet, rule.at);
        return (
          splitSelectors(rule.prelude).includes(selector) &&
          block.includes('position: sticky')
        );
      });

      expect(sticky, selector).toHaveLength(1);
      const block = readBlock(sheet, sticky[0]?.at ?? -1);
      // `dvh`, so the last nav items are not under a mobile URL bar.
      expect(block, selector).toContain('dvh');
      expect(block, selector).toContain('--wave-docs-chrome-offset');
    }
  });

  /** Public class names with no rules are the worst of the three options. */
  it('defines every sidebar class the JSX emits', async () => {
    const jsx = await readFile(
      path.join(import.meta.dirname, 'react', 'sidebar.tsx'),
      'utf8',
    );
    const emitted = new Set(
      [...jsx.matchAll(/["'`](wave-docs-sidebar__[a-z-]+)["'`]/g)].map(
        (match) => match[1],
      ),
    );
    expect(emitted.size).toBeGreaterThan(0);

    const undefinedClasses = [...emitted].filter(
      (name) => !sheet.includes(`.${name}`),
    );
    expect(undefinedClasses).toEqual([]);
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

/**
 * The shell renders no header, and the rule that produced that is bigger than
 * the header.
 *
 * **Every persistent element this package renders is in normal flow, inside the
 * grid, and offsettable. Nothing is `position: fixed`.** Two elements in flow
 * push each other and both stay visible; a fixed element overlaps whatever is
 * beneath it and neither side can detect the collision — which is the whole
 * reason a documentation package can be dropped into an application that
 * already has chrome.
 *
 * Modals are exempt and always were: the search backdrop and the drawer are
 * top-layer, present only while open, and a host cannot collide with something
 * that is not there.
 */
describe('the chrome', () => {
  it('renders no header at all', () => {
    expect(sheet).not.toContain('.wave-docs-layout__header');
    expect(sheet).not.toContain('.wave-docs-layout__title');
    expect(sheet).not.toContain('.wave-docs-layout__actions');
  });

  /**
   * ⚠️ THE SHELL PAINTS NOTHING, AND THAT IS THE WHOLE STRUCTURE.
   *
   * Three boxes, one job each: the shell places, the navigation carries the
   * surface and the one border, the trigger carries neither. A background or a
   * border creeping onto the shell is a third surface to keep in step with the
   * other two, and it is what made the strip read as filled every previous time
   * this was drawn.
   *
   * It was `display: contents` below 64rem — no box at all — so the modal
   * drawer inside it could still paint. There is no drawer now, and no width at
   * which this is not a real box.
   */
  it('is a shell: it places its two children and paints nothing', () => {
    const block = readBlock(
      sheet,
      sheet.indexOf('.wave-docs-layout__sidebar {'),
    );
    expect(block).toContain('display: flex');
    expect(block).toContain('background: none');
    expect(block).toContain('border: 0');
    expect(block).not.toContain('display: contents');
    expect(block).not.toContain('display: none');
  });

  /**
   * ⚠️ ZERO SPACE BETWEEN THE NAVIGATION AND THE TRIGGER. The trigger sits
   * directly against the navigation's border — a gap there reads as the strip
   * being detached from the panel it moves.
   */
  it('leaves no gap between the navigation and the trigger', () => {
    const shell = readBlock(
      sheet,
      sheet.indexOf('.wave-docs-layout__sidebar {'),
    );
    expect(shell).toContain('gap: 0');

    const trigger = readBlock(
      sheet,
      sheet.indexOf('.wave-docs-layout__sidebar-trigger {'),
    );
    expect(trigger).not.toMatch(/margin/);
    // And no border on it, in any state — the navigation owns the only one.
    expect(trigger).toContain('border: 0');
    expect(trigger).toContain('background: none');
  });

  /**
   * ⚠️ THE TWO DECLARATIONS THAT MOVE THE SIDEBAR READ THE SAME TOKEN.
   *
   * The negative margin takes the navigation's room out of the grid and the
   * translate takes the navigation off the page, and they have to agree to the
   * pixel — disagree and the sidebar is either visible when closed or leaves a
   * hole when open. Docsify has this exact fragility: `--sidebar-width` appears
   * in the panel's width, the toggle's translate and the content's `left`, and
   * missing one detaches the button from the panel.
   *
   * This was `calc(var(--wave-docs-trigger-width) - 100%)` for a while — "minus
   * all of me, plus the trigger back" — which named only the strip. That held
   * while the strip had a width to name; it is `auto` now, sized by the button
   * inside it, so there is nothing to subtract and one token does both.
   */
  it('moves the sidebar and its track by the same token', () => {
    const block = readBlock(
      sheet,
      sheet.indexOf('.wave-docs-layout__sidebar {'),
    );
    const translate = /translate:\s*([^;]+);/.exec(block)?.[1] ?? '';
    const margin = /margin-inline-end:\s*([^;]+);/.exec(block)?.[1] ?? '';

    expect(translate).toContain('--wave-docs-sidebar-width');
    expect(margin).toContain('--wave-docs-sidebar-width');
    expect(translate.replace(/\s+/g, '')).toBe(margin.replace(/\s+/g, ''));
  });

  it('has no header-height and no bar-height token left', () => {
    expect(sheet).not.toContain('--wave-docs-header-height');
    expect(sheet).not.toContain('--wave-docs-bar-height');
    expect(sheet).toContain('--wave-docs-chrome-offset');
  });

  /**
   * ⚠️ THE LIST IS THE POINT, AND IT IS SHORT ON PURPOSE.
   *
   * A fixed element overlaps whatever is beneath it with neither side able to
   * detect the collision, which is why this package renders no bar across the
   * top: two of the sites using it have a fixed navbar of their own, and ours
   * landed on top of theirs at every width.
   *
   * Three, and they fall into two kinds.
   *
   * **Modal furniture**, which cannot collide with anything because it is only
   * rendered while a modal is open and the modal is in the top layer: the
   * search backdrop, and the drawer's close control.
   *
   * ⚠️ THE DRAWER'S TRIGGER USED TO BE ON THIS LIST AND IS NOT ANY MORE. It was
   * a `fixed` strip down the inline start edge, because the drawer it opened
   * was a modal over the page. There is no drawer: the sidebar is a grid item,
   * the trigger is a flex child of it, and the scrim is `absolute` inside the
   * layout — so every one of them resolves against a box this package owns and
   * a host placed, not against the viewport they share with it.
   *
   * **Anything else appearing in this list is a regression.**
   */
  it('positions nothing in the page flow as fixed', () => {
    const fixed = RULES.filter(
      (rule) =>
        !rule.prelude.startsWith('@') &&
        /position:\s*fixed/.test(readBlock(sheet, rule.at)),
    ).flatMap((rule) => splitSelectors(rule.prelude));

    expect(fixed.sort()).toEqual(['.wave-docs-search-backdrop']);
  });

  /**
   * Every sticky box starts at the host's offset rather than at a height of
   * ours, and every one subtracts the same token from `100dvh`. Getting one and
   * not the other leaves a box whose bottom is unreachable.
   *
   * ⚠️ THE SIDEBAR IS NOT ON THIS LIST, AND ITS ABSENCE IS THE FIX. It was
   * `sticky` with `height: 100dvh` — sized against the viewport while
   * positioned against the layout — so with the UA's 8px of `body` margin its
   * divider stopped 8px short of the top and ran 8px past the bottom, and
   * snapped into place the moment sticky engaged. It is the column in the page
   * now, stretched to the grid row; the two boxes *inside* it are what follow
   * the viewport, and they are what this covers.
   */
  it.each([
    '.wave-docs-layout__sidebar-nav',
    '.wave-docs-layout__sidebar-trigger',
    '.wave-docs-layout__toc',
  ])('starts %s at the host offset, wherever it is sticky', (selector) => {
    const sticky = RULES.filter((rule) => {
      const block = readBlock(sheet, rule.at);
      return (
        splitSelectors(rule.prelude).includes(selector) &&
        block.includes('position: sticky')
      );
    });

    expect(sticky.length).toBeGreaterThan(0);
    for (const rule of sticky) {
      expect(readBlock(sheet, rule.at)).toContain(
        'top: var(--wave-docs-chrome-offset)',
      );
    }
  });

  /**
   * And every column that subtracts the viewport subtracts the same token.
   * Getting `top` right and `max-height` wrong leaves a column whose last few
   * nav items cannot be scrolled to — the failure `dvh` was chosen against.
   */
  /**
   * ⚠️ ONE DERIVATION NOW, AND IT USED TO BE TWO — WITH ONE OF THEM MISSING.
   *
   * The sheet carried a `--wave-docs-bar-height` term below 64rem, because the
   * sidebar took a strip shape *above* the content there and a heading had to
   * clear it. The desktop override that dropped the term was described in a
   * comment and never declared, so every heading on a wide screen parked 3.5rem
   * too low: legal CSS, a plausible value, wrong at one of two widths, and no
   * test could see it.
   *
   * The sidebar is beside the content at every width now, so there is one value
   * and nothing of ours in it. What survives is the assertion that broke it:
   * exactly as many derivations as there are shapes, and the host's offset in
   * every one.
   */
  it('derives the scroll padding once, and never without the host offset', () => {
    const derivations = [
      ...sheet.matchAll(/--wave-docs-scroll-padding:\s*calc\(([^;]+)\);/g),
    ].map(([, value]) => (value ?? '').replace(/\s+/g, ' ').trim());

    expect(derivations).toEqual(['var(--wave-docs-chrome-offset) + 1rem']);
  });

  it('subtracts the host offset from every scrolling column', () => {
    /*
     * `height` or `max-height`: the sticky shell needs a definite height for
     * the scroller inside it, the TOC only needs a ceiling. Both subtract the
     * same token, and getting one and not the other leaves a column whose
     * bottom is unreachable.
     *
     * `[^)]+` stops at the `)` inside `var(…)`; match the whole function.
     */
    const subtractions = [
      ...sheet.matchAll(/(?:max-)?height: calc\(100dvh - (var\([^)]+\))\)/g),
    ];

    expect(subtractions.length).toBeGreaterThanOrEqual(2);
    for (const [, term] of subtractions) {
      expect(term).toBe('var(--wave-docs-chrome-offset)');
    }
  });
});
/**
 * The back-to-top link is revealed by a scroll timeline, and the two things
 * that can go silently wrong with that are both invisible to a browser that
 * supports the feature: the fallback for one that does not, and the scroller
 * the timeline names.
 */
describe('the back-to-top reveal', () => {
  const KEYFRAMES = '@keyframes wave-docs-toc-top-reveal';

  /**
   * ⚠️ THE FALLBACK IS THE ABSENCE OF A DECLARATION, WHICH IS THE ONE KIND OF
   * BUG A DIFF DOES NOT SHOW.
   *
   * Put `opacity: 0` on the base rule and the reveal looks identical in
   * Chromium and hides the link permanently everywhere the timeline never runs
   * — Firefox, a page too short to scroll, and a host that scrolls an inner
   * pane rather than the document. Three different audiences, one missing
   * animation, and no failing assertion anywhere in a browser that works.
   */
  it('leaves the link visible for an engine that never runs the animation', () => {
    const start = sheet.indexOf('.wave-docs-toc__top {');
    expect(start).toBeGreaterThan(-1);

    const base = readBlock(sheet, start);
    expect(base).not.toMatch(/\bopacity\s*:/);
    expect(base).not.toMatch(/\bvisibility\s*:/);

    // And the animation itself is behind the guard rather than beside it.
    const supports = sheet.indexOf('@supports (animation-timeline: scroll())');
    const timeline = sheet.indexOf('animation-name: wave-docs-toc-top-reveal');
    expect(supports).toBeGreaterThan(-1);
    expect(timeline).toBeGreaterThan(supports);
  });

  /**
   * `nearest` is the tempting spelling and it resolves to `.wave-docs-layout__toc`,
   * which is a scroll container of its own above 80rem. That timeline is
   * inactive on every page whose headings fit, so the link would never appear —
   * and would look exactly like the feature being unsupported.
   */
  it('measures the document, not the column the link sits in', () => {
    const start = sheet.indexOf(
      '@supports (animation-timeline: scroll())',
      sheet.indexOf('.wave-docs-toc__top'),
    );
    const guarded = readBlock(sheet, start);

    expect(guarded).toContain('animation-timeline: scroll(root block);');
    expect(guarded).toMatch(/animation-range:\s*\d+dvh\s+\d+dvh;/);
  });

  /**
   * ⚠️ TWO `hidden` FRAMES, AND TWO IS NOT ONE MORE THAN NEEDED.
   *
   * `visibility` steps rather than interpolates, except across any interval
   * with a `visible` endpoint — which is `visible` the whole way. Delete the
   * middle frame and the link rejoins the tab order one pixel past the
   * threshold at an opacity of nearly zero: Tab reaches it, and the focus ring
   * is drawn around nothing.
   */
  it('keeps the link out of the tab order until it can be read', () => {
    const start = sheet.indexOf(KEYFRAMES);
    expect(start).toBeGreaterThan(-1);

    const frames = readBlock(sheet, start);
    expect([...frames.matchAll(/visibility:\s*hidden/g)]).toHaveLength(2);
    expect([...frames.matchAll(/visibility:\s*visible/g)]).toHaveLength(1);

    // The `hidden` pair is adjacent — a `visible` between them would restore
    // the exception this depends on.
    expect(frames.indexOf('visibility: visible')).toBeGreaterThan(
      frames.lastIndexOf('visibility: hidden'),
    );
  });
});

/**
 * ⚠️ `:dir()` DOES NOT SURVIVE A CONSUMER'S BUILD, SO THIS SHEET DOES NOT USE IT.
 *
 * Next compiles CSS with lightningcss, which downlevels `:dir(rtl)` into a
 * hardcoded list of right-to-left *languages* — `:is(:lang(ae), :lang(ar), …
 * :lang(yi))`. Direction is not language, and the substitution is wrong in both
 * directions: `<html dir="rtl" lang="en">` gets no mirror, `lang="ar"
 * dir="ltr"` gets one it did not ask for.
 *
 * It is invisible from inside this repo. The browser tests inject the source
 * text into a `<style>` element, so `:dir()` behaves perfectly there and the
 * defect appears only on a built site — which is where it was found, after the
 * rule had already been written and measured passing.
 *
 * The replacement is `[dir='rtl'] …`, which is plain CSS 2.1 and which no
 * pipeline rewrites.
 */
describe('direction-aware rules', () => {
  it('never reaches for :dir(), which lightningcss rewrites', () => {
    expect(sheet).not.toMatch(/:dir\(/);
  });

  it('mirrors with an attribute selector instead', () => {
    expect(sheet).toContain("[dir='rtl'] .wave-docs-sidebar__chevron");
  });
});

/**
 * The two `<kbd>` treatments, which were one rule and must not become one again.
 *
 * The footer's caps sit on the flat bottom of the dialog and are the only thing
 * there that should look pressable. The trigger's shortcut sits *inside* a
 * bordered, filled control — a chip on a chip, sharing its fill, for a hint
 * nobody clicks.
 *
 * They shared a selector when the footer's caps were added, which is how the
 * trigger got a border it never wanted. Nothing measurable changes if they are
 * merged back: no layout moves, no test in the browser suite fails, and the
 * defect is a screenshot away from anyone who does not know to look.
 */
describe('the two keyboard treatments', () => {
  /**
   * The block for `.wave-docs-search-kbd` **on its own**.
   *
   * ⚠️ NOT `indexOf`, WHICH FINDS THE SHARED RULE FIRST. That selector is also
   * the second line of `.wave-docs-search-trigger-kbd, .wave-docs-search-kbd`,
   * so a naive search reads the block the two still have in common and reports
   * that the footer caps have no border — from a sheet where they do.
   */
  function keyRule(): string {
    for (const match of sheet.matchAll(/\.wave-docs-search-kbd \{/g)) {
      const at = match.index ?? -1;
      const before = sheet.slice(Math.max(0, at - 80), at);
      if (!before.includes('.wave-docs-search-trigger-kbd,')) {
        return readBlock(sheet, at);
      }
    }
    throw new Error('the footer caps have no rule of their own');
  }

  /** The block both `<kbd>`s still share. */
  function sharedRule(): string {
    const at = sheet.indexOf('.wave-docs-search-trigger-kbd,');
    expect(at, 'the two kbd rules are no longer split').toBeGreaterThan(-1);
    return readBlock(sheet, at);
  }

  it('draws the footer caps as keys', () => {
    const footer = keyRule();
    expect(footer).toContain('border: 1px solid');
    expect(footer).toContain('border-radius');
  });

  it('leaves the trigger hint as plain text', () => {
    const shared = sharedRule();
    expect(shared).not.toMatch(/\bborder\b/);
    expect(shared).not.toMatch(/\bbackground\b/);
    expect(shared).not.toMatch(/\bpadding\b/);
  });

  /** The scale that matches `⌘`'s ink to the `K`'s, and must not reach `Ctrl`. */
  it('scales only the glyph, and only behind the attribute', () => {
    const at = sheet.indexOf('.wave-docs-search-trigger-mod[data-symbol]');
    expect(at, 'the modifier rule is not attribute-gated').toBeGreaterThan(-1);
    expect(readBlock(sheet, at)).toMatch(/font-size:\s*1\.\d+em/);
  });
});

/**
 * ⚠️ THIS SHEET DOES NOT REWRITE WORDS SOMEONE ELSE AUTHORED.
 *
 * A sidebar separator's text comes from a consumer's `meta.json`
 * — `"---Reference---"` — and `text-transform: uppercase` on it is this package
 * restyling a string in a language it cannot read. Portuguese `Referência`
 * became `REFERÊNCIA`; Turkish trades its dotted and dotless `i` for each
 * other; and no CJK script has a case to transform, so those authors got the
 * `letter-spacing` and none of the effect it existed to rescue. The string was
 * a prop; its shape was not.
 *
 * Reading as a divider rather than as a row is done by size, weight and colour
 * — none of which touch a character.
 */
describe('authored strings keep their own shape', () => {
  it('never uppercases a sidebar separator', () => {
    const rule = readBlock(
      sheet,
      sheet.indexOf('.wave-docs-sidebar__separator {'),
    );

    expect(rule).not.toMatch(/text-transform/);
    expect(rule).not.toMatch(/letter-spacing/);
    // And it is still visibly a divider rather than another row.
    expect(rule).toContain('font-weight');
    expect(rule).toContain('--wave-docs-fg-subtle');
  });
});
