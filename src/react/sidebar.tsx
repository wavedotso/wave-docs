'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { DocNavGroup, DocNavNode } from '../types.js';
import type { DocsLinkComponent } from './markdown-components.js';
import { nearestScrollTop } from './nearest-scroll-top.js';

export interface DocsSidebarProps {
  /** The tree from `@waveso/docs/source`. */
  nav: DocNavNode[];
  /**
   * Current route, used for `aria-current` and for deciding which groups open.
   * Passed in rather than read from `next/navigation` so this component stays
   * host-agnostic and testable without a router.
   */
  pathname: string;
  /** Client-side router link, e.g. `next/link`. Falls back to `<a>`. */
  Link?: DocsLinkComponent | undefined;
  /** Accessible name for the landmark. Distinguish multiple navs on a page. */
  label?: string | undefined;
  /**
   * A collapsed group's toggle. Default `'Expand {title}'`.
   *
   * `{title}` is replaced with the group's own name. A placeholder rather than
   * a function, because `docs.Layout` sets this from a Server Component and a
   * function cannot cross that boundary — and because a translator has to be
   * able to move the name within the sentence.
   */
  expandGroup?: string | undefined;
  /** The same toggle when open. Default `'Collapse {title}'`. */
  collapseGroup?: string | undefined;
  /**
   * Screen-reader suffix on an external link. Default `'(opens in a new tab)'`.
   *
   * The separating space is markup, so this is the sentence and nothing else.
   */
  externalLink?: string | undefined;
  className?: string | undefined;
}

/**
 * The three strings this tree renders, resolved once.
 *
 * Threaded as one object rather than three props: `DocsSidebar` → `NavList` →
 * `NavGroup` → `NavList` is four hops, and three separate parameters at each
 * one is where a prop gets dropped on the way through — which is exactly how
 * `DocsNav`'s `label` and `closeLabel` came to be documented, defaulted and
 * never passed.
 */
interface SidebarLabels {
  expandGroup: string;
  collapseGroup: string;
  externalLink: string;
}

const DEFAULT_SIDEBAR_LABELS: SidebarLabels = {
  expandGroup: 'Expand {title}',
  collapseGroup: 'Collapse {title}',
  externalLink: '(opens in a new tab)',
};

/** Trailing slashes are a routing detail, not a difference in identity. */
function normalizeHref(href: string): string {
  return href.length > 1 ? href.replace(/\/+$/, '') : href;
}

function isActiveHref(pathname: string, href: string): boolean {
  return normalizeHref(pathname) === normalizeHref(href);
}

/** Whether the active page lives anywhere under this node. */
function containsActive(node: DocNavNode, pathname: string): boolean {
  switch (node.type) {
    case 'page':
      return isActiveHref(pathname, node.href);
    case 'group':
      return (
        (node.href !== undefined && isActiveHref(pathname, node.href)) ||
        node.children.some((child) => containsActive(child, pathname))
      );
    case 'link':
      // The same rule `NavList` applies when it decides `aria-current`. A link
      // node is only external when its href carries a scheme, so
      // `{ title, href: '/docs/roadmap' }` in meta.json is a real route — and a
      // group whose active child is one of those has to open, or the current
      // page is the one entry the reader cannot see.
      return !node.external && isActiveHref(pathname, node.href);
    default:
      return false;
  }
}

/**
 * The docs navigation tree.
 *
 * ## Prefetch
 *
 * Nearby links prefetch; the rest do not. Nearby means the list that directly
 * contains the current page, plus the heading link of the group the reader is
 * inside — 5 to 15 warm links on a real sidebar rather than 400 or none.
 *
 * ⚠️ THE PREVIOUS NOTE HERE WAS WRONG, AND THE RETRACTION IS THE POINT. It
 * said prefetch was off because a full-tree sidebar otherwise asks Next to
 * prefetch every route in it, ~1.8 KB brotli each. That reasoning is correct
 * for the Pages Router and wrong for the App Router:
 * `next/dist/client/app-dir/link.js` computes
 * `const prefetchEnabled = prefetchProp !== false`, and BOTH the hover path
 * and the touch path bail on it, while the IntersectionObserver is only
 * registered when it is true. So `prefetch={false}` did not trade viewport
 * prefetching for hover prefetching — it turned off both, and made every
 * navigation from the most-clicked control in a docs site a cold RSC
 * round-trip.
 *
 * ## The keyboard model, and why there is no `role="tree"`
 *
 * This is the **APG Disclosure Navigation** pattern: a list of links, with a
 * button per collapsible group. Every link is an ordinary tab stop, Enter
 * follows it, and the browser does all of it. There is no `tabindex`
 * anywhere in here and no roving focus, deliberately.
 *
 * `role="tree"` is the tempting alternative and it is refused. It removes
 * every link from the tab order in favour of a single roving tabstop, so a
 * reader who tabs into the navigation can no longer tab through it; and it
 * makes a screen reader announce "tree item, level 3" for what is, in every
 * way that matters to the person hearing it, a link to a page. A docs sidebar
 * is not a file explorer. `sidebar.test.tsx` asserts the absence of both, so
 * the decision survives someone reaching for the aria pattern that sounds
 * closest to "collapsible tree".
 *
 * ⚠️ AND IT IS UNOBSERVABLE IN `next dev`. The same file guards the hover path
 * with `if (!prefetchEnabled || process.env.NODE_ENV === 'development')`, so
 * nothing prefetches locally whatever this says. Do not "fix" it back because
 * the network tab looks the same.
 */
export function DocsSidebar({
  nav,
  pathname,
  Link,
  label = 'Docs',
  expandGroup,
  collapseGroup,
  externalLink,
  className,
}: DocsSidebarProps): ReactNode {
  const text: SidebarLabels = {
    expandGroup: expandGroup ?? DEFAULT_SIDEBAR_LABELS.expandGroup,
    collapseGroup: collapseGroup ?? DEFAULT_SIDEBAR_LABELS.collapseGroup,
    externalLink: externalLink ?? DEFAULT_SIDEBAR_LABELS.externalLink,
  };
  const baseId = useId();
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  // Re-sync the tree to the route on navigation: a group the reader collapsed
  // an hour ago should not hide the page they just opened. Adjusting state
  // during render is the supported way to react to a changed prop — an effect
  // would paint the stale tree first.
  const lastPathname = useRef(pathname);
  if (lastPathname.current !== pathname) {
    lastPathname.current = pathname;
    setToggled({});
  }

  const handleToggle = (key: string, isOpen: boolean) => {
    setToggled((previous) => ({ ...previous, [key]: isOpen }));
  };

  const navRef = useRef<HTMLElement | null>(null);

  /*
   * Bring the current page into view, on navigation only.
   *
   * ⚠️ KEYED ON `pathname`, NEVER ON `toggled`. Adding the toggle state would
   * re-scroll the column every time the reader expanded a group — yanking the
   * list under the hand that just clicked, which is worse than never scrolling
   * at all.
   *
   * `useLayoutEffect` so it lands before paint: in an effect the reader sees
   * the wrong position for a frame and then a jump.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: a trigger, not an input — see above.
  useLayoutEffect(() => {
    revealActive(navRef.current);
  }, [pathname]);

  /*
   * ⚠️ AND AGAIN WHEN A DIALOG AROUND THIS OPENS — FOR A CONSUMER'S DIALOG, NOT
   * FOR OURS.
   *
   * This shell had one. The sidebar lived inside `<dialog
   * class="wave-docs-layout__drawer">` below 64rem, which the UA sheet keeps at
   * `display: none` until `showModal()`, and an element in a `display: none`
   * subtree generates no boxes — so it reported `scrollHeight === clientHeight
   * === 0` and `scrollableAncestor` walked past the drawer, past the grid, and
   * returned `null`. The timing made it unreachable rather than merely
   * unreliable: the effect above is keyed on `pathname`, and the drawer closed
   * on every `pathname` change, so at the only moment it could fire the drawer
   * was always shut. Every phone reader, every navigation, opened a 60-item
   * list scrolled to the top with their page below the fold.
   *
   * There is no drawer now: one sidebar at every width, and a closed one is
   * translated out past the inline start edge rather than hidden — so it has a
   * scrollport the whole time and the effect above is enough.
   *
   * This stays because `DocsSidebar` is public API and the condition it tests
   * was never "I am inside *our* drawer" — it is "I am inside something that
   * can be hidden and revealed". A consumer who puts this in a dialog of their
   * own gets it working for the same reason, and `closest('dialog')` is what
   * keeps that true without a prop threaded down from a component of ours.
   */
  useEffect(() => {
    const dialog = navRef.current?.closest('dialog');
    if (!(dialog instanceof HTMLDialogElement)) return;

    const onToggle = (): void => {
      // Only on the way open. `toggle` fires in both directions, and a closing
      // dialog measures zero anyway — but declining is cheaper than proving it.
      if (dialog.open) revealActive(navRef.current);
    };

    dialog.addEventListener('toggle', onToggle);
    return () => {
      dialog.removeEventListener('toggle', onToggle);
    };
  }, []);

  return (
    <nav
      ref={navRef}
      aria-label={label}
      className={['wave-docs-sidebar', className].filter(Boolean).join(' ')}
    >
      <NavList
        nodes={nav}
        depth={0}
        keyPrefix={baseId}
        pathname={pathname}
        Link={Link}
        toggled={toggled}
        onToggle={handleToggle}
        text={text}
      />
    </nav>
  );
}

/**
 * The nearest ancestor that actually scrolls, or `null`.
 *
 * ⚠️ THIS EXISTS SO `scrollIntoView` DOES NOT HAVE TO. `scrollIntoView({ block:
 * 'nearest' })` reads as exactly the right call and scrolls **every**
 * scrollable ancestor including the document — so on a docs page it brings the
 * sidebar item into view and jumps the article the reader came to read, on the
 * one navigation where they know precisely what they asked for.
 * `sidebar.test.tsx` spies on it and asserts it is never called.
 */
/**
 * Scroll the item marked `aria-current="page"` into view, if it is not already.
 *
 * A no-op wherever there is nothing to measure — no nav, no active item, no
 * scrollport — which is every server render, every jsdom render, and every
 * layout where the column is shorter than its content. Nothing to do, and
 * nothing to do wrongly.
 */
function revealActive(nav: HTMLElement | null): void {
  const active = nav?.querySelector('[aria-current="page"]');
  if (!(active instanceof HTMLElement)) return;

  const port = scrollableAncestor(active);
  if (port === null) return;

  /*
   * ⚠️ RECTANGLES, NOT `offsetTop`. `active.offsetTop - port.offsetTop` reads
   * as the obvious way to get an item's position inside its scrollport and is
   * wrong here, because `offsetTop` is measured from the nearest *positioned*
   * ancestor — and the scrollport is `position: sticky`, so it IS that
   * ancestor. `active.offsetTop` is therefore already the number wanted, and
   * subtracting the port's own offset takes off a second distance that belongs
   * to the port rather than to the item: how far the port sits from *its* own
   * offsetParent.
   *
   * ⚠️ AND THAT DISTANCE IS NOT A FIXED NUMBER. It was written up here as the
   * header height, measured once at the top of the page, and the shell has since
   * removed the header. What it actually is: whatever the host stacks above
   * the shell — the thing `--wave-docs-chrome-offset` is set to match — plus
   * every pixel the sticky column has already travelled, because a stuck
   * element reports its shift in `offsetTop`. Measured in Chromium at
   * 1440×800 with the active item's own `offsetTop` at 1849, `port.offsetTop`
   * reads 0 at the top of the page, 400 after a 400px scroll, and 64 then 464
   * with a 4rem host bar above the grid; the naive difference is short by
   * exactly that each time, while the rect difference is 1849 in all four.
   * What that cost under the header shell, at 1280×800: the active item
   * scrolled to 206 where 265 was correct, which put a 1024–1055 item inside a
   * 206–1014 viewport — entirely below the fold, the exact failure this exists
   * to prevent.
   *
   * The rect difference is right whether or not the port is the offsetParent,
   * and `+ port.scrollTop` converts it from viewport-relative back to
   * content-relative, which is what `nearestScrollTop` documents itself to
   * take.
   */
  const next = nearestScrollTop({
    itemTop:
      active.getBoundingClientRect().top -
      port.getBoundingClientRect().top +
      port.scrollTop,
    itemHeight: active.offsetHeight,
    viewHeight: port.clientHeight,
    scrollTop: port.scrollTop,
    scrollHeight: port.scrollHeight,
  });
  if (next !== undefined) port.scrollTop = next;
}

function scrollableAncestor(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement;
  while (current !== null) {
    const overflow = getComputedStyle(current).overflowY;
    if (
      (overflow === 'auto' || overflow === 'scroll') &&
      current.scrollHeight > current.clientHeight
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

interface NavListProps {
  nodes: DocNavNode[];
  depth: number;
  keyPrefix: string;
  pathname: string;
  Link: DocsLinkComponent | undefined;
  toggled: Record<string, boolean>;
  onToggle: (key: string, isOpen: boolean) => void;
  text: SidebarLabels;
  /** Set on the `<ul>` a group's toggle button points `aria-controls` at. */
  id?: string | undefined;
}

function NavList({
  nodes,
  depth,
  keyPrefix,
  pathname,
  Link,
  toggled,
  onToggle,
  text,
  id,
}: NavListProps): ReactNode {
  /*
   * One decision for the whole list: is the reader's own page in it? If so
   * every link here is a plausible next click — the sibling pages of the
   * section they are reading. Anywhere else in a few-hundred-page tree is not,
   * and prefetching it would be the bandwidth the old comment was worried
   * about, correctly.
   */
  const holdsActive = nodes.some(
    (node) =>
      (node.type === 'page' || (node.type === 'link' && !node.external)) &&
      isActiveHref(pathname, node.href),
  );

  return (
    <ul id={id} className="wave-docs-sidebar__list" data-depth={depth}>
      {/* Positional keys: the tree is authored on disk and read at build time,
          so a node's index is as stable an identity as it has. */}
      {nodes.map((node, index) => {
        const key = `${keyPrefix}-${index}`;
        switch (node.type) {
          case 'separator':
            return (
              <li key={key} className="wave-docs-sidebar__separator-item">
                {/* Not a heading: the correct level depends on the surrounding
                    page, and guessing one corrupts the document outline. */}
                <span className="wave-docs-sidebar__separator">
                  {node.title}
                </span>
              </li>
            );
          case 'link':
            return (
              <li key={key} className="wave-docs-sidebar__item">
                <NavLink
                  href={node.href}
                  isExternal={node.external}
                  isActive={!node.external && isActiveHref(pathname, node.href)}
                  isNearby={holdsActive}
                  Link={Link}
                  externalLink={text.externalLink}
                >
                  {node.title}
                </NavLink>
              </li>
            );
          case 'page':
            return (
              <li key={key} className="wave-docs-sidebar__item">
                <NavLink
                  href={node.href}
                  isExternal={false}
                  isActive={isActiveHref(pathname, node.href)}
                  isNearby={holdsActive}
                  Link={Link}
                >
                  {node.title}
                </NavLink>
              </li>
            );
          case 'group':
            return (
              <NavGroup
                key={key}
                node={node}
                itemKey={key}
                depth={depth}
                pathname={pathname}
                Link={Link}
                toggled={toggled}
                onToggle={onToggle}
                text={text}
              />
            );
          default:
            return null;
        }
      })}
    </ul>
  );
}

interface NavGroupProps {
  node: DocNavGroup;
  itemKey: string;
  depth: number;
  pathname: string;
  Link: DocsLinkComponent | undefined;
  toggled: Record<string, boolean>;
  onToggle: (key: string, isOpen: boolean) => void;
  text: SidebarLabels;
}

function NavGroup({
  node,
  itemKey,
  depth,
  pathname,
  Link,
  toggled,
  onToggle,
  text,
}: NavGroupProps): ReactNode {
  const listId = `${itemKey}-list`;
  const hasActive = containsActive(node, pathname);
  const isOpen = toggled[itemKey] ?? hasActive;
  const isGroupActive =
    node.href !== undefined && isActiveHref(pathname, node.href);

  return (
    <li className="wave-docs-sidebar__item" data-open={isOpen ? '' : undefined}>
      <div className="wave-docs-sidebar__group-header">
        {node.href === undefined ? (
          <button
            type="button"
            className="wave-docs-sidebar__group-button"
            aria-expanded={isOpen}
            // Only while the list exists: `aria-controls` pointing at an id
            // that is not in the DOM is worse than no `aria-controls` at all,
            // and a closed group renders no children (a few hundred pages of
            // permanently-hidden `<li>`s is DOM nobody reads).
            aria-controls={isOpen ? listId : undefined}
            onClick={() => onToggle(itemKey, !isOpen)}
          >
            <span className="wave-docs-sidebar__group-title">{node.title}</span>
            <Chevron isOpen={isOpen} />
          </button>
        ) : (
          <>
            <NavLink
              href={node.href}
              isExternal={false}
              isActive={isGroupActive}
              // The heading of the group the reader is inside: the one link
              // that reliably gets clicked on the way back out.
              isNearby={hasActive}
              Link={Link}
            >
              {node.title}
            </NavLink>
            <button
              type="button"
              className="wave-docs-sidebar__group-toggle"
              aria-expanded={isOpen}
              aria-controls={isOpen ? listId : undefined}
              // The link beside it carries the name, so this icon-only control
              // needs its own — and it must say which group it opens.
              aria-label={(isOpen
                ? text.collapseGroup
                : text.expandGroup
              ).replace('{title}', node.title)}
              onClick={() => onToggle(itemKey, !isOpen)}
            >
              <Chevron isOpen={isOpen} />
            </button>
          </>
        )}
      </div>
      {isOpen ? (
        <NavList
          id={listId}
          nodes={node.children}
          depth={depth + 1}
          keyPrefix={itemKey}
          pathname={pathname}
          Link={Link}
          toggled={toggled}
          onToggle={onToggle}
          text={text}
        />
      ) : null}
    </li>
  );
}

interface NavLinkProps {
  href: string;
  isExternal: boolean;
  isActive: boolean;
  /** Close enough to the reader's position to be worth a warm route. */
  isNearby?: boolean | undefined;
  Link: DocsLinkComponent | undefined;
  /** Only read on the external branch, so the internal one omits it. */
  externalLink?: string | undefined;
  children: ReactNode;
}

function NavLink({
  href,
  isExternal,
  isActive,
  isNearby = false,
  Link,
  externalLink = DEFAULT_SIDEBAR_LABELS.externalLink,
  children,
}: NavLinkProps): ReactNode {
  const className = 'wave-docs-sidebar__link';

  if (isExternal) {
    return (
      <a
        className={className}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
        {/*
         * An inline SVG, matching the `Chevron` precedent in this file rather
         * than a `::after` glyph — some screen-reader and browser pairs
         * announce generated content, which would double the name the sr-only
         * span below already provides. `aria-hidden` for the same reason.
         */}
        <svg
          className="wave-docs-sidebar__external"
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 24 24"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
        </svg>
        {/* The leading space is markup: it separates the suffix from the
            link text, and a translator should not have to type it. */}
        <span className="wave-docs-sr-only"> {externalLink}</span>
      </a>
    );
  }

  if (Link === undefined) {
    return (
      <a
        className={className}
        href={href}
        aria-current={isActive ? 'page' : undefined}
      >
        {children}
      </a>
    );
  }

  return (
    <Link
      className={className}
      href={href}
      // `undefined`, not `true`: it is omitted from the element entirely, so
      // Next applies its own default rather than this component pinning a
      // policy it has no information to pin.
      prefetch={isNearby ? undefined : false}
      aria-current={isActive ? 'page' : undefined}
    >
      {children}
    </Link>
  );
}

function Chevron({ isOpen }: { isOpen: boolean }): ReactNode {
  return (
    <svg
      className="wave-docs-sidebar__chevron"
      data-open={isOpen ? '' : undefined}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
