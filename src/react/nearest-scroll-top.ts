/**
 * Where a scrollport should be scrolled to so an item inside it is visible,
 * or `undefined` when it already is.
 *
 * Private, and pure, and separate from the component for one reason: this is
 * the whole of the geometry, and geometry is the half that can be tested
 * exhaustively. jsdom reports every rectangle as zero, so a test that drove
 * the effect would assert nothing about the arithmetic.
 *
 * ## Why not `scrollIntoView`
 *
 * ⚠️ `element.scrollIntoView({ block: 'nearest' })` LOOKS LIKE THE ANSWER AND
 * IS A TRAP. It scrolls **every** scrollable ancestor, the document included.
 * On a docs page that means opening a deep link scrolls the sidebar *and*
 * jumps the article the reader came to read — a page that silently moves under
 * them, on the one navigation where they know exactly what they asked for.
 *
 * So the caller finds the nearest scrollable ancestor and assigns `scrollTop`
 * itself. `sidebar.test.tsx` spies on `scrollIntoView` and asserts it is never
 * called: a test for the API deliberately not used, which is the only thing
 * that stops the page-jump being reintroduced by someone simplifying the code.
 */

/** Breathing room above or below the item, so it is not flush against the edge. */
const MARGIN = 16;

export interface NearestScrollTopInput {
  /** The item's offset from the top of the scrollport's content. */
  itemTop: number;
  itemHeight: number;
  /** The scrollport's visible height. */
  viewHeight: number;
  /** Where the scrollport is scrolled to now. */
  scrollTop: number;
  /** Total scrollable content height, used to clamp. */
  scrollHeight: number;
}

/**
 * The new `scrollTop`, or `undefined` when nothing should move.
 *
 * `undefined` for the already-visible case is not an optimisation: it is the
 * common case — most navigations are to a page already on screen — and
 * assigning `scrollTop` to its current value still cancels a smooth scroll in
 * progress and still fires a `scroll` event.
 */
export function nearestScrollTop({
  itemTop,
  itemHeight,
  viewHeight,
  scrollTop,
  scrollHeight,
}: NearestScrollTopInput): number | undefined {
  // A scrollport with no overflow has nowhere to go, and a zero-height one is
  // what jsdom and a display:none ancestor both report.
  if (viewHeight <= 0 || scrollHeight <= viewHeight) return undefined;

  const itemBottom = itemTop + itemHeight;
  const viewBottom = scrollTop + viewHeight;

  const target =
    itemTop < scrollTop
      ? // Above the fold: bring its top into view.
        itemTop - MARGIN
      : itemBottom > viewBottom
        ? // Below: bring its bottom into view, which keeps the items above it
          // visible rather than paging the item to the top.
          itemBottom - viewHeight + MARGIN
        : undefined;

  if (target === undefined) return undefined;

  // Clamped, because an item near either end would otherwise ask for a
  // position the scrollport cannot hold — harmless in a browser, which clamps
  // anyway, but it makes the function's output the thing the test asserts.
  const clamped = Math.max(0, Math.min(target, scrollHeight - viewHeight));

  // An item taller than the scrollport can never satisfy both edges; aligning
  // its top is the reading order.
  return itemHeight > viewHeight
    ? Math.max(0, Math.min(itemTop - MARGIN, scrollHeight - viewHeight))
    : clamped;
}
