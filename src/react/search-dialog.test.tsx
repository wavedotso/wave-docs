/**
 * The dialog's open state lives behind `useState` and a portal, and this repo
 * has no DOM environment — `renderToStaticMarkup` reaches the trigger and
 * nothing beyond it. So the results list is covered where it can be: at the
 * type level, which is where the bug was.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { SearchLinkProps } from './search-dialog.js';
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

  it('lets an injected link take the tabIndex the listbox requires', () => {
    // `next/link` renders a bare `<a href>`, which the focus trap counts as a
    // tab stop unless it carries `tabindex="-1"` — and the dialog can only pass
    // that if the prop type admits it. Without this member the dialog's own
    // `tabIndex={-1}` on the `<Link>` branch is a compile error, which is the
    // guard: `tsc --noEmit` fails before this test ever runs.
    const props: SearchLinkProps = {
      href: '/docs/api',
      tabIndex: -1,
      children: null,
    };
    expect(props.tabIndex).toBe(-1);
  });
});
