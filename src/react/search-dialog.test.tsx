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
import type { SearchDialogProps } from './search-dialog.js';
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
function renderDialog(props: Partial<SearchDialogProps> = {}): {
  user: ReturnType<typeof userEvent.setup>;
  navigate: Mock<(href: string) => void>;
  trigger: HTMLElement;
} {
  const user = userEvent.setup();
  const navigate = vi.fn<(href: string) => void>();
  render(<SearchDialog indexUrl={INDEX_URL} navigate={navigate} {...props} />);
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
    /**
     * ⚠️ NOTHING IS SELECTED UNTIL THE READER SELECTS IT, AND THE FIRST ROW
     * USED TO LIGHT UP THE INSTANT RESULTS ARRIVED.
     *
     * A row changing under a reader for something they had not chosen reads as
     * a decision already made. `activeIndex` starts at `-1`, `hits[-1]` is
     * `undefined`, and every guard that existed for "no results yet" already
     * covers it: no `aria-activedescendant` is written, and Enter opens
     * nothing.
     */
    it('selects nothing until a key or a pointer says so', async () => {
      const { user, trigger } = renderDialog();
      const input = await search(user, trigger, 'install');
      const options = screen.getAllByRole('option');
      expect(options.length).toBeGreaterThan(1);

      expect(input).not.toHaveAttribute('aria-activedescendant');
      for (const option of options) {
        expect(option).toHaveAttribute('aria-selected', 'false');
      }
    });

    it('tracks the selected option in aria-activedescendant', async () => {
      const { user, trigger } = renderDialog();
      const input = await search(user, trigger, 'install');
      const options = screen.getAllByRole('option');
      expect(options.length).toBeGreaterThan(1);

      await user.keyboard('{ArrowDown}');

      expect(input).toHaveAttribute('aria-activedescendant', options[0]?.id);
      expect(options[0]).toHaveAttribute('aria-selected', 'true');

      await user.keyboard('{ArrowDown}');

      expect(input).toHaveAttribute('aria-activedescendant', options[1]?.id);
      expect(options[1]).toHaveAttribute('aria-selected', 'true');
      expect(options[0]).toHaveAttribute('aria-selected', 'false');
    });

    /**
     * ⚠️ UP FROM "NOTHING SELECTED" IS THE END OF THE LIST, AND THE MODULO
     * ARITHMETIC ALONE GETS IT WRONG. `(-1 - 1 + n) % n` is `n - 2` — the
     * second to last — which is why the arrow handler special-cases `-1`.
     */
    it('reaches the last result with one Up from a fresh query', async () => {
      const { user, trigger } = renderDialog();
      const input = await search(user, trigger, 'install');
      const options = screen.getAllByRole('option');

      await user.keyboard('{ArrowUp}');

      expect(input).toHaveAttribute(
        'aria-activedescendant',
        options[options.length - 1]?.id,
      );
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

      // Nothing is selected until the reader selects it, so Enter alone opens
      // nothing — the arrow is the choice.
      await user.keyboard('{ArrowDown}');
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

      /*
       * The `<kbd>`'s text rather than `getByText`: the modifier is its own
       * element now, so the hint is split across two nodes and a whole-string
       * matcher reports "the text is broken up by multiple elements". Reading
       * the container is the same claim, made where the split cannot break it.
       */
      await waitFor(() => {
        const kbd = trigger.querySelector('.wave-docs-search-trigger-kbd');
        expect(kbd?.textContent).toBe('Ctrl K');
      });

      expect(trigger).toHaveAccessibleName('Search');
      expect(trigger).toHaveAttribute('aria-keyshortcuts');
    });

    /**
     * ⚠️ THE FLAG THAT SCALES THE GLYPH MUST NOT REACH THE WORD.
     *
     * `⌘` carries a third less ink than the `K` beside it — measured at 12px in
     * the shipped mono stack, 6.39px against 8.75px — so the stylesheet scales
     * it by `1.35em` to make the two read as one mark. `Ctrl` is a word set in
     * the same face as that `K`; the same rule applied to it makes the hint
     * shout. The attribute is the only thing keeping them apart, and nothing
     * else in the component would fail if it were on both.
     */
    it.each([
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', '⌘', true],
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Ctrl', false],
    ])('scales the glyph and not the word (%s)', async (ua, text, scaled) => {
      const original = Object.getOwnPropertyDescriptor(
        window.navigator,
        'userAgent',
      );
      Object.defineProperty(window.navigator, 'userAgent', {
        value: ua,
        configurable: true,
      });

      try {
        const { trigger } = renderDialog();
        await waitFor(() => {
          const mod = trigger.querySelector('.wave-docs-search-trigger-mod');
          expect(mod?.textContent).toBe(text);
          expect(mod?.hasAttribute('data-symbol')).toBe(scaled);
        });
      } finally {
        if (original !== undefined) {
          Object.defineProperty(window.navigator, 'userAgent', original);
        }
      }
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
      /*
       * ⚠️ A BREADCRUMB, NOT A ROUTE — the segments joined by `›` rather than
       * by slashes. Same fact, and it reads as the trail it is instead of as a
       * URL a reader has to parse. Safe here only because the line is
       * `aria-hidden`: more than one screen reader pronounces the character,
       * which is why `spokenName` joins with commas instead.
       */
      expect(location?.textContent).toBe('docs › guide › install');
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
      ).toBe('docs › guide › install');
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
        expect(location?.textContent).toMatch(/^docs › /);
      }
    });

    it('does not answer a one-character query', async () => {
      /*
       * Measured on this package's own docs: "a" matches 100% of the corpus,
       * "i" 97%, "s" 93%. A single character is not a query, it is the reader
       * halfway through typing one — and answering it with everything teaches
       * them that search returns noise.
       */
      /*
       * ⚠️ `debounceMs={0}`, AND THAT IS WHAT MAKES THIS ABLE TO FAIL. "No
       * options yet" is also true for the 120ms the default debounce has not
       * fired in, so the first version of this test passed with the floor
       * deleted — it was measuring the debounce, not the floor. With no
       * debounce, a query that runs produces options on the next tick, and one
       * that is refused never does.
       *
       * Asserting on `fetch` does not work either: the index is prefetched when
       * the dialog opens, before any query.
       */
      const user = userEvent.setup();
      render(
        <SearchDialog
          indexUrl={INDEX_URL}
          navigate={() => undefined}
          debounceMs={0}
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Search' }));
      await user.type(screen.getByRole('combobox'), 'i');

      await waitFor(() => {
        expect(screen.getByText(/Keep typing/)).toBeTruthy();
      });
      expect(screen.queryAllByRole('option')).toHaveLength(0);

      // The control: one more character and the same dialog answers.
      await user.type(screen.getByRole('combobox'), 'n');
      await waitFor(() => {
        expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
      });
    });

    it('answers a two-character query, which a docs site is full of', async () => {
      /*
       * The reason the floor is two and not three. `ts`, `js`, `id`, `h1` and
       * `px` are all real queries here and all selective — 10%, 17%, 14%, 3%,
       * 0% — so a three-character floor would refuse the useful half of the
       * short queries to block the useless one.
       */
      const { user, trigger } = renderDialog();
      // `js` reaches "Next.js" in this fixture; `ts`, `id` and `h1` are the
      // same shape on a real corpus.
      await search(user, trigger, 'js');

      expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
      expect(screen.queryByText(/Keep typing/)).toBeNull();
    });

    it('does not scroll the list when a pointer moves over a result', async () => {
      /*
       * ⚠️ THE BUG THIS PREVENTS, IN FULL. Pointing at a row half-clipped by
       * the top or bottom edge set the active index, which fired the
       * scroll-into-view meant for arrow keys — so the row snapped flush and
       * the whole list moved under the cursor, which then landed on a
       * different row. Measured in Chromium: a 28px jump from hovering the
       * visible sliver of a clipped row.
       *
       * jsdom has no layout, so what is asserted here is the wiring: a pointer
       * never reaches `scrollIntoView`, and a key always does.
       * `search.browser.test.tsx` measures the scroll position itself.
       */
      const spy = vi.fn();
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = spy;

      try {
        const { user, trigger } = renderDialog();
        await search(user, trigger, 'install');
        spy.mockClear();

        await user.hover(screen.getAllByRole('option')[1] as HTMLElement);
        expect(spy).not.toHaveBeenCalled();

        // The control: the same movement by keyboard must still scroll, or
        // this test would pass against a component that never scrolls at all.
        await user.keyboard('{ArrowDown}');
        await waitFor(() => {
          expect(spy).toHaveBeenCalled();
        });
      } finally {
        Element.prototype.scrollIntoView = original;
      }
    });

    it('starts a new result set at the top of the list', async () => {
      /*
       * The scroll-into-view used to do this by accident, because a fresh
       * search reset the active index to 0. Now that it only runs for the
       * keyboard, a reader who scrolled halfway down one query's results would
       * otherwise keep that offset into the next.
       */
      const { user, trigger } = renderDialog();
      await search(user, trigger, 'install');

      const list = screen.getByRole('listbox');
      list.scrollTop = 40;

      await user.clear(screen.getByRole('combobox'));
      await user.type(screen.getByRole('combobox'), 'keyboard');
      await waitFor(() => {
        expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
      });

      expect(list.scrollTop).toBe(0);
    });

    it('renders one page of results, and declares the whole set', async () => {
      /*
       * `pageSize` is a window, not a ceiling. The DOM holds one page, and
       * `aria-setsize` carries the real total — a listbox rendering 1 of 2 that
       * says "1 of 1" tells a reader they have reached the end when they have
       * not, which is the same lie the old hard cap told out loud.
       */
      const user = userEvent.setup();
      render(
        <SearchDialog
          indexUrl={INDEX_URL}
          navigate={() => undefined}
          pageSize={1}
        />,
      );
      // `install` matches two sections of the Installation page.
      await search(
        user,
        screen.getByRole('button', { name: 'Search' }),
        'install',
      );

      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(1);
      expect(options[0]?.getAttribute('aria-setsize')).toBe('2');
      expect(options[0]?.getAttribute('aria-posinset')).toBe('1');
      // And the announcement is the whole set, because nothing is withheld.
      expect(screen.getByRole('status').textContent).toBe('2 results');
    });

    it('reveals the next page when the keyboard walks past the window', async () => {
      /*
       * The window has to widen, or `aria-activedescendant` points at an id
       * that is not in the DOM — a listbox that silently stops responding to
       * ArrowDown for anyone navigating by keyboard.
       */
      const user = userEvent.setup();
      render(
        <SearchDialog
          indexUrl={INDEX_URL}
          navigate={() => undefined}
          pageSize={1}
        />,
      );
      const input = await search(
        user,
        screen.getByRole('button', { name: 'Search' }),
        'install',
      );

      expect(screen.getAllByRole('option')).toHaveLength(1);
      /*
       * Two, not one: the first lands on the row already rendered, because
       * nothing is selected until a key says so. The second is the one that
       * walks past the window.
       */
      await user.keyboard('{ArrowDown}');
      await user.keyboard('{ArrowDown}');

      await waitFor(() => {
        expect(screen.getAllByRole('option')).toHaveLength(2);
      });
      // And the second option is the one the input now points at.
      const active = input.getAttribute('aria-activedescendant');
      expect(screen.getAllByRole('option')[1]?.id).toBe(active);
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
      await user.keyboard('{ArrowDown}');
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
          pageSize={count}
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

describe('the dialog says everything in the language it is given', () => {
  /*
   * ⚠️ SIX STRINGS WERE HARDCODED ENGLISH BEHIND A PROP LIST THAT LOOKED
   * COMPLETE. `triggerLabel`, `placeholder` and `dialogLabel` were props from
   * the start, so `search={{ … }}` read as the channel for the dialog's words —
   * while every state message and the live region's count were literals. A site
   * in another language got "Start typing to search the documentation." and
   * "3 results", in English, at the two moments a reader is most reliant on
   * being told what happened.
   */
  function renderWith(props: Partial<SearchDialogProps>): {
    user: ReturnType<typeof userEvent.setup>;
    trigger: HTMLElement;
  } {
    const user = userEvent.setup();
    render(
      <SearchDialog
        indexUrl={INDEX_URL}
        navigate={vi.fn()}
        triggerLabel="Procurar"
        {...props}
      />,
    );
    return { user, trigger: screen.getByRole('button', { name: 'Procurar' }) };
  }

  const status = (): string =>
    document.querySelector('.wave-docs-search-status')?.textContent ?? '';

  it('shows the hint it was given before anything is typed', async () => {
    const { user, trigger } = renderWith({ hintLabel: 'Comece a escrever.' });
    await user.click(trigger);

    expect(status()).toBe('Comece a escrever.');
    expect(status()).not.toBe(HINT_TEXT);
  });

  it('fills {min} into the short-query message', async () => {
    const { user, trigger } = renderWith({
      minQueryLength: 3,
      shortQueryLabel: 'Escreva pelo menos {min} letras.',
    });
    await user.click(trigger);
    await user.type(screen.getByRole('combobox'), 'ab');

    // The number, not the placeholder: a `{min}` reaching a reader looks like a
    // bug in the site rather than a missing translation.
    expect(status()).toBe('Escreva pelo menos 3 letras.');
  });

  it('fills {query} into the empty message', async () => {
    const { user, trigger } = renderWith({
      emptyLabel: 'Nada para “{query}”.',
    });
    await user.click(trigger);
    await user.type(screen.getByRole('combobox'), 'zzzzqqq');

    await waitFor(() => {
      expect(status()).toBe('Nada para “zzzzqqq”.');
    });
  });

  it('announces the count by plural category, not by === 1', async () => {
    /*
     * ⚠️ THE REASON THIS IS A RECORD AND NOT TWO STRINGS. Polish takes four
     * plural forms; `Intl.PluralRules` picks and an unlisted category falls back
     * to `other`. A singular/plural pair would announce a wrong number of
     * results — correctly and confidently — in most of the world.
     */
    const forms: Record<string, string> = {
      one: 'ONE',
      few: 'FEW',
      many: 'MANY',
      other: 'OTHER',
    };
    const { user, trigger } = renderWith({
      locale: 'pl',
      resultCountLabels: {
        one: '{count} ONE',
        few: '{count} FEW',
        many: '{count} MANY',
        other: '{count} OTHER',
      },
    });
    // `install` matches two records; `search` matches one, and Polish agrees
    // with English on one.
    await search(user, trigger, 'install');

    const announced =
      document.querySelector('.wave-docs-search-announcer')?.textContent ?? '';
    const count = Number(/^\d+/.exec(announced)?.[0]);

    /*
     * ⚠️ THE GUARD THAT MAKES THIS ABLE TO FAIL. Polish and English agree on a
     * count of one, so a corpus that happened to return a single hit would let
     * a plain `count === 1 ? one : other` pass this — which it did, on the first
     * draft. Above one they diverge: Polish says `few` for 2–4 and `many` for 5
     * and up, and neither is `other`.
     */
    expect(count).toBeGreaterThan(1);
    expect(announced).toBe(
      `${String(count)} ${forms[new Intl.PluralRules('pl').select(count)] ?? ''}`,
    );
    expect(announced).not.toContain('OTHER');
  });

  it('falls back to `other` for a category that was not given', async () => {
    const { user, trigger } = renderWith({
      locale: 'pl',
      resultCountLabels: { other: '{count} znaleziono' },
    });
    await search(user, trigger, 'search');

    expect(
      document.querySelector('.wave-docs-search-announcer')?.textContent,
    ).toMatch(/^\d+ znaleziono$/);
  });

  it("survives an invalid `lang`, because that is the site's typo", async () => {
    // `Intl.PluralRules` throws a RangeError on a malformed tag, and a thrown
    // announcement is a dialog that renders nothing at all.
    const { user, trigger } = renderWith({ locale: 'not a language' });
    await search(user, trigger, 'search');

    expect(
      document.querySelector('.wave-docs-search-announcer')?.textContent,
    ).toMatch(/^\d+ results?$/);
  });
});
/**
 * The magnifier and the keyboard footer.
 *
 * The footer replaces a standalone button that said `Close` in hardcoded
 * English — the one user-facing string in this package that was never lifted to
 * a prop, in the one dialog a reader cannot leave without it.
 */
describe('SearchDialog chrome', () => {
  it('marks the trigger and the input with a magnifier', async () => {
    const { user, trigger } = renderDialog();

    expect(trigger.querySelector('.wave-docs-search-glyph')).not.toBeNull();

    await user.click(trigger);
    const row = document.querySelector('.wave-docs-search-input-row');
    expect(row?.querySelector('.wave-docs-search-glyph')).not.toBeNull();
  });

  /**
   * ⚠️ DECORATIVE, AND THE TRIGGER PROVES WHY. Named from content, that button
   * announced as "Search Ctrl K" before its `aria-label` pinned the name — a
   * glyph left in the tree would put a third fragment in front of it.
   */
  it('keeps every glyph and hint out of the accessibility tree', async () => {
    const { user, trigger } = renderDialog();
    await user.click(trigger);

    for (const glyph of document.querySelectorAll('.wave-docs-search-glyph')) {
      expect(glyph.getAttribute('aria-hidden')).toBe('true');
    }
    for (const hint of document.querySelectorAll('.wave-docs-search-hint')) {
      expect(hint.getAttribute('aria-hidden')).toBe('true');
    }
  });

  /**
   * ⚠️ THE REGRESSION THIS FILE EXISTED WITHOUT. `Close` was a literal in the
   * JSX, so a Portuguese site rendered a Portuguese dialog with an English way
   * out of it — and no test could see it, because every assertion looked for
   * the same literal the component shipped.
   */
  it('takes its dismiss label from a prop, in whatever language', async () => {
    const { user, trigger } = renderDialog({ closeLabel: 'Fechar' });
    await user.click(trigger);

    const close = screen.getByRole('button', { name: 'Fechar' });
    expect(close).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();

    await user.click(close);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('takes the two keyboard hints from props as well', async () => {
    const { user, trigger } = renderDialog({
      selectLabel: 'Selecionar',
      openLabel: 'Abrir',
    });
    await user.click(trigger);

    const footer = document.querySelector('.wave-docs-search-footer');
    expect(footer?.textContent).toContain('Selecionar');
    expect(footer?.textContent).toContain('Abrir');
  });

  /**
   * ⚠️ AFTER THE RESULTS, NOT BEFORE THEM. The button it replaces sat in the
   * input row, so one Tab from the query went to *Close* rather than to the
   * first result — past every answer the reader had just asked for. Document
   * order is tab order here, and this is the assertion that keeps it.
   */
  it('places the dismiss control after the result list', async () => {
    const { user, trigger } = renderDialog();
    await user.click(trigger);

    const results = document.querySelector('.wave-docs-search-results');
    const close = screen.getByRole('button', { name: 'Close' });
    if (results === null) throw new Error('no result list');

    expect(
      results.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
