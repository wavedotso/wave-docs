'use client';

/**
 * The sidebar — one shell holding the navigation and the control that moves it.
 *
 * Private. `docs.Layout` renders it; nothing else should.
 *
 * ## One sidebar, at every width
 *
 * There is no drawer, no dialog and no breakpoint at which this becomes a
 * different component:
 *
 * ```
 * .wave-docs-layout__sidebar            paints nothing, and moves
 * ├─ .wave-docs-layout__sidebar-nav     the surface, and the one border
 * └─ .wave-docs-layout__sidebar-trigger the strip
 * ```
 *
 * Pressing the trigger translates the shell. The trigger rides on the
 * navigation's outer edge because it is the next flex item — no arithmetic
 * connects them, so they cannot drift apart.
 *
 * ## Cover and push, and why this file does not know the breakpoint
 *
 * Where the container is wide the navigation sits beside the article; where it
 * is narrow it covers the article. That decision belongs to a `@container`
 * query in `styles.css`, and `matchMedia` cannot ask a container query — it
 * answers about the viewport, which is the question this package deliberately
 * stopped asking. So the stylesheet *declares* the mode in a custom property
 * and this reads it back. One source of truth, and the number appears nowhere
 * in here.
 *
 * ## What a `<dialog>` was giving us for free
 *
 * The five behaviours below were the browser's while the navigation was a modal
 * drawer, and they are ours now. Skipping them is how an overlay becomes a
 * keyboard trap in the wrong direction — Tab walking into text the reader
 * cannot see:
 *
 * 1. `inert` on everything the navigation covers
 * 2. Escape closes
 * 3. the scrim dismisses
 * 4. focus moves into the navigation on open
 * 5. focus returns to where it was on close
 *
 * All five apply in cover mode only. In push mode nothing is hidden, so there
 * is nothing to contain and moving focus would be an interruption.
 */

import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { DocNavNode } from '../types.js';
import type { DocsLinkComponent } from './markdown-components.js';
import { DocsSidebar } from './sidebar.js';
import type { DocsIconMap } from './sidebar.js';

/** The navigation's `id`, and the trigger's `aria-controls`. */
export const DOCS_NAV_ID = 'wave-docs-nav';

/** What `--wave-docs-sidebar-mode` resolves to, and what each one implies. */
type SidebarMode = 'cover' | 'push';

export interface DocsNavProps {
  /** The tree from `docs.source.nav()`. */
  nav: DocNavNode[];
  /** Current route. Injected, so this stays testable without a router. */
  pathname: string;
  /** Client-side router link, e.g. `next/link`. Falls back to `<a>`. */
  Link?: DocsLinkComponent | undefined;
  /** Accessible name for the nav landmark. */
  label?: string | undefined;
  /** Accessible name for the trigger while the sidebar is open. */
  closeLabel?: string | undefined;
  /** Accessible name for the trigger while the sidebar is closed. */
  openLabel?: string | undefined;
  /**
   * Rendered above the tree. The search trigger goes here — it belongs to the
   * navigation, so it moves with it and is never a second thing to place.
   */
  children?: ReactNode;
  /** Passed through to the tree. See `DocsSidebarProps.expandGroup`. */
  expandGroup?: string | undefined;
  collapseGroup?: string | undefined;
  externalLink?: string | undefined;
  /** The marker column. See `DocsSidebarProps.icons`. */
  icons?: boolean | DocsIconMap | undefined;
}

export function DocsNav({
  nav,
  pathname,
  Link,
  label = 'Documentation',
  children,
  closeLabel = 'Close navigation',
  openLabel = 'Open navigation',
  expandGroup,
  collapseGroup,
  externalLink,
  icons,
}: DocsNavProps): ReactNode {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const navRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  /**
   * ⚠️ THREE STATES, AND THE THIRD ONE IS WHY THERE IS NO FLASH.
   *
   * `null` is "nobody has chosen yet". The server renders it, no `data-state`
   * reaches the DOM, and the stylesheet decides per mode — closed where the
   * navigation would cover the article, open where it would sit beside it. So
   * the first paint is already right at both shapes, with no JavaScript and
   * nothing to correct afterwards.
   *
   * A boolean would have to be picked before the container's width is known,
   * which is either a flash on a phone or a flash on a desktop.
   */
  const [choice, setChoice] = useState<boolean | null>(null);
  const [mode, setMode] = useState<SidebarMode | null>(null);
  const [ready, setReady] = useState(false);

  const open = choice ?? mode === 'push';
  const covering = mode === 'cover' && open;

  /*
   * Read the mode the stylesheet resolved, and re-read it whenever the
   * container is resized. `ResizeObserver` on the *layout* rather than the
   * shell: the shell's own width changes when it opens, which would make this
   * fire on its own state changes.
   */
  useEffect(() => {
    const shell = shellRef.current;
    const layout = shell?.parentElement;
    if (shell == null || layout == null) return;

    const read = (): void => {
      const value = getComputedStyle(shell)
        .getPropertyValue('--wave-docs-sidebar-mode')
        .trim();
      setMode(value === 'push' ? 'push' : 'cover');
    };

    read();
    /*
     * Transitions come on one frame after the first read, so the resolved
     * state lands as a jump nobody sees rather than a slide on every load.
     */
    const frame = requestAnimationFrame(() => {
      setReady(true);
    });

    const observer = new ResizeObserver(read);
    observer.observe(layout);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  const close = useCallback(() => {
    setChoice(false);
  }, []);

  /*
   * A route change while the navigation is covering the article leaves the
   * reader looking at the navigation they just used. In push mode nothing is
   * covered and closing would be an unrequested change to their layout.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pathname` is the trigger, not an input.
  useEffect(() => {
    if (covering) setChoice(false);
  }, [pathname]);

  /* Escape, and the focus handling that has to come with an overlay. */
  useEffect(() => {
    if (!covering) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [covering, close]);

  /*
   * ⚠️ `inert`, AND IT IS THE HALF OF AN OVERLAY NOBODY SEES. Without it Tab
   * walks straight out of the navigation into an article the reader cannot
   * read, behind a scrim, with no way back. It is what `<dialog>` was doing
   * before this was hand-rolled, and what Docsify hand-rolls for the same
   * reason.
   */
  useEffect(() => {
    const shell = shellRef.current;
    const layout = shell?.parentElement;
    if (shell == null || layout == null) return;

    const outside = [...layout.children].filter(
      (child) => child !== shell && !child.classList.contains(SCRIM_CLASS),
    );

    if (!covering) {
      for (const element of outside) element.removeAttribute('inert');
      return;
    }

    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    for (const element of outside) element.setAttribute('inert', '');
    navRef.current?.focus();

    return () => {
      for (const element of outside) element.removeAttribute('inert');
      returnFocusRef.current?.focus({ preventScroll: true });
    };
  }, [covering]);

  const state = choice === null && mode === null ? undefined : open;

  return (
    <>
      <div
        ref={shellRef}
        className="wave-docs-layout__sidebar"
        {...(state === undefined
          ? {}
          : { 'data-state': state ? 'open' : 'closed' })}
        {...(ready ? { 'data-ready': '' } : {})}
      >
        <div
          ref={navRef}
          id={DOCS_NAV_ID}
          className="wave-docs-layout__sidebar-nav"
          /* Focusable only as a focus destination, never as a tab stop. */
          tabIndex={-1}
        >
          {children}
          <DocsSidebar
            nav={nav}
            pathname={pathname}
            label={label}
            Link={Link}
            {...(expandGroup === undefined ? {} : { expandGroup })}
            {...(collapseGroup === undefined ? {} : { collapseGroup })}
            {...(externalLink === undefined ? {} : { externalLink })}
            {...(icons === undefined ? {} : { icons })}
          />
        </div>
        <button
          type="button"
          className="wave-docs-layout__sidebar-trigger"
          aria-controls={DOCS_NAV_ID}
          aria-label={open ? closeLabel : openLabel}
          {...(state === undefined ? {} : { 'aria-expanded': state })}
          onClick={() => {
            setChoice(!open);
          }}
        >
          {/*
           * No icon: the strip is 44px wide and holds a 36px button, too narrow
           * for a legible glyph, so `styles.css` draws three dots on it. The
           * accessible name is `aria-label`, so nothing here is load-bearing.
           */}
        </button>
      </div>
      {/*
       * A sibling of the sidebar, not a child: it has to cover the article,
       * which is the sidebar's sibling. `position: absolute`, so it claims no
       * grid track, and `display: none` in push mode where nothing is covered.
       */}
      <div className={SCRIM_CLASS} aria-hidden="true" onClick={close} />
    </>
  );
}

const SCRIM_CLASS = 'wave-docs-layout__sidebar-scrim';
