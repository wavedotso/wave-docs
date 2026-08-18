/**
 * `@waveso/docs/highlighter` — a public subpath that had no tests at all.
 *
 * It is the escape hatch for grammars and themes outside the curated set, so it
 * is the module a consumer reaches for precisely when the defaults do not fit —
 * and the least likely to be exercised by anything else in this repository. The
 * `cfg`/`conf` alias it exists for could regress into `Language 'cfg' not
 * found` and nothing here would have said so.
 *
 * The instances are cached process-wide and each one loads real grammars, so
 * these are deliberately few: the cache identity, the two refusals, and the
 * alias.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DOCS_LANGS,
  DEFAULT_DOCS_THEMES,
  createDocsHighlighter,
} from './highlighter.js';

describe('createDocsHighlighter', () => {
  it('returns one instance per option set', async () => {
    const a = createDocsHighlighter({ langs: ['ts'] });
    const b = createDocsHighlighter({ langs: ['ts'] });

    // The same promise, not merely an equal result: the point of the cache is
    // that a second call costs nothing, and two awaited instances would compare
    // unequal while still having loaded every grammar twice.
    expect(a).toBe(b);
    await a;
  });

  it('shares an instance across an equal language list written differently', async () => {
    const a = createDocsHighlighter({ langs: ['ts', 'json'] });
    const b = createDocsHighlighter({ langs: ['json', 'ts', 'ts'] });

    expect(a).toBe(b);
    await a;
  });

  it('shares an instance across an equal theme pair written differently', async () => {
    /*
     * ⚠️ IT DID NOT. The key was `JSON.stringify({ langs, themes })`, and
     * `JSON.stringify` preserves insertion order — so `{ light, dark }` and
     * `{ dark, light }`, the same pair written two ways, produced two keys and
     * two whole Shiki instances, each loading every grammar. `langs` was sorted
     * for exactly this reason; the object beside it was not.
     */
    const a = createDocsHighlighter({
      langs: ['ts'],
      themes: { light: 'github-light', dark: 'github-dark' },
    });
    const b = createDocsHighlighter({
      langs: ['ts'],
      themes: { dark: 'github-dark', light: 'github-light' },
    });

    expect(a).toBe(b);
    await a;
  });

  it('refuses an unknown language, and names the supported set', () => {
    // Throws rather than degrading: the set is fixed at build time, so a typo
    // in config is a build bug, and shipping unhighlighted code silently is the
    // failure this package exists to avoid.
    expect(() =>
      createDocsHighlighter({ langs: ['klingon' as never] }),
    ).toThrowError(
      expect.objectContaining({ code: 'unknown-language' }) as Error,
    );
    expect(() => createDocsHighlighter({ langs: ['klingon' as never] })) //
      .toThrow(/typescript/);
  });

  it('refuses an unknown theme, and names the supported set', () => {
    expect(() =>
      createDocsHighlighter({
        themes: { light: 'solarised' as never, dark: 'github-dark' },
      }),
    ).toThrowError(expect.objectContaining({ code: 'unknown-theme' }) as Error);
  });

  it('highlights a ```cfg fence, which is the alias it exists for', async () => {
    /*
     * ⚠️ SHIKI RESOLVES A FENCE AGAINST A GRAMMAR'S OWN ALIASES, not against the
     * keys of the loader map — so registering `ini` under a `cfg` key does not
     * make ```cfg work, and it threw `Language 'cfg' not found`. The loader
     * rewrites the grammar's `aliases` instead, which is invisible to any test
     * that only checks the map's keys.
     *
     * It matters because the fence an author types follows the filename: a
     * FiveM docs site is mostly `server.cfg`, and nobody writes ```ini above a
     * file called `server.cfg`.
     */
    const highlighter = await createDocsHighlighter({ langs: ['ini', 'cfg'] });

    for (const lang of ['ini', 'cfg', 'conf']) {
      const html = highlighter.codeToHtml('key = value', {
        lang,
        themes: DEFAULT_DOCS_THEMES,
      });
      // Token spans, not a plain block: a fallback renders the text with none.
      expect(html, lang).toContain('<span');
      expect(html, lang).toContain('key');
    }
  }, 30_000);

  it('loads every default language it advertises', async () => {
    // `DEFAULT_DOCS_LANGS` is a published list — the README prints it — and an
    // entry that is not a real loader key fails only when someone writes that
    // fence.
    const highlighter = await createDocsHighlighter();

    for (const lang of DEFAULT_DOCS_LANGS) {
      expect(() =>
        highlighter.codeToHtml('x', { lang, themes: DEFAULT_DOCS_THEMES }),
      ).not.toThrow();
    }
  }, 30_000);
});
