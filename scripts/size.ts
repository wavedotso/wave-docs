/**
 * Measure the three numbers this package's argument is made of, and fail when
 * one of them moves.
 *
 * The argument is: markdown becomes hast in Node, the browser gets no parser
 * and no highlighter, and the price is a slightly larger payload. Every clause
 * of that is a number, and until this script existed not one of them was
 * measured — the README carried a figure that contradicted a comment 185 lines
 * away in the same repository, and a Node floor that disagreed with
 * `package.json`.
 *
 * Three axes, because bundle size alone cannot defend any of it:
 *
 * 1. **Client bytes.** Each `'use client'` entry bundled standalone with React
 *    and Next external, gzipped. This is what a reader downloads.
 * 2. **Payload ratio.** brotli of `{hast, toc}` against brotli of the same tree
 *    serialised to HTML. The honest price of shipping a tree instead of a
 *    string, as a ratio so it is machine-independent — and it is the first
 *    number a skeptical reviewer asks for.
 * 3. **Render cost.** Milliseconds per page against the same corpus with every
 *    grammar excluded, so the highlighter's share is isolated from the
 *    machine's speed.
 *
 * Every budget in `size-budget.json` carries a `note`. A reviewer seeing
 * `1.15` with no explanation approves it; one seeing "if this exceeds 1.15 the
 * architecture argument needs restating, not the budget raising" asks a
 * question.
 *
 * ```bash
 * pnpm size            # measure, compare, exit 1 on a breach
 * pnpm size --write    # rewrite the budget file from what was measured
 * ```
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { toHtml } from 'hast-util-to-html';
import { rolldown } from 'rolldown';

import { createDocsRenderer } from '../dist/render.js';
import type { DocFile } from '../dist/types.js';

const ROOT = path.join(import.meta.dirname, '..');
const BUDGET_FILE = path.join(ROOT, 'size-budget.json');

interface Budget {
  /** The measured ceiling. */
  max: number;
  /** Why this number, and what to do when it is exceeded. */
  note: string;
}

interface BudgetFile {
  client: Record<string, Budget>;
  payload: Record<string, Budget>;
  render: Record<string, Budget>;
}

/* -------------------------------------------------------------------------
 * Axis 1 — client bytes
 * ---------------------------------------------------------------------- */

/**
 * Every `'use client'` module in `dist/react`, read from the built output.
 *
 * Discovered rather than listed: a hand-maintained list is one a new client
 * component is added without, which is exactly the component whose weight
 * nobody notices.
 */
function clientEntries(): string[] {
  const dir = path.join(ROOT, 'dist', 'react');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.js'))
    .filter((name) =>
      /^\s*(['"])use client\1/.test(readFileSync(path.join(dir, name), 'utf8')),
    )
    .map((name) => name.replace(/\.js$/, ''))
    .sort();
}

async function measureClient(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};

  for (const entry of clientEntries()) {
    const bundle = await rolldown({
      input: path.join(ROOT, 'dist', 'react', `${entry}.js`),
      logLevel: 'silent',
      // The peers are the consumer's, and they are already on the page. Their
      // bytes are not ours to claim or to be charged for.
      external: [/^react($|\/)/, /^react-dom($|\/)/, /^next($|\/)/],
    });
    const { output } = await bundle.generate({ format: 'esm', minify: true });
    await bundle.close();

    const code = output
      .filter((chunk) => chunk.type === 'chunk')
      .map((chunk) => chunk.code)
      .join('');
    out[entry] = gzipSync(Buffer.from(code), { level: 9 }).length;
  }
  return out;
}

/* -------------------------------------------------------------------------
 * A corpus, for axes 2 and 3
 * ---------------------------------------------------------------------- */

function page(index: number, heavy: boolean): DocFile {
  const body = heavy
    ? [
        '## Overview',
        '',
        'Prose about the subject. '.repeat(40),
        '',
        '```ts',
        'export function handler(request: Request): Response {',
        '  return new Response(JSON.stringify({ ok: true }));',
        '}',
        '```',
        '',
        '### Details',
        '',
        '| Field | Type | Notes |',
        '| --- | --- | --- |',
        '| `id` | `string` | The identifier |',
        '| `name` | `string` | Display name |',
        '',
        'More prose. '.repeat(40),
      ]
    : ['## Overview', '', 'Prose about the subject. '.repeat(60)];

  return {
    segments: ['page', String(index)],
    slug: `page/${index}`,
    href: `/docs/page/${index}`,
    filePath: `/content/page-${index}.md`,
    relativePath: `page-${index}.md`,
    frontmatter: { title: `Page ${index}` },
    content: body.join('\n'),
  } as DocFile;
}

const brotli = (input: string): number =>
  brotliCompressSync(Buffer.from(input), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;

async function measurePayload(): Promise<Record<string, number>> {
  const renderer = createDocsRenderer({
    config: { basePath: '/docs', assertLinks: false },
  });
  const out: Record<string, number> = {};

  for (const [label, heavy] of [
    ['light', false],
    ['heavy', true],
  ] as Array<[string, boolean]>) {
    const docs = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        renderer.render(page(index, heavy)),
      ),
    );

    const asTree = docs.map((doc) => ({ hast: doc.hast, toc: doc.toc }));
    const asHtml = docs.map((doc) => ({
      html: toHtml(doc.hast),
      toc: doc.toc,
    }));

    out[label] =
      brotli(JSON.stringify(asTree)) / brotli(JSON.stringify(asHtml));
  }
  return out;
}

/* -------------------------------------------------------------------------
 * Axis 3 — render cost
 * ---------------------------------------------------------------------- */

async function timeRender(exclude: readonly string[]): Promise<number> {
  const renderer = createDocsRenderer({
    config: { basePath: '/docs', assertLinks: false },
    excludeLangs: exclude,
  });
  const docs = Array.from({ length: 30 }, (_, index) => page(index, true));

  await renderer.render(docs[0] as DocFile); // warm the highlighter

  const runs: number[] = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const started = performance.now();
    for (const doc of docs) await renderer.render(doc);
    runs.push((performance.now() - started) / docs.length);
  }
  runs.sort((a, b) => a - b);
  return runs[2] as number;
}

async function measureRender(): Promise<Record<string, number>> {
  const withShiki = await timeRender([]);
  // The same corpus with the highlighter switched off, so the ratio is the
  // highlighter's share and the machine cancels out.
  const without = await timeRender(['ts', 'typescript']);
  return { 'shiki-multiple': withShiki / without };
}

/* -------------------------------------------------------------------------
 * Compare
 * ---------------------------------------------------------------------- */

const failures: string[] = [];

function compare(
  axis: string,
  measured: Record<string, number>,
  budgets: Record<string, Budget>,
  format: (value: number) => string,
): void {
  console.log(`\n${axis}`);

  for (const [name, value] of Object.entries(measured)) {
    const budget = budgets[name];
    if (budget === undefined) {
      // A new client component with no budget is one whose weight nobody
      // agreed to. That is a failure, not a warning.
      failures.push(`${axis}/${name} has no budget entry`);
      console.log(`  ✗ ${name.padEnd(18)} ${format(value)}  (no budget)`);
      continue;
    }
    const ok = value <= budget.max;
    if (!ok) {
      failures.push(
        `${axis}/${name}: ${format(value)} exceeds ${format(budget.max)} — ${budget.note}`,
      );
    }
    console.log(
      `  ${ok ? '✓' : '✗'} ${name.padEnd(18)} ${format(value).padStart(10)}  budget ${format(budget.max)}`,
    );
  }

  for (const name of Object.keys(budgets)) {
    if (!(name in measured)) {
      // A budget for something that no longer exists reads as coverage.
      failures.push(`${axis}/${name} is budgeted but was not measured`);
      console.log(`  ✗ ${name.padEnd(18)} budgeted, not measured`);
    }
  }
}

const budgets = JSON.parse(readFileSync(BUDGET_FILE, 'utf8')) as BudgetFile;

const measured = {
  client: await measureClient(),
  payload: await measurePayload(),
  render: await measureRender(),
};

if (process.argv.includes('--write')) {
  const next: BudgetFile = { client: {}, payload: {}, render: {} };
  for (const axis of ['client', 'payload', 'render'] as const) {
    for (const [name, value] of Object.entries(measured[axis])) {
      next[axis][name] = {
        // Headroom, rounded: a budget pinned to the measurement fails on the
        // next dependency patch and teaches everyone to re-run with --write.
        max:
          axis === 'client'
            ? Math.ceil((value * 1.1) / 100) * 100
            : Number((value * 1.1).toFixed(2)),
        note: budgets[axis][name]?.note ?? 'TODO: say why this number.',
      };
    }
  }
  writeFileSync(BUDGET_FILE, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`\nwrote ${path.relative(ROOT, BUDGET_FILE)}`);
  process.exit(0);
}

compare(
  'client (gzip bytes)',
  measured.client,
  budgets.client,
  (value) => `${(value / 1024).toFixed(2)} KB`,
);
compare(
  'payload (hast ÷ html, brotli)',
  measured.payload,
  budgets.payload,
  (value) => `${value.toFixed(3)}×`,
);
compare(
  'render (with ÷ without shiki)',
  measured.render,
  budgets.render,
  (value) => `${value.toFixed(2)}×`,
);

if (failures.length > 0) {
  console.error(`\n${failures.length} budget failure(s):`);
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log('\nsize: within budget');
