'use client';

import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { DocNavGroup, DocNavNode } from '../types.js';
import type { DocsLinkComponent } from './markdown-components.js';

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
  className?: string | undefined;
}

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
 * Prefetch is off by default on the injected link. A full-tree sidebar on a
 * few hundred pages otherwise asks Next to prefetch every route in it —
 * ~1.8 KB brotli each, all of it wasted on the routes nobody clicks.
 */
export function DocsSidebar({
  nav,
  pathname,
  Link,
  label = 'Docs',
  className,
}: DocsSidebarProps): ReactNode {
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

  return (
    <nav
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
      />
    </nav>
  );
}

interface NavListProps {
  nodes: DocNavNode[];
  depth: number;
  keyPrefix: string;
  pathname: string;
  Link: DocsLinkComponent | undefined;
  toggled: Record<string, boolean>;
  onToggle: (key: string, isOpen: boolean) => void;
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
  id,
}: NavListProps): ReactNode {
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
                  Link={Link}
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
}

function NavGroup({
  node,
  itemKey,
  depth,
  pathname,
  Link,
  toggled,
  onToggle,
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
              aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${node.title}`}
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
        />
      ) : null}
    </li>
  );
}

interface NavLinkProps {
  href: string;
  isExternal: boolean;
  isActive: boolean;
  Link: DocsLinkComponent | undefined;
  children: ReactNode;
}

function NavLink({
  href,
  isExternal,
  isActive,
  Link,
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
        <span className="wave-docs-sr-only"> (opens in a new tab)</span>
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
      prefetch={false}
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
