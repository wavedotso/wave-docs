/**
 * The drawer's wiring, and only its wiring.
 *
 * jsdom has no `showModal`, no `:modal`, no focus management and no inertness,
 * so the shim in `vitest.setup.dom.ts` does attribute bookkeeping and nothing
 * else. Asserting focus or Escape here would be asserting that the shim works.
 * Those four behaviours are the reason this is a `<dialog>` rather than a
 * `popover`, and they are tested in `nav.browser.test.tsx` against a real
 * engine.
 *
 * What is worth pinning here is everything that fails *silently*: an effect
 * that stops closing the drawer on navigation, and a `command` fallback that
 * either never installs or installs on top of the native implementation.
 */

import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DocNavNode } from '../types.js';
import { DOCS_NAV_ID, DocsNav } from './nav.js';

const NAV: DocNavNode[] = [
  { type: 'page', title: 'Guide', href: '/docs/guide', slug: 'guide' },
  { type: 'page', title: 'API', href: '/docs/api', slug: 'api' },
];

/** Whether the native `command` implementation is present, restorable. */
function withCommandSupport(present: boolean): () => void {
  const had = 'command' in HTMLButtonElement.prototype;
  if (present && !had) {
    Object.defineProperty(HTMLButtonElement.prototype, 'command', {
      value: '',
      configurable: true,
      writable: true,
    });
    return () => {
      delete (HTMLButtonElement.prototype as { command?: unknown }).command;
    };
  }
  if (!present && had) {
    delete (HTMLButtonElement.prototype as { command?: unknown }).command;
    return () => {
      Object.defineProperty(HTMLButtonElement.prototype, 'command', {
        value: '',
        configurable: true,
        writable: true,
      });
    };
  }
  return () => undefined;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DocsNav', () => {
  it('renders one dialog, carrying the id the trigger commands', () => {
    const { container } = render(<DocsNav nav={NAV} pathname="/docs/guide" />);

    const dialogs = container.querySelectorAll('dialog');
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]?.id).toBe(DOCS_NAV_ID);
    expect(dialogs[0]?.getAttribute('closedby')).toBe('any');
    expect(dialogs[0]?.getAttribute('aria-label')).toBe('Documentation');
  });

  it('closes itself when the route changes', () => {
    const { container, rerender } = render(
      <DocsNav nav={NAV} pathname="/docs/guide" />,
    );
    const dialog = container.querySelector('dialog');
    if (dialog === null) throw new Error('expected a dialog');

    dialog.showModal();
    expect(dialog.hasAttribute('open')).toBe(true);

    /*
     * The whole reason this component has a client boundary. A link click
     * inside the drawer routes without a document load, so nothing native
     * dismisses it — the reader taps a page and watches the drawer sit on top
     * of the page they asked for.
     */
    rerender(<DocsNav nav={NAV} pathname="/docs/api" />);

    expect(dialog.hasAttribute('open')).toBe(false);
  });

  it('leaves an open drawer alone when the route has not changed', () => {
    const { container, rerender } = render(
      <DocsNav nav={NAV} pathname="/docs/guide" />,
    );
    const dialog = container.querySelector('dialog');
    if (dialog === null) throw new Error('expected a dialog');

    dialog.showModal();
    // A re-render for any other reason — a parent state change, a nav refetch
    // — must not slam the drawer shut under the reader's thumb.
    rerender(<DocsNav nav={[...NAV]} pathname="/docs/guide" />);

    expect(dialog.hasAttribute('open')).toBe(true);
    dialog.close();
  });

  describe('the command fallback', () => {
    it('is not installed where the browser implements command', () => {
      const restore = withCommandSupport(true);
      const addEventListener = vi.spyOn(document, 'addEventListener');
      try {
        render(<DocsNav nav={NAV} pathname="/docs/guide" />);

        expect(
          addEventListener.mock.calls.filter(([type]) => type === 'click'),
        ).toHaveLength(0);
      } finally {
        restore();
      }
    });

    it('opens and closes the drawer where the browser does not', () => {
      const restore = withCommandSupport(false);
      try {
        const { container } = render(
          <DocsNav nav={NAV} pathname="/docs/guide" />,
        );
        const dialog = container.querySelector('dialog');
        if (dialog === null) throw new Error('expected a dialog');

        // A trigger rendered outside this component, exactly as the header
        // renders it — which is why the listener is delegated on `document`
        // rather than bound to a button this component can see.
        const trigger = document.createElement('button');
        trigger.setAttribute('command', 'show-modal');
        trigger.setAttribute('commandfor', DOCS_NAV_ID);
        document.body.append(trigger);

        trigger.click();
        expect(dialog.hasAttribute('open')).toBe(true);

        const close = container.querySelector<HTMLButtonElement>(
          'button.wave-docs-layout__drawer-close',
        );
        close?.click();
        expect(dialog.hasAttribute('open')).toBe(false);

        trigger.remove();
      } finally {
        restore();
      }
    });

    it('ignores a command aimed at somebody else', () => {
      const restore = withCommandSupport(false);
      try {
        const { container } = render(
          <DocsNav nav={NAV} pathname="/docs/guide" />,
        );
        const dialog = container.querySelector('dialog');

        const other = document.createElement('button');
        other.setAttribute('command', 'show-modal');
        other.setAttribute('commandfor', 'someone-elses-dialog');
        document.body.append(other);

        other.click();

        // Without the `commandfor` check this fallback would hijack every
        // command button on the consumer's page.
        expect(dialog?.hasAttribute('open')).toBe(false);
        other.remove();
      } finally {
        restore();
      }
    });
  });
});
