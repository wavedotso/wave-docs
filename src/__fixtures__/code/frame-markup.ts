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
export const CODE_FRAME_CLASSES = {
  figure: ['wave-docs-panel', 'wave-docs-code'],
  title: ['wave-docs-code__title'],
  lang: ['wave-docs-code__lang'],
  copy: ['wave-docs-code__copy'],
  body: ['wave-docs-panel__body', 'wave-docs-code__body'],
} as const;

const attr = (names: readonly string[]): string => names.join(' ');

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
 * ⚠️ THE LABEL SLOT HOLDS ONE OF THE TWO, NEVER BOTH. A title is a filename,
 * and a filename says what the language is more precisely than the language
 * does — `swap.ts` next to a `ts` badge is the same fact twice.
 */
export function codeFrameMarkup(options: CodeFrameMarkupOptions = {}): string {
  const {
    title,
    lang,
    copyLabel = title === undefined ? 'Copy code' : `Copy code from ${title}`,
    code = '<span class="line">const a = 1;</span>',
  } = options;

  const label =
    title !== undefined
      ? `<figcaption class="${attr(CODE_FRAME_CLASSES.title)}">${title}</figcaption>`
      : lang !== undefined
        ? `<span class="${attr(CODE_FRAME_CLASSES.lang)}" aria-hidden="true">${lang}</span>`
        : '';

  return [
    `<figure class="${attr(CODE_FRAME_CLASSES.figure)}" data-wave-docs-code=""${
      lang === undefined ? '' : ` data-lang="${lang}"`
    }>`,
    label,
    `<button type="button" class="${attr(CODE_FRAME_CLASSES.copy)}" data-wave-docs-copy="" aria-label="${copyLabel}"><span aria-hidden="true">⧉</span></button>`,
    `<div class="${attr(CODE_FRAME_CLASSES.body)}">`,
    `<pre class="shiki" tabindex="0"><code>${code}</code></pre>`,
    `</div>`,
    `</figure>`,
  ].join('');
}
