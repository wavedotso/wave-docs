/**
 * The last hop of the copy runtime's two labels: `createDocsRoute` → the page.
 *
 * ⚠️ WRITTEN BECAUSE A MUTATION SURVIVED. `code-runtime.test.tsx` renders
 * `DocContent` directly with `labels`, and `next.test.ts` renders a page to
 * static markup — so deleting the forward in `next.ts` broke neither. The
 * runtime announces at run time and renders nothing, so it is invisible to
 * markup; and a props assertion is what let `docs.Layout`'s search options ship
 * broken through two releases. This clicks the button and reads the live region,
 * with the route in the loop.
 *
 * In `src/react/` because that is the dom project's directory, and this needs a
 * DOM. It is the only test here that reaches for `../next.js`.
 */

import { render, screen } from '@testing-library/react';
import path from 'node:path';
import { isValidElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { userEvent } from '@testing-library/user-event';

import { createDocsRoute } from '../next.js';

const FIXTURE = path.join(
  import.meta.dirname,
  '..',
  '__fixtures__',
  'source',
  'labels',
);

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.execCommand = vi.fn(() => true);
  HTMLTextAreaElement.prototype.select = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('announces a copy in the language the route was configured in', async () => {
  const route = createDocsRoute({
    contentDir: FIXTURE,
    onBrokenLinks: 'ignore',
    labels: { copied: 'Copiado para a área de transferência.' },
  });

  // The page is a fragment of `<main>` and the TOC aside; the runtime lives in
  // the first, and the second wants an IntersectionObserver this does not need.
  const page = await route.IndexPage();
  if (!isValidElement<{ children?: unknown }>(page)) {
    throw new Error('expected `IndexPage` to return an element');
  }
  const [main] = Array.isArray(page.props.children)
    ? (page.props.children as unknown[])
    : [];
  if (!isValidElement(main)) {
    throw new Error('expected a main element');
  }

  // The user first, then the clipboard: `userEvent.setup()` installs its own
  // stub over anything written before it.
  const user = userEvent.setup();
  writeText = vi.fn(() => Promise.resolve());
  vi.stubGlobal('isSecureContext', true);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });

  render(main);

  await user.click(
    screen.getAllByRole('button', { name: /^Copy code/ })[0] as HTMLElement,
  );

  expect(writeText).toHaveBeenCalled();
  expect(document.querySelector('[role="status"]')?.textContent).toBe(
    'Copiado para a área de transferência.',
  );
});
