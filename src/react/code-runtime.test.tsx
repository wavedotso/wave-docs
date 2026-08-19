/**
 * The copy runtime, driven against trees the real pipeline produced.
 *
 * A hand-built `<pre><span class="line">` fixture would pass every assertion
 * below while telling you nothing: the whole question is what Shiki's output
 * actually looks like — where the newlines live, what an excluded fence's
 * `<pre>` has inside it — and a fixture is just this file's author guessing at
 * that a second time.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { CODE_READY_ATTRIBUTE } from '../code-frame.js';
import { createDocsRenderer } from '../render.js';
import type { DocFile } from '../types.js';
import { DocContent } from './doc-content.js';

const SOURCE = [
  '```ts title="app/page.tsx"',
  'const a = 1;',
  '',
  'export default a;',
  '```',
].join('\n');

/** A fenced markdown sample, whose two trailing spaces are a hard line break. */
const HARD_BREAK = ['```md', 'first line  ', 'second line', '```'].join('\n');

const MERMAID = ['```mermaid', 'graph TD;', '  A-->B;', '```'].join('\n');

async function renderDoc(
  content: string,
): Promise<{ hast: DocFile extends never ? never : import('hast').Root }> {
  const renderer = createDocsRenderer({
    config: {
      basePath: '/docs',
      onBrokenLinks: 'ignore',
      onUnverifiableLinks: 'ignore',
    },
    excludeLangs: ['mermaid'],
    titleHeading: false,
  });
  const doc = await renderer.render({
    segments: ['code'],
    slug: 'code',
    href: '/docs/code',
    filePath: '/content/code.md',
    relativePath: 'code.md',
    frontmatter: { title: 'Code' },
    content,
  } as DocFile);
  return { hast: doc.hast };
}

let writeText: ReturnType<typeof vi.fn>;

/**
 * Replace the clipboard, and **after** `userEvent.setup()`, never before.
 *
 * ⚠️ `userEvent.setup()` INSTALLS ITS OWN `navigator.clipboard` STUB so that
 * `user.copy()` and `user.paste()` work. A stub written before it is silently
 * replaced, and the symptom is `expect(writeText).toHaveBeenCalled()` failing
 * against a runtime that copied perfectly — which reads as our bug and is not.
 */
function stubClipboard(options: { secure: boolean; works: boolean }): void {
  writeText = vi.fn(() =>
    options.works ? Promise.resolve() : Promise.reject(new Error('denied')),
  );
  vi.stubGlobal('isSecureContext', options.secure);
  /*
   * ⚠️ THE CLIPBOARD OBJECT EXISTS EVEN WHEN THE CONTEXT IS NOT SECURE. This
   * used to set it to `undefined` for the insecure case, which made
   * `window.isSecureContext &&` in the runtime dead code — deleting the guard
   * left every test green. Browsers do expose `navigator.clipboard` over plain
   * HTTP and reject the write, so the stub now does the same and the guard is
   * the thing being measured.
   */
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
}

const trees: Record<string, import('hast').Root> = {};

beforeAll(async () => {
  trees.plain = (await renderDoc(SOURCE)).hast;
  trees.hardBreak = (await renderDoc(HARD_BREAK)).hast;
  trees.mermaid = (await renderDoc(MERMAID)).hast;
  trees.prose = (await renderDoc('Just prose, no fences.')).hast;
}, 30_000);

/** A user, with our clipboard stub installed over the one setup() adds. */
function setupUser(
  options: { secure: boolean; works: boolean } = { secure: true, works: true },
): ReturnType<typeof userEvent.setup> {
  const user = userEvent.setup();
  stubClipboard(options);
  return user;
}

beforeEach(() => {
  // jsdom implements neither; the legacy path needs both to exist to be
  // measurable at all.
  document.execCommand = vi.fn(() => true);
  HTMLTextAreaElement.prototype.select = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const copyButton = (): HTMLElement =>
  screen.getAllByRole('button', { name: /^Copy code/ })[0] as HTMLElement;

const status = (): HTMLElement | null =>
  document.querySelector('[role="status"]');

describe('DocsCodeRuntime', () => {
  it('mounts only when the tree contains a code frame', () => {
    const { unmount } = render(<DocContent hast={trees.prose as never} />);

    // A page of pure prose must ship none of this. The check is one pass over
    // a tree the server already has, so "zero bytes" costs nothing.
    expect(document.documentElement.hasAttribute(CODE_READY_ATTRIBUTE)).toBe(
      false,
    );
    unmount();

    render(<DocContent hast={trees.plain as never} />);
    expect(document.documentElement.hasAttribute(CODE_READY_ATTRIBUTE)).toBe(
      true,
    );
  });

  /*
   * A note on what these cannot yet distinguish. `readCode` walks `.line`
   * elements rather than reading `pre.textContent`, and today those produce
   * byte-identical output — Shiki emits a literal `"\n"` text node between
   * lines, so deleting the walk passes every assertion below. The walk exists
   * for `SKIP_LINE_CLASSES`, which is empty until `@shikijs/transformers`
   * lands and `'remove'` goes in it. Saying so here is better than implying a
   * coverage that does not exist.
   */
  it('copies the code as the author wrote it', async () => {
    const user = setupUser();
    render(<DocContent hast={trees.plain as never} />);

    await user.click(copyButton());

    expect(writeText).toHaveBeenCalledWith('const a = 1;\n\nexport default a;');
  });

  it('keeps the trailing spaces that are a markdown hard break', async () => {
    /*
     * The reason lines are not blanket-trimmed. A documentation site is the
     * one place somebody writes a fenced markdown sample, and trimming would
     * turn its hard line break into an ordinary space — a change to the
     * meaning of the copied text, invisible until it is pasted.
     */
    const user = setupUser();
    render(<DocContent hast={trees.hardBreak as never} />);

    await user.click(copyButton());

    expect(writeText).toHaveBeenCalledWith('first line  \nsecond line');
  });

  it('gives an excluded fence no button, even beside a framed one', async () => {
    /*
     * ⚠️ RENAMED, BECAUSE THE OLD NAME DESCRIBED SOMETHING THIS CANNOT DO. It
     * was "copies an excluded fence, which has no line spans at all", and it
     * clicked the *TypeScript* fence's button and asserted the TypeScript
     * source — because an excluded fence is deliberately unframed and so has no
     * button to click. The `textContent` fallback it claimed to cover was never
     * reached; the test below reaches it.
     *
     * What this genuinely pins is the pairing: one frame, one button, and the
     * mermaid block beside it carrying none.
     */
    const user = setupUser();
    const both = await renderDoc(`${SOURCE}\n\n${MERMAID}`);
    render(<DocContent hast={both.hast as never} />);

    expect(screen.getAllByRole('button', { name: /^Copy code/ })).toHaveLength(
      1,
    );

    await user.click(copyButton());
    expect(writeText).toHaveBeenCalledWith('const a = 1;\n\nexport default a;');
  }, 30_000);

  it('falls back to the text when a <pre> carries no line spans', async () => {
    /*
     * The branch the test above claimed. `readCode` walks `.line` children
     * because `pre.textContent` stops being right the moment a transformer adds
     * a gutter or a line that should not be copied — and it falls back to
     * `textContent` when there are no lines to walk.
     *
     * A `rehypePlugins` entry that rewrites a fence's innards is exactly what
     * produces that shape, so this strips the spans out of a real Shiki frame
     * rather than hand-building one: the frame, the button and the wiring stay
     * the pipeline's, and only the thing under test is changed.
     */
    const user = setupUser();
    render(<DocContent hast={trees.plain as never} />);

    const pre = document.querySelector('pre');
    if (pre === null) throw new Error('the frame rendered no <pre>');
    pre.innerHTML = '<code>graph TD;\n  A--&gt;B;</code>';
    expect(pre.querySelectorAll('.line')).toHaveLength(0);

    await user.click(copyButton());

    expect(writeText).toHaveBeenCalledWith('graph TD;\n  A-->B;');
  });

  it('announces once, and copies once, with two DocContents mounted', async () => {
    /*
     * The bug the module singleton prevents, and the one nothing else would
     * catch: a second listener copies the same text twice — harmless — and
     * announces twice, which only a screen-reader user ever notices.
     */
    const user = setupUser();
    render(
      <>
        <DocContent hast={trees.plain as never} />
        <DocContent hast={trees.hardBreak as never} />
      </>,
    );

    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);

    await user.click(copyButton());

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(status()?.textContent).toBe('Copied to the clipboard.');
  });

  it('cleans up after the last DocContent unmounts', () => {
    const first = render(<DocContent hast={trees.plain as never} />);
    const second = render(<DocContent hast={trees.hardBreak as never} />);

    first.unmount();
    // Still one mounted: the attribute and the region must survive, or the
    // remaining page's buttons go inert and invisible.
    expect(document.documentElement.hasAttribute(CODE_READY_ATTRIBUTE)).toBe(
      true,
    );

    second.unmount();
    expect(document.documentElement.hasAttribute(CODE_READY_ATTRIBUTE)).toBe(
      false,
    );
    expect(status()).toBeNull();
  });

  it('falls back to execCommand outside a secure context', async () => {
    /*
     * `next dev` on `http://192.168.x.x:3000` — the standard way to check a
     * docs site on a real phone — is not a secure context, so
     * `navigator.clipboard` is `undefined` there and reading it without the
     * guard is a TypeError rather than a graceful path.
     */
    const user = setupUser({ secure: false, works: false });
    render(<DocContent hast={trees.plain as never} />);

    await user.click(copyButton());

    expect(document.execCommand).toHaveBeenCalledWith('copy');
    // The async API is present but must not be reached: reading it is what
    // throws on some engines, and awaiting it is a guaranteed rejection.
    expect(writeText).not.toHaveBeenCalled();
    expect(status()?.textContent).toBe('Copied to the clipboard.');
    expect(copyButton().dataset.copied).toBe('true');
  });

  it('tells the reader what to do instead when both paths fail', async () => {
    const user = setupUser({ secure: false, works: false });
    document.execCommand = vi.fn(() => false);
    render(<DocContent hast={trees.plain as never} />);

    await user.click(copyButton());

    // An instruction, not an apology: the most common way to land here cannot
    // be fixed by trying again, and "Copy failed." leaves the reader stuck.
    expect(status()?.textContent).toBe(
      'Copy failed. Select the code and press Control or Command + C.',
    );
    expect(copyButton().dataset.copied).toBe('false');
  });

  it('announces in the language the site is written in', async () => {
    /*
     * ⚠️ THESE TWO WERE HARDCODED ENGLISH UNDER A `labels` PROP DOCUMENTING
     * ITSELF AS "THE WHOLE OF WHAT A NON-ENGLISH SITE HAS TO SAY". They are the
     * only strings in this package announced to a screen reader at run time —
     * so a reader on a German site was told, in English, that something they
     * could not see had happened.
     *
     * `DocContent` carries them rather than `docs.Layout`, because this is the
     * component that mounts the runtime and the one no consumer can avoid: the
     * hand-rolled route in the README renders it directly.
     */
    const user = setupUser();
    render(
      <DocContent
        hast={trees.plain as never}
        labels={{ copied: 'Copiado.', copyFailed: 'Falhou.' }}
      />,
    );

    await user.click(copyButton());

    expect(status()?.textContent).toBe('Copiado.');
  });

  it('uses the failure message it was given, not only the success one', async () => {
    // Both, separately. One forwarded and one dropped is the shape of every
    // half-wired prop in this package's history.
    const user = setupUser({ secure: false, works: false });
    document.execCommand = vi.fn(() => false);
    render(
      <DocContent
        hast={trees.plain as never}
        labels={{ copied: 'Copiado.', copyFailed: 'Falhou. Copie à mão.' }}
      />,
    );

    await user.click(copyButton());

    expect(status()?.textContent).toBe('Falhou. Copie à mão.');
  });

  it('shows the failure, rather than announcing it to nobody who can see', async () => {
    /*
     * `data-copied="false"` was written by the runtime from the beginning and
     * had no rule in the stylesheet — so a screen-reader user was told the copy
     * failed and a sighted user watched a button do nothing at all. The most
     * common way to land here is `next dev` opened from a phone over
     * `http://192.168.x.x:3000`, which is not a secure context and never will
     * be, so "press it again" is not a recovery.
     *
     * The stylesheet is asserted in `styles.test.ts`; what this pins is that
     * the attribute reaches the DOM for CSS to act on, in the failure case as
     * well as the success one.
     */
    const user = setupUser({ secure: false, works: false });
    document.execCommand = vi.fn(() => false);
    render(<DocContent hast={trees.plain as never} />);

    await user.click(copyButton());

    expect(copyButton().matches('[data-copied="false"]')).toBe(true);
    expect(copyButton().matches('[data-copied="true"]')).toBe(false);
  });

  it('keeps the second copy indicator for its full two seconds', async () => {
    /*
     * The timer id was discarded, so two copies inside the window left two
     * timers running and the first cleared the second's indicator early: press
     * copy, press it again a second later, and the tick disappears after one
     * second instead of two. Reads as "did that work?" to the reader.
     */
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = setupUser();
      render(<DocContent hast={trees.plain as never} />);

      await user.click(copyButton());
      vi.advanceTimersByTime(1000);
      await user.click(copyButton());

      // 1.5s after the second copy: the first copy's timer has now fired, and
      // must not have taken this indicator with it.
      vi.advanceTimersByTime(1500);
      expect(copyButton().dataset.copied).toBe('true');

      // And it still clears on its own schedule rather than never.
      vi.advanceTimersByTime(600);
      expect(copyButton().dataset.copied).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('never renames the button it is announcing about', async () => {
    /*
     * Mutating the accessible name of the element that currently has focus is
     * announced inconsistently across screen readers, and is the classic wrong
     * fix for "how does the reader know it worked". The live region does that
     * job; the name is stable.
     */
    const user = setupUser();
    render(<DocContent hast={trees.plain as never} />);
    const before = copyButton().getAttribute('aria-label');

    await user.click(copyButton());

    expect(copyButton().getAttribute('aria-label')).toBe(before);
    expect(before).toBe('Copy code from app/page.tsx');
  });
});
