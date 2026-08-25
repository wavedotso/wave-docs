/**
 * The frame a table is wrapped in, exactly as `createTable` emits it.
 *
 * ⚠️ SHARED SO THE TIERS CANNOT DISAGREE ABOUT THE SHAPE, and written the day
 * they did. `styles.browser.test.ts` had three hand-written copies of
 * `<section class="wave-docs-table-scroll">`; the day the table started
 * wearing the panel every one of them became a scroll region with no frame
 * around it and no overflow to scroll — measuring a shape the component had
 * stopped emitting, and failing for a reason that had nothing to do with what
 * they were testing. `markdown-components.test.tsx` asserts the component
 * agrees with this.
 */

/** Every class `createTable` puts on the frame, in one place. */
export const TABLE_FRAME_CLASSES = {
  surface: ['wave-docs-table-scroll'],
  table: ['wave-docs-table'],
} as const;

const attr = (names: readonly string[]): string => names.join(' ');

export interface TableFrameMarkupOptions {
  /** The scroll region's accessible name. */
  label?: string | undefined;
  /** Extra classes on the `<table>` itself. */
  tableClass?: string | undefined;
}

/**
 * Wrap table markup — `<thead>`/`<tbody>`, not the `<table>` — in the frame.
 */
export function tableFrameMarkup(
  inner: string,
  options: TableFrameMarkupOptions = {},
): string {
  const { label = 'Table', tableClass } = options;
  const classes = tableClass
    ? `${attr(TABLE_FRAME_CLASSES.table)} ${tableClass}`
    : attr(TABLE_FRAME_CLASSES.table);

  return [
    `<section class="${attr(TABLE_FRAME_CLASSES.surface)}" aria-label="${label}" tabindex="0">`,
    `<table class="${classes}">${inner}</table>`,
    `</section>`,
  ].join('');
}
