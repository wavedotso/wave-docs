/**
 * The budget file itself — that it covers what ships, and that it can fail.
 *
 * `pnpm size` is the measurement; this is the part that can run in the fast
 * suite. A budget file is a promise about bytes, and it rots in two silent
 * ways: a new client component lands with no entry, and every entry gets a
 * round number nobody can argue with because nobody wrote down why.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.join(import.meta.dirname, '..');
const DIST_REACT = path.join(ROOT, 'dist', 'react');

interface Budget {
  max: number;
  note: string;
}

const budgets = JSON.parse(
  readFileSync(path.join(ROOT, 'size-budget.json'), 'utf8'),
) as Record<string, Record<string, Budget>>;

/** Every `'use client'` module in the built output. */
function clientEntries(): string[] {
  return readdirSync(DIST_REACT)
    .filter((name) => name.endsWith('.js'))
    .filter((name) =>
      /^\s*(['"])use client\1/.test(
        readFileSync(path.join(DIST_REACT, name), 'utf8'),
      ),
    )
    .map((name) => name.replace(/\.js$/, ''));
}

describe('the size budget', () => {
  it('covers all three axes', () => {
    // Bundle size alone cannot defend this package's argument: the payload
    // ratio is the honest price of shipping a tree, and the render ratio is
    // what the highlighter costs. Dropping either leaves a budget that passes
    // while the claim it protects stops being true.
    expect(Object.keys(budgets).sort()).toEqual([
      'client',
      'payload',
      'render',
    ]);
  });

  it('explains every number, in a sentence a reviewer can argue with', () => {
    /*
     * A reviewer seeing `1.32` with no explanation approves it. One seeing
     * "if this exceeds it, restate the architecture argument — do not raise
     * the budget" asks a question. That is the entire purpose of `note`, and
     * a placeholder defeats it.
     */
    for (const [axis, entries] of Object.entries(budgets)) {
      for (const [name, budget] of Object.entries(entries)) {
        expect(budget.max, `${axis}/${name}`).toBeGreaterThan(0);
        expect(budget.note.length, `${axis}/${name} note`).toBeGreaterThan(60);
        expect(budget.note, `${axis}/${name} note`).not.toMatch(/TODO/);
      }
    }
  });

  it.skipIf(!existsSync(DIST_REACT))(
    'budgets every client component that ships',
    () => {
      /*
       * The failure this exists for: a new `'use client'` module lands, ships
       * to every reader who imports it, and is measured by nothing. The
       * measurement script fails on an unbudgeted entry too — this is the copy
       * that runs in the fast suite, where it is seen on the commit that adds
       * the component rather than in CI ten minutes later.
       */
      const shipped = clientEntries().sort();
      expect(shipped.length).toBeGreaterThan(0);
      expect(Object.keys(budgets.client ?? {}).sort()).toEqual(shipped);
    },
  );
});
