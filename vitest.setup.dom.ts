import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * Unmount between tests. Testing Library does not do this automatically outside
 * its own globals setup, and a leaked tree keeps its focus and its event
 * listeners — which makes a focus-trap test pass for the wrong reason.
 */
afterEach(() => {
  cleanup();
});

/**
 * jsdom implements no `IntersectionObserver`, and the TOC's scrollspy is built
 * on one. Without a stand-in the component throws on mount, so the choice is a
 * stub or no coverage at all.
 *
 * This one records its callback so a test can drive it: `triggerIntersection`
 * plays the browser's part and reports which headings are on screen. That keeps
 * the assertion about *our* logic — which entry becomes current — rather than
 * about a real observer's timing, which jsdom could not reproduce anyway.
 */
function toThresholds(
  threshold: number | number[] | undefined,
): readonly number[] {
  if (threshold === undefined) {
    return [];
  }
  return Array.isArray(threshold) ? threshold : [threshold];
}

const observers = new Set<{
  callback: IntersectionObserverCallback;
  instance: IntersectionObserver;
  elements: Set<Element>;
}>();

class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  /** As passed by the component under test, so a test can assert it. */
  readonly rootMargin: string;
  readonly thresholds: readonly number[];
  private readonly elements = new Set<Element>();

  constructor(
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    // Not a parameter property: nothing reads it through `this`, the
    // registry closes over it directly, and Biome flags the unused member.
    this.rootMargin = options?.rootMargin ?? '';
    this.thresholds = toThresholds(options?.threshold);
    observers.add({ callback, instance: this, elements: this.elements });
  }

  observe(target: Element): void {
    this.elements.add(target);
  }

  unobserve(target: Element): void {
    this.elements.delete(target);
  }

  disconnect(): void {
    this.elements.clear();
    for (const entry of observers) {
      if (entry.instance === this) {
        observers.delete(entry);
      }
    }
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

/**
 * Report `visibleIds` as the elements currently intersecting, to every live
 * observer. Ids rather than elements so a test reads as the situation it is
 * describing: "the reader is looking at `#install`".
 */
export function triggerIntersection(visibleIds: readonly string[]): void {
  for (const { callback, instance, elements } of observers) {
    const entries = [...elements].map((target) => {
      const id = target.getAttribute('id') ?? '';
      const isIntersecting = visibleIds.includes(id);
      return {
        target,
        isIntersecting,
        intersectionRatio: isIntersecting ? 1 : 0,
        // Enough of the shape for a scrollspy that sorts by position; jsdom
        // reports every rect as zero, so a test that needs order supplies it
        // through the id list instead.
        boundingClientRect: target.getBoundingClientRect(),
        intersectionRect: target.getBoundingClientRect(),
        rootBounds: null,
        time: 0,
      } as IntersectionObserverEntry;
    });
    callback(entries, instance);
  }
}

/**
 * The observers currently registered, newest last.
 *
 * For asserting what a component *asked* for — `rootMargin` decides when a
 * heading counts as current, and it is the one number in a scrollspy worth
 * pinning. Unreadable without this, since jsdom reports every rect as zero.
 */
export function activeIntersectionObservers(): IntersectionObserver[] {
  return [...observers].map(({ instance }) => instance);
}

/** Drop every registered observer. Call between tests that mount a TOC. */
export function resetIntersectionObservers(): void {
  observers.clear();
}

vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

afterEach(() => {
  resetIntersectionObservers();
});
