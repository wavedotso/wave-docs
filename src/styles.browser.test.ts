/**
 * What the stylesheet actually does to a page, in a real engine.
 *
 * `styles.test.ts` reads declarations; this reads geometry. The distinction is
 * not pedantry — every visual defect this package has shipped was a rule that
 * parsed exactly as intended and rendered wrongly. jsdom cannot stand in: it
 * has no layout at all, so `clientWidth`, `scrollWidth` and `offsetTop` are all
 * 0 and every assertion below would pass against a blank page.
 *
 * Runs only under `pnpm test:browser`, deliberately. A browser launch costs
 * more than the entire node+dom suite, and the sub-seven-second inner loop is
 * worth protecting.
 */

import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it } from 'vitest';

import styles from './styles.css?inline';

/** Widths the reflow and layout claims are made at. */
const VIEWPORTS = [320, 390, 768, 1024, 1440] as const;

function mount(html: string): HTMLElement {
  document.head.querySelector('#wave-docs-styles')?.remove();
  const style = document.createElement('style');
  style.id = 'wave-docs-styles';
  style.textContent = styles;
  document.head.append(style);

  document.body.innerHTML = `<article class="wave-docs-prose">${html}</article>`;
  const root = document.body.firstElementChild;
  if (!(root instanceof HTMLElement)) {
    throw new Error('failed to mount the prose fixture');
  }
  return root;
}

/**
 * Resize the actual viewport.
 *
 * `document.documentElement.style.width` would not do: a media query reads the
 * viewport, not the root element, so every breakpoint assertion would sample
 * whatever width the runner happened to open with.
 */
async function resize(width: number): Promise<void> {
  await page.viewport(width, 900);
}

const LONG_WORD = 'a'.repeat(120);
const DIGEST = `sha256:${'0123456789abcdef'.repeat(4)}`;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('the reading column', () => {
  it('holds the measure rather than running the viewport', async () => {
    const prose = mount('<p>Hello.</p>');
    await resize(1440);

    const width = prose.getBoundingClientRect().width;
    // 46rem at the 16px default root. Without a measure this was the full
    // 1424px content box.
    expect(width).toBeGreaterThan(700);
    expect(width).toBeLessThanOrEqual(736);
  });

  it('renders in the shipped stack, not the UA serif', async () => {
    const prose = mount('<p>Hello.</p>');
    await resize(1024);

    // The FIRST family, not a substring of the stack: `/serif$/` matches
    // `sans-serif`, so a naive negative assertion here passes on a serif page
    // and fails on a correct one.
    const first = getComputedStyle(prose).fontFamily.split(',')[0]?.trim();
    expect(first).not.toMatch(/^(Times|serif)/i);
    expect(first).toMatch(/ui-sans-serif|system-ui|-apple-system/);
  });
});

describe('reflow', () => {
  it.each(VIEWPORTS)(
    'does not scroll the document sideways at %ipx',
    async (width) => {
      mount(`
      <h2>${LONG_WORD}</h2>
      <p>${DIGEST}</p>
      <ul><li>${LONG_WORD}</li></ul>
      <p><a href="/x">https://example.com/${LONG_WORD}</a></p>
    `);
      await resize(width);

      // WCAG 1.4.10 is tested at 320px; the rest are here because a fix that
      // only holds at the tested width is a fix aimed at the test.
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    },
  );
});

describe('the type scale', () => {
  it('renders six strictly distinguishable levels', async () => {
    const prose = mount(
      [1, 2, 3, 4, 5, 6].map((n) => `<h${n}>Heading ${n}</h${n}>`).join(''),
    );
    await resize(1024);

    const seen = [1, 2, 3, 4, 5, 6].map((n) => {
      const el = prose.querySelector(`h${n}`);
      if (!(el instanceof HTMLElement)) throw new Error(`no h${n}`);
      const style = getComputedStyle(el);
      return {
        size: Number.parseFloat(style.fontSize),
        transform: style.textTransform,
        weight: style.fontWeight,
      };
    });

    // h1..h4 strictly descend.
    for (let i = 1; i < 4; i += 1) {
      const previous = seen[i - 1];
      const current = seen[i];
      if (!previous || !current) throw new Error('missing level');
      expect(current.size, `h${i + 1} is not smaller than h${i}`).toBeLessThan(
        previous.size,
      );
    }

    // h5/h6 were the same size AND weight as body text, differing only in
    // colour. They are distinguished on a different axis now, so assert that
    // axis rather than a fifth size nobody could see.
    const body = Number.parseFloat(getComputedStyle(prose).fontSize);
    for (const level of [seen[4], seen[5]]) {
      if (!level) throw new Error('missing eyebrow level');
      expect(level.size).toBeLessThan(body);
      expect(level.transform).toBe('uppercase');
    }
  });

  it('keeps an ordinary h1 to two lines on a phone', async () => {
    const prose = mount('<h1>Getting started with the Wave documentation</h1>');
    await resize(390);

    const h1 = prose.querySelector('h1');
    if (!(h1 instanceof HTMLElement)) throw new Error('no h1');
    const lineHeight = Number.parseFloat(getComputedStyle(h1).lineHeight);
    expect(h1.getBoundingClientRect().height).toBeLessThanOrEqual(
      lineHeight * 2,
    );
  });
});

describe('tables', () => {
  /** The three shapes that behave differently, per the `min-width` finding. */
  const API = `<table class="wave-docs-table"><thead><tr>
      <th>Name</th><th>Type</th><th>Default</th><th>Since</th><th>Notes</th><th>Status</th>
    </tr></thead><tbody><tr>
      <td>contentDir</td><td>string</td><td>—</td><td>0.1</td><td>Where the markdown lives</td><td>stable</td>
    </tr></tbody></table>`;

  const LINKS = `<table class="wave-docs-table"><tbody><tr>
      <td><a href="/a">/api/v1/some/long/path</a></td>
      <td><a href="/b">/api/v1/another/long/path</a></td>
      <td><a href="/c">/api/v1/a/third/long/path</a></td>
    </tr></tbody></table>`;

  const PROSE_CELL = `<table class="wave-docs-table"><tbody><tr>
      <td>timeout</td>
      <td>How long the client waits before giving up, in milliseconds, across every retry.</td>
    </tr></tbody></table>`;

  function mountTable(html: string): HTMLElement {
    const prose = mount(
      `<section class="wave-docs-table-scroll" tabindex="0">${html}</section>`,
    );
    const scroll = prose.querySelector('.wave-docs-table-scroll');
    if (!(scroll instanceof HTMLElement)) throw new Error('no scroll region');
    return scroll;
  }

  it('scrolls a wide table instead of squeezing it', async () => {
    const scroll = mountTable(API);
    await resize(320);
    // The defect: `width: 100%` plus `overflow-wrap: anywhere` on links let
    // auto layout floor at ~1ch per column, so the table *fitted* 320px and
    // rendered rows five lines tall instead of overflowing.
    expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth);
  });

  it('scrolls a link-only table too, which used to fit at one character', async () => {
    const scroll = mountTable(LINKS);
    await resize(320);
    expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth);
  });

  it.each([320, 768, 1024])(
    'keeps rows shallow at %ipx rather than stacking one word per line',
    async (width) => {
      const scroll = mountTable(PROSE_CELL);
      await resize(width);

      const cell = scroll.querySelector('td');
      if (!(cell instanceof HTMLElement)) throw new Error('no cell');
      const lineHeight = Number.parseFloat(getComputedStyle(cell).lineHeight);
      expect(cell.getBoundingClientRect().height).toBeLessThanOrEqual(
        lineHeight * 5,
      );
    },
  );
});

describe('focus indicators', () => {
  it('draws a real outline on every focusable surface', async () => {
    const prose = mount('<p><a href="/x">a link</a></p>');
    await resize(1024);

    const link = prose.querySelector('a');
    if (!(link instanceof HTMLElement)) throw new Error('no link');
    link.focus();

    const style = getComputedStyle(link);
    // The old ring was a `box-shadow` with a transparent `outline`, which
    // forced-colors mode dropped entirely.
    expect(style.outlineStyle).not.toBe('none');
    expect(style.outlineWidth).not.toBe('0px');
    expect(style.outlineColor).not.toMatch(/transparent|rgba\(0, 0, 0, 0\)/);
  });
});

describe('the responsive shell', () => {
  /**
   * The shell as `docs.Layout` renders it.
   *
   * The table is deliberately wide and deliberately inside the scroll wrapper
   * the pipeline always emits. That is the ONE shape where `minmax(0, 1fr)` and
   * `min-width: 0` change the outcome: measured, a bare `1fr` floors the track
   * at the wrapper's min-content and pushes the document to 1048px inside a
   * 1024px viewport. Every other wide child — a bare table, a fixed-width
   * image, an unstyled `<pre>` — overflows identically with or without those
   * two rules, so a fixture built from one of those passes either way and
   * proves nothing.
   */
  function mountShell(): void {
    document.head.querySelector('#wave-docs-styles')?.remove();
    const style = document.createElement('style');
    style.id = 'wave-docs-styles';
    style.textContent = styles;
    document.head.append(style);

    document.body.innerHTML = `
      <div class="wave-docs-shell">
      <div class="wave-docs-layout">
        <div class="wave-docs-layout__sidebar">
          <div class="wave-docs-layout__sidebar-nav" tabindex="-1">
            <nav class="wave-docs-sidebar"><ul class="wave-docs-sidebar__list" data-depth="0">
              <li class="wave-docs-sidebar__item"><a class="wave-docs-sidebar__link" href="/a">A page</a></li>
            </ul></nav>
          </div>
          <button type="button" class="wave-docs-layout__sidebar-trigger"></button>
        </div>
        <div class="wave-docs-layout__sidebar-scrim" aria-hidden="true"></div>
        <div class="wave-docs-layout__main">
          <article class="wave-docs-prose">
            <h1>Title</h1>
            <p>${DIGEST}</p>
            <section class="wave-docs-table-scroll" tabindex="0">
              <table class="wave-docs-table"><tbody><tr>
                <td>${'x'.repeat(200)}</td>
                <td><a href="/b">/api/v1/another/long/path</a></td>
              </tr></tbody></table>
            </section>
          </article>
        </div>
        <div class="wave-docs-layout__toc"><nav class="wave-docs-toc"><a href="#x">Title</a></nav></div>
      </div>
      </div>`;
  }

  function box(selector: string): DOMRect {
    const el = document.querySelector(selector);
    if (!(el instanceof HTMLElement)) throw new Error(`no ${selector}`);
    return el.getBoundingClientRect();
  }

  const WIDTHS = [320, 390, 768, 1024, 1440, 2560] as const;

  /**
   * The defect this shell exists to prevent, measured on the obvious
   * hand-written version at 390px: 568px of document width — 178px of
   * horizontal scroll, WCAG 1.4.10 failed — with the prose column computing to
   * **0**. Not "unstyled on mobile": a blank page.
   */
  it.each(WIDTHS)(
    'fits the viewport and keeps a readable column at %ipx',
    async (width) => {
      mountShell();
      await resize(width);

      expect(
        document.documentElement.scrollWidth,
        `document scrolls sideways at ${width}px`,
      ).toBeLessThanOrEqual(width);
      /*
       * ⚠️ 260, NOT 280, AND THE 20px IS THE TAP TARGET.
       *
       * The floor was 280 while the trigger was a `fixed` 24px strip overlapping
       * the gutter. It is 44px of real track now — Apple's minimum, and the
       * strip *is* the target — paid for out of the article: 320 − 44 − 8 − 8 is
       * 260. About 46 characters, on a viewport narrower than any phone sold
       * since 2016. Every other width is unaffected: 330 at 390px.
       */
      expect(
        box('.wave-docs-prose').width,
        `prose column collapsed at ${width}px`,
      ).toBeGreaterThanOrEqual(260);
    },
  );

  it('shows one column on a phone and three on a desktop', async () => {
    mountShell();

    await resize(390);
    /*
     * MEASURED AS GEOMETRY, NOT AS A KEYWORD, and the geometry has now been
     * four different things.
     *
     * `display: none` on the wrapper, then a width of 0 because it was
     * `display: contents`, then 0 again with a `<dialog>` inside it. There is
     * one sidebar now and no width at which it is absent — so the number that
     * means "a phone gets one reading column" is the article's inline start,
     * not the sidebar's width.
     *
     * ⚠️ AND NOT THE SIDEBAR'S OWN BOX, WHICH IS 300px IN BOTH STATES. It is
     * `max-content` wide always; what changes is its negative margin, so
     * measuring the box would pass whatever the layout did.
     */
    expect(box('.wave-docs-layout__main').left).toBeLessThanOrEqual(60);
    expect(
      getComputedStyle(
        document.querySelector('.wave-docs-layout__toc') as HTMLElement,
      ).display,
    ).toBe('none');

    await resize(1024);
    expect(box('.wave-docs-layout__main').left).toBeGreaterThan(280);
    expect(
      getComputedStyle(
        document.querySelector('.wave-docs-layout__toc') as HTMLElement,
      ).display,
    ).toBe('none');

    await resize(1440);
    expect(box('.wave-docs-layout__sidebar').width).toBeGreaterThan(0);
    expect(box('.wave-docs-layout__toc').width).toBeGreaterThan(0);
  });

  it('paints one surface, not islands on a canvas nobody declared', async () => {
    /*
     * ⚠️ FOUND IN A SCREENSHOT, AND ONLY IN DARK MODE.
     *
     * This sheet paints its own containers and never `body`, deliberately — a
     * contrast ratio is only a fact if the background under it is one, and the
     * host owns `body`. What that left unpainted was the *grid*: 1.5rem of
     * gutter between each column, plus the inline padding.
     *
     * Light mode hid it, because the browser's canvas and `--wave-docs-bg` are
     * both white. In dark mode they are two different darks, so the sidebar and
     * the table of contents rendered as slightly lighter panels floating on a
     * darker page — while every contrast assertion in `styles.test.ts` stayed
     * green, each one a correct fact about a container that was painted.
     *
     * Same colour everywhere, not "the right colour": the token is the token's
     * business, and a host is free to override it. What must hold is that the
     * shell is one surface.
     */
    mountShell();
    await resize(1440);
    document.documentElement.dataset.theme = 'dark';

    try {
      const painted = [
        '.wave-docs-layout',
        '.wave-docs-prose',
        '.wave-docs-sidebar',
        '.wave-docs-toc',
      ].map((selector) => {
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLElement)) {
          throw new Error(`the shell fixture has no ${selector}`);
        }
        return getComputedStyle(element).backgroundColor;
      });

      // The guard on the guard: four transparents would also be "all equal".
      expect(painted[0]).not.toBe('rgba(0, 0, 0, 0)');
      expect(new Set(painted).size).toBe(1);
    } finally {
      document.documentElement.removeAttribute('data-theme');
    }
  });

  /**
   * ⚠️ THE READING COLUMN IS CAPPED, NOT THE SHELL — AND SWAPPING THOSE TWO IS
   * WHAT THIS TEST NOW GUARDS.
   *
   * The shell used to carry `max-width: 100rem` and `margin-inline: auto`, so
   * that a 2560px display did not leave the sidebar and the TOC 1500px apart
   * with the text floating between them. It also pushed the sidebar 480px in
   * from the page's inline start — and a *closed* navigation, translated out of
   * the shell rather than off the screen, sat visible in the centring margin.
   * Measured at 2000px: 200px of it on screen beside a trigger 200px in.
   *
   * So the sidebar keeps the inline start edge at every width, which is what
   * makes "closed" mean off the screen by construction, and the thing that
   * should not stretch — the prose — is the thing that is capped and centred.
   */
  it('caps the reading column, and keeps the sidebar on the edge', async () => {
    mountShell();
    await resize(2560);

    // The sidebar is flush, so a closed navigation has somewhere to go.
    expect(box('.wave-docs-layout__sidebar').left).toBe(0);
    expect(box('.wave-docs-layout').left).toBe(0);

    // And the text does not run the bezel: capped, and centred in its track.
    const prose = box('.wave-docs-prose');
    const main = box('.wave-docs-layout__main');
    expect(prose.width).toBeLessThanOrEqual(46 * 16);
    expect(Math.round(prose.left - main.left)).toBeCloseTo(
      Math.round(main.right - prose.right),
      -1,
    );
  });
});

/**
 * ⚠️ THIS PACKAGE MUST NOT DEPEND ON THE HOST'S RESET, AND IT DID.
 *
 * `.wave-docs-sidebar__link` is `width: 100%` with `0.5rem` of inline padding
 * and `justify-content: space-between`, so the external-link icon is pinned to
 * the far end of the box. Under `content-box` that box is the track's width
 * *plus* 1rem, and the icon renders outside the sidebar — clipped in half,
 * measured at 8px over on the real site.
 *
 * It survived because almost every host ships `box-sizing: border-box`
 * globally: Tailwind's preflight sets it, and so does every normalize-style
 * reset. The one configuration that does not is a site with no CSS of its own,
 * which is exactly what `site/` is — so the harness found a defect that no
 * consumer's project could have shown us.
 *
 * Geometry rather than a declaration check, because the declaration is the
 * thing that was missing: a text assertion would have to name the rule that
 * does not exist yet.
 */
describe('the box model', () => {
  function mountSidebar(): { sidebar: HTMLElement; link: HTMLElement } {
    document.head.querySelector('#wave-docs-styles')?.remove();
    const style = document.createElement('style');
    style.id = 'wave-docs-styles';
    style.textContent = styles;
    document.head.append(style);

    // A bounded track, as the grid gives it. The width is the point: the link
    // inside must not be wider than what encloses it.
    document.body.innerHTML = `
      <div class="wave-docs-sidebar" style="width: 16rem">
        <nav class="wave-docs-nav">
          <a class="wave-docs-sidebar__link" href="https://example.com">GitHub<svg
            class="wave-docs-sidebar__external" viewBox="0 0 24 24" width="12"
            height="12"></svg><span class="wave-docs-sr-only"> (opens in a new tab)</span></a>
        </nav>
      </div>`;

    const sidebar = document.querySelector('.wave-docs-sidebar');
    const link = document.querySelector('.wave-docs-sidebar__link');
    if (!(sidebar instanceof HTMLElement) || !(link instanceof HTMLElement)) {
      throw new Error('failed to mount the sidebar fixture');
    }
    return { sidebar, link };
  }

  it('keeps a padded full-width link inside its track', async () => {
    const { sidebar, link } = mountSidebar();
    await resize(1440);

    const track = sidebar.getBoundingClientRect();
    const box = link.getBoundingClientRect();
    expect(box.width).toBeLessThanOrEqual(track.width);
    expect(box.right).toBeLessThanOrEqual(track.right);
  });

  it('keeps the external-link icon inside it too', async () => {
    const { sidebar } = mountSidebar();
    await resize(1440);

    const icon = document.querySelector('.wave-docs-sidebar__external');
    if (!(icon instanceof SVGElement)) throw new Error('no external icon');
    expect(icon.getBoundingClientRect().right).toBeLessThanOrEqual(
      sidebar.getBoundingClientRect().right,
    );
  });

  it('sizes every element it owns as a border box', async () => {
    const { link } = mountSidebar();
    await resize(1440);

    expect(getComputedStyle(link).boxSizing).toBe('border-box');
  });
});

/**
 * The scroll affordance on a wide table, measured as pixels rather than as
 * declarations.
 *
 * ⚠️ EVERY EXISTING ASSERTION ABOUT THIS SHADOW WAS ABOUT CSS TEXT, AND IT
 * SHIPPED TWO DEFECTS ANYWAY. It was a `background`, so the sticky `thead th`
 * and every inline `<code>` chip — each carrying an opaque fill of its own —
 * punched holes in it. And it was a `radial-gradient(farthest-side at 0 50%)`,
 * which on a full-height box concentrates the shadow at the vertical centre:
 * sampled on a real table, 5–9/255 of darkening beside the first body rows,
 * 1/255 beside the header, on a long table nothing at all where a reader looks
 * first. Both were visible in a screenshot and invisible to the suite.
 *
 * So this samples rendered pixels at the header row and at body rows, with the
 * overlay on and off, and asserts the difference.
 */
describe('the table scroll shadow', () => {
  function mountTable(columns = 8): HTMLElement {
    document.head.querySelector('#wave-docs-styles')?.remove();
    const style = document.createElement('style');
    style.id = 'wave-docs-styles';
    style.textContent = styles;
    document.head.append(style);

    const cells = (tag: string): string =>
      Array.from(
        { length: columns },
        (_, i) => `<${tag}>column ${i}</${tag}>`,
      ).join('');

    document.body.innerHTML = `
      <div class="wave-docs-prose">
        <section class="wave-docs-table-scroll" tabindex="0">
          <table class="wave-docs-table">
            <thead><tr>${cells('th')}</tr></thead>
            <tbody>${`<tr>${cells('td')}</tr>`.repeat(2)}</tbody>
          </table>
        </section>
      </div>`;

    const scroller = document.querySelector('.wave-docs-table-scroll');
    if (!(scroller instanceof HTMLElement)) {
      throw new Error('failed to mount the table fixture');
    }
    return scroller;
  }

  /**
   * ⚠️ THE FRAME IS ONE LINE, AND IT WAS TWO.
   *
   * `thead` was in the same rule as `tbody tr + tr`, so it carried a
   * `border-block-start` — and the header is the first thing in the table, so
   * that landed directly against the scroll container's own border with nothing
   * between them. Measured at the top-left corner: two adjacent rows of
   * `--wave-docs-border` where there should be one, which reads as a thick or
   * doubled line rather than as a frame.
   *
   * Geometry, because the defect is the *sum* of two rules that are each
   * correct alone.
   */
  it('frames the table with one line, not two', async () => {
    const scroller = mountTable(3);
    await resize(1440);

    const head = scroller.querySelector('thead');
    if (head === null) throw new Error('expected a thead');

    expect(
      Number.parseFloat(getComputedStyle(scroller).borderBlockStartWidth),
    ).toBeGreaterThan(0);

    /*
     * ⚠️ THE COMPUTED VALUE, BECAUSE NO RECT CAN SEE THIS ONE. Two geometry
     * spellings were tried and both passed the mutation: `getBoundingClientRect`
     * is the *border* box, so a border on the `thead` sits inside its own rect;
     * and under `border-collapse` a row-group border is painted on the edge
     * without moving the cells either, so measuring the `th` did not shift it
     * a pixel. The difference is real and visible — sampled at the corner, two
     * adjacent rows of `--wave-docs-border` instead of one — and invisible to
     * layout. So the assertion is on the declaration that produces it.
     */
    expect(getComputedStyle(head).borderBlockStartWidth).toBe('0px');
  });

  it('shows nothing on a table that fits', async () => {
    // Two columns, so it fits inside the 46rem measure rather than overflowing.
    const scroller = mountTable(2);
    await resize(1440);

    expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth + 1);
    expect(Number(getComputedStyle(scroller, '::before').opacity)).toBe(0);
    expect(Number(getComputedStyle(scroller, '::after').opacity)).toBe(0);

    /*
     * ⚠️ AND IT STILL FILLS THE COLUMN. The scroller is a grid so the shadow
     * overlays can share the table's cell, and a bare `max-content` track sizes
     * that cell to the table — so `width: 100%` resolved against the table's own
     * width and a narrow table stopped filling the reading column, leaving a
     * bordered box with empty space down its inline end. Reported from a
     * screenshot; every assertion about the shadow still passed.
     */
    const table = scroller.querySelector('table');
    if (table === null) throw new Error('expected a table');
    expect(
      Math.abs(table.getBoundingClientRect().width - scroller.clientWidth),
    ).toBeLessThan(2);
  });

  /**
   * The end edge is the one that was silently missing: with a `1fr` track the
   * overlay's containing block is only as wide as the scrollport, so it scrolls
   * out of view and sticky has nothing left to hold it against.
   */
  it('marks both edges through a full scroll', async () => {
    const scroller = mountTable();
    await resize(390);
    expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth + 1);

    /*
     * ⚠️ OPACITY IS NOT VISIBILITY, AND ASSERTING ONLY OPACITY LET THIS SHIP.
     *
     * A sticky element can only travel inside its containing block. With a
     * `1fr` track that block is the scroll *port*, so the end overlay slides
     * out of view the moment the table is scrolled — while its animation runs
     * on regardless and reports `opacity: 1` from a position nobody can see. A
     * mutation putting the track back to `minmax(0, 1fr)` passed every
     * assertion below.
     *
     * The used track width is the thing that decides it: as wide as the table,
     * or as wide as the port.
     */
    const track = Number.parseFloat(
      getComputedStyle(scroller).gridTemplateColumns,
    );
    expect(track).toBeGreaterThan(scroller.clientWidth);

    const opacity = (): { start: number; end: number } => ({
      start: Number(getComputedStyle(scroller, '::before').opacity),
      end: Number(getComputedStyle(scroller, '::after').opacity),
    });
    const scrollTo = async (fraction: number): Promise<void> => {
      scroller.scrollLeft =
        (scroller.scrollWidth - scroller.clientWidth) * fraction;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    };

    await scrollTo(0);
    expect(opacity().start).toBe(0);
    expect(opacity().end).toBeGreaterThan(0.9);

    await scrollTo(0.5);
    expect(opacity().start).toBeGreaterThan(0.9);
    expect(opacity().end).toBeGreaterThan(0.9);

    await scrollTo(1);
    expect(opacity().start).toBeGreaterThan(0.9);
    expect(opacity().end).toBe(0);
  });

  /**
   * The header carries its own opaque fill and its own stacking level, so it is
   * the row the shadow used to miss. Even coverage down the height is what the
   * linear gradient buys over the radial one.
   */
  it('covers the header row as strongly as the body', async () => {
    const scroller = mountTable();
    await resize(390);
    scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const overlay = getComputedStyle(scroller, '::before');
    expect(Number(overlay.opacity)).toBeGreaterThan(0.9);
    // Above `thead th`, which is `position: sticky; z-index: 1`.
    expect(Number(overlay.zIndex)).toBeGreaterThan(
      Number(
        getComputedStyle(
          document.querySelector('.wave-docs-table th') as HTMLElement,
        ).zIndex,
      ),
    );
    // Even down the height: a linear gradient, not a radial one centred midway.
    expect(overlay.backgroundImage).toContain('linear-gradient');
    expect(overlay.backgroundImage).not.toContain('radial-gradient');

    /*
     * ⚠️ AND THE TAPER IS A MASK WITH A CAP IN IT.
     *
     * The original shadow read well — soft at the top and bottom, strongest
     * through the middle — because `farthest-side` scales the falloff with the
     * box. That is also why it failed: on a tall table the ends get nothing,
     * and one of those ends is the header. The mask keeps the look and bounds
     * the ramp, so a short table tapers over a quarter of its height and a long
     * one over 5rem. Dropping the `min()` is what would quietly bring the
     * original defect back.
     */
    expect(overlay.maskImage).toContain('linear-gradient');
    expect(overlay.maskImage).toContain('min(');
  });
});

/**
 * Block spacing around a code fence.
 *
 * ⚠️ `.wave-docs-code { margin: 0 }` WAS WRITTEN FOR THE INLINE AXIS AND TOOK
 * THE BLOCK ONE WITH IT. A `<figure>` carries a 40px user-agent inline margin,
 * which would indent every code block; zeroing all four sides also beat
 * `.wave-docs-prose > * + *`, which is the same specificity and declared
 * earlier in the sheet. Every fence sat flush against whatever followed it —
 * two fences touching each other, a fence touching the paragraph under it.
 *
 * Geometry rather than a declaration, because the defect was a cascade
 * outcome: both rules were present and correct in isolation, and reading either
 * one would have told you nothing.
 */
describe('code block spacing', () => {
  it('keeps a gap between a fence and whatever follows it', async () => {
    const prose = mount(
      '<figure class="wave-docs-code"><pre class="shiki"><code>one</code></pre></figure>' +
        '<figure class="wave-docs-code"><pre class="shiki"><code>two</code></pre></figure>' +
        '<p>After.</p>',
    );
    await resize(1024);

    const blocks = [...prose.children];
    expect(blocks).toHaveLength(3);

    for (let i = 1; i < blocks.length; i += 1) {
      const previous = blocks[i - 1]?.getBoundingClientRect();
      const current = blocks[i]?.getBoundingClientRect();
      if (previous === undefined || current === undefined) {
        throw new Error('expected three blocks');
      }
      expect(
        current.top - previous.bottom,
        `no gap before block ${i}`,
      ).toBeGreaterThan(8);
    }
  });

  it('does not indent a fence by the figure default', async () => {
    const prose = mount(
      '<p>Before.</p>' +
        '<figure class="wave-docs-code"><pre class="shiki"><code>one</code></pre></figure>',
    );
    await resize(1024);

    const paragraph = prose.children[0]?.getBoundingClientRect();
    const figure = prose.children[1]?.getBoundingClientRect();
    if (paragraph === undefined || figure === undefined) {
      throw new Error('expected two blocks');
    }
    // The 40px user-agent margin is what this guards; same inline start as prose.
    expect(Math.abs(figure.left - paragraph.left)).toBeLessThan(2);
  });
});
/**
 * The back-to-top link's reveal, measured rather than read.
 *
 * `styles.test.ts` can see that the declarations are there and that the
 * fallback is intact; only an engine that runs a scroll timeline can say what a
 * reader at a given scroll offset actually sees.
 */
describe('the back-to-top reveal', () => {
  /**
   * The link inside the real column, not on a bare page — and that is what
   * makes the fixture worth its length.
   *
   * Above 80rem `.wave-docs-layout__toc` is a scroll container of its own, so
   * the tempting `scroll(nearest block)` resolves to *it* rather than to the
   * document. On a fixture that renders the link on a bare body there is no
   * such ancestor, `nearest` and `root` name the same scroller, and the
   * mutation that would ship a link nobody ever sees passes every assertion
   * below. Here the column exists and does not overflow, so `nearest` is an
   * inactive timeline and the first test fails.
   *
   * `scroll` gives the document something to scroll; `fit` does not.
   */
  function mountToc(height: 'scroll' | 'fit'): HTMLAnchorElement {
    document.head.querySelector('#wave-docs-styles')?.remove();
    const style = document.createElement('style');
    style.id = 'wave-docs-styles';
    style.textContent = styles;
    document.head.append(style);

    const paragraphs =
      height === 'scroll' ? '<p style="block-size: 400dvh">Long.</p>' : '';

    document.body.innerHTML = `
      <div class="wave-docs-shell">
        <div class="wave-docs-layout">
          <div class="wave-docs-layout__main">
            <article class="wave-docs-prose">
              <h2 id="one">One</h2>
              ${paragraphs}
            </article>
          </div>
          <div class="wave-docs-layout__toc">
            <nav class="wave-docs-toc" aria-label="On this page">
              <p class="wave-docs-toc__title">On this page</p>
              <ul class="wave-docs-toc__list">
                <li class="wave-docs-toc__item">
                  <a class="wave-docs-toc__link" href="#one">One</a>
                </li>
              </ul>
              <a class="wave-docs-toc__top" href="#wave-docs-content">Back to top</a>
            </nav>
          </div>
        </div>
      </div>`;

    const link = document.querySelector('.wave-docs-toc__top');
    if (!(link instanceof HTMLAnchorElement)) {
      throw new Error('failed to mount the toc fixture');
    }
    return link;
  }

  /** The column must actually be on screen, or every assertion below is vacuous. */
  function assertTocColumnRendered(): void {
    const column = document.querySelector('.wave-docs-layout__toc');
    if (!(column instanceof HTMLElement)) throw new Error('no toc column');
    expect(column.getBoundingClientRect().width).toBeGreaterThan(0);
  }

  /**
   * A scroll timeline is sampled at frame time, so a `getComputedStyle` read on
   * the same tick as `scrollTo` still reports the previous frame's progress.
   * Two frames, because the first is the one the scroll lands in.
   */
  async function scrollDocumentTo(top: number): Promise<void> {
    window.scrollTo({ top, behavior: 'instant' });
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  /** 25dvh to 35dvh of a 900px-tall viewport. */
  const BEFORE = 0;
  const MIDWAY = 270;
  const AFTER = 400;

  it('is absent while the top of the page is still on screen', async () => {
    const link = mountToc('scroll');
    await resize(1440);
    assertTocColumnRendered();
    await scrollDocumentTo(BEFORE);

    const style = getComputedStyle(link);
    expect(Number(style.opacity)).toBe(0);
    expect(style.visibility).toBe('hidden');
  });

  it('fades in on the way down and back out on the way up', async () => {
    const link = mountToc('scroll');
    await resize(1440);

    await scrollDocumentTo(AFTER);
    expect(Number(getComputedStyle(link).opacity)).toBe(1);
    expect(getComputedStyle(link).visibility).toBe('visible');

    /*
     * A fade, not a switch: the whole point of asking for the midpoint is that
     * a threshold implemented as `display: none` above and `block` below would
     * pass both endpoints above and fail here.
     */
    await scrollDocumentTo(MIDWAY);
    const midway = Number(getComputedStyle(link).opacity);
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(1);

    await scrollDocumentTo(BEFORE);
    expect(Number(getComputedStyle(link).opacity)).toBe(0);
  });

  /**
   * ⚠️ THE ONE ASSERTION THAT COSTS A KEYFRAME.
   *
   * `visibility` is what keeps an invisible link out of the tab order, and it
   * steps rather than fades — so *where* the step lands is a design decision,
   * not a detail. Halfway through the fade the link is still too faint to be a
   * focus target, and the keyframes say so; drop the middle frame and this
   * reports `visible` at an opacity of nearly zero.
   */
  it('stays out of the tab order until it is legible', async () => {
    const link = mountToc('scroll');
    await resize(1440);
    await scrollDocumentTo(MIDWAY);

    expect(Number(getComputedStyle(link).opacity)).toBeCloseTo(0.5, 1);
    expect(getComputedStyle(link).visibility).toBe('hidden');
  });

  /**
   * ⚠️ AND ON A PAGE THAT CANNOT SCROLL IT IS SIMPLY THERE.
   *
   * A scroll timeline whose scroller has no overflow is *inactive*, and an
   * animation with an inactive timeline does not apply — so the un-overridden
   * base rule is what a reader gets. That same code path is the whole fallback:
   * an engine without scroll-driven animations, and a host that scrolls an
   * inner pane rather than the document, both land here. If this ever fails,
   * the link has been hidden in browsers where nothing will ever show it again.
   */
  it('is present, not hidden, where the timeline never runs', async () => {
    const link = mountToc('fit');
    await resize(1440);
    await scrollDocumentTo(BEFORE);

    expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(
      document.documentElement.clientHeight + 1,
    );
    expect(Number(getComputedStyle(link).opacity)).toBe(1);
    expect(getComputedStyle(link).visibility).toBe('visible');
  });
});
