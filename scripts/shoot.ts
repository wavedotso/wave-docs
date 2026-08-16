/**
 * Screenshots of the shell, taken from the site this repository actually
 * builds.
 *
 * ⚠️ SHOT FROM `site/out`, NEVER FROM A FIXTURE. A hand-built page posed for a
 * screenshot is marketing; this serves the same static export CI builds, over
 * HTTP, in the same Chromium the browser tests use. If the picture looks good,
 * the product is good, because they are the same bytes.
 *
 * Three shots, because they are the three questions a reader has before they
 * install: what does a page look like, does it do dark mode, and is the search
 * any good.
 *
 * ```bash
 * pnpm shoot            # rewrite docs/media/*.png
 * pnpm shoot --check    # fail if any shot differs from the committed one
 * ```
 *
 * `--check` is what CI runs on a pull request touching `src/styles.css`,
 * `src/react/**` or `site/`. A stylesheet change that reflows the shell should
 * fail on the pull request that made it, not be discovered in the README six
 * releases later.
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.join(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'site', 'out');
const MEDIA = path.join(ROOT, 'docs', 'media');

/** Device pixel ratio 2: a 1× screenshot on a Retina README looks broken. */
const SCALE = 2;
const WIDTH = 1280;
const HEIGHT = 800;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * The static export, served.
 *
 * `file://` would be simpler and is wrong: the search dialog `fetch`es its
 * index, and a `file://` origin fails that with an opaque CORS error — so the
 * one shot that needs the network is the one a file server cannot take.
 */
function serve(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const requested = decodeURIComponent(
      (request.url ?? '/').split('?')[0] ?? '/',
    );
    // Contained to `out/`: this serves a build directory, and a `..` in a URL
    // must not reach the rest of the repository even in a screenshot script.
    const resolved = path.join(OUT, path.normalize(requested));
    if (!resolved.startsWith(OUT)) {
      response.writeHead(403).end();
      return;
    }

    for (const candidate of [
      resolved,
      `${resolved}.html`,
      path.join(resolved, 'index.html'),
    ]) {
      if (!existsSync(candidate) || candidate.endsWith(path.sep)) continue;
      try {
        const body = readFileSync(candidate);
        response.writeHead(200, {
          'content-type':
            TYPES[path.extname(candidate)] ?? 'application/octet-stream',
        });
        response.end(body);
        return;
      } catch {
        // A directory without an index falls through to the next candidate.
      }
    }
    response.writeHead(404).end('not found');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port =
        typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

interface Shot {
  name: string;
  /** Page to open, relative to the served root. */
  route: string;
  theme: 'light' | 'dark';
  /** Anything to do once the page has settled. */
  prepare?: (page: import('playwright').Page) => Promise<void>;
}

const SHOTS: Shot[] = [
  {
    name: 'hero-light',
    route: '/docs/installation',
    theme: 'light',
    prepare: async (page) => {
      // Scrolled to the first code frame: a hero showing only prose sells the
      // one thing every alternative also does.
      await page.evaluate(() => {
        document.querySelector('pre')?.scrollIntoView({ block: 'center' });
        window.scrollBy(0, -120);
      });
    },
  },
  { name: 'hero-dark', route: '/docs/installation', theme: 'dark' },
  {
    name: 'search',
    route: '/docs/reference',
    theme: 'light',
    prepare: async (page) => {
      await page
        .getByRole('button', { name: /search/i })
        .first()
        .click();
      const input = page.getByRole('combobox');
      await input.waitFor({ state: 'visible' });
      // A query with hits across several pages: an empty dialog shows the
      // chrome and none of the thing being demonstrated.
      await input.fill('static');
      await page.waitForFunction(
        () => document.querySelectorAll('[role="option"]').length > 0,
        undefined,
        { timeout: 5000 },
      );
    },
  },
];

const check = process.argv.includes('--check');
const failures: string[] = [];

if (!existsSync(path.join(OUT, 'docs', 'installation.html'))) {
  console.error(
    'shoot: no site build found. Run `pnpm build && pnpm build:site` first.',
  );
  process.exit(1);
}

mkdirSync(MEDIA, { recursive: true });

const { url, close } = await serve();
const browser = await chromium.launch();

try {
  for (const shot of SHOTS) {
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: SCALE,
      colorScheme: shot.theme,
      // Deterministic across machines: a screenshot that differs by a caret
      // blink or a scrollbar cannot be pixel-diffed.
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();

    await page.goto(`${url}${shot.route}`, { waitUntil: 'networkidle' });

    /*
     * ⚠️ AFTER NAVIGATION, NOT IN AN INIT SCRIPT. `addInitScript` runs before
     * the document exists, so `document.documentElement.dataset.theme = …`
     * silently did nothing — and because the stylesheet only follows the OS
     * under `:root[data-theme='system']`, the context's `colorScheme: 'dark'`
     * did nothing either. The two hero shots came out byte-identical, which is
     * how it was caught: a dark-mode screenshot that is not dark is exactly the
     * sort of thing that ships in a README for a year.
     *
     * The attribute is what a consumer's theme toggle sets, so this is also the
     * path worth photographing.
     */
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, shot.theme);

    await page.evaluate(() => document.fonts.ready);
    await shot.prepare?.(page);
    // One frame, so a scroll or an opening dialog has landed.
    await page.evaluate(
      () =>
        new Promise((resolve) => requestAnimationFrame(() => resolve(null))),
    );

    const buffer = await page.screenshot({ type: 'png' });
    const file = path.join(MEDIA, `${shot.name}.png`);

    if (check) {
      const committed = existsSync(file) ? readFileSync(file) : undefined;
      if (committed === undefined) {
        failures.push(
          `${shot.name}: no committed screenshot to compare against`,
        );
      } else if (!committed.equals(buffer)) {
        failures.push(
          `${shot.name}: differs from the committed screenshot ` +
            `(${committed.length} bytes committed, ${buffer.length} rendered)`,
        );
      } else {
        console.log(`  ✓ ${shot.name}`);
      }
    } else {
      writeFileSync(file, buffer);
      console.log(
        `  wrote ${path.relative(ROOT, file)} (${buffer.length} bytes)`,
      );
    }

    await context.close();
  }
} finally {
  await browser.close();
  await close();
}

if (failures.length > 0) {
  console.error(`\nshoot: ${failures.length} screenshot(s) out of date:`);
  for (const line of failures) console.error(`  - ${line}`);
  console.error('\nRun `pnpm shoot` and commit the result — deliberately.');
  process.exit(1);
}
console.log(check ? '\nshoot: screenshots match' : '\nshoot: done');
