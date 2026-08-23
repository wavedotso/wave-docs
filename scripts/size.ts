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
const README_FILE = path.join(ROOT, 'README.md');
const SITE_CONTENT = path.join(ROOT, 'site', 'content');

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

/** Milliseconds per page for one pass over the corpus. */
async function timeOnce(
  renderer: ReturnType<typeof createDocsRenderer>,
  docs: DocFile[],
): Promise<number> {
  const started = performance.now();
  for (const doc of docs) await renderer.render(doc);
  return (performance.now() - started) / docs.length;
}

/**
 * Highlighting's share of a render, as a ratio so the machine cancels out.
 *
 * ⚠️ THE TWO HALVES ARE INTERLEAVED, AND THAT IS THE WHOLE DESIGN. They used to
 * be timed in separate blocks — five runs with Shiki, then five without — and a
 * ratio built that way only cancels the machine out if the machine was the same
 * for both blocks. It is not: measured on an idle machine this reported
 * 1.71–1.86×, and on the same machine while a build was running, 2.03× — over
 * the 1.98× budget, from a code change that touched nothing on this path. A
 * contended CI runner is the normal case, so that is a gate that fails for
 * reasons the author cannot act on, which is the fastest way to teach everyone
 * to raise a budget without reading it.
 *
 * Timed back to back within an attempt, a load spike lands on both halves and
 * divides out. The median of the per-attempt *ratios* is then the answer, not
 * the ratio of two independently-median times.
 */
async function measureRender(): Promise<Record<string, number>> {
  const docs = Array.from({ length: 30 }, (_, index) => page(index, true));
  const build = (exclude: readonly string[]) =>
    createDocsRenderer({
      config: { basePath: '/docs', assertLinks: false },
      excludeLangs: exclude,
    });

  const shiki = build([]);
  const plain = build(['ts', 'typescript']);

  // Warm both highlighters before anything is timed: the first render of each
  // loads grammars, and charging that to attempt one skews the median.
  await shiki.render(docs[0] as DocFile);
  await plain.render(docs[0] as DocFile);

  const ratios: number[] = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const withShiki = await timeOnce(shiki, docs);
    const without = await timeOnce(plain, docs);
    ratios.push(withShiki / without);
  }
  ratios.sort((a, b) => a - b);
  return { 'shiki-multiple': ratios[2] as number };
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

/* -------------------------------------------------------------------------
 * Axis 4 — the README's own numbers
 * ---------------------------------------------------------------------- */

/**
 * Every figure the README publishes about cost, and what measures it.
 *
 * ⚠️ THIS AXIS EXISTS BECAUSE THE OTHER THREE DID NOT COVER THE ONE PLACE
 * ANYONE READS. The README claimed the sidebar was 1.24 KB against a budget of
 * 1.37 KB; both had been true, and both had been wrong for two commits by the
 * time anyone looked — under a sentence promising that "every number here is
 * one a build fails over rather than one somebody remembered to update". No
 * test read the table, so the rot the sentence ruled out had already happened.
 *
 * The published figure is a **ceiling**, not a snapshot: the check is
 * `measured <= published <= budget`. That is the direction that matters — a
 * README may not understate what this package costs — and it means an ordinary
 * dependency patch that shaves 40 bytes does not force a documentation commit.
 * Comparison is at the published precision, so a figure of `1.20×` is not
 * breached by `1.2000001`.
 */
interface ReadmeClaim {
  /** The row's first cell, verbatim. */
  label: string;
  axis: 'client' | 'payload' | 'render';
  /** Budget keys this row covers; more than one means the row is their sum. */
  names: string[];
  unit: 'kb' | 'ratio';
}

const README_CLAIMS: ReadmeClaim[] = [
  {
    label: 'Everything the quick start ships, gzipped',
    axis: 'client',
    names: ['next-search', 'next-nav', 'toc', 'code-runtime'],
    unit: 'kb',
  },
  {
    label: 'Search dialog and router wiring',
    axis: 'client',
    names: ['next-search'],
    unit: 'kb',
  },
  {
    label: 'Navigation: one sidebar, open and closed',
    axis: 'client',
    names: ['next-nav'],
    unit: 'kb',
  },
  { label: 'Table of contents', axis: 'client', names: ['toc'], unit: 'kb' },
  {
    label: 'Copy-button runtime',
    axis: 'client',
    names: ['code-runtime'],
    unit: 'kb',
  },
  {
    label: 'hast over the wire vs HTML, prose page',
    axis: 'payload',
    names: ['light'],
    unit: 'ratio',
  },
  {
    label: 'hast over the wire vs HTML, code and tables',
    axis: 'payload',
    names: ['heavy'],
    unit: 'ratio',
  },
  {
    label: 'Highlighting vs no highlighting',
    axis: 'render',
    names: ['shiki-multiple'],
    unit: 'ratio',
  },
];

/** The published figure for a row, or `undefined` when the row is missing. */
function publishedFigure(
  readme: string,
  claim: ReadmeClaim,
): number | undefined {
  const escaped = claim.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const row = new RegExp(`^\\| ${escaped} \\| ([^|]+) \\|`, 'm').exec(readme);
  if (row === null) return undefined;
  const value = Number.parseFloat((row[1] as string).trim());
  return Number.isNaN(value) ? undefined : value;
}

/** Every `.md` under `site/content/`, at any depth. */
function siteContentFiles(dir: string = SITE_CONTENT): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...siteContentFiles(full));
      continue;
    }
    if (entry.name.endsWith('.md')) found.push(full);
  }
  return found;
}

/**
 * Check one document's published figures against what was measured.
 *
 * `requireEveryRow` is the difference between the two callers, and it is the
 * whole of it. The README is the contract and must carry all eight rows, so a
 * deleted one is a failure. A page of the site publishes whichever subset its
 * argument needs — but every row it *does* publish is held to the same two
 * assertions, because a second document repeating these numbers is a second
 * document that can rot.
 */
function checkDocument(
  source: string,
  text: string,
  measured: {
    client: Record<string, number>;
    payload: Record<string, number>;
    render: Record<string, number>;
  },
  requireEveryRow: boolean,
): void {
  for (const claim of README_CLAIMS) {
    const published = publishedFigure(text, claim);
    if (published === undefined) {
      if (!requireEveryRow) continue;
      failures.push(
        `${source}/${claim.label}: no row in the "What it costs" table — ` +
          'a figure this script checks was deleted or retitled',
      );
      console.log(`  ✗ ${claim.label} — no such row`);
      continue;
    }

    // A ratio row can only be a single key; only bytes are summed.
    const raw = claim.names.reduce(
      (total, name) => total + (measured[claim.axis][name] ?? Number.NaN),
      0,
    );
    const actual =
      claim.unit === 'kb'
        ? Number((raw / 1024).toFixed(1))
        : Number(raw.toFixed(2));
    const budget = claim.names.reduce(
      (total, name) => total + (budgets[claim.axis][name]?.max ?? Number.NaN),
      0,
    );
    const ceiling =
      claim.unit === 'kb'
        ? Number((budget / 1024).toFixed(1))
        : Number(budget.toFixed(2));
    const unit = claim.unit === 'kb' ? ' KB' : '×';

    if (actual > published) {
      failures.push(
        `${source}/${claim.label}: measured ${actual}${unit} exceeds the ` +
          `published ${published}${unit}. A document here may not understate ` +
          'what this package costs — raise the published figure, deliberately.',
      );
      console.log(
        `  ✗ ${claim.label}: ${actual}${unit} > published ${published}${unit}`,
      );
      continue;
    }
    if (published > ceiling) {
      failures.push(
        `${source}/${claim.label}: the published ${published}${unit} is above ` +
          `the budget's ${ceiling}${unit}, so the table promises worse than the ` +
          'build enforces',
      );
      console.log(
        `  ✗ ${claim.label}: published ${published}${unit} > budget ${ceiling}${unit}`,
      );
      continue;
    }
    console.log(
      `  ✓ ${claim.label.padEnd(42)} ${`${actual}${unit}`.padStart(9)} ≤ published ${published}${unit}`,
    );
  }
}

/**
 * Every document that publishes one of these numbers, checked.
 *
 * ⚠️ THE SITE IS HERE BECAUSE IT BECAME A SECOND PLACE THE NUMBERS ARE
 * PUBLISHED. `site/content/` was six fixture pages when this axis was written
 * and is a documentation site now, with a cost table on its landing page and
 * another in its installation guide — and the first thing that happened was the
 * drift this axis exists to catch: the site said 13.0 KB under a sentence
 * calling it a ceiling, while the README said 13.5 KB, for as long as nobody
 * compared them.
 *
 * Unlike the README, a page is not required to carry every row. It is required
 * to be right about the rows it carries.
 */
function checkPublishedFigures(measured: {
  client: Record<string, number>;
  payload: Record<string, number>;
  render: Record<string, number>;
}): void {
  console.log('\nreadme (published ceilings)');
  checkDocument('readme', readFileSync(README_FILE, 'utf8'), measured, true);

  console.log('\nsite (published ceilings)');
  for (const file of siteContentFiles()) {
    const text = readFileSync(file, 'utf8');
    const label = `site/${path.relative(SITE_CONTENT, file)}`;
    // Most pages publish no figure at all. Naming only the ones that do keeps
    // the output a list of what is checked rather than a list of files.
    if (!README_CLAIMS.some((c) => publishedFigure(text, c) !== undefined)) {
      continue;
    }
    console.log(`  ${label}`);
    checkDocument(label, text, measured, false);
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
checkPublishedFigures(measured);

if (failures.length > 0) {
  console.error(`\n${failures.length} budget failure(s):`);
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log('\nsize: within budget');
