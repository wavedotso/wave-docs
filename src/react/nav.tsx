'use client';

/**
 * The navigation drawer — one `<dialog>` holding the one `<DocsSidebar>`.
 *
 * Private. `docs.Layout` renders it; nothing else should, because the trigger
 * that opens it lives in the sidebar chrome and is bound by `id`.
 *
 * ## One DOM for both breakpoints
 *
 * Below 64rem this is a modal drawer. At 64rem and above,
 * `dialog.wave-docs-layout__drawer:not(:modal) { display: contents }` removes
 * the dialog box from layout *and from the accessibility tree*, so the sidebar
 * inside it becomes the sticky column directly. One nav in the DOM, one
 * landmark, one copy of the links in the payload, and nothing to keep in step.
 *
 * ## What is native, and what is not
 *
 * Native `<dialog>` gives the four things that make an overlay usable, and they
 * are the reason this is not `popover="auto"` or a `<details>`: focus moves
 * inside on open and Tab never escapes, Escape closes and restores focus to the
 * trigger, the backdrop paints, and the rest of the page is inert.
 * `closedby="any"` adds light dismiss. The trigger is a plain server-rendered
 * `<button command="show-modal">`, so opening the drawer works before this
 * component has hydrated and with JavaScript switched off entirely.
 *
 * Two things it does not give, both handled here because this is where the
 * client boundary already is:
 *
 * 1. **Closing on navigation.** A link click inside the drawer routes without
 *    a document load, so nothing dismisses it — the reader taps a page and
 *    watches the drawer sit there over it.
 * 2. **`command` on older browsers.** Baseline since December 2025, and the
 *    fallback is eight lines, installed only where it is missing.
 */

import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';

import type { DocNavNode } from '../types.js';
import type { DocsLinkComponent } from './markdown-components.js';
import { DocsSidebar } from './sidebar.js';

/**
 * The drawer's `id`, and the sidebar trigger's `commandfor`.
 *
 * A constant rather than a `useId`, for two reasons that both matter: the
 * trigger is rendered on the server in a different subtree and cannot see a
 * hook's value, and `command`/`commandfor` must agree before React hydrates or
 * the button does nothing on the first tap.
 */
export const DOCS_NAV_ID = 'wave-docs-nav';

export interface DocsNavProps {
  /** The tree from `docs.source.nav()`. */
  nav: DocNavNode[];
  /** Current route. Injected, so this stays testable without a router. */
  pathname: string;
  /** Client-side router link, e.g. `next/link`. Falls back to `<a>`. */
  Link?: DocsLinkComponent | undefined;
  /** Accessible name for the nav landmark and the drawer. */
  label?: string | undefined;
  /** Accessible name for the close button. */
  closeLabel?: string | undefined;
  /**
   * Rendered inside the drawer, above the tree. The search trigger goes here.
   *
   * ⚠️ IT HAS TO BE INSIDE THE DIALOG, NOT BESIDE IT. Below 64rem the wrapper
   * around this is `display: contents` and generates no box, so a sibling would
   * render loose in the grid with nothing placing it. Inside, it is hidden with
   * the closed dialog on a phone and — because the dialog is `display: contents`
   * above 64rem — becomes the first child of the sidebar column on a desktop.
   * One element, both shapes, no second copy in the payload.
   */
  children?: ReactNode;
  /** Passed through to the tree. See `DocsSidebarProps.expandGroup`. */
  expandGroup?: string | undefined;
  collapseGroup?: string | undefined;
  externalLink?: string | undefined;
}

export function DocsNav({
  nav,
  pathname,
  Link,
  label = 'Documentation',
  children,
  closeLabel = 'Close navigation',
  expandGroup,
  collapseGroup,
  externalLink,
}: DocsNavProps): ReactNode {
  const ref = useRef<HTMLDialogElement | null>(null);

  /*
   * `pathname` is the trigger, not an input. This effect exists precisely to
   * fire when the route changes, and it reads nothing out of the value — which
   * is exactly why the rule flags it. Drop the dependency to satisfy the rule
   * and the drawer never closes on navigation, which is the entire reason this
   * file is a client component.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: a trigger, not an input — see above.
  useEffect(() => {
    /*
     * Closing an already-closed dialog is a no-op, so this is free on first
     * mount and on every desktop render where the drawer was never open.
     * Optional-called because a browser without `<dialog>` support at all
     * would otherwise throw here and take the whole layout down — the drawer
     * degrading to "does not close itself" beats a blank page.
     */
    ref.current?.close?.();
  }, [pathname]);

  useEffect(() => {
    if ('command' in HTMLButtonElement.prototype) return;

    /*
     * Delegated, so it costs one listener rather than one per trigger, and so
     * it works for a trigger rendered after this effect ran.
     */
    const onClick = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const button = target.closest('button[commandfor]');
      if (button === null) return;
      if (button.getAttribute('commandfor') !== DOCS_NAV_ID) return;

      const dialog = ref.current;
      if (dialog === null) return;

      if (button.getAttribute('command') === 'close') {
        dialog.close();
      } else {
        dialog.showModal();
      }
    };

    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('click', onClick);
    };
  }, []);

  return (
    <dialog
      ref={ref}
      id={DOCS_NAV_ID}
      className="wave-docs-layout__drawer"
      closedby="any"
      aria-label={label}
    >
      <button
        type="button"
        className="wave-docs-layout__drawer-close"
        aria-label={closeLabel}
        /*
         * `command` and `commandfor` are not in `@types/react` yet, so they
         * arrive through a spread — JSX skips excess-property checking there.
         * React passes both through verbatim because they are lowercase.
         */
        {...{ command: 'close', commandfor: DOCS_NAV_ID }}
      >
        {/*
         * No icon, and the same absence as the trigger that opens this. Both
         * are 24px strips down an edge, too narrow to hold one legibly, so
         * `styles.css` draws the same grip on each. The accessible name is
         * `aria-label`.
         */}
      </button>
      {children}
      <DocsSidebar
        nav={nav}
        pathname={pathname}
        label={label}
        Link={Link}
        {...(expandGroup === undefined ? {} : { expandGroup })}
        {...(collapseGroup === undefined ? {} : { collapseGroup })}
        {...(externalLink === undefined ? {} : { externalLink })}
      />
    </dialog>
  );
}
