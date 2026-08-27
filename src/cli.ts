/**
 * `npx @waveso/docs init` — the route files, written for you.
 *
 * ⚠️ THIS EXISTS BECAUSE THE FILE COUNT IS NEXT'S FLOOR AND THE TYPING IS NOT.
 * A route in the App Router is a folder in the consumer's `app/`, and no
 * package can add one — so a documentation site needs six files however good
 * this package is. What it can stop is those files being hand-typed, because
 * three of them fail *silently* when they are slightly wrong: a `dynamicParams`
 * that is not a literal `false`, a missing `export const dynamic =
 * 'force-static'`, and an index page nobody created because `[...slug]` does
 * not match the mount itself.
 *
 * Non-interactive on purpose. Flags and defaults rather than prompts: it runs
 * the same way in a terminal, in CI and inside another tool's scaffolder, and
 * it adds no dependency to a package that ships its parser to nobody.
 *
 * ⚠️ AND IT NEVER OVERWRITES. A file that exists is reported and skipped, so
 * running it twice is safe and running it in a project that already has a
 * `layout.tsx` cannot destroy one. Scaffolders that clobber are scaffolders
 * people stop running.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

/** One file the scaffold writes. */
export interface DocsScaffoldFile {
  /** Path relative to the project root, with `/` separators. */
  file: string;
  contents: string;
}

export interface DocsScaffoldOptions {
  /** Where the App Router lives. Defaults to `'app'`. */
  appDir?: string | undefined;
  /** Where `createDocsRoute` goes. Defaults to `'lib/docs.ts'`. */
  configFile?: string | undefined;
  /** The `contentDir` written into the config. Defaults to `'content/docs'`. */
  contentDir?: string | undefined;
  /** The mount. Defaults to `'/docs'`, which is `createDocsRoute`'s default. */
  basePath?: string | undefined;
  /** Absolute site origin, written into the config when given. */
  siteUrl?: string | undefined;
  /**
   * The `llms.title` written into the config — your product's name.
   *
   * ⚠️ OMITTED RATHER THAN INVENTED WHEN IT IS NOT KNOWN, AND THE WHOLE `llms`
   * BLOCK GOES WITH IT. A scaffold that writes `title: 'Your product'` ships a
   * placeholder that *builds*, so nothing ever forces anyone to fix it — and a
   * corpus telling every agent the product is called "Your product" is worse
   * than one that does not exist. `siteUrl` is commented out for exactly this
   * reason; this is the same rule applied to the line that broke it.
   *
   * `initDocs` fills this from the project's `package.json` name, which is at
   * least true.
   */
  title?: string | undefined;
  /**
   * Also write `llms.txt`, the agent index. Defaults to `false`.
   *
   * ⚠️ THE CORPUS IS THE ONE THAT EARNS ITS FILE. `llms-full.txt` carries every
   * page *and its URL*, so an agent that finds it has everything; the index is
   * a convenience on top, and the "Copy page" button reads the corpus. Six
   * files is the floor, and this is the seventh — opt in when you want it.
   */
  llmsIndex?: boolean | undefined;
}

/**
 * The files a documentation site needs.
 *
 * Exported so a host scaffolder can write them its own way, and so the tests
 * can assert the contents without touching a disk.
 */
export function docsScaffold(
  options: DocsScaffoldOptions = {},
): DocsScaffoldFile[] {
  const appDir = options.appDir ?? 'app';
  const configFile = options.configFile ?? 'lib/docs.ts';
  const contentDir = options.contentDir ?? 'content/docs';
  const basePath = (options.basePath ?? '/docs').replace(/\/+$/, '') || '/';

  /*
   * The route files live *under* the mount, because that is where their URLs
   * are: a root mount puts them at the top of `app/`, `/docs` puts them in
   * `app/docs/`.
   */
  const segments = basePath.split('/').filter(Boolean);
  const routeDir = [appDir, ...segments].join('/');

  /*
   * ⚠️ `@/`, THE ALIAS `create-next-app` SETS UP. A relative import would be
   * wrong for every `appDir` but the default, and wrong quietly — a project
   * without the alias edits one line, which is the better failure.
   */
  const configImport = `@/${configFile.replace(/\.tsx?$/, '')}`;

  const config = [
    `import { createDocsRoute } from '@waveso/docs/next';`,
    ``,
    `/**`,
    ` * One route, shared by every file under \`${routeDir}\`.`,
    ` *`,
    ` * Where the markdown lives, where it is mounted, and what the chrome says.`,
    ` */`,
    `export const docs = createDocsRoute({`,
    `  contentDir: '${contentDir}',`,
    ...(basePath === '/docs' ? [] : [`  basePath: '${basePath}',`]),
    ...(options.siteUrl === undefined
      ? [
          `  // Your origin, e.g. 'https://example.com'. Canonical URLs, the`,
          `  // sitemap and the links inside \`llms-full.txt\` all read it.`,
          `  // siteUrl: 'https://example.com',`,
        ]
      : [`  siteUrl: '${options.siteUrl}',`]),
    ...(options.title === undefined
      ? [
          `  /*`,
          `   * Add this to serve \`llms.txt\` and \`llms-full.txt\`, and to turn on`,
          `   * the "Copy page" button, which reads the corpus:`,
          `   *`,
          `   *   llms: { title: 'Your product' },`,
          `   */`,
        ]
      : [
          `  /*`,
          `   * \`llms.txt\` and \`llms-full.txt\`, and the "Copy page" button that`,
          `   * reads the corpus. Remove this and the button stops rendering.`,
          `   */`,
          `  llms: {`,
          `    title: '${options.title.replace(/'/g, "\\'")}',`,
          `    description: 'One sentence on what this documentation covers.',`,
          `  },`,
        ]),
    `});`,
    ``,
  ].join('\n');

  const files: DocsScaffoldFile[] = [
    { file: configFile, contents: config },
    /*
     * ⚠️ TWO SHAPES, BECAUSE `docs.Layout` IS NOT A ROOT LAYOUT. It owns the
     * sidebar, the search trigger, the skip link and the grid — and
     * deliberately not `<html>` or `<body>`, which is the property that lets a
     * host wrap it. A Next application needs exactly one layout that does own
     * them, so at a root mount this file has to be that layout *and* render
     * the shell; under `/docs` the root layout already exists and this is a
     * nested one-liner.
     */
    basePath === '/'
      ? {
          file: `${routeDir}/layout.tsx`,
          contents: [
            `import '@waveso/docs/styles.css';`,
            `import type { ReactNode } from 'react';`,
            ``,
            `import { docs } from '${configImport}';`,
            ``,
            `/*`,
            ` * The docs are at the root, so the one layout there renders both the`,
            ` * document and the shell. \`docs.Layout\` does not own \`<html>\` or`,
            ` * \`<body>\` — put your own chrome around it, and if it is sticky say`,
            ` * how tall once: \`--wave-docs-chrome-offset: 4rem\`.`,
            ` */`,
            `export default function RootLayout({`,
            `  children,`,
            `}: {`,
            `  children: ReactNode;`,
            `}): ReactNode {`,
            `  return (`,
            `    <html lang="en">`,
            `      {/* Every browser ships \`body { margin: 8px }\`, which would start`,
            `        * the sidebar's divider 8px below the top edge. Clearing it is`,
            `        * the site's job: this package styles nothing outside`,
            `        * \`.wave-docs-*\`. */}`,
            `      <body style={{ margin: 0 }}>`,
            `        <docs.Layout>{children}</docs.Layout>`,
            `      </body>`,
            `    </html>`,
            `  );`,
            `}`,
            ``,
          ].join('\n'),
        }
      : {
          file: `${routeDir}/layout.tsx`,
          contents: [
            `import '@waveso/docs/styles.css';`,
            ``,
            `import { docs } from '${configImport}';`,
            ``,
            `/*`,
            ` * The whole shell: sidebar, search trigger, skip link and the grid.`,
            ` * It renders inside your application's root layout, which owns`,
            ` * \`<html>\` and \`<body>\`.`,
            ` *`,
            ` * Wrap it in your own chrome by rendering \`<docs.Layout>\` yourself`,
            ` * with children — a sticky header of yours only needs to say how`,
            ` * tall it is, once: \`--wave-docs-chrome-offset: 4rem\`.`,
            ` */`,
            `export default docs.Layout;`,
            ``,
          ].join('\n'),
        },
    {
      file: `${routeDir}/page.tsx`,
      contents: [
        `import { docs } from '${configImport}';`,
        ``,
        `/*`,
        ` * The index, and it needs its own file: \`[...slug]\` does not match the`,
        ` * mount itself. An optional catch-all (\`[[...slug]]\`) does, and then`,
        ` * leaves \`${basePath === '/' ? '/index' : `${basePath}/index`}\` live serving byte-identical HTML.`,
        ` */`,
        `export default docs.IndexPage;`,
        `export const generateMetadata = docs.generateMetadata;`,
        ``,
      ].join('\n'),
    },
    {
      file: `${routeDir}/[...slug]/page.tsx`,
      contents: [
        `import { docs } from '${configImport}';`,
        ``,
        `export default docs.Page;`,
        `export const generateStaticParams = docs.generateStaticParams;`,
        `export const generateMetadata = docs.generateMetadata;`,
        `/*`,
        ` * ⚠️ A LITERAL \`false\`, NOT \`docs.dynamicParams\`. Next parses route`,
        ` * segment config out of the module before any of it runs, so a value it`,
        ` * has to execute an import to learn is no value at all — and the failure`,
        ` * is a build that succeeds while unlisted URLs render on demand.`,
        ` */`,
        `export const dynamicParams = false;`,
        ``,
      ].join('\n'),
    },
    {
      file: `${routeDir}/search-index.json/route.ts`,
      contents: [
        `import { docs } from '${configImport}';`,
        ``,
        `export const GET = docs.searchIndex;`,
        `/*`,
        ` * ⚠️ NOT OPTIONAL, AND IT HAS TO BE A LITERAL. Without it Next marks the`,
        ` * route dynamic and re-renders your whole corpus on every request, from`,
        ` * markdown that output tracing did not put in the deployment bundle.`,
        ` */`,
        `export const dynamic = 'force-static';`,
        ``,
      ].join('\n'),
    },
    {
      file: `${routeDir}/llms-full.txt/route.ts`,
      contents: [
        `import { docs } from '${configImport}';`,
        ``,
        `/*`,
        ` * Every page's markdown, in one file — for agents, and for the "Copy`,
        ` * page" button, which reads this and slices out the page it is on.`,
        ` */`,
        `export const GET = docs.llmsFullTxt;`,
        `export const dynamic = 'force-static';`,
        ``,
      ].join('\n'),
    },
  ];

  /*
   * ⚠️ ONLY UNDER A SUB-MOUNT, AND IT IS USUALLY SKIPPED. `create-next-app`
   * writes this file, so the scaffold leaves it alone — but a bare project
   * without one produces an application Next refuses to build, with an error
   * about a missing root layout rather than about anything here.
   */
  if (basePath !== '/') {
    files.push({
      file: `${appDir}/layout.tsx`,
      contents: [
        `import type { ReactNode } from 'react';`,
        ``,
        `/* Your application's root layout. If you already had one, this file`,
        ` * was left alone. */`,
        `export default function RootLayout({`,
        `  children,`,
        `}: {`,
        `  children: ReactNode;`,
        `}): ReactNode {`,
        `  return (`,
        `    <html lang="en">`,
        `      <body>{children}</body>`,
        `    </html>`,
        `  );`,
        `}`,
        ``,
      ].join('\n'),
    });
  }

  if (options.llmsIndex === true) {
    files.push({
      file: `${routeDir}/llms.txt/route.ts`,
      contents: [
        `import { docs } from '${configImport}';`,
        ``,
        `/*`,
        ` * The corpus index — one line per page, in llmstxt.org's format.`,
        ` * Optional: \`llms-full.txt\` already carries every page and its URL.`,
        ` */`,
        `export const GET = docs.llmsTxt;`,
        `export const dynamic = 'force-static';`,
        ``,
      ].join('\n'),
    });
  }

  return files;
}

/** What `init` did, so a caller can report it. */
export interface InitResult {
  written: string[];
  skipped: string[];
  /**
   * `true` when no product name could be found, so the config was written
   * without an `llms` block — and the "Copy page" button will not render until
   * one is added.
   */
  needsTitle?: boolean;
}

/**
 * The project's own name, for `llms.title`.
 *
 * ⚠️ THE REAL NAME OR NOTHING. `acme-docs` is not elegant, but it is *true* —
 * nobody publishes it by accident, because it is already what they called the
 * project. An invented one builds cleanly and is therefore never noticed.
 *
 * Any failure is silence: a missing `package.json`, invalid JSON, a name that
 * is not a string. None of them is worth stopping a scaffold over, and all of
 * them land in the same place — no `llms`, and a line saying so.
 */
async function readProjectName(cwd: string): Promise<string | undefined> {
  try {
    const raw = await readFile(path.join(cwd, 'package.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const name = (parsed as { name?: unknown }).name;
    return typeof name === 'string' && name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Write the scaffold into `cwd`, skipping anything that already exists.
 *
 * `wx` rather than a `stat` first: the check and the write are then one
 * operation, so two runs at once cannot both decide a file is absent.
 */
export async function initDocs(
  cwd: string,
  options: DocsScaffoldOptions = {},
): Promise<InitResult> {
  const result: InitResult = { written: [], skipped: [] };
  const title = options.title ?? (await readProjectName(cwd));
  const resolved: DocsScaffoldOptions = {
    ...options,
    ...(title === undefined ? {} : { title }),
  };

  for (const { file, contents } of docsScaffold(resolved)) {
    const target = path.join(cwd, ...file.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await writeFile(target, contents, { encoding: 'utf8', flag: 'wx' });
      result.written.push(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      result.skipped.push(file);
    }
  }

  if (title === undefined) result.needsTitle = true;

  return result;
}

/** `--flag` names, and what they mean. */
const USAGE = `@waveso/docs

Usage
  npx @waveso/docs init [options]

Options
  --app-dir <dir>       where the App Router lives            (app)
  --config <file>       where createDocsRoute goes            (lib/docs.ts)
  --content-dir <dir>   where your markdown lives             (content/docs)
  --base-path <path>    where the docs are mounted            (/docs)
  --site-url <url>      your origin, for canonicals and links
  --llms-index          also write llms.txt, the agent index
  -h, --help            this
`;

/**
 * The entry point.
 *
 * Returns an exit code rather than calling `process.exit`, so a test can drive
 * it and a host can embed it.
 */
export async function run(
  argv: string[],
  cwd: string,
  log: (line: string) => void = console.log,
): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        'app-dir': { type: 'string' },
        config: { type: 'string' },
        'content-dir': { type: 'string' },
        'base-path': { type: 'string' },
        'site-url': { type: 'string' },
        'llms-index': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (error) {
    log(`@waveso/docs: ${(error as Error).message}\n`);
    log(USAGE);
    return 1;
  }

  const { values, positionals } = parsed;
  const command = positionals[0];

  if (values.help === true || command === undefined) {
    log(USAGE);
    return values.help === true ? 0 : 1;
  }
  if (command !== 'init') {
    log(`@waveso/docs: unknown command \`${command}\`.\n`);
    log(USAGE);
    return 1;
  }

  const result = await initDocs(cwd, {
    ...(typeof values['app-dir'] === 'string'
      ? { appDir: values['app-dir'] }
      : {}),
    ...(typeof values.config === 'string' ? { configFile: values.config } : {}),
    ...(typeof values['content-dir'] === 'string'
      ? { contentDir: values['content-dir'] }
      : {}),
    ...(typeof values['base-path'] === 'string'
      ? { basePath: values['base-path'] }
      : {}),
    ...(typeof values['site-url'] === 'string'
      ? { siteUrl: values['site-url'] }
      : {}),
    ...(values['llms-index'] === true ? { llmsIndex: true } : {}),
  });

  for (const file of result.written) log(`  created  ${file}`);
  for (const file of result.skipped) log(`  exists   ${file}  (left alone)`);

  if (result.written.length === 0) {
    log('\n@waveso/docs: everything was already there.');
    return 0;
  }

  const contentDir =
    typeof values['content-dir'] === 'string'
      ? values['content-dir']
      : 'content/docs';

  log(
    [
      '',
      '@waveso/docs: done. Next:',
      '',
      `  1. Put some markdown in ${contentDir}/`,
      '  2. Uncomment `siteUrl` in your config',
      ...(result.needsTitle === true
        ? [
            '',
            '  No `name` in package.json, so no `llms` block was written —',
            '  add `llms: { title: "Your product" }` to serve llms.txt and',
            '  llms-full.txt, and to turn on the "Copy page" button.',
          ]
        : []),
      '',
    ].join('\n'),
  );
  return 0;
}
