/**
 * The syntax highlighter used for documentation code blocks.
 *
 * Deliberately fine-grained: `shiki/core` plus one static import per grammar
 * and per theme. The bundled entry points (`shiki`, `@shikijs/rehype`) pull all
 * 346 grammars — roughly 11MB and four seconds per build worker — for a docs
 * site that realistically uses a dozen. Nothing here reaches the browser
 * either way; the cost is build time, and it is worth avoiding.
 *
 * The regex engine is the JavaScript one, so no WASM is loaded and the module
 * works unchanged in a Next.js build worker or a plain Node script.
 */

import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { docsError } from './docs-error.js';

/*
 * Shiki's own type entry (`@shikijs/types`) is only a transitive dependency, so
 * naming it in an import would make our published `.d.ts` depend on a package
 * consumers never installed. Deriving the same types from the function we
 * already import keeps the public surface honest.
 */
type HighlighterCoreOptions = Parameters<typeof createHighlighterCore>[0];
type LanguageInput = NonNullable<
  NonNullable<HighlighterCoreOptions['langs']>[number]
>;
type ThemeInput = NonNullable<
  NonNullable<HighlighterCoreOptions['themes']>[number]
>;

/** A ready-to-use Shiki highlighter carrying only the docs grammars. */
export type DocsHighlighter = Awaited<ReturnType<typeof createHighlighterCore>>;

/**
 * Grammar loaders, keyed by every name an author might reasonably write in a
 * fence. Shiki resolves its own aliases once a grammar is loaded; the extra
 * keys exist so `langs: ['ts']` in user config does not fail the lookup below.
 *
 * Every entry is a static `import()` specifier: that is what lets a bundler
 * see the dependency without pulling the full bundle.
 */
/**
 * The `ini` grammar, with `cfg` and `conf` registered as aliases of it.
 *
 * ⚠️ SHIKI RESOLVES A FENCE AGAINST A GRAMMAR'S OWN ALIASES, not against the
 * keys of {@link LANG_LOADERS}. `ini` ships exactly one alias, `properties`, so
 * ```cfg threw `Language 'cfg' not found` and `fallbackLanguage` rendered the
 * block as plain text. Loading the grammar under a `cfg` key would not have
 * helped — the lookup that fails is Shiki's, not ours.
 *
 * It matters because the fence an author types follows the filename. A FiveM
 * docs site is mostly `server.cfg`, and nobody writes ```ini above a file
 * called `server.cfg`.
 *
 * One function object, shared by every key that wants it: the dedup below is by
 * loader identity, so `langs: ['ini', 'cfg']` still loads the grammar once.
 */
const loadIni: LanguageInput = async () => {
  const loaded = (await import('@shikijs/langs/ini')).default;
  const grammars = Array.isArray(loaded) ? loaded : [loaded];
  return grammars.map((grammar) =>
    grammar.name === 'ini'
      ? { ...grammar, aliases: [...(grammar.aliases ?? []), 'cfg', 'conf'] }
      : grammar,
  );
};

const LANG_LOADERS = {
  typescript: () => import('@shikijs/langs/typescript'),
  ts: () => import('@shikijs/langs/typescript'),
  tsx: () => import('@shikijs/langs/tsx'),
  javascript: () => import('@shikijs/langs/javascript'),
  js: () => import('@shikijs/langs/javascript'),
  jsx: () => import('@shikijs/langs/jsx'),
  json: () => import('@shikijs/langs/json'),
  shellscript: () => import('@shikijs/langs/shellscript'),
  bash: () => import('@shikijs/langs/shellscript'),
  sh: () => import('@shikijs/langs/shellscript'),
  shell: () => import('@shikijs/langs/shellscript'),
  zsh: () => import('@shikijs/langs/shellscript'),
  css: () => import('@shikijs/langs/css'),
  html: () => import('@shikijs/langs/html'),
  markdown: () => import('@shikijs/langs/markdown'),
  md: () => import('@shikijs/langs/markdown'),
  yaml: () => import('@shikijs/langs/yaml'),
  yml: () => import('@shikijs/langs/yaml'),
  diff: () => import('@shikijs/langs/diff'),
  sql: () => import('@shikijs/langs/sql'),
  python: () => import('@shikijs/langs/python'),
  py: () => import('@shikijs/langs/python'),
  go: () => import('@shikijs/langs/go'),
  rust: () => import('@shikijs/langs/rust'),
  rs: () => import('@shikijs/langs/rust'),
  prisma: () => import('@shikijs/langs/prisma'),
  ini: loadIni,
  cfg: loadIni,
  conf: loadIni,
  properties: loadIni,
  toml: () => import('@shikijs/langs/toml'),
} satisfies Record<string, LanguageInput>;

/** Theme loaders. Same static-import constraint as {@link LANG_LOADERS}. */
const THEME_LOADERS = {
  'github-light': () => import('@shikijs/themes/github-light'),
  'github-dark': () => import('@shikijs/themes/github-dark'),
  'github-light-default': () => import('@shikijs/themes/github-light-default'),
  'github-dark-default': () => import('@shikijs/themes/github-dark-default'),
  'vitesse-light': () => import('@shikijs/themes/vitesse-light'),
  'vitesse-dark': () => import('@shikijs/themes/vitesse-dark'),
  'min-light': () => import('@shikijs/themes/min-light'),
  'min-dark': () => import('@shikijs/themes/min-dark'),
  'one-light': () => import('@shikijs/themes/one-light'),
  'one-dark-pro': () => import('@shikijs/themes/one-dark-pro'),
  'catppuccin-latte': () => import('@shikijs/themes/catppuccin-latte'),
  'catppuccin-mocha': () => import('@shikijs/themes/catppuccin-mocha'),
  nord: () => import('@shikijs/themes/nord'),
} satisfies Record<string, ThemeInput>;

/** A grammar name accepted by {@link createDocsHighlighter}. */
export type DocsLang = keyof typeof LANG_LOADERS;

/** A theme name accepted by {@link createDocsHighlighter}. */
export type DocsTheme = keyof typeof THEME_LOADERS;

/**
 * The light/dark pair. Two themes rather than one is what makes Shiki emit
 * `--shiki-light` / `--shiki-dark` CSS variables, which is how the stylesheet
 * switches colour scheme without shipping a second copy of every token.
 */
export type DocsThemes = {
  light: DocsTheme;
  dark: DocsTheme;
  // A type alias rather than an interface on purpose: Shiki's `themes` option
  // is a `Record<string, …>`, and only aliases get the implicit index
  // signature that makes them assignable to one.
};

/**
 * Languages loaded when none are configured: what technical documentation
 * actually contains. Anything outside this list falls back to plain text
 * rather than throwing — see {@link createDocsHighlighter}.
 */
export const DEFAULT_DOCS_LANGS: readonly DocsLang[] = [
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'json',
  'shellscript',
  'css',
  'html',
  'markdown',
  'yaml',
  'diff',
  'sql',
  'python',
  'go',
  'rust',
  'prisma',
  'ini',
  'toml',
];

/** Default theme pair. */
export const DEFAULT_DOCS_THEMES: DocsThemes = {
  light: 'github-light',
  dark: 'github-dark',
};

export interface DocsHighlighterOptions {
  /**
   * Grammars to load. Names or aliases (`'ts'`, `'bash'`). Defaults to
   * {@link DEFAULT_DOCS_LANGS}.
   *
   * Narrowed to {@link DocsLang} so `'typescrpt'` is a compile error rather
   * than a build-time throw. The runtime check below stays for JavaScript
   * callers and for values that arrive from JSON config.
   */
  langs?: readonly DocsLang[] | undefined;
  /** Theme pair. Defaults to {@link DEFAULT_DOCS_THEMES}. */
  themes?: DocsThemes | undefined;
}

/**
 * Highlighters are cached per resolved option set, not per call.
 *
 * The *promise* is cached rather than the resolved highlighter because build
 * tools call this concurrently — Next.js renders route segments in parallel —
 * and caching after the await races into two grammar loads. Keyed rather than
 * a single slot so that a second call
 * with different languages gets a highlighter that actually has them.
 */
const highlighters = new Map<string, Promise<DocsHighlighter>>();

function isDocsLang(name: string): name is DocsLang {
  return Object.hasOwn(LANG_LOADERS, name);
}

function isDocsTheme(name: string): name is DocsTheme {
  return Object.hasOwn(THEME_LOADERS, name);
}

/**
 * Create (or reuse) the process-wide highlighter for a given option set.
 *
 * Unknown language and theme names throw rather than degrading: the set is
 * fixed at build time, so a typo in config is a build bug, and silently
 * shipping unhighlighted code is exactly the failure this package exists to
 * avoid. If you need a grammar outside the curated set, build your own
 * `createHighlighterCore` and hand it to `createDocsRenderer({ highlighter })`.
 */
export function createDocsHighlighter(
  options: DocsHighlighterOptions = {},
): Promise<DocsHighlighter> {
  const themes = options.themes ?? DEFAULT_DOCS_THEMES;
  const requested = options.langs ?? DEFAULT_DOCS_LANGS;

  for (const theme of [themes.light, themes.dark]) {
    if (!isDocsTheme(theme)) {
      throw docsError(
        'unknown-theme',
        `@waveso/docs: unknown Shiki theme '${theme}'. ` +
          `Supported themes: ${Object.keys(THEME_LOADERS).sort().join(', ')}. ` +
          'To use another theme, pass your own highlighter to createDocsRenderer().',
      );
    }
  }

  // Sorted + deduplicated so `['ts','tsx']` and `['tsx','ts']` share a cache
  // entry, and so aliases of one grammar do not load it twice.
  const langs = [...new Set(requested)].sort();
  // A `Set` of loaders rather than of names: `ts` and `typescript` are the same
  // grammar and must not be registered twice.
  const loaders = new Set<LanguageInput>();
  for (const lang of langs) {
    if (!isDocsLang(lang)) {
      throw docsError(
        'unknown-language',
        `@waveso/docs: unknown code language '${lang}'. ` +
          `Supported languages: ${Object.keys(LANG_LOADERS).sort().join(', ')}. ` +
          'To use another grammar, pass your own highlighter to createDocsRenderer().',
      );
    }
    loaders.add(LANG_LOADERS[lang]);
  }

  /*
   * ⚠️ THE THEME KEYS ARE NAMED, NOT SPREAD. `JSON.stringify` preserves
   * insertion order, so `{ light, dark }` and `{ dark, light }` — the same pair,
   * written two ways — produced two keys and two whole Shiki instances, each
   * with every grammar loaded. `langs` was already sorted for exactly this
   * reason; the object beside it was not.
   */
  const key = JSON.stringify({
    langs,
    light: themes.light,
    dark: themes.dark,
  });
  const cached = highlighters.get(key);
  if (cached) {
    return cached;
  }

  const created = createHighlighterCore({
    engine: createJavaScriptRegexEngine(),
    themes: [THEME_LOADERS[themes.light], THEME_LOADERS[themes.dark]],
    langs: [...loaders],
  }).catch((error: unknown) => {
    // Evict on failure: caching a rejected promise would poison every later
    // call in the process for what may have been a transient import error.
    highlighters.delete(key);
    throw error;
  });

  highlighters.set(key, created);
  return created;
}
