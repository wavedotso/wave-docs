/**
 * Behaviour, not markup.
 *
 * Every test here mounts the dialog, drives real keys through it and asserts
 * what a reader observes — `document.activeElement`,
 * `aria-activedescendant`, the announced status — rather than what the
 * component stores. Rendering this component to a string reaches the trigger
 * and nothing beyond it, which is how a keyboard-first surface ends up
 * "verified" by reading.
 *
 * The index is built with the package's own `buildSearchIndex` over real
 * `SearchRecord`s, so the shape the dialog deserialises cannot drift from the
 * one the build writes. A hand-rolled JSON blob here would keep passing after
 * `storeFields` changed.
 */

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MiniSearch from 'minisearch';
import { StrictMode } from 'react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';

import { buildSearchIndex } from '../search-index.js';
import type { SearchRecord } from '../types.js';
import type { DocsLinkProps } from './markdown-components.js';
import { SearchDialog } from './search-dialog.js';

const INDEX_URL = '/search-index.json';

/**
 * Three sections across two pages. `install` is deliberately the prefix of a
 * title shared by two records, so arrow-key wrapping has somewhere to wrap;
 * `keyboard` hits exactly one, so a navigation assertion can name the href.
 */
const RECORDS: SearchRecord[] = [
  {
    id: 'guide/install',
    title: 'Installation',
    heading: 'Installation',
    ancestors: [],
    href: '/docs/guide/install',
    text: 'Add the package to a Next.js project and mount the docs route.',
  },
  {
    id: 'guide/install#peer-dependencies',
    title: 'Installation',
    heading: 'Peer dependencies',
    ancestors: ['Requirements'],
    href: '/docs/guide/install#peer-dependencies',
    text: 'React 19 and react-dom are peer dependencies of this package.',
  },
  {
    id: 'guide/search#shortcuts',
    title: 'Search',
    heading: 'Keyboard shortcuts',
    ancestors: ['Search', 'Behaviour'],
    href: '/docs/guide/search#shortcuts',
    text: 'Move between hits with the arrow keys and open one with Enter.',
  },
];

const INDEX_JSON = buildSearchIndex(RECORDS);

/**
 * jsdom implements no `scrollIntoView`, and the dialog calls it on every
 * selection change to keep the active option visible. Without a stand-in the
 * effect throws and every arrow-key test fails for a reason that does not
 * exist in a browser.
 */
Object.defineProperty(Element.prototype, 'scrollIntoView', {
  value: () => undefined,
  writable: true,
  configurable: true,
});

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(INDEX_JSON, { status: 200 })),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Mount the dialog and hand back the pieces every test needs. */
function renderDialog(): {
  user: ReturnType<typeof userEvent.setup>;
  navigate: Mock<(href: string) => void>;
  trigger: HTMLElement;
} {
  const user = userEvent.setup();
  const navigate = vi.fn<(href: string) => void>();
  render(<SearchDialog indexUrl={INDEX_URL} navigate={navigate} />);
  return {
    user,
    navigate,
    trigger: screen.getByRole('button', { name: 'Search' }),
  };
}

/** Open the dialog, run a query and wait for the results to land. */
async function search(
  user: ReturnType<typeof userEvent.setup>,
  trigger: HTMLElement,
  query: string,
): Promise<HTMLElement> {
  await user.click(trigger);
  const input = screen.getByRole('combobox');
  await user.type(input, query);
  await waitFor(() =>
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0),
  );
  return input;
}

const combobox = (): HTMLElement => screen.getByRole('combobox');

describe('SearchDialog', () => {
  describe('opening and closing', () => {
    it('opens on ⌘K', async () => {
      const { user } = renderDialog();

      expect(screen.queryByRole('dialog')).toBeNull();
      await user.keyboard('{Meta>}k{/Meta}');

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAccessibleName('Search documentation');
    });

    it('opens on Ctrl-K', async () => {
      const { user } = renderDialog();

      await user.keyboard('{Control>}k{/Control}');

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('opens from the trigger button', async () => {
      const { user, trigger } = renderDialog();

      await user.click(trigger);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('closes on a second ⌘K', async () => {
      const { user } = renderDialog();

      await user.keyboard('{Meta>}k{/Meta}');
      await user.keyboard('{Meta>}k{/Meta}');

      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('moves focus into the input when opened', async () => {
      const { user, trigger } = renderDialog();

      await user.click(trigger);

      expect(combobox()).toHaveFocus();
    });

    it('returns focus to the trigger when Escape closes it', async () => {
      const { user, trigger } = renderDialog();
      await user.click(trigger);

      await user.keyboard('{Escape}');

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    it('returns focus to the trigger when opened from the shortcut', async () => {
      // ⌘K on a freshly-loaded page snapshots `document.body`, which cannot
      // take focus; the reader must not be dropped at the top of the document.
      const { user, trigger } = renderDialog();
      expect(document.activeElement).toBe(document.body);

      await user.keyboard('{Meta>}k{/Meta}');
      await user.keyboard('{Escape}');

      expect(document.activeElement).toBe(trigger);
    });

    it('closes when the backdrop is pressed', async () => {
      const { user, trigger } = renderDialog();
      await user.click(trigger);
      const backdrop = screen.getByRole('dialog').parentElement;

      expect(backdrop).not.toBeNull();
      if (backdrop !== null) await user.click(backdrop);

      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('restores page scrolling on close', async () => {
      const { user, trigger } = renderDialog();

      await user.click(trigger);
      expect(document.body.style.overflow).toBe('hidden');
      await user.keyboard('{Escape}');

      expect(document.body.style.overflow).toBe('');
    });

    it('does not carry a previous query into the next open', async () => {
      const { user, trigger } = renderDialog();
      await search(user, trigger, 'install');
      await user.keyboard('{Escape}');

      await user.click(trigger);

      expect(combobox()).toHaveValue('');
      expect(screen.queryAllByRole('option')).toHaveLength(0);
    });
  });

  describe('focus trap', () => {
    it('keeps Tab inside the dialog', async () => {
      const { user, trigger } = renderDialog();
      await user.click(trigger);
      const input = combobox();
      const close = screen.getByRole('button', { name: 'Close' });

      await user.tab();
      expect(close).toHaveFocus();

      // Last stop forward wraps to the first, rather than escaping into the
      // page behind the modal.
      await user.tab();
      expect(input).toHaveFocus();
    });

    it('keeps Shift-Tab inside the dialog', async () => {
      const { user, trigger } = renderDialog();
      await user.click(trigger);
      const close = screen.getByRole('button', { name: 'Close' });

      await user.tab({ shift: true });

      expect(close).toHaveFocus();
    });

    it('does not make results tab stops', async () => {
      // The combobox pattern points at the active option with
      // `aria-activedescendant`; focus never leaves the input. A result that
      // is a tab stop is also a hole in the trap.
      const { user, trigger } = renderDialog();
      await search(user, trigger, 'install');

      for (const option of screen.getAllByRole('option')) {
        expect(option).toHaveAttribute('tabindex', '-1');
        const link = within(option).getByRole('link', { hidden: true });
        expect(link).toHaveAttribute('tabindex', '-1');
      }
    });
  });

  describe('keyboard selection', () => {
    it('tracks the selected option in aria-activedescendant', async () => {
      const { user, trigger } = renderDialog();
      const input = await search(user, trigger, 'install');
      const options = screen.getAllByRole('option');
      expect(options.length).toBeGreaterThan(1);

      expect(input).toHaveAttribute('aria-activedescendant', options[0]?.id);
      expect(options[0]).toHaveAttribute('aria-selected', 'true');

      await user.keyboard('{ArrowDown}');

      expect(input).toHaveAttribute('aria-activedescendant', options[1]?.id);
      expect(options[1]).toHaveAttribute('aria-selected', 'true');
      expect(options[0]).toHaveAttribute('aria-selected', 'false');
    });

    it('wraps at both ends of the list', async () => {
      const { user, trigger } = renderDialog();
      const input = await search(user, trigger, 'install');
      const options = screen.getAllByRole('option');
      const last = options[options.length - 1];

      // Up from the first lands on the last…
      await user.keyboard('{ArrowUp}');
      expect(input).toHaveAttribute('aria-activedescendant', last?.id);

      // …and down from the last comes back to the first.
      await user.keyboard('{ArrowDown}');
      expect(input).toHaveAttribute('aria-activedescendant', options[0]?.id);
    });

    it('navigates to the selected result on Enter', async () => {
      const { user, navigate, trigger } = renderDialog();
      // `keyboard` matches exactly one record, so the href is unambiguous.
      await search(user, trigger, 'keyboard');

      await user.keyboard('{Enter}');

      expect(navigate).toHaveBeenCalledWith('/docs/guide/search#shortcuts');
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('navigates to the option the arrows moved to', async () => {
      const { user, navigate, trigger } = renderDialog();
      const input = await search(user, trigger, 'install');

      await user.keyboard('{ArrowDown}');
      const activeId = input.getAttribute('aria-activedescendant');
      const active =
        activeId === null ? null : document.getElementById(activeId);
      const href = active?.querySelector('a')?.getAttribute('href');
      await user.keyboard('{Enter}');

      expect(href).toBeDefined();
      expect(navigate).toHaveBeenCalledWith(href);
    });

    it('leaves Home and End to the text caret', async () => {
      /*
       * The APG's combobox pattern requires the textbox to keep "standard
       * single line text editing keys". Home/End moving the selection in the
       * listbox instead costs a reader the only way to reach the start of a
       * query they are correcting — and buys nothing, because the arrow keys
       * here already wrap, so ArrowUp from the first option is End.
       */
      const { user, trigger } = renderDialog();
      const input = await search(user, trigger, 'install');

      await user.keyboard('{Home}x');
      expect(input).toHaveValue('xinstall');

      await user.keyboard('{End}!');
      expect(input).toHaveValue('xinstall!');
    });

    it('does nothing on Enter with no results', async () => {
      const { user, navigate, trigger } = renderDialog();
      await user.click(trigger);
      await user.type(combobox(), 'zzz');
      await waitFor(() =>
        expect(screen.getByText(/No results/)).toBeInTheDocument(),
      );

      await user.keyboard('{Enter}');

      expect(navigate).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('navigates when a result is clicked', async () => {
      const { user, navigate, trigger } = renderDialog();
      await search(user, trigger, 'keyboard');

      await user.click(screen.getByRole('link', { hidden: true }));

      expect(navigate).toHaveBeenCalledWith('/docs/guide/search#shortcuts');
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  describe('combobox wiring', () => {
    it('points the combobox at its listbox', async () => {
      const { user, trigger } = renderDialog();
      await user.click(trigger);
      const listbox = screen.getByRole('listbox');

      expect(combobox()).toHaveAttribute('aria-controls', listbox.id);
      expect(listbox.id).not.toBe('');
      expect(combobox()).toHaveAttribute('aria-autocomplete', 'list');
    });

    it('reports expansion only once there is something to expand into', async () => {
      const { user, trigger } = renderDialog();
      await user.click(trigger);
      expect(combobox()).toHaveAttribute('aria-expanded', 'false');

      await search(user, trigger, 'install');

      expect(combobox()).toHaveAttribute('aria-expanded', 'true');
    });

    it('exposes the shortcut on the trigger without naming it', async () => {
      // A `<kbd>` inside the label would otherwise make the button announce as
      // "Search Ctrl K"; `aria-keyshortcuts` is where a shortcut belongs.
      const { trigger } = renderDialog();

      await waitFor(() =>
        expect(screen.getByText('Ctrl K')).toBeInTheDocument(),
      );

      expect(trigger).toHaveAccessibleName('Search');
      expect(trigger).toHaveAttribute('aria-keyshortcuts');
    });
  });

  describe('results', () => {
    it('announces the heading and its trail as one name', async () => {
      const { user, trigger } = renderDialog();
      await search(user, trigger, 'install');

      // Page title first, then the ancestor headings the record carries. The
      // separators are `aria-hidden` and the crumbs are adjacent inline spans,
      // so left to name-from-content this read "InstallationRequirements".
      const option = screen.getByRole('option', {
        name: 'Peer dependencies, Installation, Requirements',
      });

      // Visually the trail is still a path, separator and all.
      const crumbs = [
        ...option.querySelectorAll('.wave-docs-search-result-crumb'),
      ].map((crumb) => crumb.textContent);
      expect(crumbs).toEqual(['Installation', '›Requirements']);
    });

    it('gives a page’s lead hit no trail, which would only repeat it', async () => {
      // `extractSearchRecords` emits one record per page whose heading *is* the
      // page title, with no ancestors. Its trail is the string already printed
      // above it: "Installation" over "Installation" reads as a rendering bug,
      // and a screen reader announced the option twice over.
      const { user, trigger } = renderDialog();
      await search(user, trigger, 'install');

      const lead = screen.getByRole('option', { name: 'Installation' });
      expect(
        lead.querySelectorAll('.wave-docs-search-result-crumb'),
      ).toHaveLength(0);
      expect(lead).toHaveTextContent(/^Installation$/);
    });

    it('caps the list at maxResults', async () => {
      const user = userEvent.setup();
      render(
        <SearchDialog
          indexUrl={INDEX_URL}
          navigate={() => undefined}
          maxResults={1}
        />,
      );
      // `install` matches two sections of the Installation page.
      await search(
        user,
        screen.getByRole('button', { name: 'Search' }),
        'install',
      );

      expect(screen.getAllByRole('option')).toHaveLength(1);
    });

    it('portals the dialog out of the trigger’s stacking context', async () => {
      const { user, trigger } = renderDialog();

      await user.click(trigger);

      // A navbar with its own transform or z-index would otherwise trap the
      // modal behind the page.
      expect(screen.getByRole('dialog').parentElement?.parentElement).toBe(
        document.body,
      );
    });

    it('announces the result count', async () => {
      const { user, trigger } = renderDialog();
      await search(user, trigger, 'keyboard');

      expect(screen.getByRole('status')).toHaveTextContent('1 result');
    });

    it('distinguishes an empty result set from a loading index', async () => {
      let release: (() => void) | null = null;
      fetchMock.mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            release = () => resolve(new Response(INDEX_JSON, { status: 200 }));
          }),
      );
      const { user, trigger } = renderDialog();
      await user.click(trigger);
      await user.type(combobox(), 'zzz');

      // Index still in flight: nothing is known about the query yet.
      expect(screen.getByText('Loading the search index…')).toBeInTheDocument();
      expect(screen.queryByText(/No results/)).toBeNull();

      await act(async () => {
        release?.();
        await Promise.resolve();
      });

      await waitFor(() =>
        expect(screen.getByText('No results for “zzz”.')).toBeInTheDocument(),
      );
      expect(screen.queryByText('Loading the search index…')).toBeNull();
    });

    it('surfaces a failed index load', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(new Response('nope', { status: 500 })),
      );
      const { user, trigger } = renderDialog();

      await user.click(trigger);

      await waitFor(() =>
        expect(
          screen.getByText(/Search is unavailable right now/),
        ).toBeInTheDocument(),
      );
    });

    it('renders results through an injected link component', async () => {
      const seen: DocsLinkProps[] = [];
      function TestLink(props: DocsLinkProps) {
        seen.push(props);
        const { prefetch: _prefetch, href, children, ...rest } = props;
        return (
          <a data-testid="injected" href={href} {...rest}>
            {children}
          </a>
        );
      }
      const navigate = vi.fn<(href: string) => void>();
      const user = userEvent.setup();
      render(
        <SearchDialog
          indexUrl={INDEX_URL}
          navigate={navigate}
          Link={TestLink}
        />,
      );
      await search(
        user,
        screen.getByRole('button', { name: 'Search' }),
        'keyboard',
      );

      const link = screen.getByTestId('injected');
      expect(link).toHaveAttribute('tabindex', '-1');
      await user.click(link);

      expect(seen.some((props) => props.href.startsWith('/docs/'))).toBe(true);
      expect(navigate).toHaveBeenCalledWith('/docs/guide/search#shortcuts');
    });
  });

  describe('lazy loading', () => {
    it('does not touch the network on mount', () => {
      renderDialog();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('warms the index on hover', async () => {
      const { user, trigger } = renderDialog();

      await user.hover(trigger);

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(fetchMock).toHaveBeenCalledWith(INDEX_URL);
    });

    it('warms the index when the trigger takes focus', async () => {
      const { trigger } = renderDialog();

      await act(async () => {
        trigger.focus();
      });

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    });

    it('warms the index when the shortcut opens the dialog', async () => {
      const { user } = renderDialog();

      await user.keyboard('{Meta>}k{/Meta}');

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    });

    it('fetches the index once across hover, open and query', async () => {
      const { user, trigger } = renderDialog();

      await user.hover(trigger);
      await search(user, trigger, 'install');
      await user.type(combobox(), 'ation');
      await waitFor(() =>
        expect(screen.queryAllByRole('option')).toHaveLength(2),
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('stays lazy under StrictMode', async () => {
      // Next runs dev in StrictMode, which double-invokes every effect. An
      // effect that warms the index or grabs focus on mount shows up here.
      const user = userEvent.setup();
      render(
        <StrictMode>
          <SearchDialog indexUrl={INDEX_URL} navigate={() => undefined} />
        </StrictMode>,
      );
      const trigger = screen.getByRole('button', { name: 'Search' });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(document.body);

      await user.click(trigger);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await user.keyboard('{Escape}');

      expect(document.activeElement).toBe(trigger);
    });

    it('debounces the search rather than running one per keystroke', async () => {
      /*
       * Real timers, deliberately. Vitest's fake timers replace
       * `queueMicrotask`, which is what React 19 schedules its work on, so
       * `act` never settles and the test deadlocks. `delay: null` keeps the
       * seven keystrokes inside one macrotask instead: no `setTimeout` can fire
       * between them, so the count below is the debounce and nothing else.
       */
      const user = userEvent.setup({ delay: null });
      const searchSpy = vi.spyOn(MiniSearch.prototype, 'search');
      render(
        <SearchDialog
          indexUrl={INDEX_URL}
          navigate={() => undefined}
          debounceMs={120}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Search' }));
      // Wait out the index load, so what follows is about the debounce and not
      // about a pending fetch.
      await waitFor(() =>
        expect(screen.queryByText('Loading the search index…')).toBeNull(),
      );

      await user.type(screen.getByRole('combobox'), 'install');
      expect(searchSpy).not.toHaveBeenCalled();

      await waitFor(() => expect(searchSpy).toHaveBeenCalled());

      expect(searchSpy).toHaveBeenCalledTimes(1);
      expect(searchSpy).toHaveBeenLastCalledWith('install');
    });
  });
});
