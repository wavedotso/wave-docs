'use client';

/**
 * "Copy page" — this page's markdown, on the clipboard.
 *
 * ⚠️ IT SLICES THE PAGE OUT OF `llms-full.txt`, AND THAT IS WHAT MAKES IT FREE
 * OF CONFIGURATION. Per-page `.md` URLs were the first design and they cost
 * five steps: a route file, a rewrite, `output: 'export'` made conditional, a
 * post-build script, and a placeholder the export forces which the script then
 * deletes. Two of those fail *silently* — a rewrite that stops matching, and a
 * folder name that turns out to be a private one. For a package whose pitch is
 * "point it at a folder of markdown", that is the wrong trade.
 *
 * `llms-full.txt` is a fixed path, which is the whole difference. All of that
 * pain came from `*.md` being a *pattern* the docs catch-all already owns; a
 * fixed path needs no rewrite, so it renders on demand in development and
 * prerenders into a static export with one route file — the same cost as the
 * search index. The corpus is a file the package ships for agents anyway.
 *
 * ⚠️ AND IT HOLDS NO MARKDOWN OF ITS OWN. Embedding each page's source in its
 * own HTML was the other alternative: it taxes every reader on every page load
 * for a control most never press. A fetch on click costs nothing until
 * somebody clicks, and the result is cached for the rest of the visit.
 *
 * The cost is one download of the whole corpus on the first click — 40 KB
 * gzipped for twenty pages, and roughly 2 MB at a thousand, which is
 * Stripe-scale. It is on *click*, not on load, so page weight and first paint
 * are untouched either way, and the label's pulse covers the wait.
 */

import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { CODE_ICON_PATHS } from '../code-frame.js';
import { writeClipboard } from './clipboard.js';

/** What the button is showing. */
type CopyState = 'idle' | 'loading' | 'copied' | 'failed';

export interface DocsCopyPageProps {
  /**
   * The page's route, e.g. `'/guides/links'`. Used to find this page inside
   * the corpus.
   *
   * Passed in rather than read from `usePathname`, so the component works in
   * any adapter and in a test — and so a host rendering it outside the docs
   * tree cannot accidentally point it at a route the corpus has no entry for.
   */
  href: string;
  /**
   * Where the corpus lives. Defaults to `'/llms-full.txt'`.
   *
   * Set it when the docs are mounted under a base path, or when the route
   * lives somewhere else.
   */
  corpusUrl?: string | undefined;
  /** Button text. Default `'Copy page'`. */
  label?: string | undefined;
  /** Announced and shown after a successful copy. Default `'Copied'`. */
  copiedLabel?: string | undefined;
  /**
   * Announced and shown when the copy fails. Default
   * `'Press Ctrl+C to copy'` — an instruction, because the most common
   * failure leaves the text selected and the reader able to finish the job.
   */
  failedLabel?: string | undefined;
}

/**
 * A button that puts this page's markdown on the clipboard.
 *
 * ```tsx
 * <DocsCopyPage href="/guides/links" />
 * ```
 *
 * A primitive rather than something the layout injects: where a page title
 * sits, and whether a page wants this at all, is the host's decision — the
 * same reason `DocsToc` and `DocsSidebar` are exported instead of assumed.
 */
export function DocsCopyPage({
  href,
  corpusUrl = '/llms-full.txt',
  label = 'Copy page',
  copiedLabel = 'Copied',
  failedLabel = 'Press Ctrl+C to copy',
}: DocsCopyPageProps): ReactNode {
  const [state, setState] = useState<CopyState>('idle');
  /*
   * The fetched markdown, kept across clicks.
   *
   * A ref and not state: nothing renders from it, and holding it in state
   * would re-render the button the moment the fetch resolves — before the
   * clipboard write it exists to feed.
   */
  const cached = useRef<string | undefined>(undefined);
  const timer = useRef<number | undefined>(undefined);
  /*
   * The corpus is not being served, so there is nothing this button can ever
   * do. It renders on the server either way — that decision is `copyPage`'s,
   * and the file's absence is only knowable from the browser.
   */
  const [missing, setMissing] = useState(false);

  const onClick = useCallback(async () => {
    if (state === 'loading') return;
    if (timer.current !== undefined) clearTimeout(timer.current);

    let text = cached.current;
    if (text === undefined) {
      /*
       * ⚠️ A STATE FOR THE FETCH, OR THE OUTCOME IS THE FIRST THING A READER
       * SEES. A cold click crosses the network, and with nothing between the
       * press and the result the button sat idle and then flashed a ✗ or a ✓ —
       * which reads as the button having failed *at* the click rather than
       * having been working. It is the label that animates rather than a
       * fourth glyph: a spinner is another icon in a bundle that exists to be
       * small, and the two the button already owns say what happened.
       */
      setState('loading');
      /*
       * ⚠️ NO THROW HERE, AND NOT ONLY BECAUSE `docsError` IS THIS PACKAGE'S
       * ONLY THROW. A missing file is a wiring mistake — `writeDocsMarkdown`
       * did not run — and the reader who clicked can do nothing about it. The
       * failure they can act on is the one the button shows; an exception
       * crossing a click handler reaches the console and the error overlay,
       * where it looks like a bug in their browser.
       */
      const response = await fetch(corpusUrl).catch(() => undefined);
      if (response === undefined) {
        /*
         * ⚠️ A NETWORK FAILURE IS NOT A MISSING ROUTE, AND ONLY ONE OF THEM IS
         * PERMANENT. Offline, or a request that never completed: the wiring is
         * fine and the next press may well work, so the button says so and
         * stays.
         */
        setState('failed');
        timer.current = window.setTimeout(() => setState('idle'), 2000);
        return;
      }
      if (!response.ok) {
        /*
         * The corpus route was never added. Nothing the reader can act on, and
         * nothing they should see: the button removes itself rather than
         * showing a control that will fail every time it is pressed.
         */
        setMissing(true);
        return;
      }
      text = sliceCorpus(await response.text(), href);
      if (text === undefined) {
        setState('failed');
        timer.current = window.setTimeout(() => setState('idle'), 2000);
        return;
      }
      cached.current = text;
    }

    setState((await writeClipboard(text)) ? 'copied' : 'failed');
    timer.current = window.setTimeout(() => setState('idle'), 2000);
  }, [corpusUrl, href, state]);

  // `loading` keeps the copy glyph: the icon is not what changed, the label is.
  const icon = state === 'copied' ? 'check' : state === 'failed' ? 'x' : 'copy';
  const text =
    state === 'copied'
      ? copiedLabel
      : state === 'failed'
        ? failedLabel
        : undefined;

  if (missing) return null;

  return (
    <button
      type="button"
      className="wave-docs-copy-page"
      data-state={state}
      onClick={onClick}
    >
      <svg
        className="wave-docs-copy-page__icon"
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {CODE_ICON_PATHS[icon].map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
      {label}
      {/*
       * The state change is a colour and a glyph, neither of which a screen
       * reader reports. `aria-live` on a region that is empty at rest
       * announces the outcome once, without renaming the button mid-press —
       * which is what putting the result in the label would do.
       */}
      <span className="wave-docs-copy-page__status" aria-live="polite">
        {text ?? ''}
      </span>
    </button>
  );
}

/**
 * One page's markdown, out of the concatenated corpus.
 *
 * ⚠️ MATCHED ON THE `<!-- source: … -->` MARKER `buildLlmsFullTxt` WRITES, AND
 * BY SUFFIX RATHER THAN BY EQUALITY. The marker carries an absolute URL when
 * the site has a `siteUrl` and a root-relative path when it does not, and the
 * button only knows the route — so the comparison has to tolerate the origin
 * being there or not. The leading `/` keeps `/api` from matching `/legacy/api`.
 */
function sliceCorpus(corpus: string, href: string): string | undefined {
  const route = href.replace(/\/$/, '') || '/';
  const markers = [...corpus.matchAll(/^<!-- source: (\S+) -->$/gm)];

  const index = markers.findIndex((marker) => {
    const source = marker[1];
    if (source === undefined) return false;
    return source === route || source.endsWith(route);
  });
  const marker = markers[index];
  if (marker?.index === undefined) return undefined;

  const start = marker.index + marker[0].length;
  const next = markers[index + 1];
  const end = next?.index ?? corpus.length;

  // The `---` separator belongs to neither page.
  return corpus
    .slice(start, end)
    .replace(/\n+---\n*$/, '')
    .trim();
}
