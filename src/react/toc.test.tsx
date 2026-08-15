/**
 * The scrollspy is the point, and it had never run before this file mounted it.
 * The observer only ever sees elements it found in the document, so every
 * behavioural test here puts the headings the TOC points at into the page and
 * plays the browser's part with `triggerIntersection`.
 */

import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { triggerIntersection } from '../../vitest.setup.dom.js';
import type { TocEntry } from '../types.js';
import { DocsToc } from './toc.js';

const entries: TocEntry[] = [
  {
    id: 'install',
    text: 'Install',
    depth: 2,
    children: [
      { id: 'usage', text: 'Usage', depth: 3, children: [] },
      // A duplicate heading gets a collision suffix from rehype-slug; the TOC
      // must carry the suffixed id, not a re-slugged guess at it.
      { id: 'usage-1', text: 'Usage', depth: 3, children: [] },
    ],
  },
  { id: 'api', text: 'API', depth: 2, children: [] },
];

/** Document order of the ids above — what "topmost" is measured against. */
const HEADING_IDS = ['install', 'usage', 'usage-1', 'api'];

let article: HTMLElement | undefined;

/**
 * The headings themselves. `getElementById` returning `null` is indistinguishable
 * from a broken scrollspy, so a test that forgets these fails rather than passes
 * vacuously.
 */
function mountHeadings(ids: readonly string[] = HEADING_IDS): void {
  article = document.createElement('article');
  for (const id of ids) {
    const heading = document.createElement('h2');
    heading.id = id;
    article.append(heading);
  }
  document.body.append(article);
}

// Only our own nodes: Testing Library's cleanup owns its container, and hook
// order between this file and the setup file is not something to rely on.
afterEach(() => {
  article?.remove();
  article = undefined;
  vi.restoreAllMocks();
});

/** Frames a drain will run before it calls the retry loop unbounded. */
const FRAME_DRAIN_LIMIT = 500;

/**
 * Take over `requestAnimationFrame` so the retry loop can be run by hand.
 *
 * jsdom drives rAF off a real timer, which would turn "does it eventually give
 * up?" into a race against the clock. Install this *before* rendering.
 */
function captureFrames(): { runOne: () => void; drain: () => number } {
  const queue: FrameRequestCallback[] = [];
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(
    (callback) => {
      queue.push(callback);
      return queue.length;
    },
  );

  const runOne = (): void => {
    const next = queue.shift();
    if (next === undefined) {
      throw new Error('expected a queued animation frame');
    }
    act(() => {
      next(0);
    });
  };

  return {
    runOne,
    /** Runs queued frames until none are left; the count it took. */
    drain: (): number => {
      let count = 0;
      while (queue.length > 0 && count < FRAME_DRAIN_LIMIT) {
        runOne();
        count += 1;
      }
      return count;
    },
  };
}

/** Which entries a screen reader would announce as the current location. */
function currentHrefs(): (string | null)[] {
  return screen
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'location')
    .map((link) => link.getAttribute('href'));
}

/** Report `visibleIds` as on screen, flushing the state update React queues. */
function scrollTo(visibleIds: readonly string[]): void {
  act(() => {
    triggerIntersection(visibleIds);
  });
}

describe('DocsToc scrollspy', () => {
  it('marks the heading on screen as the current location, and only it', () => {
    mountHeadings();
    render(<DocsToc entries={entries} />);

    scrollTo(['usage']);

    expect(currentHrefs()).toEqual(['#usage']);
  });

  it('reports the topmost visible heading, not the first the observer batched', () => {
    mountHeadings();
    render(<DocsToc entries={entries} />);

    // Deliberately out of document order: a real callback batches in whatever
    // order it likes, and "current" means the one nearest the top.
    scrollTo(['api', 'usage-1', 'usage']);

    expect(currentHrefs()).toEqual(['#usage']);
  });

  it('follows the reader down the page as headings leave the viewport', () => {
    mountHeadings();
    render(<DocsToc entries={entries} />);

    scrollTo(['install', 'usage']);
    expect(currentHrefs()).toEqual(['#install']);

    // `install` has scrolled off — the callback reports it as no longer
    // intersecting, which must drop it from the visible set.
    scrollTo(['usage', 'usage-1']);
    expect(currentHrefs()).toEqual(['#usage']);

    scrollTo(['api']);
    expect(currentHrefs()).toEqual(['#api']);
  });

  it('observes every heading it lists', () => {
    const observe = vi.spyOn(IntersectionObserver.prototype, 'observe');
    mountHeadings();

    render(<DocsToc entries={entries} />);

    expect(observe.mock.calls.map(([target]) => target.id)).toEqual(
      HEADING_IDS,
    );
    observe.mockRestore();
  });

  it('disconnects its observer when unmounted', () => {
    // A docs site navigates constantly. A leaked observer per visited page
    // keeps a whole document's headings alive and its callback firing.
    const disconnect = vi.spyOn(IntersectionObserver.prototype, 'disconnect');
    mountHeadings();

    render(<DocsToc entries={entries} />).unmount();

    expect(disconnect).toHaveBeenCalledTimes(1);
    disconnect.mockRestore();
  });

  it('picks up headings that only reach the document a frame later', () => {
    // The TOC and the document it describes are separate subtrees, so the
    // headings need not exist when the effect runs — `<DocContent/>` inside a
    // `<Suspense>` boundary the TOC renders outside of, or a tabs wrapper that
    // mounts its panel late. Resolving zero elements used to observe nothing
    // for the life of the page: no entry ever became current, and nothing threw
    // or logged, so it read as "the highlight just doesn't work on our site".
    const frames = captureFrames();
    render(<DocsToc entries={entries} />);

    scrollTo(['install']);
    expect(currentHrefs()).toEqual([]);

    mountHeadings();
    frames.runOne();

    scrollTo(['install']);
    expect(currentHrefs()).toEqual(['#install']);
  });

  it('stops looking when the headings never arrive', () => {
    // The retry is what makes a late mount work; a retry with no end is a rAF
    // loop running for the life of every page that legitimately has none.
    const frames = captureFrames();
    render(<DocsToc entries={entries} />);

    expect(frames.drain()).toBeLessThan(FRAME_DRAIN_LIMIT);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(currentHrefs()).toEqual([]);
  });

  it('does not keep retrying once some headings resolved', () => {
    // A partial resolve means the content is mounted and the missing ids are an
    // authoring error — an entry for a heading the page does not have — which
    // no amount of waiting fixes.
    mountHeadings(['install']);
    const frames = captureFrames();

    render(<DocsToc entries={entries} />);

    expect(frames.drain()).toBe(0);
  });

  it("drops the previous page's current entry when the headings change", () => {
    mountHeadings();
    const { rerender } = render(<DocsToc entries={entries} />);
    scrollTo(['install']);
    expect(currentHrefs()).toEqual(['#install']);

    // A client-side navigation: same component instance, a different page's
    // headings. `#install` exists on half the pages in a docs site, so a
    // retained active id lights up an entry the reader has not scrolled to.
    rerender(
      <DocsToc
        entries={[{ id: 'install', text: 'Install', depth: 2, children: [] }]}
      />,
    );

    expect(currentHrefs()).toEqual([]);
  });
});

describe('DocsToc structure', () => {
  it('nests a child heading inside its parent item', () => {
    mountHeadings();
    render(<DocsToc entries={entries} />);

    const item = screen.getByRole('link', { name: 'Install' }).closest('li');
    expect(item).not.toBeNull();
    const nested = within(item as HTMLElement).getAllByRole('link');
    expect(nested.map((link) => link.getAttribute('href'))).toEqual([
      '#install',
      '#usage',
      '#usage-1',
    ]);
  });

  it('makes a deeply nested entry current like any other', () => {
    mountHeadings();
    render(<DocsToc entries={entries} />);

    scrollTo(['usage-1']);

    expect(currentHrefs()).toEqual(['#usage-1']);
  });

  it('exposes the heading depth for indentation', () => {
    mountHeadings();
    render(<DocsToc entries={entries} />);

    const depths = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('data-depth'));
    expect(depths).toEqual(['2', '3', '3', '2']);
  });

  it('names the landmark, and takes a custom name', () => {
    render(<DocsToc entries={entries} label="On this page, roughly" />);

    expect(
      screen.getByRole('navigation', { name: 'On this page, roughly' }),
    ).toBeInTheDocument();
  });

  it('renders no landmark at all for a page with no headings', () => {
    const { container } = render(<DocsToc entries={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe('DocsToc anchors', () => {
  it('marks a clicked entry current before any scroll fires the observer', async () => {
    const user = userEvent.setup();
    mountHeadings();
    render(<DocsToc entries={entries} />);

    await user.click(screen.getByRole('link', { name: 'API' }));

    expect(currentHrefs()).toEqual(['#api']);
  });

  it('leaves scrolling to the browser, so CSS can honour reduced motion', async () => {
    // Doing it in JS means reimplementing `prefers-reduced-motion`, and getting
    // that wrong makes people ill — so the component must not scroll at all.
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      value: scrollIntoView,
      configurable: true,
      writable: true,
    });
    const windowScrollTo = vi.spyOn(window, 'scrollTo');
    const user = userEvent.setup();
    mountHeadings();
    render(<DocsToc entries={entries} />);

    await user.click(screen.getByRole('link', { name: 'Install' }));

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(windowScrollTo).not.toHaveBeenCalled();
    windowScrollTo.mockRestore();
  });

  it('claims no current entry in the server render', () => {
    // `aria-current` on the server would be a lie — nothing has been scrolled
    // to yet — and it would flip on hydration.
    const html = renderToStaticMarkup(<DocsToc entries={entries} />);

    expect(html).toContain('href="#usage-1"');
    expect(html).not.toContain('aria-current');
  });
});
