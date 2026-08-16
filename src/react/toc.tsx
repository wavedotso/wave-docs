'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { DOCS_CONTENT_ID } from '../docs-content-id.js';
import type { TocEntry } from '../types.js';

export interface DocsTocProps {
  /** Headings from `@waveso/docs/render`, already nested by depth. */
  entries: TocEntry[];
  /** Accessible name for the landmark. */
  label?: string | undefined;
  /**
   * Region of the viewport that counts as "current", as an
   * `IntersectionObserver` root margin. The default reserves 80px for a sticky
   * header and ignores the bottom 60% of the screen, so the active entry
   * tracks what you are reading rather than what has scrolled into view.
   *
   * Only `px` and `%` are legal here — `IntersectionObserver` throws on any
   * other unit, `rem` included.
   */
  rootMargin?: string | undefined;
  /** Text for the back-to-top link. */
  topLabel?: string | undefined;
  className?: string | undefined;
}

const DEFAULT_ROOT_MARGIN = '-80px 0px -60% 0px';

/**
 * How many frames to keep looking for headings that are not in the document
 * yet. ~1s at 60Hz, which covers a `<Suspense>` boundary resolving or a
 * tabs/accordion wrapper revealing its panel. Bounded because the loop must
 * also terminate on a page whose headings genuinely never arrive.
 */
const MAX_ATTACH_FRAMES = 60;

function flattenTocIds(entries: TocEntry[]): string[] {
  const ids: string[] = [];
  const walk = (list: TocEntry[]) => {
    for (const entry of list) {
      ids.push(entry.id);
      walk(entry.children);
    }
  };
  walk(entries);
  return ids;
}

/**
 * On-this-page navigation with scrollspy.
 *
 * The ids come from the same `rehype-slug` pass that annotated the document, so
 * `getElementById` matches by construction — no second slugging pass to drift
 * out of sync on duplicate headings.
 *
 * Scrolling itself is left to the browser: the links are real anchors, and
 * smooth scrolling is applied in CSS under
 * `@media (prefers-reduced-motion: no-preference)`. Doing it in JavaScript
 * means reimplementing that check, and getting it wrong makes people ill.
 */
export function DocsToc({
  entries,
  label = 'On this page',
  rootMargin = DEFAULT_ROOT_MARGIN,
  className,
  topLabel = 'Back to top',
}: DocsTocProps): ReactNode {
  const ids = useMemo(() => flattenTocIds(entries), [entries]);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);

  // Forget the highlight when the document changes under us. On a client-side
  // navigation this component keeps its instance, and heading ids repeat across
  // pages — `#install` is on half of them — so a retained active id lights up an
  // entry on a page the reader has not scrolled a pixel of. That is the same lie
  // the server render refuses to tell. Resetting during render is the supported
  // way to react to a changed prop, and `sidebar.tsx` re-syncs its groups the
  // same way; the observer re-fires for every newly observed target, so the real
  // current entry comes straight back.
  const lastIds = useRef(ids);
  if (lastIds.current !== ids) {
    lastIds.current = ids;
    setActiveId(undefined);
  }

  useEffect(() => {
    // Bail out where there is nothing to observe or no observer to do it —
    // jsdom and older browsers both land here.
    if (ids.length === 0 || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (records) => {
        for (const record of records) {
          if (record.isIntersecting) {
            visible.add(record.target.id);
          } else {
            visible.delete(record.target.id);
          }
        }
        // First in document order, not first to fire: the callback batches
        // entries in arbitrary order, and "current" means the topmost one.
        const next = ids.find((id) => visible.has(id));
        if (next !== undefined) {
          setActiveId(next);
        }
      },
      { rootMargin, threshold: 0 },
    );

    /*
     * Retry while nothing resolves. The TOC and the document it describes are
     * separate subtrees, so the headings are not guaranteed to exist when this
     * effect runs — a `<Suspense>` boundary the TOC renders outside of, or a
     * tabs wrapper that mounts its panel late, both leave `getElementById`
     * returning `null` on the first pass. Give up there and the observer holds
     * nothing for the life of the page: no entry ever becomes current, and
     * nothing throws or logs, so it reads as "the highlight just doesn't work".
     *
     * Only the all-or-nothing case retries. A partial resolve means the content
     * is mounted and the missing ids are an authoring error — a TOC entry for a
     * heading the page does not have — which no amount of waiting fixes.
     */
    let frame: number | undefined;
    let framesLeft = MAX_ATTACH_FRAMES;

    const attach = (): void => {
      let attached = 0;
      for (const id of ids) {
        const element = document.getElementById(id);
        if (element !== null) {
          observer.observe(element);
          attached += 1;
        }
      }
      if (
        attached === 0 &&
        framesLeft > 0 &&
        typeof requestAnimationFrame === 'function'
      ) {
        framesLeft -= 1;
        frame = requestAnimationFrame(attach);
      }
    };
    attach();

    return () => {
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
      observer.disconnect();
    };
  }, [ids, rootMargin]);

  if (entries.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label={label}
      className={['wave-docs-toc', className].filter(Boolean).join(' ')}
    >
      <TocList entries={entries} activeId={activeId} onSelect={setActiveId} />
      {/*
       * A fragment link, not a scroll button, and the difference is the whole
       * reason it is correct here and nowhere else in the category: `docs.Page`
       * puts `tabIndex={-1}` on that article, so following this moves FOCUS as
       * well as the scroll position. A floating `scrollTo(0)` control returns
       * the page to the top and leaves the keyboard caret at the bottom of the
       * document, which is worse than not offering it.
       *
       * The id comes from the shared constant, so it cannot drift from the
       * one `SkipLink` targets and `docs.Page` emits.
       */}
      <a className="wave-docs-toc__top" href={`#${DOCS_CONTENT_ID}`}>
        {topLabel}
      </a>
    </nav>
  );
}

interface TocListProps {
  entries: TocEntry[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
}

function TocList({ entries, activeId, onSelect }: TocListProps): ReactNode {
  return (
    <ul className="wave-docs-toc__list">
      {entries.map((entry) => (
        <li key={entry.id} className="wave-docs-toc__item">
          <a
            className="wave-docs-toc__link"
            href={`#${entry.id}`}
            data-depth={entry.depth}
            // `location`, not `page`: the target is a section of the current
            // page, and `page` would claim this link *is* the current page.
            aria-current={entry.id === activeId ? 'location' : undefined}
            // The observer needs a scroll to fire; without this the highlight
            // lags a click that barely moves the page.
            onClick={() => onSelect(entry.id)}
          >
            {entry.text}
          </a>
          {entry.children.length > 0 ? (
            <TocList
              entries={entry.children}
              activeId={activeId}
              onSelect={onSelect}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
