/**
 * Build a real Next application against the published `exports` map.
 *
 * Everything else in this repository tests the adapter by calling it. That
 * cannot see the half of the contract Next owns: what the compiler does with
 * our module, what the tracer decides to ship, what actually lands on disk.
 * Those are undocumented internals that move under a Next minor, and when one
 * moves, this fails here — on the pull request that bumped Next — instead of
 * in a consumer's deploy.
 *
 * `smoke/lib/docs.ts` imports `@waveso/docs/next` **by name**, which Node
 * self-references through the real `exports` map into `dist/`, exactly as a
 * consumer resolves it. So `pnpm build` has to have run first.
 *
 * Builds in both output modes, so `pnpm test:smoke` is the whole thing.
 */

import { spawnSync } from 'node:child_process';
import { readFile, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const SMOKE = path.join(ROOT, 'smoke');

const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    return;
  }
  failures.push(detail === undefined ? label : `${label} — ${detail}`);
  console.log(`  ✗ ${label}${detail === undefined ? '' : ` — ${detail}`}`);
}

async function exists(file: string): Promise<boolean> {
  return await stat(file).then(
    () => true,
    () => false,
  );
}

/**
 * The routes must not drag the consumer's project into the server bundle.
 *
 * `contentDir` is a consumer-supplied string, so Turbopack cannot statically
 * see what `path.resolve(process.cwd(), contentDir)` reads, and its fallback is
 * to trace **everything**: their source, their content, their whole `public/`
 * folder, the output of their last build. `resolveDocsConfig` carries a
 * `turbopackIgnore` comment to stop that, which is safe only because nothing
 * reads markdown at request time — every page is prerendered.
 *
 * Asserted as behaviour rather than as the presence of the comment. A bundler
 * that strips comments, a Turbopack release that renames the directive, and
 * someone adding a second dynamic `fs` call all break the same property, and
 * only one of the three would fail a grep.
 */
async function checkNothingSwept(): Promise<void> {
  const traces = ['page.js.nft.json', '[...slug]/page.js.nft.json'];

  for (const name of traces) {
    const file = path.join(SMOKE, '.next', 'server', 'app', 'docs', name);
    const trace = JSON.parse(await readFile(file, 'utf8')) as {
      files: string[];
    };
    // Markdown is the crisp tell: the only reason a `.md` would be in a server
    // trace is the whole-project sweep, and every other stray rides along with
    // it. `node_modules` is excluded, because a dependency shipping its own
    // README is not this bug.
    const strays = trace.files.filter(
      (traced) => traced.endsWith('.md') && !traced.includes('node_modules'),
    );

    check(
      `${name} does not sweep the project into the bundle`,
      strays.length === 0,
      `${strays.length} content file(s) traced, e.g. ${strays[0]}`,
    );
  }
}

async function checkDefaultOutput(): Promise<void> {
  const app = path.join(SMOKE, '.next', 'server', 'app', 'docs');

  check(
    'the catch-all route prerendered a page',
    await exists(path.join(app, 'installation.html')),
    'no HTML on disk: `generateStaticParams` produced nothing Next built',
  );
  check(
    'the index route prerendered the content root',
    await exists(path.join(app, 'page.js')),
    '`app/docs/page.tsx` did not compile — `/docs` would be a 404',
  );

  await checkNothingSwept();
}

async function checkStaticExport(): Promise<void> {
  check(
    "output: 'export' wrote the page as HTML",
    await exists(path.join(SMOKE, 'out', 'docs', 'installation.html')),
    'a statically exported site would 404 on its own content',
  );
}

/**
 * `next build smoke`, spawned through Node rather than the `.bin` shim so the
 * command is identical on every platform.
 */
function build(mode: 'default' | 'export'): void {
  const cli = createRequire(import.meta.url).resolve('next/dist/bin/next');
  const result = spawnSync(process.execPath, [cli, 'build', 'smoke'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, SMOKE_EXPORT: mode === 'export' ? '1' : '0' },
  });

  if (result.status !== 0) {
    console.error(`\nsmoke: \`next build smoke\` failed in ${mode} mode`);
    process.exit(result.status ?? 1);
  }
}

// From scratch every time: a stale `.next` from the other output mode is how a
// missing artifact goes on passing.
await rm(path.join(SMOKE, '.next'), { recursive: true, force: true });
await rm(path.join(SMOKE, 'out'), { recursive: true, force: true });

build('default');
console.log('\nsmoke: default output');
await checkDefaultOutput();

build('export');
console.log('\nsmoke: export output');
await checkStaticExport();

if (failures.length > 0) {
  console.error(
    `\n${failures.length} smoke assertion(s) failed:\n` +
      failures.map((line) => `  - ${line}`).join('\n'),
  );
  process.exit(1);
}
console.log('\nsmoke: ok');
