/**
 * The "Copy page" button.
 *
 * Rendering it to a string would prove it emits a `<button>` and prove nothing
 * about the only thing it does — fetch, write, report — so this mounts it.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocsCopyPage } from './copy-page.js';

/** Two pages, in the shape `buildLlmsFullTxt` emits. */
const CORPUS = [
  '<!-- source: https://docs.example.com/api/reference -->',
  '',
  '# Rotating keys',
  '',
  'Keys rotate.',
  '',
  '---',
  '',
  '<!-- source: https://docs.example.com/guides/links -->',
  '',
  '# Links',
  '',
  'Body.',
  '',
].join('\n');

const MARKDOWN = '# Links\n\nBody.';

let writeText: ReturnType<typeof vi.fn>;

/**
 * Replace the clipboard, and **after** `userEvent.setup()`, never before.
 *
 * ⚠️ `userEvent.setup()` INSTALLS ITS OWN `navigator.clipboard` STUB, so one
 * written before it is silently replaced — and the symptom is
 * `expect(writeText).toHaveBeenCalled()` failing against a button that copied
 * perfectly. `code-runtime.test.tsx` carries the same note for the same
 * reason; both suites drive the same `writeClipboard`.
 */
function stubClipboard(): void {
  writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('isSecureContext', true);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
}

/** `userEvent.setup()` with the clipboard stubbed in the right order. */
function setup(): ReturnType<typeof userEvent.setup> {
  const user = userEvent.setup();
  stubClipboard();
  return user;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(CORPUS),
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DocsCopyPage', () => {
  it('slices this page out of the corpus and writes it to the clipboard', async () => {
    /*
     * ⚠️ THE SLICE IS THE FEATURE. The corpus is one file the package already
     * ships for agents, so the button needs no per-page artifact and no build
     * step — which is what took its wiring from five steps to one route.
     */
    const user = setup();
    render(<DocsCopyPage href="/guides/links" />);

    await user.click(screen.getByRole('button'));

    expect(fetch).toHaveBeenCalledWith('/llms-full.txt');
    // This page only — not the corpus, and not the page above it.
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(MARKDOWN));
  });

  it('picks the right page when another one’s route is a suffix of it', async () => {
    // `/api/reference` is the first entry, and a naive `includes` on the route
    // would hand back whichever page happened to be earlier in the file.
    const user = setup();
    render(<DocsCopyPage href="/api/reference" />);

    await user.click(screen.getByRole('button'));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('# Rotating keys\n\nKeys rotate.'),
    );
  });

  it('hides itself when the corpus route was never added', async () => {
    /*
     * ⚠️ WHY `copyPage` CAN DEFAULT TO `true`. Whether `/llms-full.txt` is
     * being served is only knowable from the browser, so the button renders
     * and removes itself on the first click that 404s — rather than a site
     * that never added the route shipping a control which fails every press.
     */
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404 }),
    );
    const user = setup();
    render(<DocsCopyPage href="/guides/links" />);

    await user.click(screen.getByRole('button'));

    await waitFor(() =>
      expect(screen.queryByRole('button')).not.toBeInTheDocument(),
    );
  });

  it('reports a failure when the corpus has no entry for this page', async () => {
    // The route is served but the page is missing from it — a stale corpus, or
    // a button rendered outside the docs tree. Distinct from a missing route:
    // the wiring works, so the button stays.
    const user = setup();
    render(<DocsCopyPage href="/nowhere" />);

    const button = screen.getByRole('button');
    await user.click(button);

    await waitFor(() =>
      expect(button.getAttribute('data-state')).toBe('failed'),
    );
    expect(writeText).not.toHaveBeenCalled();
  });

  it('fetches once across repeated clicks', async () => {
    const user = setup();
    render(<DocsCopyPage href="/guides/links" />);

    const button = screen.getByRole('button');
    await user.click(button);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    await user.click(button);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('announces the outcome without renaming the button', async () => {
    /*
     * ⚠️ THE LABEL IS CONSTANT AND THE LIVE REGION CARRIES THE RESULT. Putting
     * "Copied" in the label renames the control mid-press, so a screen reader
     * announces a *different button* than the one the reader activated, and
     * the accessible name a moment later is not the one they will look for.
     */
    const user = setup();
    render(<DocsCopyPage href="/guides/links" />);

    const button = screen.getByRole('button', { name: /Copy page/ });
    await user.click(button);

    await waitFor(() =>
      expect(button.getAttribute('data-state')).toBe('copied'),
    );
    expect(button.textContent).toContain('Copy page');
    expect(screen.getByText('Copied')).toHaveAttribute('aria-live', 'polite');
  });

  it('keeps the button when the network fails, rather than hiding it', async () => {
    /*
     * ⚠️ OFFLINE IS NOT A MISSING ROUTE, AND ONLY ONE OF THEM IS PERMANENT.
     * The wiring is fine and the next press may well work, so this says so and
     * stays — hiding it would take the control away for the rest of the visit
     * over a dropped request.
     */
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const user = setup();
    render(<DocsCopyPage href="/guides/links" />);

    await user.click(screen.getByRole('button'));

    await waitFor(() =>
      expect(screen.getByRole('button').getAttribute('data-state')).toBe(
        'failed',
      ),
    );
  });

  it('says it is working while the fetch is in flight', async () => {
    /*
     * ⚠️ WITHOUT THIS THE FIRST THING A READER SEES IS THE OUTCOME. A cold
     * click crosses the network; with no state between the press and the
     * result the button flashed straight to ✓ or ✗, which reads as a verdict
     * on the click rather than on a request that had been running. The label
     * animates rather than a fourth glyph appearing — a spinner is another
     * icon in a bundle whose whole argument is its size.
     */
    let release: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        await pending;
        return { ok: true, text: () => Promise.resolve(CORPUS) };
      }),
    );

    const user = setup();
    render(<DocsCopyPage href="/guides/links" />);
    const button = screen.getByRole('button');

    const click = user.click(button);
    await waitFor(() =>
      expect(button.getAttribute('data-state')).toBe('loading'),
    );
    // And it is the copy glyph throughout: the icon is not what changed.
    expect(button.querySelector('svg path')).toBeInTheDocument();

    release(undefined);
    await click;
    await waitFor(() =>
      expect(button.getAttribute('data-state')).toBe('copied'),
    );
  });

  it('ignores a second click while the first is still fetching', async () => {
    let release: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const spy = vi.fn().mockImplementation(async () => {
      await pending;
      return { ok: true, text: () => Promise.resolve(MARKDOWN) };
    });
    vi.stubGlobal('fetch', spy);

    const user = setup();
    render(<DocsCopyPage href="/guides/links" />);
    const button = screen.getByRole('button');

    const first = user.click(button);
    await waitFor(() =>
      expect(button.getAttribute('data-state')).toBe('loading'),
    );
    await user.click(button);

    release(undefined);
    await first;

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('takes its labels from props', async () => {
    const user = setup();
    render(
      <DocsCopyPage
        href="/guides/links"
        label="Copiar página"
        copiedLabel="Copiado"
      />,
    );

    const button = screen.getByRole('button', { name: /Copiar página/ });
    await user.click(button);

    await waitFor(() =>
      expect(screen.getByText('Copiado')).toBeInTheDocument(),
    );
  });
});
