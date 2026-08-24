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
   * URL of the serialised index, e.g. `/docs/search-index.json`.
   *
   * `docs.searchIndexUrl` is the value to pass: it is derived from the route's
   * `basePath`, so it is right when the docs are mounted anywhere but the root.
   * `docs.Layout` passes it for you.
   *
   * (This used to say "whatever `writeSearchIndex` wrote". That function was
   * deleted in 0.3.0, along with the build script it needed — the index is a
   * `force-static` route handler now.)
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
  /**
   * How many results to render at a time. Defaults to 20.
   *
   * ⚠️ NOT A CAP. Every match is reachable — the list renders this many, then
   * another `pageSize` each time the reader scrolls near the end, so the DOM
   * stays bounded without anything being withheld.
   *
   * This was `maxResults`, and it was a hard ceiling of 8. On a *six-page*
   * site "docs" matches 18, so ten results simply could not be reached, and
   * the live region announced "8 results" — not a smaller truth but a false
   * one. The ceiling was justified by a claim nobody had measured, and the
   * measurement did not support it: on a 300-page corpus (2,100 records) a
   * query costs 1.3–3.0 ms and rendering *every* row costs 40 ms, 128 ms at
   * 4x CPU throttle. Paging exists to keep that worst case from ever being
   * reached, not because the search cannot find things.
   */
  pageSize?: number | undefined;
  /**
   * Shortest query that runs. Defaults to 2.
   *
   * A single character is not a query — measured on this package's own docs,
   * "a" matches 100% of the corpus, "i" 97%, "s" 93%. Answering those wastes a
   * render and, worse, teaches a reader mid-word that search returns noise.
   *
   * ⚠️ TWO, NOT THREE, AND THE DIFFERENCE MATTERS ON A DOCS SITE. Three would
   * refuse `ts`, `js`, `id`, `h1`, `px` — every one a real query here, and each
   * one selective: 10%, 17%, 14%, 3%, 0%. The noise is at one character, so
   * that is where the floor goes.
   *
   * A word like `is` still matches 83%; that is a stopword problem rather than
   * a length one, and `miniSearchOptions.processTerm` is the tool for it.
   */
  minQueryLength?: number | undefined;
  /** Input debounce in milliseconds. Defaults to 120. */
  debounceMs?: number | undefined;
  /**
   * Shown before anything is typed. Defaults to
   * `'Start typing to search the documentation.'`
   */
  hintLabel?: string | undefined;
  /**
   * Shown while a query is below {@link SearchDialogProps.minQueryLength}.
   * Defaults to `'Keep typing — {min} characters or more.'`
   *
   * `{min}` is replaced with that number. Said rather than silently done: a
   * dialog that answers nothing and explains nothing reads as broken, and this
   * is the state every reader passes through on the way to their real query.
   */
  shortQueryLabel?: string | undefined;
  /** Shown while the index is being fetched. Defaults to `'Loading the search index…'`. */
  loadingLabel?: string | undefined;
  /**
   * Shown when the index cannot be loaded. Defaults to
   * `'Search is unavailable right now. Try reloading the page.'`
   */
  errorLabel?: string | undefined;
  /**
   * Shown when a query matches nothing. Defaults to `'No results for “{query}”.'`
   *
   * `{query}` is replaced with what the reader typed.
   */
  emptyLabel?: string | undefined;
  /**
   * The arrow-keys hint in the footer. Defaults to `'Select'`.
   *
   * The key-caps beside it are glyphs and are not translatable — an arrow is an
   * arrow, and `Esc` is `Esc` on a Portuguese keyboard. These props are the
   * verbs, which are not.
   */
  selectLabel?: string | undefined;
  /** The Enter hint in the footer. Defaults to `'Open'`. */
  openLabel?: string | undefined;
  /**
   * The footer's dismiss control. Defaults to `'Close'`.
   *
   * ⚠️ THIS REPLACES A BUTTON THAT SAID `Close` IN HARDCODED ENGLISH — the one
   * string in this package that was never lifted to a prop, in the one dialog a
   * reader cannot leave without it.
   *
   * It names a real button rather than a third hint: under `pointer: coarse`
   * the two hints beside it are hidden, because an instruction to press Esc is
   * one a reader on a phone cannot follow — and that leaves this as the only
   * pointer route out of the dialog.
   */
  closeLabel?: string | undefined;
  /**
   * The live region's announcement, by plural category. `{count}` is the total.
   *
   * Defaults to `{ one: '{count} result', other: '{count} results' }`.
   *
   * ⚠️ KEYED BY CATEGORY RATHER THAN BEING TWO STRINGS, BECAUSE MOST LANGUAGES
   * ARE NOT ENGLISH. Polish takes four forms and Arabic six;
   * `Intl.PluralRules(locale).select(count)` picks, and an unlisted category
   * falls back to `other`. Two props called "singular" and "plural" would have
   * made this package announce a wrong number of results, correctly, in most of
   * the world.
   */
  resultCountLabels?: Partial<Record<Intl.LDMLPluralRule, string>> | undefined;
  /**
   * Language tag for the plural rules above. Defaults to the document's own
   * `<html lang>`, then to `'en'`.
   *
   * Read at announcement time rather than at render, so it costs nothing on a
   * site that never changes it and needs no prop on a site that sets `lang`
   * correctly — which is every site that should be setting these labels at all.
   */
  locale?: string | undefined;
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
  pageSize = 20,
  minQueryLength = 2,
  debounceMs = 120,
  className,
  miniSearchOptions,
  hintLabel,
  shortQueryLabel,
  loadingLabel,
  errorLabel,
  emptyLabel,
  selectLabel = 'Select',
  openLabel = 'Open',
  closeLabel = 'Close',
  resultCountLabels,
  locale,
}: SearchDialogProps): ReactNode {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  /**
   * How many of `hits` are rendered.
   *
   * `hits` holds every match; this is the window. It grows by `pageSize` when
   * the reader scrolls near the end, and whenever the keyboard walks past it —
   * so an option always exists for `aria-activedescendant` to point at.
   */
  const [visibleCount, setVisibleCount] = useState(pageSize);

  /**
   * Whether the active option moved because of a key, rather than a pointer.
   *
   * ⚠️ THE SCROLL-INTO-VIEW BELOW MUST NOT RUN FOR A HOVER. Pointing at a row
   * that is half-clipped by the top or bottom edge set the active index, which
   * scrolled that row flush — moving the whole list under the cursor, which
   * then landed on a different row. Measured: hovering the visible sliver of a
   * clipped row jumped the list 28px.
   *
   * A ref rather than state: it records how the *last* change happened and must
   * not itself cause a render.
   */
  const movedByKeyboard = useRef(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [status, setStatus] = useState<IndexStatus>('idle');
  /**
   * The trigger's shortcut, split rather than held as one string.
   *
   * ⚠️ THE `⌘` NEEDS ITS OWN `font-size` AND CSS CANNOT SELECT A CHARACTER.
   * Measured in the shipped mono stack at 12px, its ink is 6.39px tall against
   * the `K`'s 8.75px — so as one string the symbol sits visibly short of the
   * letter beside it. Two nodes is the only way to scale one and not the other.
   *
   * `null` until the effect below resolves the platform: reading it during
   * render would disagree with the server's markup and break hydration.
   */
  const [shortcut, setShortcut] = useState<{
    modifier: string;
    /** A glyph, not a word — `Ctrl` must not be scaled with `⌘`. */
    isSymbol: boolean;
  } | null>(null);

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
    setShortcut({ modifier: isApple ? '⌘' : 'Ctrl', isSymbol: isApple });
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
    // Below the floor is treated exactly like an empty query: no request for
    // the index, no search, no results. The status line says why.
    if (trimmed.length < minQueryLength) {
      setHits([]);
      setActiveIndex(0);
      setVisibleCount(pageSize);
      return;
    }

    let isCancelled = false;
    const timer = setTimeout(() => {
      ensureIndex().then(
        (index) => {
          if (isCancelled) return;
          setStatus('ready');
          // Every match, uncapped. `visibleCount` decides what is rendered.
          setHits(index.search(trimmed).map(toSearchHit).filter(isSearchHit));
          setActiveIndex(0);
          setVisibleCount(pageSize);
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
  }, [query, ensureIndex, pageSize, debounceMs, minQueryLength]);

  /**
   * Reveal another page when the reader nears the end of the list.
   *
   * A scroll handler rather than an `IntersectionObserver` on a sentinel: the
   * scrollport is one element this component already holds a ref to, the test
   * is one subtraction, and an observer would cost bytes on the largest client
   * entry this package ships for no behaviour the reader can tell apart.
   *
   * `passive`, because this never calls `preventDefault` and a non-passive
   * scroll listener blocks the compositor on every wheel event.
   *
   * No `isOpen` dependency, though the list does not exist while the dialog is
   * closed: the effect returns early on a null ref, and `hits.length` going
   * from 0 to N re-runs it — which happens after the list has mounted, because
   * closing resets the query. The listener attaches exactly when there is
   * something to scroll.
   */
  useEffect(() => {
    const list = listRef.current;
    if (list === null || visibleCount >= hits.length) return;

    const onScroll = (): void => {
      // One viewport's warning, so the next page is in the DOM before the
      // reader arrives at the gap rather than after.
      const remaining = list.scrollHeight - list.scrollTop - list.clientHeight;
      if (remaining < list.clientHeight) {
        setVisibleCount((count) => Math.min(count + pageSize, hits.length));
      }
    };

    list.addEventListener('scroll', onScroll, { passive: true });
    return () => list.removeEventListener('scroll', onScroll);
  }, [visibleCount, hits.length, pageSize]);

  /*
   * The keyboard may walk past the window, and an option that is not rendered
   * is one `aria-activedescendant` points at nothing — a silent listbox for
   * anyone navigating by keyboard. Widen to cover wherever the arrows went.
   */
  useEffect(() => {
    if (activeIndex >= visibleCount) {
      setVisibleCount(Math.min(activeIndex + 1, hits.length));
    }
  }, [activeIndex, visibleCount, hits.length]);

  /*
   * A new result set starts at the top.
   *
   * The scroll-into-view below used to do this by accident: a fresh search
   * reset `activeIndex` to 0 and scrolled that option into view. Now that it
   * only runs for the keyboard, the reset has to be said out loud — otherwise
   * a reader who scrolled halfway down the results for one query keeps that
   * offset for the next, and lands in the middle of a list they have not seen
   * the start of.
   *
   * `hits` is a trigger, not an input — the body reads only the ref — which is
   * why the exhaustive-deps rule cannot see that removing it breaks this.
   * Verified: with the dependency dropped the effect never re-runs and a new
   * query keeps the previous one's scroll offset.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: a trigger, not an input.
  useEffect(() => {
    const list = listRef.current;
    // Guarded, and `scrollTop` rather than `scrollTo`: assigning a value it
    // already holds still fires a `scroll` event — which this component now
    // listens to — and jsdom implements the property but not the method.
    if (list !== null && list.scrollTop !== 0) list.scrollTop = 0;
  }, [hits]);

  // Keep the active option visible under arrow-key navigation — and only then.
  useEffect(() => {
    if (hits.length === 0) return;
    if (!movedByKeyboard.current) return;
    movedByKeyboard.current = false;
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
      movedByKeyboard.current = true;
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
        <SearchGlyph />
        <span className="wave-docs-search-trigger-label">{triggerLabel}</span>
        {shortcut === null ? null : (
          <kbd className="wave-docs-search-trigger-kbd">
            <span
              className="wave-docs-search-trigger-mod"
              data-symbol={shortcut.isSymbol ? '' : undefined}
            >
              {shortcut.modifier}
            </span>
            {/* `Ctrl K` reads as two words and `⌘K` as one mark. The space is
                markup rather than part of either string. */}
            {shortcut.isSymbol ? 'K' : ' K'}
          </kbd>
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
                  <SearchGlyph />
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
                  {hits.slice(0, visibleCount).map((hit, index) => (
                    <SearchResultOption
                      key={hit.id}
                      hit={hit}
                      id={optionId(index)}
                      isActive={index === activeIndex}
                      /*
                       * The whole list's size, not the window's. A listbox that
                       * renders 20 of 47 must say 47, or a screen reader
                       * announces "20 of 20" and the reader stops scrolling at
                       * the point the DOM happens to end.
                       */
                      setSize={hits.length}
                      posInSet={index + 1}
                      onActivate={() => {
                        movedByKeyboard.current = false;
                        setActiveIndex(index);
                      }}
                      onSelect={selectHit}
                      {...(Link === undefined ? {} : { Link })}
                    />
                  ))}
                </div>

                <SearchStatus
                  status={status}
                  query={query.trim()}
                  hitCount={hits.length}
                  minQueryLength={minQueryLength}
                  labels={{
                    ...(hintLabel === undefined ? {} : { hint: hintLabel }),
                    ...(shortQueryLabel === undefined
                      ? {}
                      : { shortQuery: shortQueryLabel }),
                    ...(loadingLabel === undefined
                      ? {}
                      : { loading: loadingLabel }),
                    ...(errorLabel === undefined ? {} : { error: errorLabel }),
                    ...(emptyLabel === undefined ? {} : { empty: emptyLabel }),
                  }}
                  resultCountLabels={resultCountLabels}
                  locale={locale}
                />

                {/*
                 * The keyboard footer, and the dialog's dismiss control.
                 *
                 * ⚠️ THE STANDALONE "Close" BUTTON THIS REPLACES SAID `Close`
                 * IN HARDCODED ENGLISH. Every other string this package speaks
                 * had been lifted to a prop; that one was missed, in the one
                 * dialog a reader cannot leave without it. It is a prop now,
                 * and it names a control that also teaches the key.
                 *
                 * ⚠️ AND IT IS STILL A BUTTON, NOT A THIRD HINT. On a touch
                 * screen there is no Esc to press: the two hints beside it are
                 * `display: none` under `pointer: coarse`, and without a real
                 * control the only way out would be a tap on the backdrop —
                 * undiscoverable, and the thing every reader tries last.
                 *
                 * The hints themselves are `aria-hidden`. They describe the
                 * pointer-free path through a listbox that a screen reader
                 * already exposes through `role`, `aria-activedescendant` and
                 * `aria-posinset` — so announcing them adds two lines of
                 * symbols and no information. The button is not hidden, and
                 * carries its verb as its name rather than "Esc Close".
                 */}
                <div className="wave-docs-search-footer">
                  <span className="wave-docs-search-hint" aria-hidden="true">
                    <kbd className="wave-docs-search-kbd">↑</kbd>
                    <kbd className="wave-docs-search-kbd">↓</kbd>
                    {selectLabel}
                  </span>
                  <span className="wave-docs-search-hint" aria-hidden="true">
                    <kbd className="wave-docs-search-kbd">↵</kbd>
                    {openLabel}
                  </span>
                  <button
                    type="button"
                    className="wave-docs-search-close"
                    aria-label={closeLabel}
                    aria-keyshortcuts="Escape"
                    onClick={closeDialog}
                  >
                    {/* No `aria-hidden` on either: `aria-label` above already
                        overrides this button's contents for its accessible
                        name, so it announces as "Close" rather than "Esc
                        Close", and hiding the children as well would be a
                        second answer to a question already answered. */}
                    <kbd className="wave-docs-search-kbd">Esc</kbd>
                    <span>{closeLabel}</span>
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * The magnifier, on the trigger and in the dialog's input row.
 *
 * Decorative in both places: the trigger carries its name in `aria-label` and
 * the input carries its own, so this glyph would only ever repeat a word that
 * is already there — announced as "search Search" and, on some engines, as the
 * name of the character.
 *
 * Inline SVG rather than a `::before` glyph, matching every other icon in this
 * package: generated content is announced by some screen-reader and browser
 * pairs, which is the one thing `aria-hidden` cannot take back.
 */
function SearchGlyph(): ReactNode {
  return (
    <svg
      className="wave-docs-search-glyph"
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

/** One result row: a real link, so middle-click and "open in new tab" work. */
function SearchResultOption({
  hit,
  id,
  isActive,
  setSize,
  posInSet,
  onActivate,
  onSelect,
  Link,
}: {
  hit: SearchHit;
  id: string;
  isActive: boolean;
  /** Size of the whole result set, not of the rendered window. */
  setSize: number;
  posInSet: number;
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

  const body = (
    <>
      <span className="wave-docs-search-result-heading">{hit.heading}</span>
      {/*
       * ⚠️ `aria-hidden`, AND THE NAME BELOW SAYS SOMETHING ELSE. A route read
       * aloud is punctuation, one character at a time —
       * "slash docs slash styling hash layout dash tokens" — which is worse
       * than useless as a result's name. The visible line is a sighted
       * reader's affordance for "where does this land"; the announced name
       * answers the same question in words.
       *
       * Not a WCAG 2.5.3 problem: the visible label a speech-input user would
       * say is the heading, and the heading opens the accessible name.
       */}
      <span className="wave-docs-search-result-location" aria-hidden="true">
        {toDisplayPath(hit.href)}
      </span>
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
       * Explicit, because the DOM undercounts on purpose. The listbox renders
       * a window of the results, so the sizes a browser would infer are the
       * window's — "20 of 20" while 47 matched, which tells a reader they have
       * reached the end when they have not.
       */
      aria-setsize={setSize}
      aria-posinset={posInSet}
      /*
       * Named explicitly, and in words rather than in the route the row shows.
       * The visible second line is `/docs/styling#layout-tokens`, which a
       * screen reader would spell out as punctuation; "Layout tokens, Styling"
       * is the same fact in the form a listener can use.
       *
       * Commas because that is what a path sounds like read aloud, and `›`
       * stays out of it: more than one screen reader pronounces it.
       */
      aria-label={spokenName(hit)}
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

/** The five overridable state messages. */
interface StatusLabels {
  hint?: string | undefined;
  shortQuery?: string | undefined;
  loading?: string | undefined;
  error?: string | undefined;
  empty?: string | undefined;
}

/**
 * The wording, so a caller that overrides none of it costs nothing.
 *
 * `Record<keyof …, string>` rather than `as const`: literal types here make
 * every override a type error, and `Required<StatusLabels>` keeps the
 * `| undefined` that `exactOptionalPropertyTypes` needs on the props.
 */
const DEFAULT_STATUS_LABELS: Record<keyof StatusLabels, string> = {
  hint: 'Start typing to search the documentation.',
  shortQuery: 'Keep typing — {min} characters or more.',
  loading: 'Loading the search index…',
  error: 'Search is unavailable right now. Try reloading the page.',
  empty: 'No results for “{query}”.',
};

const DEFAULT_RESULT_COUNT_LABELS: Partial<
  Record<Intl.LDMLPluralRule, string>
> = { one: '{count} result', other: '{count} results' };

/**
 * The announcement for `count` hits, in the document's own language.
 *
 * `Intl.PluralRules` rather than an `=== 1` check: Polish takes four plural
 * forms and Arabic six, and a package that ships an English singular/plural pair
 * announces a wrong number of results — correctly, and confidently — in most of
 * the world. An unlisted category falls back to `other`, which is the one every
 * language has.
 */
function announceCount(
  count: number,
  labels: Partial<Record<Intl.LDMLPluralRule, string>>,
  locale: string | undefined,
): string {
  const tag =
    locale ??
    (typeof document === 'undefined' ? '' : document.documentElement.lang) ??
    '';
  let category: Intl.LDMLPluralRule = 'other';
  try {
    category = new Intl.PluralRules(tag === '' ? 'en' : tag).select(count);
  } catch {
    // An invalid `lang` attribute is the site's typo, not a reason to announce
    // nothing — `Intl.PluralRules` throws a RangeError on one.
  }
  const template = labels[category] ?? labels.other ?? '{count}';
  return template.replace('{count}', String(count));
}

/** Loading, failure and empty states, plus a live region for hit counts. */
function SearchStatus({
  status,
  query,
  hitCount,
  minQueryLength,
  labels,
  resultCountLabels,
  locale,
}: {
  labels: StatusLabels;
  resultCountLabels: Partial<Record<Intl.LDMLPluralRule, string>> | undefined;
  locale: string | undefined;
  status: IndexStatus;
  query: string;
  /** Everything the index matched. Nothing is withheld, so this is the total. */
  hitCount: number;
  minQueryLength: number;
}): ReactNode {
  let message: string | null = null;
  let modifier = '';

  if (status === 'error') {
    message = labels.error ?? DEFAULT_STATUS_LABELS.error;
    modifier = ' wave-docs-search-status-error';
  } else if (query === '') {
    message = labels.hint ?? DEFAULT_STATUS_LABELS.hint;
    modifier = ' wave-docs-search-status-hint';
  } else if (query.length < minQueryLength) {
    /*
     * Said, not silently done. A dialog that answers nothing and explains
     * nothing reads as broken — and this is the state every reader passes
     * through on the way to their real query, so it is the one place the
     * wording has to be encouragement rather than an error.
     */
    message = (labels.shortQuery ?? DEFAULT_STATUS_LABELS.shortQuery).replace(
      '{min}',
      String(minQueryLength),
    );
    modifier = ' wave-docs-search-status-hint';
  } else if (status !== 'ready') {
    // 'idle' too: a query typed before the index resolved is still waiting.
    message = labels.loading ?? DEFAULT_STATUS_LABELS.loading;
    modifier = ' wave-docs-search-status-loading';
  } else if (hitCount === 0) {
    message = (labels.empty ?? DEFAULT_STATUS_LABELS.empty).replace(
      '{query}',
      query,
    );
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
          : announceCount(
              hitCount,
              resultCountLabels ?? DEFAULT_RESULT_COUNT_LABELS,
              locale,
            )}
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
 * The route, without its anchor, for display only.
 *
 * ⚠️ THE ANCHOR IS NOISE HERE, AND ALMOST ALWAYS A REPEAT. A section's anchor
 * is slugged from its heading, so `/docs/styling#layout-tokens` under a row
 * whose first line already reads "Layout tokens" spends its width restating
 * it — and on a real site it is the part that pushes the line past the
 * ellipsis.
 *
 * What the line is for is "which page does this land on", and the path answers
 * that on its own. Two rows from the same page showing the same path is not
 * ambiguity: they *are* the same page, and their headings above say which part.
 *
 * Display only. `hit.href` keeps the anchor, so the link still deep-links to
 * the section — that is the whole point of section-scoped records.
 */
function toDisplayPath(href: string): string {
  const hash = href.indexOf('#');
  return hash === -1 ? href : href.slice(0, hash);
}

/**
 * What a result is called when it is read aloud.
 *
 * Words, not the route the row displays. `/docs/styling#layout-tokens` is
 * punctuation to a screen reader — spelled out slash by slash — so the visible
 * line and the announced name deliberately carry the same fact in two forms:
 * the route for a sighted reader scanning for where a hit lands, and
 * "Layout tokens, Styling" for a listener.
 *
 * `ancestors` deliberately excludes the page title, so the page comes first
 * here and the enclosing headings follow, outermost first.
 *
 * A page's own record carries `heading === title` and no ancestors, so its name
 * is the heading alone — "Styling, Styling" is not a path, it is a stutter.
 */
function spokenName(hit: SearchHit): string {
  if (hit.ancestors.length === 0 && hit.heading === hit.title) {
    return hit.heading;
  }
  return [hit.heading, hit.title, ...hit.ancestors].join(', ');
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
