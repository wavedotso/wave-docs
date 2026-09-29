/**
 * Read, render and check a content tree — the part no framework owns.
 *
 * Both adapters do the same four things before anything framework-shaped
 * happens: collect every published route so links can be proved, construct a
 * renderer from the consumer's options, render every page, and check the
 * cross-page anchors that only exist once every page is in hand. None of that
 * is Next's or Vite's, and until there was a second adapter it lived inside
 * `next.ts` because there was nowhere better for it to be.
 *
 * ⚠️ THIS EXISTS BECAUSE OF {@link docsRendererOptions}, NOT BECAUSE THREE
 * FUNCTIONS LOOKED ALIKE. That one is a ten-branch conditional spread over
 * every render-affecting option the package has, and a second copy of it is a
 * standing invitation to add an option to one adapter and forget the other —
 * a bug with no failing test, because each adapter's own suite passes. One
 * function means a new option is wired for every adapter or for none.
 *
 * What deliberately stays per-adapter is the *caching*. Next memoises its
 * rescan through `React.cache` so that concurrently-running `generateMetadata`
 * and `Page` share one disk walk; a Vite dev server invalidates on a watcher
 * event instead. Those are not two spellings of one idea, so they are not
 * merged here.
 */

import type { PluggableList } from 'unified';

import { assertAnchors } from './anchors.js';
import { docsError } from './docs-error.js';
import { describeSuggestion } from './link-suggestion.js';
import { mapPooled } from './map-pooled.js';
import type { RehypeCodeFrameOptions } from './plugins/rehype-code-frame.js';
import type {
  DocsRenderer,
  DocsRendererConfig,
  DocsRendererOptions,
} from './render.js';
import type { DocsHighlighter, DocsLang, DocsThemes } from './highlighter.js';
import { toAliasRoute } from './route-path.js';
import type {
  DocFile,
  DocFrontmatter,
  ImageResolver,
  LinkResolver,
  RenderedDoc,
} from './types.js';

/**
 * Pages rendered at once by {@link renderDocs}.
 *
 * Shiki is the bottleneck and it is synchronous per document, so more
 * concurrency buys nothing past the point where one core is always busy; the
 * pool exists to keep a thousand-page tree from opening a thousand file
 * handles.
 */
const RENDER_CONCURRENCY = 16;

/**
 * Every render-affecting option, with no route sets and no config.
 *
 * Named as its own type so an adapter's own options interface can extend it
 * and stay in step: adding a field here is what makes it available to every
 * adapter at once, which is the point of the file.
 */
export interface DocsBuildRenderOptions {
  highlighter?: DocsHighlighter | Promise<DocsHighlighter> | undefined;
  langs?: readonly DocsLang[] | undefined;
  themes?: DocsThemes | undefined;
  excludeLangs?: readonly string[] | undefined;
  codeLabels?: RehypeCodeFrameOptions | undefined;
  titleHeading?: boolean | undefined;
  remarkPlugins?: PluggableList | undefined;
  rehypePlugins?: PluggableList | undefined;
  linkResolver?: LinkResolver | undefined;
  imageResolver?: ImageResolver | undefined;
}

/** The three route sets a renderer checks links against. */
export interface DocsBuildRoutes {
  /** Every published page's href. A link to one resolves. */
  knownRoutes: ReadonlySet<string>;
  /**
   * Every `draft: true` page's href. Diagnostic only — read after
   * `knownRoutes` has already missed, purely to tell an author linking a draft
   * from an author linking a typo.
   */
  draftRoutes: ReadonlySet<string>;
  /** Alias route → the href it redirects to. Also diagnostic. */
  aliasRoutes: ReadonlyMap<string, string>;
}

/**
 * Record each page's own route in `into`, and each of its aliases in `aliases`.
 *
 * ⚠️ THE TWO ARE KEPT APART ON PURPOSE. An alias used to be added to
 * `knownRoutes` on the reasoning that a permanent redirect resolves — but it
 * only resolves once the consumer has wired the redirects up, which a quick
 * start never does, and no adapter emits a static route for it either. So a
 * page linking a sibling's alias built green and 404'd for every reader.
 */
export function collectDocRoutes<TFrontmatter extends DocFrontmatter>(
  into: Set<string>,
  aliases: Map<string, string>,
  files: ReadonlyArray<DocFile<TFrontmatter>>,
  basePath: string,
): void {
  for (const file of files) {
    into.add(file.href);
    for (const alias of file.frontmatter.aliases ?? []) {
      aliases.set(toAliasRoute(alias, basePath, file.relativePath), file.href);
    }
  }
}

/**
 * The full {@link DocsRendererOptions} for a set of consumer options.
 *
 * ⚠️ EVERY BRANCH IS `undefined ? {} : { key: value }` RATHER THAN A SPREAD OF
 * THE WHOLE OBJECT, AND THAT IS NOT STYLE. This package compiles with
 * `exactOptionalPropertyTypes`, under which passing `{ themes: undefined }` is
 * not the same as omitting `themes` — the first is a type error against an
 * option declared `themes?: DocsThemes` and, where it type-checks, overwrites
 * a default with `undefined` instead of leaving it alone.
 */
export function docsRendererOptions(
  config: DocsRendererConfig,
  routes: DocsBuildRoutes,
  options: DocsBuildRenderOptions,
): DocsRendererOptions {
  return {
    config,
    knownRoutes: routes.knownRoutes,
    draftRoutes: routes.draftRoutes,
    aliasRoutes: routes.aliasRoutes,
    ...(options.highlighter === undefined
      ? {}
      : { highlighter: options.highlighter }),
    ...(options.langs === undefined ? {} : { langs: options.langs }),
    ...(options.themes === undefined ? {} : { themes: options.themes }),
    ...(options.excludeLangs === undefined
      ? {}
      : { excludeLangs: options.excludeLangs }),
    ...(options.codeLabels === undefined
      ? {}
      : { codeLabels: options.codeLabels }),
    ...(options.titleHeading === undefined
      ? {}
      : { titleHeading: options.titleHeading }),
    ...(options.remarkPlugins === undefined
      ? {}
      : { remarkPlugins: options.remarkPlugins }),
    ...(options.rehypePlugins === undefined
      ? {}
      : { rehypePlugins: options.rehypePlugins }),
    ...(options.linkResolver === undefined
      ? {}
      : { linkResolver: options.linkResolver }),
    ...(options.imageResolver === undefined
      ? {}
      : { imageResolver: options.imageResolver }),
  };
}

/** How a broken cross-page anchor is reported. */
export type DocsAnchorSeverity = 'ignore' | 'warn' | 'throw';

/**
 * Report a broken cross-page anchor at the configured severity.
 *
 * No line number, unlike the same-page check inside `render`: positions are
 * stripped from a returned tree, so the page and the link are what there is to
 * name.
 */
export function reportBrokenAnchor(
  severity: DocsAnchorSeverity,
  message: string,
): void {
  if (severity === 'ignore') return;
  if (severity === 'throw') throw docsError('broken-anchor', message);
  console.warn(message);
}

/**
 * Render every file, then prove every cross-page anchor.
 *
 * ⚠️ CROSS-PAGE ANCHORS CAN ONLY BE CHECKED HERE, AND THIS IS THE FIRST MOMENT
 * THEY CAN. `render` sees one page, so it can prove `#setup` exists on the page
 * being rendered and nothing about `./other.md#setup` — the ids of `other` do
 * not exist until `other` has been rendered. Once every page is in hand they
 * all do.
 */
export async function renderDocs<TFrontmatter extends DocFrontmatter>(
  files: ReadonlyArray<DocFile<TFrontmatter>>,
  renderer: DocsRenderer,
  onBrokenAnchor: (message: string) => void,
): Promise<Array<RenderedDoc<TFrontmatter>>> {
  const rendered = await mapPooled(files, RENDER_CONCURRENCY, (file) =>
    renderer.render(file),
  );

  assertAnchors(rendered, (from, link, known) => {
    onBrokenAnchor(
      `@waveso/docs: ${from} links to '${link.href}', and '${link.route}' ` +
        `has no '#${link.fragment}'.${describeSuggestion(
          link.fragment,
          known,
        )} Heading ids come from the heading text, so renaming a heading ` +
        'renames its anchor.',
    );
  });

  return rendered;
}
