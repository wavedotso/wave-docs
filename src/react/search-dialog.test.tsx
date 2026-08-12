/**
 * The dialog's open state lives behind `useState` and a portal, and this repo
 * has no DOM environment — `renderToStaticMarkup` reaches the trigger and
 * nothing beyond it. So the results list is covered where it can be: at the
 * type level, which is where the bug was.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

// `SearchLinkProps` is gone. The dialog takes `DocsLinkComponent` — the one
// link contract the package publishes, which `sidebar.tsx` already used.
import type { DocsLinkProps } from './markdown-components.js';
import { SearchDialog } from './search-dialog.js';

describe('SearchDialog', () => {
  it('renders a trigger with the shortcut hint resolved after mount', () => {
    const html = renderToStaticMarkup(
      <SearchDialog
        indexUrl="/search-index.json"
        navigate={() => undefined}
        triggerLabel="Find"
      />,
    );

    expect(html).toContain('wave-docs-search-trigger');
    expect(html).toContain('Find');
    // The platform hint would disagree between server and client markup, so it
    // is empty until the effect runs.
    expect(html).not.toContain('wave-docs-search-trigger-kbd');
  });

  /**
   * ⚠️ THE COMPILER IS THE ASSERTION HERE, and this used to pretend otherwise.
   *
   * `next/link` renders a bare `<a href>`, which the focus trap counts as a tab
   * stop unless it carries `tabindex="-1"` — and the dialog can only pass that
   * if the prop type admits it. If it does not, the dialog's own
   * `tabIndex={-1}` on the `<Link>` branch fails to compile and `tsc --noEmit`
   * stops the build before this file is ever executed.
   *
   * The old version ended `expect(props.tabIndex).toBe(-1)` — asserting a
   * literal it had written two lines above, which cannot fail and reads as
   * coverage. The type annotation below is the whole test; the runtime check is
   * that the module imports.
   */
  it('accepts a link component carrying the tabIndex the listbox requires', () => {
    const props: DocsLinkProps = {
      href: '/docs/api',
      tabIndex: -1,
      children: null,
    };

    expect(SearchDialog).toBeTypeOf('function');
    expect(props.href).toBe('/docs/api');
  });
});
