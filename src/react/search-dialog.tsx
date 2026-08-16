'use client';

/**
 * The client half of search: a keyboard-first dialog over the index that
 * `@waveso/docs/search-index` wrote at build time.
 *
 * Nothing here is on the critical path. MiniSearch is `import()`ed inside the
 * handler that first needs it and the index JSON — 200–500 KB brotli for a
 * real corpus — is fetched on hover, focus or first open, never on page load.
 * A docs page that pays for search before anyone searches is a docs page that
 * fails its Core Web Vitals for the 95% who never open the dialog.
 */

import type MiniSearch from 'minisearch';
import type { Options as MiniSearchOptions } from 'minisearch';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
// `../search-options.js`, not `../search-index.js`: the index builder is
// Node-only (`"browser": null` in the exports map), while the field
// configuration both halves must agree on carries no Node imports at all.
import { mergeSearchOptions } from '../search-options.js';
import type { SearchRecord } from '../types.js';
/*
 * ⚠️ ONE LINK CONTRACT FOR THE WHOLE PACKAGE. This file used to declare its own
 * `SearchLinkProps`, a strict subset of `DocsLinkProps` — so the package
 * published two answers to "what must a link component accept", and a wrapper
 * satisfying one carried no guarantee about the other. `sidebar.tsx` already
 * reached across for the shared type; the dialog was the outlier.
 *
 * A type-only import, so nothing about the markdown layer is pulled into this
 * client bundle.
 */
import type { DocsLinkComponent } from './markdown-components.js';
import { docsError } from '../docs-error.js';

/**
 * Tab stops inside the dialog. Every clause excludes `tabindex="-1"`: the
 * result links are anchors *and* are deliberately out of the tab order, and a
 * trap that counted them would let Tab escape the dialog at the last real
 * control.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]',
]
  .map((selector) => `${selector}:not([tabindex="-1"])`)
  .join(', ');

export interface SearchDialogProps {
  /**
   * URL of the serialised index, e.g. `/search-index.json`. Whatever
   * `writeSearchIndex` wrote, served as a static asset.
   */
  indexUrl: string;
  /**
   * Router navigation for the selected result. Injected rather than imported
   * so this component stays host-agnostic — `next/navigation`'s
   * `useRouter().push`, a `react-router` navigate, or `location.assign`.
   */
  navigate: (href: string) => void;
  /**
   * Optional link component for results, e.g. `next/link`, so hovering a hit
   * prefetches the page. Results fall back to a plain anchor.
   */
  Link?: DocsLinkComponent | undefined;
  /** Trigger button label. Defaults to `'Search'`. */
  triggerLabel?: string | undefined;
  /** Input placeholder. Defaults to `'Search documentation'`. */
  placeholder?: string | undefined;
  /** Accessible name for the dialog. Defaults to `'Search documentation'`. */
  dialogLabel?: string | undefined;
  /** Maximum results rendered. Defaults to 8. */
  maxResults?: number | undefined;
  /** Input debounce in milliseconds. Defaults to 120. */
  debounceMs?: number | undefined;
  /** Extra class names for the trigger button, e.g. a navbar's own layout. */
  className?: string | undefined;
  /**
   * Overrides applied through `mergeSearchOptions` when the index is
   * deserialised — the escape hatch for tokenisation, `processTerm` and the
   * query defaults, without waiting on a release of this package.
   *
   * MiniSearch's own name for the query defaults is `searchOptions`, so they
   * nest one level down:
   *
   * ```tsx
   * <DocsSearch miniSearchOptions={{ searchOptions: { fuzzy: 0.1 } }} />
   * ```
   *
   * That stutter is why this prop is not called `searchOptions` too. It was,
   * and `searchOptions={{ fuzzy: 0.1 }}` reads so naturally that both README
   * examples were written that way — neither compiled, and the flat form is
   * not a runtime error either. It is a `fuzzy` MiniSearch never reads.
   *
   * ⚠️ HAND THE IDENTICAL OVERRIDES TO THE BUILD — `createDocsRoute`'s
   * `miniSearchOptions`, or `buildSearchIndex`'s second argument. `tokenize`
   * and `processTerm` decide how terms were written into the index; a client
   * that splits differently from the build looks up terms that were never
   * written and finds nothing, silently.
   */
  miniSearchOptions?: Partial<MiniSearchOptions<SearchRecord>> | undefined;
}

/** A search result, narrowed out of MiniSearch's untyped stored fields. */
interface SearchHit {
  id: string;
  title: string;
  heading: string;
  ancestors: string[];
  href: string;
}

type IndexStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Search trigger plus its dialog.
 *
 * Render it once, wherever the trigger belongs — the dialog itself is
 * portalled to `document.body`, so a navbar's stacking context cannot trap
 * it behind the page.
 */
export function SearchDialog({
  indexUrl,
  navigate,
  Link,
  triggerLabel = 'Search',
  placeholder = 'Search documentation',
  dialogLabel = 'Search documentation',
  maxResults = 8,
  debounceMs = 120,
  className,
  miniSearchOptions,
}: SearchDialogProps): ReactNode {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [status, setStatus] = useState<IndexStatus>('idle');
  const [shortcutHint, setShortcutHint] = useState('');

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  /*
   * ⚠️ KEYED BY URL, NOT A SINGLE SLOT. `indexUrl` is a prop, and a locale or
   * version switcher changes it while this component stays mounted inside a
   * persistent layout. A one-slot cache went on serving the corpus the tab
   * first loaded — old hits, old hrefs, no network request and no error state
   * — for as long as that tab lived. Keying it also makes switching back free.
   */
  const indexCacheRef = useRef(
    new Map<string, Promise<MiniSearch<SearchRecord>>>(),
  );
  /*
   * Read through a ref rather than closed over: a consumer passes this as an
   * object literal, so its identity changes on every render. In `ensureIndex`'s
   * dependencies that would re-run the query effect below on every render —
   * including the render `setHits` itself causes, which is a search every
   * `debounceMs` forever. The options are consumed exactly once per URL
   * anyway, when that URL's index is deserialised.
   */
  const miniSearchOptionsRef = useRef(miniSearchOptions);
  /** Whether the dialog has ever been open. See the focus effect below. */
  const hasOpenedRef = useRef(false);

  const baseId = useId();
  const listId = `${baseId}-results`;
  const optionId = (index: number): string => `${baseId}-option-${index}`;

  useEffect(() => {
    miniSearchOptionsRef.current = miniSearchOptions;
  }, [miniSearchOptions]);

  /** Load each URL at most once; a failure evicts that key so a retry can. */
  const ensureIndex = useCallback((): Promise<MiniSearch<SearchRecord>> => {
    const cache = indexCacheRef.current;
    let pending = cache.get(indexUrl);
    if (pending === undefined) {
      pending = loadIndex(indexUrl, miniSearchOptionsRef.current).catch(
        (error: unknown) => {
          cache.delete(indexUrl);
          throw error;
        },
      );
      cache.set(indexUrl, pending);
    }
    return pending;
  }, [indexUrl]);

  const warmIndex = useCallback((): void => {
    if (indexCacheRef.current.has(indexUrl)) return;
    setStatus('loading');
    ensureIndex().then(
      () => setStatus('ready'),
      () => setStatus('error'),
    );
  }, [ensureIndex, indexUrl]);

  const openDialog = useCallback((): void => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setIsOpen(true);
    warmIndex();
  }, [warmIndex]);

  const closeDialog = useCallback((): void => {
    setIsOpen(false);
  }, []);

  // Cmd/Ctrl-K from anywhere. Registered on the document because the trigger
  // is frequently off-screen in a scrolled docs layout.
  useEffect(() => {
    function handleShortcut(event: KeyboardEvent): void {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      if (isOpen) {
        closeDialog();
      } else {
        openDialog();
      }
    }
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, [isOpen, openDialog, closeDialog]);

  /*
   * ⚠️ ESCAPE AND TAB BELONG TO THE DOCUMENT, NOT TO THE DIALOG ELEMENT.
   * Bound to the dialog `<div>`, both died on one ordinary click: the status
   * paragraph is not focusable and has no focusable ancestor, so focus fell to
   * `<body>` — outside the subtree React was listening on. Escape stopped
   * closing the dialog, and the next Tab walked the document from the top into
   * the page that `aria-modal="true"` has hidden from assistive tech.
   *
   * Capture phase: at the document in the bubble phase every ancestor handler
   * has already run, so `stopPropagation` below — which is what keeps an outer
   * layout from also acting on Escape — would guarantee nothing.
   */
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeDialog();
        return;
      }
      if (event.key === 'Tab') trapFocus(dialogRef.current, event);
    }
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, closeDialog]);

  // Resolved after mount: reading the platform during render would disagree
  // with the server-rendered markup and blow up hydration.
  useEffect(() => {
    const isApple = /mac|iphone|ipad|ipod/i.test(navigator.userAgent);
    setShortcutHint(isApple ? '⌘K' : 'Ctrl K');
  }, []);

  // Focus into the input on open, back to the trigger on close.
  useEffect(() => {
    if (isOpen) {
      hasOpenedRef.current = true;
      inputRef.current?.focus();
      return;
    }
    /*
     * ⚠️ MOUNT RUNS THIS EFFECT TOO, WITH `isOpen` ALREADY FALSE, so without
     * this guard "restore focus on close" fired on page load: every docs page
     * yanked focus onto the search trigger before the reader touched anything,
     * past the skip link this package ships. And focusing the trigger fires its
     * `onFocus`, which warms the index — so the 200–500 KB the whole lazy-load
     * dance in this file exists to defer was fetched on every page view.
     */
    if (!hasOpenedRef.current) return;
    const previous = returnFocusRef.current;
    returnFocusRef.current = null;
    // ⌘K on a freshly-loaded page snapshots `document.body`, which is not
    // focusable — focusing it is a no-op that drops the reader at the top of
    // the document, past the whole sidebar this package ships a skip link to
    // avoid. Fall back to the trigger, which is where they were.
    const target =
      previous !== null && previous !== document.body && previous.isConnected
        ? previous
        : triggerRef.current;
    target?.focus();
  }, [isOpen]);

  // A modal that lets the page scroll underneath it is a modal in name only.
  useEffect(() => {
    if (!isOpen) return;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => {
      body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  // Reopening should not resume someone else's half-finished query.
  useEffect(() => {
    if (isOpen) return;
    setQuery('');
    setHits([]);
    setActiveIndex(0);
  }, [isOpen]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === '') {
      setHits([]);
      setActiveIndex(0);
      return;
    }

    let isCancelled = false;
    const timer = setTimeout(() => {
      ensureIndex().then(
        (index) => {
          if (isCancelled) return;
          setStatus('ready');
          setHits(
            index
              .search(trimmed)
              .slice(0, maxResults)
              .map(toSearchHit)
              .filter(isSearchHit),
          );
          setActiveIndex(0);
        },
        () => {
          if (!isCancelled) setStatus('error');
        },
      );
    }, debounceMs);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [query, ensureIndex, maxResults, debounceMs]);

  // Keep the active option visible under arrow-key navigation.
  useEffect(() => {
    if (hits.length === 0) return;
    // `useId` values contain colons, which are legal in an id attribute but
    // not in a bare selector.
    const option = listRef.current?.querySelector<HTMLElement>(
      `#${CSS.escape(`${baseId}-option-${activeIndex}`)}`,
    );
    option?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, hits, baseId]);

  const selectHit = useCallback(
    (hit: SearchHit): void => {
      closeDialog();
      navigate(hit.href);
    },
    [closeDialog, navigate],
  );

  /*
   * ⚠️ ON THE INPUT, NOT ON THE DIALOG. At the dialog level these branches ran
   * for every key pressed anywhere inside it, so Enter on the focused Close
   * button navigated to whichever result happened to be selected — and the
   * `preventDefault` below suppressed the button's own activation, leaving the
   * dialog's one visible dismiss affordance unusable from the keyboard.
   * Escape and Tab stay on the document listener above, so they still work
   * from the Close button and from a stray click on the dialog's chrome.
   */
  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    /*
     * An IME sends the composition-commit key as `keydown{key:'Enter',
     * isComposing:true}` *before* `compositionend` — so without this guard the
     * keystroke a CJK reader uses to accept 客户端 opened whichever result the
     * partial romaji had already matched. `keyCode === 229` is the same event
     * on engines that leave `isComposing` unset. Escape is deliberately not
     * gated here: a reader mid-composition still has to be able to leave.
     */
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (hits.length === 0) return;
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((index) => (index + delta + hits.length) % hits.length);
      return;
    }
    /*
     * ⚠️ NO `Home`/`End` BRANCH, AND THAT IS THE POINT. Jumping to the first
     * and last option is a tempting two lines, but this listbox is driven from
     * a text input the reader is typing a query into, and the APG's combobox
     * pattern requires the textbox to keep the standard single-line editing
     * keys. Swallowing `Home` left no way to reach the start of a query being
     * corrected — while buying nothing, because the arrow keys above wrap:
     * ArrowUp from the first option already *is* End.
     */
    if (event.key === 'Enter') {
      const hit = hits[activeIndex];
      if (hit === undefined) return;
      event.preventDefault();
      selectHit(hit);
    }
  }

  const activeHit = hits[activeIndex];

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={['wave-docs-search-trigger', className]
          .filter(Boolean)
          .join(' ')}
        /*
         * The hint is a shortcut, not part of the button's name. Named from
         * content, this button announced as "Search Ctrl K" — and `⌘` reads as
         * "place of interest sign" on more than one screen reader. The explicit
         * label pins the name to the label the consumer chose, and
         * `aria-keyshortcuts` is where the shortcut itself belongs, so nothing
         * is hidden from a reader, it is just exposed as what it is.
         */
        aria-label={triggerLabel}
        aria-keyshortcuts="Meta+K Control+K"
        onClick={openDialog}
        onPointerEnter={warmIndex}
        onFocus={warmIndex}
      >
        <span className="wave-docs-search-trigger-label">{triggerLabel}</span>
        {shortcutHint === '' ? null : (
          <kbd className="wave-docs-search-trigger-kbd">{shortcutHint}</kbd>
        )}
      </button>

      {isOpen
        ? createPortal(
            // biome-ignore lint/a11y/noStaticElementInteractions: click-to-dismiss backdrop; Escape is the keyboard equivalent.
            <div
              className="wave-docs-search-backdrop"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) closeDialog();
              }}
            >
              <div
                ref={dialogRef}
                className="wave-docs-search-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={dialogLabel}
              >
                <div className="wave-docs-search-input-row">
                  <input
                    ref={inputRef}
                    className="wave-docs-search-input"
                    type="text"
                    role="combobox"
                    aria-label={dialogLabel}
                    aria-expanded={hits.length > 0}
                    aria-controls={listId}
                    aria-autocomplete="list"
                    {...(activeHit === undefined
                      ? {}
                      : { 'aria-activedescendant': optionId(activeIndex) })}
                    placeholder={placeholder}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={handleInputKeyDown}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="wave-docs-search-close"
                    onClick={closeDialog}
                  >
                    Close
                  </button>
                </div>

                {/*
                  A `div`, not a `ul`: `role="listbox"` replaces the list
                  semantics outright, and overriding `ul`/`li` roles leaves
                  two contradictory answers in the accessibility tree.
                */}
                <div
                  ref={listRef}
                  id={listId}
                  className="wave-docs-search-results"
                  role="listbox"
                  aria-label={dialogLabel}
                >
                  {hits.map((hit, index) => (
                    <SearchResultOption
                      key={hit.id}
                      hit={hit}
                      id={optionId(index)}
                      isActive={index === activeIndex}
                      onActivate={() => setActiveIndex(index)}
                      onSelect={selectHit}
                      {...(Link === undefined ? {} : { Link })}
                    />
                  ))}
                </div>

                <SearchStatus
                  status={status}
                  query={query.trim()}
                  hitCount={hits.length}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** One result row: a real link, so middle-click and "open in new tab" work. */
function SearchResultOption({
  hit,
  id,
  isActive,
  onActivate,
  onSelect,
  Link,
}: {
  hit: SearchHit;
  id: string;
  isActive: boolean;
  onActivate: () => void;
  onSelect: (hit: SearchHit) => void;
  Link?: DocsLinkComponent;
}): ReactNode {
  function handleClick(event: ReactMouseEvent<HTMLAnchorElement>): void {
    // Leave modified clicks to the browser: new tab, new window, download.
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    onSelect(hit);
  }

  const trail = toBreadcrumbs(hit);

  const body = (
    <>
      <span className="wave-docs-search-result-heading">{hit.heading}</span>
      {trail.length === 0 ? null : (
        <span className="wave-docs-search-result-breadcrumb">
          {trail.map((crumb, index) => (
            <span className="wave-docs-search-result-crumb" key={crumb.key}>
              {index === 0 ? null : (
                <span
                  className="wave-docs-search-result-crumb-separator"
                  aria-hidden="true"
                >
                  ›
                </span>
              )}
              {crumb.text}
            </span>
          ))}
        </span>
      )}
    </>
  );

  return (
    <div
      id={id}
      className={
        isActive
          ? 'wave-docs-search-result wave-docs-search-result-active'
          : 'wave-docs-search-result'
      }
      role="option"
      aria-selected={isActive}
      /*
       * Named explicitly rather than from its own content. The separators are
       * `aria-hidden` and the crumbs are adjacent inline spans, so the computed
       * name ran them together — "InstallationRequirements" — and the visual
       * `margin-inline` that separates them for a sighted reader contributes
       * nothing to the accessibility tree. Commas here are what the trail
       * sounds like read aloud, and `›` stays out of it: more than one screen
       * reader pronounces it.
       */
      aria-label={[hit.heading, ...trail.map((crumb) => crumb.text)].join(', ')}
      // Options are never tab stops in the combobox pattern: focus stays in
      // the input and `aria-activedescendant` does the pointing.
      tabIndex={-1}
      onPointerMove={onActivate}
    >
      {Link === undefined ? (
        <a
          className="wave-docs-search-result-link"
          href={hit.href}
          // Focus stays on the input; the listbox is driven by
          // aria-activedescendant, so results must not be tab stops.
          tabIndex={-1}
          onClick={handleClick}
        >
          {body}
        </a>
      ) : (
        <Link
          className="wave-docs-search-result-link"
          href={hit.href}
          // As in the anchor branch: results are never tab stops.
          tabIndex={-1}
          onClick={handleClick}
        >
          {body}
        </Link>
      )}
    </div>
  );
}

/** Loading, failure and empty states, plus a live region for hit counts. */
function SearchStatus({
  status,
  query,
  hitCount,
}: {
  status: IndexStatus;
  query: string;
  hitCount: number;
}): ReactNode {
  let message: string | null = null;
  let modifier = '';

  if (status === 'error') {
    message = 'Search is unavailable right now. Try reloading the page.';
    modifier = ' wave-docs-search-status-error';
  } else if (query === '') {
    message = 'Start typing to search the documentation.';
    modifier = ' wave-docs-search-status-hint';
  } else if (status !== 'ready') {
    // 'idle' too: a query typed before the index resolved is still waiting.
    message = 'Loading the search index…';
    modifier = ' wave-docs-search-status-loading';
  } else if (hitCount === 0) {
    message = `No results for “${query}”.`;
    modifier = ' wave-docs-search-status-empty';
  }

  return (
    <>
      {message === null ? null : (
        <p className={`wave-docs-search-status${modifier}`}>{message}</p>
      )}
      <p
        className="wave-docs-search-announcer"
        role="status"
        aria-live="polite"
      >
        {query === '' || status !== 'ready'
          ? ''
          : `${hitCount} ${hitCount === 1 ? 'result' : 'results'}`}
      </p>
    </>
  );
}

/**
 * Fetch and deserialise the index.
 *
 * `loadJSONAsync` yields between chunks so deserialising a large index does
 * not freeze the frame the dialog just opened in.
 */
async function loadIndex(
  url: string,
  overrides: Partial<MiniSearchOptions<SearchRecord>> | undefined,
): Promise<MiniSearch<SearchRecord>> {
  const [{ default: MiniSearchClass }, response] = await Promise.all([
    import('minisearch'),
    fetch(url),
  ]);
  if (!response.ok) {
    /*
     * A 404 is not a transient failure, and saying "try again" for one wastes
     * the author's time on the single most likely mistake: the route file was
     * never created. The trigger renders from `docs.Layout` whether or not the
     * index exists, so the first sign of it is a reader's search box that never
     * works — name the file instead of describing the symptom.
     */
    throw docsError(
      'search-index-unavailable',
      response.status === 404
        ? `No search index at ${url}. Create the route that serves it:\n` +
            `\n  // app${url}/route.ts — the whole file\n` +
            "  import { docs } from '@/lib/docs';\n" +
            '\n  export const GET = docs.searchIndex;\n' +
            "  export const dynamic = 'force-static';\n" +
            '\nOr pass `search={false}` to `docs.Layout` to hide the trigger.'
        : `Failed to load the search index from ${url} (HTTP ${response.status}).`,
    );
  }
  // The same merge `buildSearchIndex` applies, from the same module: an index
  // built with one `tokenize` and queried with another matches nothing at all.
  return MiniSearchClass.loadJSONAsync<SearchRecord>(
    await response.text(),
    mergeSearchOptions(overrides),
  );
}

/**
 * Narrow one MiniSearch result. Its stored fields are untyped by design, and
 * an index built without `storeFields` yields rows with nothing to render —
 * those are dropped rather than rendered blank.
 */
function toSearchHit(result: unknown): SearchHit | undefined {
  if (typeof result !== 'object' || result === null) return undefined;
  const row: Record<string, unknown> = result as Record<string, unknown>;
  const { id, title, heading, href, ancestors } = row;
  if (typeof id !== 'string') return undefined;
  if (typeof title !== 'string') return undefined;
  if (typeof heading !== 'string') return undefined;
  if (typeof href !== 'string') return undefined;
  return {
    id,
    title,
    heading,
    href,
    ancestors: Array.isArray(ancestors)
      ? ancestors.filter((entry): entry is string => typeof entry === 'string')
      : [],
  };
}

function isSearchHit(hit: SearchHit | undefined): hit is SearchHit {
  return hit !== undefined;
}

/**
 * Page title first, then the ancestor headings: `ancestors` deliberately excludes
 * the page title so the index does not carry it twice.
 *
 * A page's lead record carries `heading === title` and no ancestors (see
 * `extractSearchRecords`), so its trail would be the one string already printed
 * above it. "Installation" over "Installation" is not a path, it is a bug that
 * reads as a rendering glitch — such a hit gets no trail at all.
 */
function toBreadcrumbs(hit: SearchHit): Array<{ key: string; text: string }> {
  if (hit.ancestors.length === 0 && hit.heading === hit.title) return [];

  let trail = '';
  return [hit.title, ...hit.ancestors].map((text) => {
    trail = trail === '' ? text : `${trail}/${text}`;
    return { key: trail, text };
  });
}

function trapFocus(root: HTMLElement | null, event: KeyboardEvent): void {
  if (root === null) return;
  const focusable = root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (first === undefined || last === undefined) {
    event.preventDefault();
    return;
  }
  const active = document.activeElement;
  /*
   * Focus is not in the dialog at all — clicking its status paragraph, which
   * nothing focusable contains, leaves it on `<body>`. Wrapping only at the
   * two edges would let this Tab walk the document from the top, i.e. onto the
   * trigger behind the modal. Pull it back to the near end instead.
   */
  if (!(active instanceof HTMLElement) || !root.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
