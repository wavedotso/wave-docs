/**
 * Build a real Next application against the published `exports` map.
 *
 * Everything else in this repository tests the adapter by calling it. That
 * cannot see the half of the contract Next owns: what the compiler does with
 * our module, what the tracer decides to ship, what actually lands on disk.
 * Those are undocumented internals that move under a Next minor, and when one
 * moves, this fails here — on the pull request that bumped Next — instead of
 * in a consumer's deploy. Four of them are load-bearing:
 *
 * - `path.resolve(process.cwd(), …)` does not sweep the whole project into the
 *   server bundle, because `resolveDocsConfig` carries a `turbopackIgnore`;
 * - a `force-static` route handler prerenders to `<route>.body`, which is the
 *   entire premise of `docs.searchIndex`;
 * - headers set on that handler's `Response` survive into the prerender
 *   manifest as `initialHeaders`, and are served verbatim;
 * - `output: 'export'` writes the same body out as a plain static file.
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
import MiniSearch from 'minisearch';

/*
 * The one deliberate reach past `exports`. `mergeSearchOptions` is internal —
 * the dialog bundles it so a consumer never has to know it exists — but
 * loading an index without it is exactly the silent failure it prevents, so
 * this has to load the index the way the browser does.
 */
import { mergeSearchOptions } from '../dist/search-options.js';

const ROOT = path.join(import.meta.dirname, '..');
const SMOKE = path.join(ROOT, 'smoke');

const EXPECTED_HEADERS: Record<string, string> = {
  'content-type': 'application/json',
  'cache-control': 'public, max-age=0, must-revalidate',
};

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
 * reads markdown at request time — every page is prerendered, and so is the
 * search index.
 *
 * Asserted as behaviour rather than as the presence of the comment. A bundler
 * that strips comments, a Turbopack release that renames the directive, and
 * someone adding a second dynamic `fs` call all break the same property, and
 * only one of the three would fail a grep.
 */
async function checkNothingSwept(): Promise<void> {
  const traces = [
    'page.js.nft.json',
    '[...slug]/page.js.nft.json',
    'search-index.json/route.js.nft.json',
  ];

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

/** The index, loaded and queried the way `SearchDialog` loads and queries it. */
function checkIndexContents(json: string): void {
  const index = MiniSearch.loadJSON(json, mergeSearchOptions());

  check(
    'published prose is searchable',
    index.search('quokka').length > 0,
    'a word that appears only in installation.md found nothing',
  );
  check(
    'draft prose is absent',
    index.search('wombat').length === 0,
    'a word that appears only on a `draft: true` page was indexed',
  );
  check(
    'hits carry the base path',
    index
      .search('installation')
      .every((hit) => String(hit.href).startsWith('/docs/')),
    'a hit would navigate somewhere the route table does not serve',
  );
}

/**
 * The prerendered index, and the headers Next carried out of the handler.
 *
 * A missing `.body` is the failure `docs.searchIndex`'s guard exists for, seen
 * from the build side: the route went dynamic, so in production it would
 * re-render the whole corpus per request out of markdown the deployment does
 * not carry.
 */
async function checkSearchIndex(): Promise<void> {
  const app = path.join(SMOKE, '.next', 'server', 'app', 'docs');
  const body = await readFile(
    path.join(app, 'search-index.json.body'),
    'utf8',
  ).catch(() => undefined);

  check(
    'the handler prerendered to search-index.json.body',
    body !== undefined,
    'no body on disk: the route went dynamic, so every request would ' +
      're-render the corpus from markdown the deployment does not carry',
  );
  if (body === undefined) return;

  const manifest = JSON.parse(
    await readFile(
      path.join(SMOKE, '.next', 'prerender-manifest.json'),
      'utf8',
    ),
  ) as {
    routes?: Record<
      string,
      { compute?: string; initialHeaders?: Record<string, string> }
    >;
  };
  const route = manifest.routes?.['/docs/search-index.json'];

  check(
    'the prerender manifest calls it static',
    route?.compute === 'static',
    `compute was ${JSON.stringify(route?.compute)}`,
  );

  const headers = route?.initialHeaders ?? {};
  for (const [name, value] of Object.entries(EXPECTED_HEADERS)) {
    check(
      `initialHeaders carries ${name}`,
      headers[name] === value,
      `got ${JSON.stringify(headers[name])}`,
    );
  }
  check(
    'initialHeaders carries a strong ETag',
    /^"[0-9a-f]{40}"$/.test(headers.etag ?? ''),
    `got ${JSON.stringify(headers.etag)}`,
  );

  checkIndexContents(body);
}

/**
 * The shell, in HTML a browser would actually receive.
 *
 * `docs.Layout` is an async Server Component used as a Next layout's default
 * export, and the two facts that makes true — that Next accepts it, and that
 * its client children keep the layout itself on the server — are only
 * observable from a real build. A jsdom test renders the component; it cannot
 * tell you Next was willing to route to it.
 */
async function checkShell(): Promise<void> {
  const html = await readFile(
    path.join(SMOKE, '.next', 'server', 'app', 'docs', 'installation.html'),
    'utf8',
  ).catch(() => undefined);

  check(
    'the docs layout prerendered',
    html !== undefined,
    '`export default docs.Layout` produced no HTML',
  );
  if (html === undefined) return;

  for (const [label, pattern] of [
    ['a skip link, before anything else', /class="wave-docs-skip-link"/],
    ['the header', /wave-docs-layout__header/],
    ['the grid', /class="wave-docs-layout"/],
    ['the drawer', /<dialog[^>]*id="wave-docs-nav"/],
    ['light dismiss on the drawer', /closedby="any"/],
    ['a declarative trigger', /command="show-modal"/],
    ['the article in the main track', /wave-docs-layout__main/],
    ['the search trigger', /wave-docs-search-trigger/],
  ] as Array<[string, RegExp]>) {
    check(`the shell rendered ${label}`, pattern.test(html));
  }

  /*
   * Two landmarks, and they must not be two of the same thing. The sidebar
   * and the TOC are both `<nav>`, which is right — a screen-reader user picks
   * between them by name. What would be wrong is a second copy of the sidebar
   * for the mobile breakpoint, which is what `display: contents` on the
   * drawer exists to avoid, and which would show up here as two navs with the
   * same label.
   */
  const labels = [...html.matchAll(/<nav [^>]*aria-label="([^"]+)"/g)].map(
    (match) => match[1],
  );
  check(
    'every nav landmark has a distinct name',
    labels.length === new Set(labels).size,
    `duplicate landmark names: ${labels.join(', ')}`,
  );
  check(
    'the drawer is not a second copy of the sidebar',
    (html.match(/class="wave-docs-sidebar"/g) ?? []).length === 1,
    'the nav is in the payload twice',
  );
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
  await checkShell();
  await checkSearchIndex();
}

async function checkStaticExport(): Promise<void> {
  check(
    "output: 'export' wrote the page as HTML",
    await exists(path.join(SMOKE, 'out', 'docs', 'installation.html')),
    'a statically exported site would 404 on its own content',
  );

  const file = path.join(SMOKE, 'out', 'docs', 'search-index.json');
  const body = await readFile(file, 'utf8').catch(() => undefined);

  check(
    "output: 'export' wrote out/docs/search-index.json",
    body !== undefined,
    'a statically exported site would 404 on its own search index',
  );
  if (body === undefined) return;

  checkIndexContents(body);
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
