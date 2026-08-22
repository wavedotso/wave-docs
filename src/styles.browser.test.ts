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
      <div class="wave-docs-layout">
        <div class="wave-docs-layout__sidebar">
          <nav class="wave-docs-sidebar"><ul class="wave-docs-sidebar__list" data-depth="0">
            <li class="wave-docs-sidebar__item"><a class="wave-docs-sidebar__link" href="/a">A page</a></li>
          </ul></nav>
        </div>
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
      expect(
        box('.wave-docs-prose').width,
        `prose column collapsed at $widthpx`,
      ).toBeGreaterThan(280);
    },
  );

  it('shows one column on a phone and three on a desktop', async () => {
    mountShell();

    await resize(390);
    /*
     * MEASURED AS GEOMETRY, NOT AS A KEYWORD, and the geometry has now been
     * three different things.
     *
     * It asserted `display: none` on the sidebar wrapper until the drawer
     * landed — wrong, because the drawer `<dialog>` lives inside this wrapper
     * so one nav DOM can serve both breakpoints, and an element inside a
     * `display: none` subtree generates no boxes at all, including one promoted
     * to the top layer. Then it asserted a width of 0, because the wrapper was
     * `display: contents` and reserved no track.
     *
     * `contents` is what makes that work, and the thing worth asserting was
     * never the keyword: it is that the wrapper takes up no space, so nothing
     * of this package's sits between a host's own chrome and the article.
     */
    expect(box('.wave-docs-layout__sidebar').width).toBe(0);
    expect(
      getComputedStyle(
        document.querySelector('.wave-docs-layout__toc') as HTMLElement,
      ).display,
    ).toBe('none');

    await resize(1024);
    expect(box('.wave-docs-layout__sidebar').width).toBeGreaterThan(0);
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

  it('caps the shell so the columns do not pin to the bezels', async () => {
    mountShell();
    await resize(2560);
    // Uncapped, the sidebar and TOC end up ~1500px apart with the text
    // floating between them.
    expect(box('.wave-docs-layout').width).toBeLessThanOrEqual(100 * 16);
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
 * The drawer's trigger at a phone's width.
 *
 * ⚠️ THIS DESCRIBE HAS OUTLIVED TWO SHELLS, AND BOTH TIMES THE FIXTURE WENT
 * STALE BEFORE THE ASSERTIONS DID. It mounted a header, then a strip; each was
 * deleted, each left markup no shell renders, and every assertion against it
 * passed against nothing.
 *
 * What survives both is the question the header existed to answer: **on a
 * phone, can a reader reach the rest of the site?** The control that answers it
 * is a floating button now, and it is the one fixed-position element this
 * package renders — small and corner-anchored rather than a band across the
 * top, because two of the sites using this have a fixed navbar of their own and
 * a second bar at the same edge lands on top of the first.
 */
describe('the drawer trigger at a phone width', () => {
  function mountTrigger(): HTMLElement {
    document.head.querySelector('#wave-docs-styles')?.remove();
    const style = document.createElement('style');
    style.id = 'wave-docs-styles';
    style.textContent = styles;
    document.head.append(style);

    document.body.innerHTML = `
      <div class="wave-docs-layout">
        <div class="wave-docs-layout__sidebar">
          <button type="button" class="wave-docs-layout__nav-trigger"></button>
          <dialog class="wave-docs-layout__drawer">
            <button type="button" class="wave-docs-layout__drawer-close"></button>
          </dialog>
        </div>
        <main class="wave-docs-layout__main">${'<p>Scroll me.</p>'.repeat(60)}</main>
      </div>`;

    const trigger = document.querySelector('.wave-docs-layout__nav-trigger');
    if (!(trigger instanceof HTMLElement)) {
      throw new Error('failed to mount the trigger fixture');
    }
    return trigger;
  }

  /**
   * ⚠️ 24px OF BAR, 44px OF TARGET, AND THE SECOND NUMBER IS NOT IN THE BOX.
   *
   * WCAG 2.5.8 asks for 24 and iOS and WCAG 2.5.5 ask for 44, so the painted
   * strip satisfies only the first. The rest of the target comes from an
   * `::after` that extends past what is painted — which
   * `getBoundingClientRect` cannot see, because a pseudo-element is not in the
   * element's border box. Hit-testing is the only way to assert it, and it is
   * the thing that actually matters: what a thumb landing at 40px reaches.
   */
  it('answers to 44px while painting only the dots', async () => {
    const trigger = mountTrigger();
    await resize(390);

    // The strip is the target and paints nothing.
    expect(trigger.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    expect(getComputedStyle(trigger).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(trigger).borderTopWidth).toBe('0px');

    /*
     * Measured off docsify.js.org rather than reasoned about: their toggle is a
     * full-height strip at `rgba(0, 0, 0, 0)` with `border: 0`, `padding: 0` and
     * no radius, holding three small circles. No box — two attempts here wrapped
     * the dots in a bordered disc, and that is the part that never matched.
     */
    expect(getComputedStyle(trigger, '::after').content).toBe('none');

    const dots = getComputedStyle(trigger, '::before');
    expect(dots.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    // Three of them: one element and two box-shadow copies, 7px either side.
    // Matched on the offsets rather than on a colour — the computed value comes
    // back in whatever colour space the engine resolved `currentcolor` into.
    expect(dots.boxShadow).not.toBe('none');
    expect(dots.boxShadow).toContain('-7px');
    expect(dots.boxShadow).toContain('7px');

    const mid = window.innerHeight / 2;
    expect(document.elementFromPoint(12, mid)).toBe(trigger);
    expect(document.elementFromPoint(40, mid)).toBe(trigger);
    // And no further: past the target it is the page again.
    expect(document.elementFromPoint(60, mid)).not.toBe(trigger);
  });

  /**
   * It runs the full height of the viewport and stays there while the document
   * scrolls, so the navigation is one tap from anywhere in a long page.
   */
  it('runs the full height and holds it while the page scrolls', async () => {
    const trigger = mountTrigger();
    await resize(390);

    const before = trigger.getBoundingClientRect();
    expect(Math.round(before.height)).toBe(Math.round(window.innerHeight));

    window.scrollTo(0, 800);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const after = trigger.getBoundingClientRect();

    expect(Math.round(after.top)).toBe(Math.round(before.top));
    expect(Math.round(after.height)).toBe(Math.round(before.height));
  });

  /**
   * The article clears it rather than running underneath. `position: fixed`
   * takes the bar out of flow, so without matching padding on the grid the
   * first words of every line sit under a control.
   */
  /**
   * The article clears the *painted* button, not the whole target. The extra
   * 20px of hit area deliberately overlaps the gutter — that is the trade that
   * buys 44px without a 44px slab down the page — but no text may sit under
   * something a reader can see and press.
   */
  it('does not put the article under the dots', async () => {
    const trigger = mountTrigger();
    await resize(390);

    const main = document.querySelector('.wave-docs-layout__main');
    if (!(main instanceof HTMLElement)) throw new Error('no article');

    /*
     * The article clears the *painted* dots, not the whole target. The extra
     * hit area deliberately overlaps the gutter — that is the trade that buys
     * 44px without a slab down the page — but no text may sit under something
     * a reader can see and press.
     */
    const dots = getComputedStyle(trigger, '::before');
    const edge =
      trigger.getBoundingClientRect().left +
      Number.parseFloat(dots.insetInlineStart) +
      Number.parseFloat(dots.width) / 2;
    expect(main.getBoundingClientRect().left).toBeGreaterThanOrEqual(edge);
  });

  it('takes no space in the flow, so the article starts at the top', async () => {
    mountTrigger();
    await resize(390);

    const main = document.querySelector('.wave-docs-layout__main');
    if (!(main instanceof HTMLElement)) throw new Error('no article');
    expect(main.getBoundingClientRect().top).toBeLessThan(48);
  });

  /**
   * ⚠️ ONE CONTROL, TWO PLACES. They were two: 24px against 44px, a grip
   * against an `<svg>` cross, transparent against filled. Opening and closing
   * the same drawer looked like two different buttons, which is what this
   * pins — same box, same glyph, and a chevron that points at what pressing it
   * does.
   */
  it('opens and closes with the same control', async () => {
    mountTrigger();
    await resize(390);

    const open = document.querySelector('.wave-docs-layout__nav-trigger');
    const close = document.querySelector('.wave-docs-layout__drawer-close');
    const drawer = document.querySelector('dialog.wave-docs-layout__drawer');
    if (
      !(open instanceof HTMLElement) ||
      !(close instanceof HTMLElement) ||
      !(drawer instanceof HTMLDialogElement)
    ) {
      throw new Error('expected both controls and a drawer');
    }

    // The close control lives inside the drawer, which is correctly hidden
    // until something opens it — so there is nothing to measure until it is.
    drawer.showModal();

    const a = open.getBoundingClientRect();
    const b = close.getBoundingClientRect();
    expect(Math.round(a.width)).toBe(Math.round(b.width));
    expect(Math.round(a.height)).toBe(Math.round(b.height));

    // Same glyph — three dots, drawn by one element and two box-shadow copies.
    const glyph = (el: Element): string[] => {
      const style = getComputedStyle(el, '::before');
      return [style.width, style.height, style.borderRadius, style.boxShadow];
    };
    expect(glyph(open)).toEqual(glyph(close));

    // And neither wraps them in a box: the dots are the whole control.
    expect(getComputedStyle(open, '::after').content).toBe('none');
    expect(getComputedStyle(close, '::after').content).toBe('none');
    drawer.close();
  });

  /**
   * The fill is the pointer affordance and the outline is the accessible one.
   * They were the same rule for a commit, and forced-colours mode discards a
   * background — so a keyboard reader there would have had no indicator at all.
   */
  it('marks focus with an outline, not only a fill', async () => {
    const trigger = mountTrigger();
    await resize(390);

    expect(getComputedStyle(trigger).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    trigger.focus();
    expect(getComputedStyle(trigger).outlineStyle).toBe('solid');
    expect(
      Number.parseFloat(getComputedStyle(trigger).outlineWidth),
    ).toBeGreaterThan(0);
  });

  it('is hidden once the sidebar is a column', async () => {
    const trigger = mountTrigger();
    await resize(1440);

    expect(getComputedStyle(trigger).display).toBe('none');
  });
});

/**
 * The control that closes the drawer, which is the one that opened it seen from
 * the other side.
 *
 * ⚠️ IT IS `fixed`, AND THAT IS THE WHOLE POINT OF THE TEST. The dialog is the
 * scroll container, so anything positioned inside it travels with the content —
 * on a navigation longer than the viewport, a close button in the flow scrolls
 * out of reach and a reader has to scroll back up to find the way out. Fixed
 * inside a top-layer dialog resolves against the viewport, which is the frame
 * it should hold still in.
 *
 * It sits on the *drawer's* inline end rather than the screen's, so it reads as
 * part of the panel. The two edges are kept together by a custom property the
 * dialog declares and this inherits, so neither can be moved without the other.
 */
describe('the drawer close control', () => {
  function mountDrawer(): HTMLDialogElement {
    document.head.querySelector('#wave-docs-styles')?.remove();
    const style = document.createElement('style');
    style.id = 'wave-docs-styles';
    style.textContent = styles;
    document.head.append(style);

    document.body.innerHTML = `
      <dialog class="wave-docs-layout__drawer">
        <button type="button" class="wave-docs-layout__drawer-close"></button>
        <nav class="wave-docs-sidebar">${'<a href="#x">Item</a>'.repeat(80)}</nav>
      </dialog>`;

    const dialog = document.querySelector('dialog.wave-docs-layout__drawer');
    if (!(dialog instanceof HTMLDialogElement)) {
      throw new Error('failed to mount the drawer fixture');
    }
    dialog.showModal();
    return dialog;
  }

  it('sits on the drawer edge, not the screen edge', async () => {
    const dialog = mountDrawer();
    await resize(390);

    const close = document.querySelector('.wave-docs-layout__drawer-close');
    if (!(close instanceof HTMLElement)) throw new Error('no close control');

    const panel = dialog.getBoundingClientRect();
    const strip = close.getBoundingClientRect();

    // Inside the panel's inline end — not over it, and not beyond it.
    expect(strip.right).toBeLessThanOrEqual(panel.right + 1);
    expect(strip.right).toBeGreaterThan(panel.right - 48);
    // And the panel is not the whole screen, so the two edges are distinct.
    expect(panel.right).toBeLessThan(window.innerWidth);
  });

  it('runs the full height and holds it while the tree scrolls', async () => {
    const dialog = mountDrawer();
    await resize(390);

    const close = document.querySelector('.wave-docs-layout__drawer-close');
    if (!(close instanceof HTMLElement)) throw new Error('no close control');

    const before = close.getBoundingClientRect();
    expect(Math.round(before.height)).toBe(Math.round(window.innerHeight));

    dialog.scrollTop = 400;
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const after = close.getBoundingClientRect();
    expect(Math.round(after.top)).toBe(Math.round(before.top));
  });

  it('keeps the tree out from under it', async () => {
    const dialog = mountDrawer();
    await resize(390);

    const close = document.querySelector('.wave-docs-layout__drawer-close');
    const tree = document.querySelector('.wave-docs-sidebar');
    if (!(close instanceof HTMLElement) || !(tree instanceof HTMLElement)) {
      throw new Error('expected a close control and a tree');
    }

    // Clear of the dots, which sit just inside the panel's inline end.
    const dots = getComputedStyle(close, '::before');
    const edge =
      close.getBoundingClientRect().right -
      Number.parseFloat(dots.insetInlineEnd) -
      Number.parseFloat(dots.width) / 2;
    expect(tree.getBoundingClientRect().right).toBeLessThanOrEqual(edge + 1);
    dialog.close();
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
