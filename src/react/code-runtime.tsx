'use client';

/**
 * The nine hundred bytes that make every copy button on the page work.
 *
 * Private. `DocContent` mounts it, and only when the tree it was handed
 * actually contains a code frame — so a page with no fences ships none of
 * this rather than a component that mounts and finds nothing to do.
 *
 * ## One listener, not one component per block
 *
 * The buttons are plain server-rendered HTML with no React identity at all.
 * This attaches a single delegated `click` listener to `document` and one live
 * region to `<body>`, both behind a module-level ref count: the first instance
 * installs them, later instances increment and return, and the last one out
 * removes them. Two `DocContent`s on one page therefore copy once and announce
 * once — a bug nothing else would catch, because the second announcement is
 * only audible to a screen-reader user.
 *
 * The alternative every comparable package ships — mapping `pre` to a
 * `'use client'` component — puts one client reference and one hydration root
 * in the flight stream per fence, and drags the highlighted subtree across the
 * client boundary as children.
 */

import { useEffect } from 'react';

import { writeClipboard } from './clipboard.js';
import type { ReactNode } from 'react';

import {
  CODE_COPY_ATTRIBUTE,
  CODE_FRAME_ATTRIBUTE,
  CODE_READY_ATTRIBUTE,
} from '../code-frame.js';

/** How long the button shows its copied state. */
const COPIED_MS = 2000;

/**
 * Line classes whose text is not part of what the reader wanted.
 *
 * Empty today, and deliberately an array rather than an inline condition:
 * `@shikijs/transformers` lands at 0.3, and `'remove'` — the class it puts on
 * a deleted diff line — goes here. Copying deleted lines into somebody's
 * editor is the kind of failure that is discovered at run time, in their
 * project, days later.
 */
const SKIP_LINE_CLASSES: readonly string[] = [];

/** Marker classes whose lines carry trailing whitespace worth trimming. */
const TRIMMED_LINE_CLASSES: readonly string[] = [];

let refCount = 0;
let detach: (() => void) | undefined;

/** The two announcements, for a site that is not in English. */
export interface CodeRuntimeLabels {
  /** Announced after a successful copy. Default `'Copied to the clipboard.'` */
  copied?: string | undefined;
  /**
   * Announced after a failed one. Default
   * `'Copy failed. Select the code and press Control or Command + C.'`
   */
  copyFailed?: string | undefined;
}

const DEFAULT_COPIED = 'Copied to the clipboard.';
/*
 * What to do instead, not merely that it failed. The most common way to land
 * here is `next dev` on a phone over `http://192.168.x.x`, where there is no
 * secure context and no amount of retrying helps.
 */
const DEFAULT_COPY_FAILED =
  'Copy failed. Select the code and press Control or Command + C.';

/**
 * Module scope, beside `refCount`, because the listener is a singleton too.
 *
 * The runtime installs once per page however many `DocContent`s mount it, so
 * the messages belong to the installation rather than to a component — and two
 * mounts with different labels would be a page with two languages in it, which
 * is not a case worth code. First one in wins, and `refCount` says which.
 *
 * Spelled out rather than `Required<CodeRuntimeLabels>`: the props are declared
 * `string | undefined` for `exactOptionalPropertyTypes`, and `Required` strips
 * the `?` while leaving the `undefined` in the value type.
 */
let messages: { copied: string; copyFailed: string } = {
  copied: DEFAULT_COPIED,
  copyFailed: DEFAULT_COPY_FAILED,
};

/**
 * Mount the copy runtime. Renders nothing.
 *
 * Every hook of state lives in the DOM rather than in React: the button's
 * copied state is a `data-copied` attribute the stylesheet reads, and the
 * announcement is a live region. React owns none of these nodes, so nothing
 * re-renders and there is no state to get out of step with a page that was
 * server-rendered.
 */
export function DocsCodeRuntime({
  copied,
  copyFailed,
}: CodeRuntimeLabels = {}): ReactNode {
  useEffect(() => {
    refCount += 1;
    if (refCount === 1) {
      messages = {
        copied: copied ?? DEFAULT_COPIED,
        copyFailed: copyFailed ?? DEFAULT_COPY_FAILED,
      };
      detach = install();
    }

    return () => {
      refCount -= 1;
      if (refCount === 0) {
        detach?.();
        detach = undefined;
      }
    };
  }, [copied, copyFailed]);

  return null;
}

function install(): () => void {
  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  // Visually hidden rather than `display: none`, which most screen readers
  // ignore entirely — an announcement nobody hears is not an announcement.
  status.className = 'wave-docs-code__status';
  document.body.append(status);

  const onClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const button = target.closest(`[${CODE_COPY_ATTRIBUTE}]`);
    if (!(button instanceof HTMLElement)) return;

    const frame = button.closest(`[${CODE_FRAME_ATTRIBUTE}]`);
    const pre = frame?.querySelector('pre');
    if (pre === null || pre === undefined) return;

    void copy(readCode(pre), button, status);
  };

  document.addEventListener('click', onClick);
  /*
   * The button is `visibility: hidden` until this attribute exists — which is
   * also what keeps it out of the tab order. That is what stops a no-JS
   * reader, or anyone rendering the hast to a string, from meeting a control
   * that silently does nothing.
   */
  document.documentElement.setAttribute(CODE_READY_ATTRIBUTE, '');

  return () => {
    document.removeEventListener('click', onClick);
    document.documentElement.removeAttribute(CODE_READY_ATTRIBUTE);
    status.remove();
  };
}

/**
 * The text of a code block, as the author wrote it.
 *
 * ⚠️ NOT `pre.textContent`. Shiki emits one `<span class="line">` per line with
 * a literal `"\n"` text node between them, so `textContent` happens to be
 * right *today* — and stops being right the moment a transformer adds a line
 * that should not be copied, or a gutter of line numbers that should not be
 * either. Walking the lines is the same amount of code and survives both.
 */
function readCode(pre: Element): string {
  const lines = pre.querySelectorAll('.line');
  // No `.line` children is the excluded-fence shape: a bare `<pre>` Shiki
  // never touched, whose text is exactly what the author typed.
  if (lines.length === 0) return pre.textContent ?? '';

  const out: string[] = [];
  for (const line of lines) {
    const classes = line.className.split(/\s+/);
    if (classes.some((name) => SKIP_LINE_CLASSES.includes(name))) continue;

    const text = line.textContent ?? '';
    /*
     * Trailing whitespace is trimmed only on marked lines. Trimming every line
     * would eat the two trailing spaces that are a hard line break inside a
     * fenced markdown sample — a documentation site is the one place that
     * example gets written.
     */
    out.push(
      classes.some((name) => TRIMMED_LINE_CLASSES.includes(name))
        ? text.replace(/\s+$/, '')
        : text,
    );
  }
  return out.join('\n');
}

async function copy(
  text: string,
  button: HTMLElement,
  status: HTMLElement,
): Promise<void> {
  const copied = (await writeClipboard(text)) ? 'true' : 'false';

  /*
   * The one place a non-React writer touches DOM inside a React tree. It is
   * safe because React owns no state for these nodes and nothing re-renders
   * them — but it is the only such place, which is why it is called out here.
   */
  button.dataset.copied = copied;
  status.textContent =
    copied === 'true' ? messages.copied : messages.copyFailed;

  /*
   * ⚠️ THE PREVIOUS TIMER IS CANCELLED FIRST. The id used to be discarded, so
   * two copies inside `COPIED_MS` left two timers running and the first one
   * cleared the second's indicator early — press copy, press it again a second
   * later, and the tick vanishes after one second instead of two. Small, and
   * exactly the kind of thing a reader reads as "did that work?".
   *
   * Keyed on the button, so two frames on one page keep their own timers.
   */
  const existing = timers.get(button);
  if (existing !== undefined) window.clearTimeout(existing);

  timers.set(
    button,
    window.setTimeout(() => {
      timers.delete(button);
      button.removeAttribute('data-copied');
    }, COPIED_MS),
  );
}

/**
 * The pending "clear the indicator" timer per button.
 *
 * A `WeakMap`, so a button removed by a client-side navigation takes its entry
 * with it — this module is a page-lifetime singleton and a `Map` here would
 * hold every code block the reader ever copied from.
 */
const timers = new WeakMap<HTMLElement, number>();
