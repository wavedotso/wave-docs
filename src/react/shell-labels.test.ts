import { describe, expect, it } from 'vitest';

import type { DocsLabels } from './shell-labels.js';
import { DEFAULT_DOCS_LABELS, resolveLabels } from './shell-labels.js';

/**
 * The merge, on its own, because the shell cannot see it.
 *
 * `layout.test.tsx` renders a partial `labels` map and asserts the untranslated
 * strings keep their English — and that test passes with this function replaced
 * by `labels as Required<DocsLabels>`, because `SkipLink`, `DocsNav` and
 * `DocsSidebar` each carry a default of their own for the standalone case. Two
 * layers of defaults is right (each component is usable alone), but it means
 * the shell is the wrong place to assert which layer answered.
 *
 * So: the wiring is `layout.test.tsx`, and the arithmetic is here.
 */
describe('resolveLabels', () => {
  it('returns the defaults for no map at all', () => {
    expect(resolveLabels(undefined)).toEqual(DEFAULT_DOCS_LABELS);
  });

  it('fills every unmentioned key', () => {
    const resolved = resolveLabels({ openNav: 'Abrir navegação' });

    expect(resolved.openNav).toBe('Abrir navegação');
    expect(resolved.nav).toBe(DEFAULT_DOCS_LABELS.nav);
    expect(resolved.closeNav).toBe(DEFAULT_DOCS_LABELS.closeNav);
    expect(resolved.skipToContent).toBe(DEFAULT_DOCS_LABELS.skipToContent);
  });

  it('treats an explicit undefined as unset, not as a blank name', () => {
    /*
     * `exactOptionalPropertyTypes` is on, so this is the shape a host produces
     * by spreading a partially-filled config — and the failure it prevents is
     * an `aria-label` of `undefined`, which is a control with no accessible
     * name at all rather than one in the wrong language.
     */
    const partial: DocsLabels = { nav: 'Documentação', closeNav: undefined };

    expect(resolveLabels(partial)).toEqual({
      ...DEFAULT_DOCS_LABELS,
      nav: 'Documentação',
    });
  });

  it('replaces every key when every key is given', () => {
    const all = {
      nav: 'Documentação',
      openNav: 'Abrir navegação',
      closeNav: 'Fechar navegação',
      skipToContent: 'Ir para o conteúdo',
    };

    expect(resolveLabels(all)).toEqual(all);
    // Nothing English survives — the assertion the shell test cannot make on
    // its own, because a component default would answer for a dropped key.
    expect(Object.values(resolveLabels(all))).not.toContain(
      DEFAULT_DOCS_LABELS.nav,
    );
  });

  it('keeps an empty string, because that is a decision a host made', () => {
    // `?? `, not `||`. A host that deliberately empties a label — a nav whose
    // name is carried by a visible heading instead — must not be overridden
    // back to English.
    expect(resolveLabels({ nav: '' }).nav).toBe('');
  });
});
