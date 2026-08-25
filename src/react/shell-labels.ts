/**
 * Every user-visible string this package renders that is not the reader's
 * content.
 *
 * ⚠️ THERE USED TO BE FOUR, AND THE DOCSTRING CLAIMED THEY WERE ALL OF THEM.
 * They were the four `docs.Layout` renders directly, and the claim — "the whole
 * of what a non-English site has to say" — was false by seventeen strings. A
 * German site built exactly the documented way shipped
 * `<nav aria-label="On this page">`, a visible `Back to top`, `aria-label="Tip"`
 * on every callout, `Copy code` on every fence and `(opens in a new tab)` after
 * every external link. Verified in this repository's own `site/out`, which is
 * how it was found.
 *
 * ## Where each one is rendered, because it decides the cost
 *
 * Most are emitted by Server Components or baked into the HTML by a rehype
 * plugin at build time, so overriding them costs nothing at all. Six cross into
 * a Client Component — the two sidebar disclosure verbs, the two table-of-contents
 * strings and the two copy-status messages — and those are forwarded ONLY when
 * set, so a site that overrides nothing carries exactly the payload it did
 * before.
 *
 * ## The defaults do not all live here
 *
 * {@link DEFAULT_DOCS_LABELS} covers the four shell strings and no more, on
 * purpose. The rest default inside the component that renders them, because
 * this module would otherwise have to be imported by `sidebar.tsx` and
 * `code-runtime.tsx` — and an object literal of twenty-one strings does not
 * tree-shake, so every reader would download the German site's English
 * fallbacks. `next.test.ts` asserts that every key here reaches the output, so
 * a key that is declared and never wired fails rather than reading as
 * configuration.
 *
 * Not here: the search dialog's strings, which are reachable through
 * `search={{ … }}` on `docs.Layout` — its trigger, its placeholder, its
 * accessible name and its five state messages, plus the plural forms of its
 * live region. They travel with the dialog's own props rather than with these
 * because that channel already existed and already carries `pageSize` and
 * `minQueryLength`; a second route to the same component would be two places to
 * look. `DocsSidebar`'s own `label` is likewise public API, for anyone composing
 * a shell by hand.
 */

export interface DocsLabels {
  /* ---------------------------------------------------------------------
   * The shell — `docs.Layout`
   * ------------------------------------------------------------------ */

  /** The navigation landmark's accessible name. Default `'Documentation'`. */
  nav?: string | undefined;
  /**
   * The sidebar's trigger, named for what pressing it does next. One button
   * carries both strings: `openNav` while the sidebar is closed, `closeNav`
   * while it is open.
   *
   * Default `'Open navigation'`.
   */
  openNav?: string | undefined;
  /** The same button, while the sidebar is open. Default `'Close navigation'`. */
  closeNav?: string | undefined;
  /** The skip link's visible text. Default `'Skip to content'`. */
  skipToContent?: string | undefined;

  /* ---------------------------------------------------------------------
   * The sidebar — a client component, so these cross only when set
   * ------------------------------------------------------------------ */

  /**
   * Accessible name of a collapsed group's toggle. Default `'Expand {title}'`.
   *
   * `{title}` is replaced with the group's own name. A placeholder rather than a
   * function because this crosses from a Server Component to a Client one, where
   * a function cannot go.
   */
  expandGroup?: string | undefined;
  /** The same toggle when open. Default `'Collapse {title}'`. */
  collapseGroup?: string | undefined;

  /* ---------------------------------------------------------------------
   * The table of contents — `docs.Page`
   * ------------------------------------------------------------------ */

  /** The TOC landmark's accessible name. Default `'On this page'`. */
  toc?: string | undefined;
  /** The link at the end of the TOC. Default `'Back to top'`. */
  backToTop?: string | undefined;
  /**
   * Above the previous page's title in the pager. Defaults to `'Previous'`.
   *
   * The direction, not the destination: the page's own title is the name, and
   * these two words are what say which way it lies.
   */
  /**
   * The "where to go next" block's heading. Defaults to `'Where to go next'`.
   *
   * A page opts into that block with `explore` in its frontmatter; this is the one
   * string the package supplies for it, and the questions are the author's.
   */
  explore?: string | undefined;
  previousPage?: string | undefined;
  /** The same for the next page. Defaults to `'Next'`. */
  nextPage?: string | undefined;
  /**
   * Accessible name for the pager landmark. Defaults to `'Pagination'`.
   *
   * A page carries three navigation landmarks — the sidebar, the table of
   * contents and this — and "navigation" three times is not a list anyone can
   * steer by.
   */
  pagination?: string | undefined;

  /* ---------------------------------------------------------------------
   * The content — rendered from your markdown by `docs.Page`
   * ------------------------------------------------------------------ */

  /**
   * Screen-reader suffix on a link that opens a new tab.
   * Default `'(opens in a new tab)'`.
   */
  externalLink?: string | undefined;
  /**
   * Accessible name of a wide table's scroll region. Default `'Table'`.
   *
   * The region exists so a keyboard user can scroll a table that overflows; an
   * unnamed one is announced as "region", which says nothing about what it
   * holds.
   */
  table?: string | undefined;
  /** Heading on a `> [!NOTE]` callout. Default `'Note'`. */
  calloutNote?: string | undefined;
  /** Heading on a `> [!TIP]` callout. Default `'Tip'`. */
  calloutTip?: string | undefined;
  /** Heading on a `> [!IMPORTANT]` callout. Default `'Important'`. */
  calloutImportant?: string | undefined;
  /** Heading on a `> [!WARNING]` callout. Default `'Warning'`. */
  calloutWarning?: string | undefined;
  /** Heading on a `> [!CAUTION]` callout. Default `'Caution'`. */
  calloutCaution?: string | undefined;
  /**
   * Accessible name of a YouTube embed. Default `'YouTube video player'`.
   *
   * Markdown carries no video title, so this is the name every embed on the site
   * gets unless a `<YouTube title>` overrides it.
   */
  youtubeTitle?: string | undefined;
  /**
   * The closed facade's control. Default `'Play video: {title}'`.
   *
   * `{title}` is the embed's accessible name.
   */
  youtubePlay?: string | undefined;
  /** The open facade's control. Default `'Hide video: {title}'`. */
  youtubeHide?: string | undefined;

  /* ---------------------------------------------------------------------
   * Code frames — baked into the HTML at build time
   * ------------------------------------------------------------------ */

  /** The copy button on a fence with no title. Default `'Copy code'`. */
  copyCode?: string | undefined;
  /**
   * The copy button on a titled fence. Default `'Copy code from {title}'`.
   *
   * `{title}` is the fence's own `title="…"`. Two controls both called "Copy
   * code" are indistinguishable in a screen reader's element list, which is why
   * the titled form exists at all.
   */
  copyCodeFrom?: string | undefined;
  /** Announced after a successful copy. Default `'Copied to the clipboard.'` */
  copied?: string | undefined;
  /**
   * Announced after a failed one. Default
   * `'Copy failed. Select the code and press Control or Command + C.'`
   *
   * Says what to do instead, not merely that it failed: the common way to land
   * here is `next dev` on a phone over plain HTTP, where there is no secure
   * context and retrying cannot help.
   */
  copyFailed?: string | undefined;
}

/**
 * Every key of {@link DocsLabels}, for the test that proves each one is wired.
 *
 * A list rather than a type-level trick because the assertion has to run: the
 * failure being guarded against is a key that is declared, documented and never
 * read, which type-checks perfectly.
 */
export const DOCS_LABEL_KEYS = [
  'nav',
  'openNav',
  'closeNav',
  'skipToContent',
  'expandGroup',
  'collapseGroup',
  'toc',
  'backToTop',
  'externalLink',
  'table',
  'calloutNote',
  'calloutTip',
  'calloutImportant',
  'calloutWarning',
  'calloutCaution',
  'youtubeTitle',
  'youtubePlay',
  'youtubeHide',
  'copyCode',
  'copyCodeFrom',
  'explore',
  'previousPage',
  'nextPage',
  'pagination',
  'copied',
  'copyFailed',
] as const satisfies ReadonlyArray<keyof DocsLabels>;

/** The four the shell renders itself, resolved centrally. */
export type ShellLabelKey = 'nav' | 'openNav' | 'closeNav' | 'skipToContent';

/**
 * Defaults for the shell's four, in one place.
 *
 * A `Required<…>` rather than four `=` defaults spread across three components:
 * the previous arrangement is how `DocsSidebar` came to default its landmark to
 * `'Docs'` while `DocsNav` defaulted the same landmark to `'Documentation'` —
 * two names for one region, depending on the viewport.
 */
export const DEFAULT_DOCS_LABELS: Required<Pick<DocsLabels, ShellLabelKey>> = {
  nav: 'Documentation',
  openNav: 'Open navigation',
  closeNav: 'Close navigation',
  skipToContent: 'Skip to content',
};

/** The given labels over the defaults, with `undefined` treated as unset. */
export function resolveLabels(
  labels: DocsLabels | undefined,
): Required<Pick<DocsLabels, ShellLabelKey>> {
  if (labels === undefined) return DEFAULT_DOCS_LABELS;

  return {
    nav: labels.nav ?? DEFAULT_DOCS_LABELS.nav,
    openNav: labels.openNav ?? DEFAULT_DOCS_LABELS.openNav,
    closeNav: labels.closeNav ?? DEFAULT_DOCS_LABELS.closeNav,
    skipToContent: labels.skipToContent ?? DEFAULT_DOCS_LABELS.skipToContent,
  };
}

/**
 * `template` with `{title}` replaced.
 *
 * A placeholder, because these strings cross a Server → Client boundary where a
 * function cannot go — and because a translator needs to move the name within
 * the sentence, which string concatenation does not allow.
 */
export function fillTitle(template: string, title: string): string {
  return template.replace('{title}', title);
}
