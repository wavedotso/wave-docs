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
 * nothing. Stubbing the four numbers it reads is the only way to exercise the
 * path at all — and without it the `scrollIntoView` spy below is a test that
 * cannot fail.
 */
let scrollportCleanup: (() => void) | undefined;

function scrollport(): HTMLElement {
  const element = document.createElement('div');
  element.style.overflowY = 'auto';
  document.body.append(element);

  const define = (name: string, value: number): void => {
    Object.defineProperty(element, name, { value, configurable: true });
  };
  define('clientHeight', 300);
  define('scrollHeight', 2000);
  define('offsetTop', 0);

  // Every descendant needs an offset too, or the active item reports 0 and is
  // "already visible" whatever the scroll position.
  const proto = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'offsetTop',
  );
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    get(this: HTMLElement) {
      return this === element ? 0 : 900;
    },
    configurable: true,
  });
  const heightProto = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'offsetHeight',
  );
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    get: () => 40,
    configurable: true,
  });

  scrollportCleanup = () => {
    if (proto) Object.defineProperty(HTMLElement.prototype, 'offsetTop', proto);
    if (heightProto) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', heightProto);
    }
    element.remove();
  };
  return element;
}

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

  it('re-syncs the tree to the route after a navigation', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DocsSidebar nav={nav} pathname="/docs" />);
    await user.click(screen.getByRole('button', { name: 'Guides' }));
    expect(screen.getByRole('link', { name: 'Caching' })).toBeInTheDocument();

    rerender(<DocsSidebar nav={nav} pathname="/docs/api/authentication" />);

    // A group the reader collapsed an hour ago must not hide the page they just
    // opened — and one they expanded should not stay expanded forever either.
    expect(
      screen.getByRole('link', { name: 'Authentication' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Caching' })).toBeNull();
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
