/**
 * Collapse state, the tab order and the injected link are behaviour, not markup.
 * These mount the tree and drive the disclosure controls the way a reader does —
 * with a pointer and with the keyboard.
 */

import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { DocNavNode } from '../types.js';
import type { DocsLinkProps } from './markdown-components.js';
import { DocsSidebar } from './sidebar.js';

/**
 * One of each node type, a linked group with a nested unlinked group two levels
 * deep, and a sibling group that no route in these tests lives under.
 */
const nav: DocNavNode[] = [
  { type: 'page', title: 'Introduction', href: '/docs', slug: '' },
  { type: 'separator', title: 'Reference' },
  {
    type: 'group',
    title: 'API',
    href: '/docs/api',
    children: [
      {
        type: 'page',
        title: 'Authentication',
        href: '/docs/api/authentication',
        slug: 'api/authentication',
      },
      {
        type: 'group',
        title: 'Webhooks',
        children: [
          {
            type: 'page',
            title: 'Signatures',
            href: '/docs/api/webhooks/signatures',
            slug: 'api/webhooks/signatures',
          },
        ],
      },
    ],
  },
  {
    type: 'group',
    title: 'Guides',
    children: [
      {
        type: 'page',
        title: 'Caching',
        href: '/docs/guides/caching',
        slug: 'guides/caching',
      },
    ],
  },
  {
    type: 'link',
    title: 'Changelog',
    href: 'https://example.com/changelog',
    external: true,
  },
];

/** Which links a screen reader would announce as the current page. */
function currentHrefs(): (string | null)[] {
  return screen
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')
    .map((link) => link.getAttribute('href'));
}

/**
 * Stands in for `next/link`, recording that it was the one asked to render.
 * `prefetch` is not a DOM attribute, so it lands on `data-prefetch` where a test
 * can see what the sidebar passed.
 */
function RecordingLink({
  href,
  prefetch,
  children,
  ...rest
}: DocsLinkProps): ReactNode {
  return (
    /*
     * The attribute is ABSENT when `prefetch` is `undefined`, rather than the
     * string `"undefined"`. That is what `wrapNextLink` does with it, and it
     * is the difference the whole prefetch policy turns on: `undefined` means
     * "Next decides", `false` means "never". Stringifying flattened the two
     * into a value nobody passes.
     */
    <a
      {...rest}
      href={href}
      data-prefetch={prefetch === undefined ? undefined : String(prefetch)}
    >
      {children}
    </a>
  );
}

/**
 * A container that behaves like a scrolling column.
 *
 * jsdom reports every dimension as zero and lays nothing out, so a nav mounted
 * plainly has no scrollable ancestor and the scroll effect correctly does
 * nothing. Stubbing the numbers it reads is the only way to exercise the path
 * at all — and without it the `scrollIntoView` spy below is a test that cannot
 * fail.
 *
 * ⚠️ THE RECTANGLES MOVE WITH `scrollTop`, because that is the one property of
 * a real scrollport this fixture has to model. An earlier version stubbed
 * `offsetTop` as a constant on the prototype, which made the item's position
 * independent of the scroll position *and* made a double-subtraction bug in the
 * component invisible — `0 - 0` is `0` however wrong the arithmetic around it
 * is. That bug shipped, and only Chromium could see it. Anchoring the item at a
 * fixed content offset and deriving the rect from it is what keeps the two
 * honest.
 */
let scrollportCleanup: (() => void) | undefined;

/** Where the active item sits in the scrollport's content, in fixture pixels. */
const ITEM_CONTENT_TOP = 900;
const ITEM_HEIGHT = 40;

function scrollport(): HTMLElement {
  const element = document.createElement('div');
  element.style.overflowY = 'auto';
  document.body.append(element);

  const define = (name: string, value: number): void => {
    Object.defineProperty(element, name, { value, configurable: true });
  };
  define('clientHeight', 300);
  define('scrollHeight', 2000);

  const rectProto = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'getBoundingClientRect',
  );
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    value(this: HTMLElement) {
      // The port sits at the viewport origin; a descendant sits at its content
      // offset shifted up by however far the port is scrolled, which is what a
      // browser reports.
      const top = this === element ? 0 : ITEM_CONTENT_TOP - element.scrollTop;
      return { ...EMPTY_RECT, top, bottom: top + ITEM_HEIGHT };
    },
    configurable: true,
    writable: true,
  });

  const heightProto = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'offsetHeight',
  );
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    get: () => ITEM_HEIGHT,
    configurable: true,
  });

  scrollportCleanup = () => {
    if (rectProto) {
      Object.defineProperty(
        HTMLElement.prototype,
        'getBoundingClientRect',
        rectProto,
      );
    }
    if (heightProto) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', heightProto);
    }
    element.remove();
  };
  return element;
}

const EMPTY_RECT = {
  x: 0,
  y: 0,
  left: 0,
  right: 0,
  width: 0,
  height: ITEM_HEIGHT,
  toJSON: () => ({}),
} as const;

function restoreScrollport(): void {
  scrollportCleanup?.();
  scrollportCleanup = undefined;
}

describe('DocsSidebar node types', () => {
  it('renders a separator as inert text, never as a heading or a control', () => {
    render(<DocsSidebar nav={nav} pathname="/docs" />);

    const separator = screen.getByText('Reference');
    expect(separator.tagName).toBe('SPAN');
    expect(separator.closest('a, button')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('sends an external link to a new tab with an accessible warning', () => {
    render(<DocsSidebar nav={nav} pathname="/docs" />);

    const link = screen.getByRole('link', { name: /^Changelog/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    // The warning has to be in the name, not merely in the box: matched loosely
    // because `dom-accessibility-api` trims the separating space that the DOM —
    // and a screen reader reading these text nodes — keeps.
    expect(link).toHaveAccessibleName(/^Changelog\s*\(opens in a new tab\)$/);
    expect(link).toHaveTextContent('Changelog (opens in a new tab)');
  });

  it('renders a page, a linked group and a nested group as links and buttons', () => {
    render(<DocsSidebar nav={nav} pathname="/docs/api" />);

    expect(screen.getByRole('link', { name: 'Introduction' })).toHaveAttribute(
      'href',
      '/docs',
    );
    expect(screen.getByRole('link', { name: 'API' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Collapse API' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Webhooks' }),
    ).toBeInTheDocument();
  });

  it('names the landmark, and takes a name that distinguishes it', () => {
    render(<DocsSidebar nav={nav} pathname="/docs" label="API reference" />);

    expect(
      screen.getByRole('navigation', { name: 'API reference' }),
    ).toBeInTheDocument();
  });
});

describe('DocsSidebar current page', () => {
  it('marks exactly one link as the current page', () => {
    render(<DocsSidebar nav={nav} pathname="/docs/api/authentication" />);

    expect(currentHrefs()).toEqual(['/docs/api/authentication']);
  });

  it('marks a linked group when the route is the group itself', () => {
    render(<DocsSidebar nav={nav} pathname="/docs/api" />);

    expect(currentHrefs()).toEqual(['/docs/api']);
  });

  it('treats a trailing slash on the route as the same page', () => {
    render(<DocsSidebar nav={nav} pathname="/docs/api/authentication/" />);

    expect(currentHrefs()).toEqual(['/docs/api/authentication']);
  });
});

describe('DocsSidebar collapse state', () => {
  it('opens the group holding the active page and leaves its sibling shut', () => {
    render(<DocsSidebar nav={nav} pathname="/docs/api/authentication" />);

    expect(
      screen.getByRole('link', { name: 'Authentication' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Collapse API' }),
    ).toHaveAttribute('aria-expanded', 'true');
    // A collapsed group renders no children at all, not hidden ones.
    expect(screen.queryByRole('link', { name: 'Caching' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Guides' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('opens every group on the path to a page nested two levels deep', () => {
    render(<DocsSidebar nav={nav} pathname="/docs/api/webhooks/signatures" />);

    expect(
      screen.getByRole('button', { name: 'Collapse API' }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Webhooks' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(currentHrefs()).toEqual(['/docs/api/webhooks/signatures']);
    // The indentation is CSS keyed on this, so a flattened tree would still
    // read correctly to a screen reader and look wrong to everyone else.
    expect(
      screen.getByRole('link', { name: 'Signatures' }).closest('ul'),
    ).toHaveAttribute('data-depth', '2');
  });

  it('opens the group holding an internal link that is the current page', () => {
    // `{ title, href }` in meta.json with a root-relative href produces a
    // `link` node with `external: false` — a real route, which the sidebar
    // already marks `aria-current`. Its group has to open, or the current page
    // is the one thing the reader cannot see.
    const withInternalLink: DocNavNode[] = [
      {
        type: 'group',
        title: 'Resources',
        children: [
          {
            type: 'link',
            title: 'Roadmap',
            href: '/docs/roadmap',
            external: false,
          },
        ],
      },
    ];

    render(<DocsSidebar nav={withInternalLink} pathname="/docs/roadmap" />);

    expect(screen.getByRole('button', { name: 'Resources' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(currentHrefs()).toEqual(['/docs/roadmap']);
  });

  it('toggles a group on click, and says so on the control', async () => {
    const user = userEvent.setup();
    render(<DocsSidebar nav={nav} pathname="/docs" />);
    const toggle = screen.getByRole('button', { name: 'Guides' });

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Caching' })).toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Caching' })).toBeNull();
  });

  it('collapses the group holding the active page when asked', async () => {
    const user = userEvent.setup();
    render(<DocsSidebar nav={nav} pathname="/docs/api/authentication" />);

    await user.click(screen.getByRole('button', { name: 'Collapse API' }));

    expect(screen.getByRole('button', { name: 'Expand API' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('link', { name: 'Authentication' })).toBeNull();
  });

  it('reaches the disclosure controls with the Tab key and operates them there', async () => {
    const user = userEvent.setup();
    render(<DocsSidebar nav={nav} pathname="/docs" />);

    // Introduction, the API group link, the API chevron, then Guides: a `div`
    // with an `onClick` would never receive focus here.
    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();
    const toggle = screen.getByRole('button', { name: 'Guides' });
    expect(toggle).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(screen.getByRole('link', { name: 'Caching' })).toBeInTheDocument();

    await user.keyboard(' ');
    expect(screen.queryByRole('link', { name: 'Caching' })).toBeNull();
  });

  it('points aria-controls at a list that is actually in the document', async () => {
    const user = userEvent.setup();
    render(<DocsSidebar nav={nav} pathname="/docs" />);

    await user.click(screen.getByRole('button', { name: 'Guides' }));

    for (const button of screen.getAllByRole('button')) {
      const controls = button.getAttribute('aria-controls');
      // Absent while the group is shut — pointing at a missing id is worse
      // than omitting it.
      if (button.getAttribute('aria-expanded') === 'true') {
        expect(controls).not.toBeNull();
        expect(document.getElementById(controls ?? '')).not.toBeNull();
      } else {
        expect(controls).toBeNull();
      }
    }
  });

  /**
   * ⚠️ THIS TEST USED TO ASSERT THE BUG, AND IT WAS THE REASON THE BUG SURVIVED.
   *
   * It read: "a group the reader collapsed an hour ago must not hide the page
   * they just opened — and one they expanded should not stay expanded forever
   * either", and it enforced the second half by requiring `Caching` to be gone
   * after a navigation. The implementation was `setToggled({})`, which cannot
   * separate those two claims: the reader's state and the route's default share
   * one map, so clearing it collapses every group the reader had deliberately
   * opened.
   *
   * Reported from real use, twice over: expand three sections, click a page, and
   * two of them shut behind you. The first half is kept below. The second is
   * gone — no docs sidebar worth copying closes a section because you read
   * something in a different one.
   */
  it('reopens a collapsed group that holds the page just opened', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <DocsSidebar nav={nav} pathname="/docs/api/authentication" />,
    );

    // The group holding the current page starts open; shut it by hand.
    await user.click(screen.getByRole('button', { name: /Collapse API/ }));
    expect(screen.queryByRole('link', { name: 'Authentication' })).toBeNull();

    // Navigate deeper into that same group.
    rerender(
      <DocsSidebar nav={nav} pathname="/docs/api/webhooks/signatures" />,
    );

    expect(
      screen.getByRole('link', { name: 'Signatures' }),
    ).toBeInTheDocument();
  });

  it('leaves every other group exactly as the reader left it', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DocsSidebar nav={nav} pathname="/docs" />);

    await user.click(screen.getByRole('button', { name: 'Guides' }));
    expect(screen.getByRole('link', { name: 'Caching' })).toBeInTheDocument();

    rerender(<DocsSidebar nav={nav} pathname="/docs/api/authentication" />);

    // The page just opened is reachable...
    expect(
      screen.getByRole('link', { name: 'Authentication' }),
    ).toBeInTheDocument();
    // ...and the section the reader opened on the way is still open.
    expect(screen.getByRole('link', { name: 'Caching' })).toBeInTheDocument();
  });

  /**
   * The variant nobody reported, and the reason the state is seeded on mount
   * rather than starting empty.
   *
   * A group open at first paint is open by inference — it holds the route — and
   * a group opened by a click is open by record. Leave the first uninferred and
   * the two behave differently for no reason a reader could name: land on a deep
   * page from a search result or a shared link, click anywhere else, and the
   * section you arrived in collapses, while one you had opened by hand would
   * not have.
   */
  it('keeps the section you arrived in open when you click away', async () => {
    const { rerender } = render(
      <DocsSidebar nav={nav} pathname="/docs/api/authentication" />,
    );
    expect(
      screen.getByRole('link', { name: 'Authentication' }),
    ).toBeInTheDocument();

    // Straight to a top-level page that no group contains.
    rerender(<DocsSidebar nav={nav} pathname="/docs" />);

    expect(
      screen.getByRole('link', { name: 'Authentication' }),
      'the section the reader arrived in collapsed behind them',
    ).toBeInTheDocument();
  });

  /**
   * The second way it was reported: open a group, read a page in it, open the
   * next group, read a page in *that* — and the first one shuts. Two
   * navigations rather than one, because the defect needs the reader to have
   * left the first group's route before it shows.
   */
  it('survives reading a page in one section and then another', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DocsSidebar nav={nav} pathname="/docs" />);

    await user.click(screen.getByRole('button', { name: /Expand API/ }));
    rerender(<DocsSidebar nav={nav} pathname="/docs/api/authentication" />);

    await user.click(screen.getByRole('button', { name: 'Guides' }));
    rerender(<DocsSidebar nav={nav} pathname="/docs/guides/caching" />);

    expect(screen.getByRole('link', { name: 'Caching' })).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Authentication' }),
      'the first section collapsed behind the reader',
    ).toBeInTheDocument();
  });
});

describe('DocsSidebar injected Link', () => {
  it("warms the reader's own section, and nothing else", () => {
    /*
     * `prefetch={false}` used to be on every link, on Pages-Router reasoning
     * that does not hold in the App Router: there it disables the hover and
     * touch paths as well as the viewport one, so the most-clicked control in
     * a docs site made every navigation a cold round-trip.
     *
     * Nearby is the list that directly holds the current page, plus the
     * heading of the group the reader is inside. Everything else stays off,
     * which is the half of the old comment that was right.
     */
    render(
      <DocsSidebar
        nav={nav}
        pathname="/docs/api/authentication"
        Link={RecordingLink}
      />,
    );

    const prefetchOf = (name: string | RegExp): string | null =>
      screen.getByRole('link', { name }).getAttribute('data-prefetch');

    // The active page itself, and the heading of the group holding it.
    expect(prefetchOf('Authentication')).toBeNull();
    expect(prefetchOf('API')).toBeNull();
    // The root list does not hold the active page, so nothing in it is warm.
    expect(prefetchOf('Introduction')).toBe('false');

    const internal = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href')?.startsWith('/') === true);
    const warm = internal.filter(
      (link) => link.getAttribute('data-prefetch') === null,
    );
    // Warm links are the minority, always — that is the entire budget.
    expect(warm.length).toBeGreaterThan(0);
    expect(warm.length).toBeLessThan(internal.length);
  });

  it('keeps every link an ordinary tab stop, and uses no tree roles', () => {
    /*
     * The APG **Disclosure Navigation** pattern, pinned so it survives the
     * next person reaching for the aria role that sounds closest.
     *
     * `role="tree"` replaces the tab order with a single roving tabstop — so a
     * reader who tabs into the navigation can no longer tab through it — and
     * announces "tree item, level 3" for what is, to the person hearing it, a
     * link to a page. A docs sidebar is not a file explorer.
     */
    // Both link branches: the plain `<a>` fallback AND the injected component.
    // Checking one leaves the other free to grow a `tabindex` unnoticed, which
    // is exactly what happened when this was first written.
    for (const Link of [undefined, RecordingLink]) {
      const { container, unmount } = render(
        <DocsSidebar
          nav={nav}
          pathname="/docs/api/authentication"
          {...(Link === undefined ? {} : { Link })}
        />,
      );

      expect(container.querySelectorAll('[tabindex]')).toHaveLength(0);
      for (const role of ['tree', 'treeitem', 'group', 'menu', 'menuitem']) {
        expect(container.querySelectorAll(`[role="${role}"]`)).toHaveLength(0);
      }
      unmount();
    }
  });

  it('does not re-scroll when the reader expands a group', async () => {
    /*
     * The effect is keyed on `pathname` alone, and that is the point. Keying it
     * on the toggle state as well would yank the column every time a group was
     * expanded — pulling the list out from under the hand that just clicked,
     * which is worse than never scrolling at all.
     */
    const user = userEvent.setup();
    const port = scrollport();
    try {
      render(<DocsSidebar nav={nav} pathname="/docs/api/authentication" />, {
        container: port,
      });
      port.scrollTop = 0;

      await user.click(screen.getByRole('button', { name: 'Guides' }));

      expect(port.scrollTop).toBe(0);
    } finally {
      restoreScrollport();
    }
  });

  it('moves focus to the toggle when a group collapses under it', async () => {
    /*
     * Collapsing a group unmounts its children. If focus was on one of them it
     * would land on `<body>`, which drops a keyboard reader at the top of the
     * document — the same failure the YouTube facade and the code copy button
     * each had to avoid. Here the control that did the collapsing is the
     * natural place for it, and the browser does it because the toggle is what
     * was activated.
     */
    const user = userEvent.setup();
    render(<DocsSidebar nav={nav} pathname="/docs/api/authentication" />);

    const toggle = screen.getByRole('button', { name: /Collapse API/ });
    await user.click(toggle);

    expect(document.activeElement).toBe(toggle);
    expect(screen.queryByRole('link', { name: 'Authentication' })).toBeNull();
  });

  it('never calls scrollIntoView, on any render', () => {
    /*
     * ⚠️ A TEST FOR THE API DELIBERATELY NOT USED, and the only thing that
     * stops the bug being reintroduced by someone simplifying the code.
     *
     * `element.scrollIntoView({ block: 'nearest' })` is what anyone reaches
     * for here, and it scrolls **every** scrollable ancestor including the
     * document — so bringing the sidebar item into view also jumps the article
     * the reader came to read, on the one navigation where they know exactly
     * what they asked for. The component walks to the nearest scrollable
     * ancestor and assigns `scrollTop` instead.
     */
    const spy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = spy;

    try {
      const port = scrollport();
      const { rerender } = render(
        <DocsSidebar nav={nav} pathname="/docs/api/authentication" />,
        { container: port },
      );
      rerender(<DocsSidebar nav={nav} pathname="/docs/guides/caching" />);

      // The scrollport is what makes this able to fail: without one the effect
      // returns before it could reach for either API, and the assertion would
      // pass against an implementation that called `scrollIntoView` happily.
      expect(spy).not.toHaveBeenCalled();
      expect(port.scrollTop).toBeGreaterThan(0);
    } finally {
      Element.prototype.scrollIntoView = original;
      restoreScrollport();
    }
  });

  it('measures the item from the top of the content, not from a positioned ancestor', () => {
    /*
     * ⚠️ EXACT NUMBERS, DELIBERATELY. The assertion this replaces was
     * `expect(port.scrollTop).toBeGreaterThan(0)`, which passes for every
     * arithmetic that scrolls *somewhere* — and the arithmetic that shipped
     * scrolled the active item entirely below the fold, because it subtracted
     * the port's own `offsetTop` from an `offsetTop` already measured against
     * that same port (the column is `position: sticky`, so it is the
     * offsetParent). Chromium caught it; `toBeGreaterThan(0)` could not.
     *
     * Fixture geometry: item at 900 in a 2000px content, 300px viewport, so
     * bringing its bottom into view with the 16px margin is
     * `900 + 40 - 300 + 16`.
     */
    const port = scrollport();
    try {
      const { rerender } = render(
        <DocsSidebar nav={nav} pathname="/docs/api/authentication" />,
        { container: port },
      );

      expect(port.scrollTop).toBe(ITEM_CONTENT_TOP + ITEM_HEIGHT - 300 + 16);

      /*
       * And the case that pins the `+ port.scrollTop` term specifically: with
       * the column already scrolled so the item is comfortably in view, the
       * right answer is to leave it alone. Drop that term and the item's
       * viewport-relative `100` reads as "above the fold", and the column jumps
       * backwards to 84 on a navigation that should not have moved it.
       */
      port.scrollTop = 800;
      rerender(<DocsSidebar nav={nav} pathname="/docs/guides/caching" />);

      expect(port.scrollTop).toBe(800);
    } finally {
      restoreScrollport();
    }
  });

  it('scrolls nothing when there is no scrollport', () => {
    // jsdom reports every dimension as zero, which is also what a nav shorter
    // than its column looks like. Neither may produce a scroll.
    const { container } = render(
      <DocsSidebar nav={nav} pathname="/docs/api/authentication" />,
    );

    for (const element of container.querySelectorAll('*')) {
      expect(element.scrollTop).toBe(0);
    }
  });

  it('warms nothing at all when the reader is on no page in the tree', () => {
    render(
      <DocsSidebar nav={nav} pathname="/somewhere/else" Link={RecordingLink} />,
    );

    const internal = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href')?.startsWith('/') === true);
    expect(internal.length).toBeGreaterThan(0);
    for (const link of internal) {
      expect(link).toHaveAttribute('data-prefetch', 'false');
    }
  });

  it('leaves an external link as a plain anchor', () => {
    render(<DocsSidebar nav={nav} pathname="/docs" Link={RecordingLink} />);

    expect(
      screen.getByRole('link', { name: /^Changelog/ }),
    ).not.toHaveAttribute('data-prefetch');
  });

  it('keeps aria-current on the injected link', () => {
    render(
      <DocsSidebar
        nav={nav}
        pathname="/docs/api/authentication"
        Link={RecordingLink}
      />,
    );

    expect(currentHrefs()).toEqual(['/docs/api/authentication']);
  });
});
/**
 * The type marker at the head of each row.
 *
 * The defect it fixes is not a missing feature, it is an unreadable column: a
 * `Reference` group directly above an `Internals` page differed only by font
 * weight and a chevron, and in a tree where the two interleave a dozen times
 * that is not enough to scan.
 */
describe('DocsSidebar type icons', () => {
  /** The marker's shape, read off the row rather than off a class name. */
  function markers(): string[] {
    return [...document.querySelectorAll('.wave-docs-sidebar__icon')].map(
      (icon) =>
        icon.tagName.toLowerCase() === 'span'
          ? 'empty'
          : // A folder is one path, a page is two.
            `paths:${icon.querySelectorAll('path').length}`,
    );
  }

  it('draws a folder on a group and a page on a page', () => {
    render(<DocsSidebar nav={nav} pathname="/docs/api" />);

    // Introduction (page), API (linked group), Authentication (page),
    // Webhooks (unlinked group), Guides (group), then the external link. The
    // separator gets nothing at all: it is not a row that points anywhere.
    expect(markers()).toEqual([
      'paths:2',
      'paths:1',
      'paths:2',
      'paths:1',
      'paths:1',
      'paths:1',
    ]);
  });

  /**
   * ⚠️ THE MARK LEADS THE ROW, AND THE ANNOUNCEMENT STILL TRAILS IT. Moving the
   * glyph to the icon column is what leaves the far edge holding one meaning
   * only — a chevron, so a group is legible from across the column. The
   * sr-only sentence must not move with it, or the link is read as "opens in a
   * new tab, GitHub".
   */
  it('puts an external mark at the head of the row, not the tail', () => {
    render(<DocsSidebar nav={nav} pathname="/docs" />);

    const external = screen.getByRole('link', { name: /Changelog/ });
    const marker = external.querySelector('.wave-docs-sidebar__icon');
    const label = external.querySelector('.wave-docs-sidebar__label');
    if (marker === null || label === null)
      throw new Error('no marker or label');

    // Document order decides both the column and the announcement.
    expect(
      marker.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(external.querySelector('.wave-docs-sidebar__external')).toBeNull();
    expect(external.textContent).toMatch(/Changelog \(opens in a new tab\)$/);
  });

  /**
   * ⚠️ TURNING OFF A DECORATIVE COLUMN IS NOT CONSENT TO DROP A WARNING. With
   * no column to lead, the mark goes back to the trailing edge exactly where it
   * shipped before the column existed — otherwise a link that leaves the site
   * looks identical to one that does not.
   */
  it('returns the external mark to the tail when icons are off', () => {
    render(<DocsSidebar nav={nav} pathname="/docs" icons={false} />);

    const external = screen.getByRole('link', { name: /Changelog/ });
    expect(
      external.querySelector('.wave-docs-sidebar__external'),
    ).not.toBeNull();
  });

  it('renders nothing at all when a host turns them off', () => {
    render(<DocsSidebar nav={nav} pathname="/docs/api" icons={false} />);

    // No glyphs and no empty slots either — off means off, not "invisible but
    // present". The `__label` wrapper stays: it is the flex hook that lets the
    // row put a chevron at its far end, and it is there with or without a
    // marker beside it.
    expect(document.querySelectorAll('.wave-docs-sidebar__icon')).toHaveLength(
      0,
    );
    expect(
      document.querySelectorAll('.wave-docs-sidebar__label').length,
    ).toBeGreaterThan(0);
  });

  /** Decorative: the name a reader hears must not gain the word "folder". */
  it('keeps every marker out of the accessibility tree', () => {
    render(<DocsSidebar nav={nav} pathname="/docs/api" />);

    for (const icon of document.querySelectorAll('.wave-docs-sidebar__icon')) {
      expect(icon.getAttribute('aria-hidden')).toBe('true');
    }
    expect(
      screen.getByRole('link', { name: 'Authentication' }),
    ).toBeInTheDocument();
  });
});
/**
 * Custom markers: a name in the content, a component in the host.
 *
 * The contract has two halves and each fails silently on its own — a name that
 * reaches no component draws nothing, and a component keyed to a name nobody
 * authored never appears. Both halves are asserted here.
 */
describe('DocsSidebar custom icons', () => {
  const Book = (): ReactNode => <svg data-testid="book" />;
  const Rocket = (): ReactNode => <svg data-testid="rocket" />;

  const iconNav: DocNavNode[] = [
    { type: 'page', title: 'Plain', href: '/docs/plain', slug: 'plain' },
    {
      type: 'page',
      title: 'Launch',
      href: '/docs/launch',
      slug: 'launch',
      icon: 'rocket',
    },
    {
      type: 'group',
      title: 'Reference',
      icon: 'book',
      children: [
        {
          type: 'page',
          title: 'Deep',
          href: '/docs/ref/deep',
          slug: 'ref/deep',
        },
      ],
    },
    {
      type: 'page',
      title: 'Typo',
      href: '/docs/typo',
      slug: 'typo',
      icon: 'nosuchicon',
    },
  ];

  it("renders the host's component for a name it maps", () => {
    render(
      <DocsSidebar
        nav={iconNav}
        pathname="/docs/plain"
        icons={{ book: Book, rocket: Rocket }}
      />,
    );

    expect(screen.getByTestId('rocket')).toBeInTheDocument();
    expect(screen.getByTestId('book')).toBeInTheDocument();
  });

  /**
   * ⚠️ A TYPO LEAVES A FOLDER WHERE A BOOK SHOULD BE, NOT A HOLE. Content is
   * authored in YAML by whoever writes the page; `icon: rockett` must degrade
   * to the default marker rather than punching a gap in the column, because the
   * column's whole value is that every row has one.
   */
  it('falls back to the built-in marker for a name it does not map', () => {
    render(
      <DocsSidebar
        nav={iconNav}
        pathname="/docs/plain"
        icons={{ book: Book }}
      />,
    );

    const typo = screen.getByRole('link', { name: 'Typo' });
    const marker = typo.querySelector('.wave-docs-sidebar__icon');
    if (marker === null) throw new Error('the typo row lost its marker');

    // The default page marker: an `<svg>` of two paths, not the host's wrapper.
    expect(marker.tagName.toLowerCase()).toBe('svg');
    expect(marker.querySelectorAll('path')).toHaveLength(2);
  });

  /** The defaults are what `icons` alone means — a map is opt-in, per name. */
  it('keeps the built-in marker for a node that authored no name', () => {
    render(
      <DocsSidebar
        nav={iconNav}
        pathname="/docs/plain"
        icons={{ book: Book, rocket: Rocket }}
      />,
    );

    const plain = screen.getByRole('link', { name: 'Plain' });
    expect(plain.querySelector('.wave-docs-sidebar__icon')?.tagName).toBe(
      'svg',
    );
  });

  it('draws no custom marker at all when the column is off', () => {
    render(<DocsSidebar nav={iconNav} pathname="/docs/plain" icons={false} />);

    expect(screen.queryByTestId('rocket')).toBeNull();
    expect(screen.queryByTestId('book')).toBeNull();
  });

  /** Decorative, whoever drew it: the host's icon must not gain a name. */
  it("keeps the host's icon out of the accessibility tree", () => {
    render(
      <DocsSidebar
        nav={iconNav}
        pathname="/docs/plain"
        icons={{ book: Book }}
      />,
    );

    const wrapper = screen
      .getByTestId('book')
      .closest('.wave-docs-sidebar__icon');
    expect(wrapper?.getAttribute('aria-hidden')).toBe('true');
  });
});
