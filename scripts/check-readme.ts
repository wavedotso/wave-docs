/**
 * Type-check every TypeScript example in the README, as one project.
 *
 * Five factual defects in this README were found by reading it rather than by
 * running it, and two were examples that did not compile —
 * `searchOptions={{ fuzzy: 0.1 }}` in both the `.ts` and the `.tsx` form, where
 * `fuzzy` is a MiniSearch *query* default that lives one level down. Nobody
 * noticed, because nothing had ever compiled them.
 *
 * Extracted rather than duplicated into a fixture directory: a fixture is a
 * second place to edit, so it drifts, and a drifted fixture passes while the
 * README is wrong — which is precisely the failure being fixed here.
 *
 * ## Fences that name a file are assembled into a project
 *
 * A fence whose first line is a path comment — `// lib/docs.ts` — is written
 * there, so later examples can import it and `@/lib/docs` resolves to the
 * README's own code. That makes this a check on the documentation as a whole
 * rather than on nineteen unrelated snippets: an example importing a name that
 * an earlier example does not export now fails, and that is a mistake no
 * amount of proofreading reliably catches.
 *
 * Everything else is checked as a standalone module under `examples/`.
 *
 * ## Opting out
 *
 * Fences that are deliberately not modules — a bare `<html>` tag, an
 * `interface` printed as a reference table, a footgun whose whole point is
 * that it compiles — carry an HTML comment on the line before, which renders
 * as nothing:
 *
 * ```md
 * <!-- typecheck: skip — a fragment, not a module -->
 * ```
 *
 * The reason after the dash is required by the pattern. "Skipped" with no
 * reason is how a broken example gets quietly excused.
 *
 * ```bash
 * pnpm check:readme
 * ```
 */

import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const README = path.join(ROOT, 'README.md');

/** ` ```ts ` / ` ```tsx ` fences, plus whatever precedes them on the line before. */
const FENCE =
  /(?:^(?<marker>[^\n]*)\n)?^```(?<lang>tsx?)\n(?<body>[\s\S]*?)^```$/gm;

const SKIP = /<!--\s*typecheck:\s*skip\s*[—-]\s*(?<reason>[^>]*?)\s*-->/;

/** `// lib/docs.ts` on the first line — the file the example claims to be. */
const NAMED_FILE = /^\/\/\s*(?<file>[\w./[\]-]+\.tsx?)\s*(?:—[^\n]*)?$/;

interface Example {
  /** 1-based, in README order — the number reported when one fails. */
  index: number;
  line: number;
  /** Path inside the generated project. */
  file: string;
  body: string;
}

function extract(markdown: string): {
  examples: Example[];
  skipped: Array<{ line: number; reason: string }>;
} {
  const examples: Example[] = [];
  const skipped: Array<{ line: number; reason: string }> = [];
  let index = 0;

  for (const match of markdown.matchAll(FENCE)) {
    const { marker, lang, body } = match.groups ?? {};
    if (lang === undefined || body === undefined) continue;

    index += 1;
    const line = markdown.slice(0, match.index).split('\n').length;
    const skip = marker === undefined ? null : SKIP.exec(marker);

    if (skip !== null) {
      skipped.push({ line, reason: skip.groups?.reason ?? '' });
      continue;
    }

    const named = NAMED_FILE.exec(body.split('\n')[0] ?? '');
    const file =
      named?.groups?.file ??
      `examples/example-${String(index).padStart(2, '0')}.${lang}`;

    examples.push({ index, line, file, body });
  }

  return { examples, skipped };
}

function main(): void {
  const markdown = readFileSync(README, 'utf8');
  const { examples, skipped } = extract(markdown);

  if (examples.length === 0) {
    console.error(
      'check:readme: matched no examples at all. The fence pattern is wrong ' +
        '— this would otherwise pass by checking nothing.',
    );
    process.exit(1);
  }

  /*
   * Inside the repository, not `os.tmpdir()`. Module resolution walks up from
   * the file, so a project here finds the real `node_modules` — which is what
   * lets `@waveso/docs/next` resolve by Node's own self-reference through the
   * published `exports` map, exactly as a consumer resolves it, instead of
   * through a `paths` alias that would check a different thing.
   */
  const dir = mkdtempSync(path.join(ROOT, '.readme-check-'));
  try {
    /*
     * Two fences claiming one path is a real defect, not a harness detail: the
     * reader is told to put two different bodies in the same file, and without
     * this the second silently wins and the first is never checked at all.
     * (It happened on the first run of this script.)
     */
    const claimed = new Map<string, Example>();
    for (const example of examples) {
      const previous = claimed.get(example.file);
      if (previous !== undefined) {
        console.error(
          `check:readme: two examples both claim to be \`${example.file}\` — ` +
            `README.md:${previous.line} and README.md:${example.line}. ` +
            'Give one of them a different path, or drop its path comment.',
        );
        process.exit(1);
      }
      claimed.set(example.file, example);

      const file = path.join(dir, example.file);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, example.body);
    }

    writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify(
        {
          /*
           * `create-next-app`'s tsconfig, not this package's.
           *
           * The examples are consumer code, so the bar is the configuration
           * the reader actually has. Checking them under the package's own
           * settings manufactures failures that say nothing about the
           * example: `exactOptionalPropertyTypes` alone rejects
           * `<DocsSidebar Link={Link} />`, because Next's `LinkProps`
           * re-declares `onClick?`, `onMouseEnter?` and `onTouchStart?`
           * without `| undefined` and React's anchor props include it. That
           * is a disagreement between two dependencies' declaration files,
           * true of every `next/link` call site in every project with the
           * flag on, and nothing the README can fix by being written
           * differently. It is documented under Troubleshooting instead.
           */
          compilerOptions: {
            strict: true,
            target: 'ES2017',
            lib: ['dom', 'dom.iterable', 'esnext'],
            module: 'esnext',
            moduleResolution: 'bundler',
            jsx: 'react-jsx',
            esModuleInterop: true,
            resolveJsonModule: true,
            isolatedModules: true,
            noEmit: true,
            skipLibCheck: true,
            baseUrl: '.',
            // The alias `create-next-app` sets up, and the one every example
            // in the README is written against.
            paths: { '@/*': ['./*'] },
          },
          include: ['./**/*.ts', './**/*.tsx'],
        },
        null,
        2,
      ),
    );

    const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
    const result = spawnSync(
      process.execPath,
      [tsc, '--noEmit', '--project', path.join(dir, 'tsconfig.json')],
      { encoding: 'utf8' },
    );

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    if (result.status !== 0) {
      // Rewrite generated paths back to README lines, so the report names
      // where to edit rather than a directory that no longer exists.
      let located = output.replaceAll(`${dir}${path.sep}`, '');
      for (const example of examples) {
        located = located.replaceAll(
          example.file,
          `README.md:${example.line} [${example.file}]`,
        );
      }
      console.error(located.trim());
      console.error(
        `\ncheck:readme: ${examples.length} example(s) checked, at least one ` +
          'does not compile. Fix the README, or mark the fence ' +
          '`<!-- typecheck: skip — why -->` if it is deliberately a fragment.',
      );
      process.exit(1);
    }

    console.log(`check:readme: ${examples.length} example(s) compile.`);
    for (const { line, reason } of skipped) {
      console.log(`  – skipped README.md:${line} — ${reason}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main();
