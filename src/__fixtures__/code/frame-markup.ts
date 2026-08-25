/**
 * The code frame's markup, exactly as `rehypeCodeFrame` emits it.
 *
 * ⚠️ SHARED SO THE TWO TIERS CANNOT DISAGREE ABOUT THE SHAPE.
 *
 * `code.browser.test.tsx` mounts this string to measure what the stylesheet
 * does with it, and `rehype-code-frame.test.ts` asserts the plugin serialises
 * to the same thing. Written out separately in both places — which is what it
 * was — the browser tier goes on measuring a shape the pipeline stopped
 * emitting, and every assertion in it keeps passing while the real page is
 * broken. That is the exact failure mode a hand-written fixture invites, so
 * the fixture has one home and both tiers import it.
 */

/**
 * Every class `rehypeCodeFrame` puts on the frame, in one place.
 *
 * The markup below is generated from these, and `rehype-code-frame.test.ts`
 * asserts the plugin emits exactly them — so a rename cannot leave the browser
 * tier measuring a class the pipeline no longer writes.
 */
import { CODE_ICON_PATHS, CODE_ICON_STATES } from '../../code-frame.js';

export const CODE_FRAME_CLASSES = {
  figure: ['wave-docs-panel', 'wave-docs-code'],
  title: ['wave-docs-code__title'],
  copy: ['wave-docs-code__copy'],
  body: ['wave-docs-panel__body', 'wave-docs-code__body'],
} as const;

const attr = (names: readonly string[]): string => names.join(' ');

/**
 * The three state icons, generated from the same table the plugin builds them
 * from — so a path or an attribute cannot be right in one tier and stale here.
 */
const icons = (): string =>
  CODE_ICON_STATES.map(
    ([state, name]) =>
      `<svg class="wave-docs-code__copy-icon" data-state="${state}" aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${CODE_ICON_PATHS[
        name
      ]
        .map((d) => `<path d="${d}"></path>`)
        .join('')}</svg>`,
  ).join('');

export interface CodeFrameMarkupOptions {
  /** The fence's `title="…"`. Omitted for a bare fence. */
  title?: string | undefined;
  /** The folded language. Omitted for a fence that declared none. */
  lang?: string | undefined;
  /** The copy button's accessible name. */
  copyLabel?: string | undefined;
  /** The highlighted body. Defaults to one Shiki line. */
  code?: string | undefined;
}

/**
 * ⚠️ A TITLE IS WHAT DECIDES WHETHER THE BLOCK HAS A FRAME. With one, the
 * figure is a panel: a band with the filename and the copy button, and the
 * code in a card below. With none the stylesheet flattens the frame away and
 * the button sits on the code. The markup is the same either way.
 */
export function codeFrameMarkup(options: CodeFrameMarkupOptions = {}): string {
  const {
    title,
    lang,
    copyLabel = title === undefined ? 'Copy code' : `Copy code from ${title}`,
    code = '<span class="line">const a = 1;</span>',
  } = options;

  const label =
    title === undefined
      ? ''
      : `<figcaption class="${attr(CODE_FRAME_CLASSES.title)}">${title}</figcaption>`;

  return [
    `<figure class="${attr(CODE_FRAME_CLASSES.figure)}" data-wave-docs-code=""${
      lang === undefined ? '' : ` data-lang="${lang}"`
    }>`,
    label,
    `<button type="button" class="${attr(CODE_FRAME_CLASSES.copy)}" data-wave-docs-copy="" aria-label="${copyLabel}">${icons()}</button>`,
    `<div class="${attr(CODE_FRAME_CLASSES.body)}">`,
    `<pre class="shiki" tabindex="0"><code>${code}</code></pre>`,
    `</div>`,
    `</figure>`,
  ].join('');
}
