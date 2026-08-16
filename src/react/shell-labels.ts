/**
 * Every user-visible string the shell renders that is not the reader's content.
 *
 * ⚠️ THERE ARE ONLY FIVE, AND THAT IS THE POINT. `docs.Layout` renders the
 * whole chrome of a documentation site, and until this existed all five were
 * hardcoded English with no way to reach them: `DocsNav` declared `label` and
 * `closeLabel` props, documented them, defaulted them — and the layout that is
 * the only thing rendering `DocsNav` never passed either, while `DocsLayoutProps`
 * had no way to say them. Dead options that read as configuration.
 *
 * Private module, public type: `next.ts` re-exports {@link DocsLabels} as part
 * of `DocsLayoutProps`, and this file exists so the Node adapter can name the
 * type without importing a `'use client'` module for it.
 *
 * Not here: the search dialog's strings, which are reachable through
 * `search={{ … }}`; and the sidebar's own `label`, which is public API on
 * `DocsSidebar` for anyone composing a shell by hand. This is the set that had
 * no route at all.
 */

export interface DocsLabels {
  /** The navigation landmark's accessible name. Default `'Documentation'`. */
  nav?: string | undefined;
  /** The header button that opens the drawer. Default `'Open navigation'`. */
  openNav?: string | undefined;
  /** The button that closes the drawer. Default `'Close navigation'`. */
  closeNav?: string | undefined;
  /** The skip link's visible text. Default `'Skip to content'`. */
  skipToContent?: string | undefined;
}

/**
 * The defaults, in one place.
 *
 * A `Required<DocsLabels>` rather than four `=` defaults spread across three
 * components: the previous arrangement is how `DocsSidebar` came to default its
 * landmark to `'Docs'` while `DocsNav` defaulted the same landmark to
 * `'Documentation'` — two names for one region, depending on the viewport.
 */
export const DEFAULT_DOCS_LABELS: Required<DocsLabels> = {
  nav: 'Documentation',
  openNav: 'Open navigation',
  closeNav: 'Close navigation',
  skipToContent: 'Skip to content',
};

/** The given labels over the defaults, with `undefined` treated as unset. */
export function resolveLabels(
  labels: DocsLabels | undefined,
): Required<DocsLabels> {
  if (labels === undefined) return DEFAULT_DOCS_LABELS;

  return {
    nav: labels.nav ?? DEFAULT_DOCS_LABELS.nav,
    openNav: labels.openNav ?? DEFAULT_DOCS_LABELS.openNav,
    closeNav: labels.closeNav ?? DEFAULT_DOCS_LABELS.closeNav,
    skipToContent: labels.skipToContent ?? DEFAULT_DOCS_LABELS.skipToContent,
  };
}
