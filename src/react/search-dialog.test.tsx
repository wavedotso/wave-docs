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

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MiniSearch from 'minisearch';
import type { Options as MiniSearchOptions } from 'minisearch';
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
import type {
  DocsLinkComponent,
  DocsLinkProps,
} from './markdown-components.js';
import { SearchDialog } from './search-dialog.js';

const INDEX_URL = '/search-index.json';
/** A second corpus at a second URL, as a locale or version switch produces. */
const FR_INDEX_URL = '/fr/search-index.json';

const HINT_TEXT = 'Start typing to search the documentation.';

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
    // `installation` in the body, not only in the page title: `title` is
    // stored but deliberately not indexed, so a shared title is not what makes
    // two sections of one page answer the same query.
    text: 'Installation needs React 19 and react-dom as peer dependencies.',
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

/**
 * The same page under a different locale: one record, matched by the same
 * `install` query, living at a different href — so a stale cache is not a
 * subtle ranking difference but a navigation to the wrong URL.
 */
const FR_RECORDS: SearchRecord[] = [
  {
    id: 'guide/install',
    title: 'Installation',
    heading: 'Installation',
    ancestors: [],
    href: '/fr/docs/guide/install',
    text: 'Ajoutez le paquet à un projet Next.js.',
  },
];

const INDEX_JSON = buildSearchIndex(RECORDS);
const FR_INDEX_JSON = buildSearchIndex(FR_RECORDS);

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

    it('keeps Escape working after a click on the dialog’s own chrome', async () => {
      /*
       * The hint paragraph is not focusable and has no focusable ancestor, so
       * one ordinary click on it leaves focus on `<body>`. With the handler
       * bound to the dialog `<div>` that put every subsequent keystroke
       * outside the subtree React was listening on: the dialog stayed open and
       * Escape was dead.
       */
      const { user, trigger } = renderDialog();
      await user.click(trigger);

      await user.click(screen.getByText(HINT_TEXT));
      expect(document.activeElement).toBe(document.body);

      await user.keyboard('{Escape}');

      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('pulls Tab back in when focus has fallen out of the dialog', async () => {
      // Tab from `<body>` walks the document from the top, i.e. straight onto
      // the trigger — in a page `aria-modal="true"` has hidden from assistive
      // tech. Wrapping only at the two edges never sees this case.
      const { user, trigger } = renderDialog();
      await user.click(trigger);
      await user.click(screen.getByText(HINT_TEXT));

      await user.tab();

      expect(combobox()).toHaveFocus();
      expect(trigger).not.toHaveFocus();
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

    it('closes on Enter from the Close button, rather than opening a hit', async () => {
      /*
       * Handled at the dialog level, the Enter branch read `hits[activeIndex]`
       * for a keystroke aimed at a button and called `preventDefault()`, which
       * also suppressed the button's own activation — so the dialog's one
       * visible dismiss affordance navigated somewhere instead of dismissing,
       * whenever a query had results.
       */
      const { user, navigate, trigger } = renderDialog();
      await search(user, trigger, 'keyboard');
      await user.tab();
      expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();

      await user.keyboard('{Enter}');

      expect(navigate).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('leaves the arrow keys alone outside the input', async () => {
      const { user, trigger } = renderDialog();
      const input = await search(user, trigger, 'install');
      const before = input.getAttribute('aria-activedescendant');
      await user.tab();

      await user.keyboard('{ArrowDown}');

      expect(input.getAttribute('aria-activedescendant')).toBe(before);
    });

    it('ignores the Enter that commits an IME composition', async () => {
      /*
       * An IME sends `keydown{key:'Enter', isComposing:true}` before
       * `compositionend`, so the keystroke that accepts a CJK word was read as
       * "open the selected result" — but only when the partial romaji happened
       * to match something, which is what made it hard to pin down.
       */
      const { user, navigate, trigger } = renderDialog();
      const input = await search(user, trigger, 'keyboard');

      fireEvent.keyDown(input, { key: 'Enter', isComposing: true });

      expect(navigate).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('ignores the composition Enter on engines that only set keyCode 229', async () => {
      const { user, navigate, trigger } = renderDialog();
      const input = await search(user, trigger, 'keyboard');

      fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });

      expect(navigate).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('still closes on Escape mid-composition', async () => {
      // The composition guard must not swallow the one key that lets a reader
      // out of the dialog.
      const { user, trigger } = renderDialog();
      const input = await search(user, trigger, 'keyboard');

      fireEvent.keyDown(input, { key: 'Escape', isComposing: true });

      expect(screen.queryByRole('dialog')).toBeNull();
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
    it('announces the words, and shows the route', async () => {
      const { user, trigger } = renderDialog();
      await search(user, trigger, 'install');

      /*
       * The two forms of the same fact. A screen reader gets the page and the
       * enclosing headings as words — a route read aloud is punctuation,
       * spelled slash by slash — while the visible line is the address, which
       * is what a sighted reader scans for.
       */
      const option = screen.getByRole('option', {
        name: 'Peer dependencies, Installation, Requirements',
      });

      const location = option.querySelector(
        '.wave-docs-search-result-location',
      );
      // The page, not the anchor. `#peer-dependencies` is slugged from the
      // heading printed directly above it, so showing it would spend the line
      // restating line one — and on a real site it is the part that pushes the
      // route past the ellipsis.
      expect(location?.textContent).toBe('/docs/guide/install');
      // The link still carries it, which is what makes the hit a deep link.
      expect(option.querySelector('a')?.getAttribute('href')).toBe(
        '/docs/guide/install#peer-dependencies',
      );
      // Hidden from the tree, or it would be announced as well as the name.
      expect(location?.getAttribute('aria-hidden')).toBe('true');
    });

    it('gives a page’s lead hit its route, not a repeat of its own title', async () => {
      /*
       * `extractSearchRecords` emits one record per page whose heading *is* the
       * page title, with no ancestors. A trail built the ordinary way would be
       * the string already printed above it — "Installation" over
       * "Installation" reads as a rendering bug, and announced the option
       * twice over.
       *
       * ⚠️ THE ANSWER USED TO BE "NO TRAIL", AND THAT WAS ITS OWN DEFECT. Six
       * of a six-page site's twenty-nine records are lead records, so a search
       * showed a list where some rows had two lines and some had one — and the
       * one-line rows were the ones saying least. A row reading only "Wave
       * Docs" tells a reader nothing about what it opens.
       *
       * The route answers exactly that, costs the index nothing (`href` is
       * stored already), and is the one row where a path beats a title: the
       * reader is being offered the top of a page rather than a place inside
       * one.
       */
      const { user, trigger } = renderDialog();
      await search(user, trigger, 'install');

      // Named by its heading alone: "Installation, Installation" is a stutter,
      // not a path.
      const lead = screen.getByRole('option', { name: 'Installation' });

      expect(
        lead.querySelector('.wave-docs-search-result-location')?.textContent,
      ).toBe('/docs/guide/install');
    });

    it('gives every row a second line, so the list is not ragged', async () => {
      // The property behind the test above, stated as the invariant: whatever
      // a row is, it says where it lives. A mixture of one- and two-line rows
      // is what made the bare ones look broken rather than merely brief.
      const { user, trigger } = renderDialog();
      await search(user, trigger, 'install');

      const options = screen.getAllByRole('option');
      expect(options.length).toBeGreaterThan(1);

      for (const option of options) {
        const location = option.querySelector(
          '.wave-docs-search-result-location',
        );
        // Present, and always the same kind of thing. The defect this replaced
        // was a slot that held a page name under one row and an address under
        // the next.
        expect(location?.textContent).toMatch(/^\/docs\//);
      }
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

    it('says so when the cap hides results, rather than passing as the total', async () => {
      /*
       * ⚠️ THE CAP USED TO BE SILENT, AND THE DEFAULT WAS 8. On a six-page site
       * "docs" matches 18 — so ten were unreachable, and the live region
       * announced "8 results", which is not a smaller truth but a false one. A
       * reader who sees a full list and no note assumes it is the whole list,
       * and stops refining the query that would have found the rest.
       */
      const user = userEvent.setup();
      render(
        <SearchDialog
          indexUrl={INDEX_URL}
          navigate={() => undefined}
          maxResults={1}
        />,
      );
      await search(
        user,
        screen.getByRole('button', { name: 'Search' }),
        'install',
      );

      expect(screen.getByText(/Showing 1 of 2/)).toBeTruthy();
      // The announcer reports what the index matched, then what is shown.
      expect(screen.getByRole('status').textContent).toBe(
        '2 results, showing 1',
      );
    });

    it('stays quiet when everything matched is on screen', async () => {
      // The other half: a note on a complete list is noise, and one that
      // appears regardless would teach readers to ignore it.
      const { user, trigger } = renderDialog();
      await search(user, trigger, 'install');

      expect(screen.queryByText(/Showing/)).toBeNull();
      expect(screen.getByRole('status').textContent).toBe('2 results');
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

  describe('index cache', () => {
    /** Serve a different corpus per URL, as a locale switch would. */
    function serveBothIndexes(): void {
      fetchMock.mockImplementation((input) =>
        Promise.resolve(
          new Response(
            String(input) === FR_INDEX_URL ? FR_INDEX_JSON : INDEX_JSON,
            { status: 200 },
          ),
        ),
      );
    }

    it('reloads when indexUrl changes', async () => {
      /*
       * `indexUrl` is a prop, and a locale or version switcher changes it
       * while the dialog stays mounted in a persistent layout. Cached in a
       * single ref, the first corpus was served for the life of the tab — with
       * no second request and no error state, so the only symptom was results
       * pointing at hrefs from the other locale.
       */
      serveBothIndexes();
      const navigate = vi.fn<(href: string) => void>();
      const user = userEvent.setup();
      const { rerender } = render(
        <SearchDialog indexUrl={INDEX_URL} navigate={navigate} />,
      );
      const trigger = screen.getByRole('button', { name: 'Search' });
      await search(user, trigger, 'install');
      await user.keyboard('{Escape}');

      rerender(<SearchDialog indexUrl={FR_INDEX_URL} navigate={navigate} />);
      await search(user, trigger, 'install');

      expect(fetchMock).toHaveBeenCalledWith(FR_INDEX_URL);
      expect(screen.getAllByRole('option')).toHaveLength(1);
      await user.keyboard('{Enter}');
      expect(navigate).toHaveBeenCalledWith('/fr/docs/guide/install');
    });

    it('serves a URL it has already loaded without refetching', async () => {
      // Keying by URL rather than replacing one slot is what makes switching
      // back — the second half of every locale toggle — free.
      serveBothIndexes();
      const user = userEvent.setup();
      const { rerender } = render(
        <SearchDialog indexUrl={INDEX_URL} navigate={() => undefined} />,
      );
      const trigger = screen.getByRole('button', { name: 'Search' });
      await search(user, trigger, 'install');
      await user.keyboard('{Escape}');

      rerender(
        <SearchDialog indexUrl={FR_INDEX_URL} navigate={() => undefined} />,
      );
      await search(user, trigger, 'install');
      await user.keyboard('{Escape}');

      rerender(
        <SearchDialog indexUrl={INDEX_URL} navigate={() => undefined} />,
      );
      await search(user, trigger, 'install');

      expect(screen.getAllByRole('option')).toHaveLength(2);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('configuration', () => {
    it('merges consumer search options over the shared defaults', async () => {
      /*
       * Without a seam here a consumer cannot fix tokenisation for their own
       * corpus — CJK above all, which the default splitter runs together into
       * one term — or tune ranking, until this package ships a release.
       *
       * `combineWith` stands in for that: 'install keyboard' shares no record,
       * so the packaged 'AND' finds nothing (the test below). That results
       * render at all also proves the merge is *over* and not instead of —
       * `fields` and `prefix` come only from the shared constant, and
       * MiniSearch throws outright without the first.
       */
      const user = userEvent.setup();
      render(
        <SearchDialog
          indexUrl={INDEX_URL}
          navigate={() => undefined}
          miniSearchOptions={{ searchOptions: { combineWith: 'OR' } }}
        />,
      );

      await search(
        user,
        screen.getByRole('button', { name: 'Search' }),
        'install keyboard',
      );

      expect(screen.getAllByRole('option')).toHaveLength(3);
      expect(
        screen.getByRole('option', { name: /Keyboard shortcuts/ }),
      ).toBeInTheDocument();
    });

    it('finds nothing for those terms on the packaged defaults', async () => {
      // The control for the test above: 'AND' is what the package ships.
      const { user, trigger } = renderDialog();
      await user.click(trigger);
      await user.type(combobox(), 'install keyboard');

      await waitFor(() =>
        expect(screen.getByText(/No results/)).toBeInTheDocument(),
      );
    });

    it('joins className onto the trigger', async () => {
      // Otherwise a navbar needs a wrapper `<div>` to place the button.
      render(
        <SearchDialog
          indexUrl={INDEX_URL}
          navigate={() => undefined}
          className="navbar__search"
        />,
      );

      expect(screen.getByRole('button', { name: 'Search' })).toHaveClass(
        'wave-docs-search-trigger',
        'navbar__search',
      );
    });

    it('accepts a possibly-undefined value for every optional prop', () => {
      /*
       * The assertion is that this file compiles. This repo — and any consumer
       * copying its `tsconfig` — sets `exactOptionalPropertyTypes`, under which
       * `prop?: string` rejects a `string | undefined` variable outright, so
       * every one of these had to be spelled `| undefined`.
       */
      const link: DocsLinkComponent | undefined = undefined;
      const label: string | undefined = undefined;
      const count: number | undefined = undefined;
      const options: Partial<MiniSearchOptions<SearchRecord>> | undefined =
        undefined;

      render(
        <SearchDialog
          indexUrl={INDEX_URL}
          navigate={() => undefined}
          Link={link}
          triggerLabel={label}
          placeholder={label}
          dialogLabel={label}
          maxResults={count}
          debounceMs={count}
          className={label}
          miniSearchOptions={options}
        />,
      );

      // Every default still applies, and the empty `className` leaves no
      // stray separator behind.
      expect(screen.getByRole('button', { name: 'Search' })).toHaveAttribute(
        'class',
        'wave-docs-search-trigger',
      );
    });
  });
});
