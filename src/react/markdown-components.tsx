import type { ComponentProps, ComponentType, JSX, ReactNode } from 'react';

import type { CalloutProps } from './callout.js';
import { Callout } from './callout.js';
import type { DocsLabels } from './shell-labels.js';
import type { CalloutType } from './callout.js';
import type { YouTubeProps } from './youtube.js';
import { YouTube } from './youtube.js';

/**
 * The component map handed to `hast-util-to-jsx-runtime`.
 *
 * Deliberately not that package's own `Components` type. `Components` is keyed
 * by `keyof JSX.IntrinsicElements` resolved from the *global* `JSX` namespace,
 * which React 19 no longer declares — so under this repo's config it collapses
 * to a `string`-keyed map of `any`, and elsewhere it rejects the custom tag
 * names our pipeline emits (`callout`, `youtube`). Keying off `React.JSX`
 * explicitly gives real prop types in both worlds and room for our own tags.
 *
 * Note the absence of `node`: {@link DocContent} renders with `passNode: false`,
 * so a component here can spread its props onto a DOM element without leaking
 * `node="[object Object]"` into the HTML.
 */
export type MarkdownComponents = {
  [Tag in keyof JSX.IntrinsicElements]?: ComponentType<
    JSX.IntrinsicElements[Tag]
  >;
} & {
  /** `<callout type="warning">`, emitted from `> [!WARNING]`. */
  callout?: ComponentType<CalloutProps>;
  /** `<youtube id="...">`, emitted from a bare YouTube URL. */
  youtube?: ComponentType<YouTubeProps>;
};

/**
 * Props the injected link component must accept.
 *
 * Shaped to be satisfied by `next/link` without this package ever importing it
 * — importing `next/*` here would couple the React layer to Next, and keeping
 * it host-agnostic is half the point of the package. Do not "simplify" this
 * by importing `next/link` directly.
 */
export interface DocsLinkProps
  extends Omit<ComponentProps<'a'>, 'href' | 'ref'> {
  href: string;
  /** Honoured by `next/link`; ignored by a plain `<a>`. */
  prefetch?: boolean | undefined;
  children?: ReactNode;
}

/** A `next/link`-compatible component. */
export type DocsLinkComponent = ComponentType<DocsLinkProps>;

/**
 * Props the injected image component must accept.
 *
 * `width`/`height` are required because `next/image` refuses to render without
 * them (short of `fill`); they come from the build-time `ImageResolver`.
 */
export interface DocsImageProps {
  src: string;
  alt: string;
  width: number;
  height: number;
  title?: string | undefined;
  className?: string | undefined;
  sizes?: string | undefined;
  loading?: 'eager' | 'lazy' | undefined;
}

/** A `next/image`-compatible component. */
export type DocsImageComponent = ComponentType<DocsImageProps>;

export interface MarkdownComponentsOptions {
  /** Client-side router link, e.g. `next/link`. Falls back to `<a>`. */
  Link?: DocsLinkComponent | undefined;
  /** Optimising image component, e.g. `next/image`. Falls back to `<img>`. */
  Image?: DocsImageComponent | undefined;
  /**
   * Overrides for the strings this map renders itself.
   *
   * Five callout headings, the external-link suffix, a wide table's region
   * name and the YouTube facade's three — every one of them hardcoded English
   * until this existed, on a shell whose `labels` prop claimed to be the whole
   * of a site's translatable chrome.
   *
   * All server-rendered, so overriding them costs no client bytes.
   */
  labels?: MarkdownLabels | undefined;
}

/** The subset of `DocsLabels` this map is responsible for. */
export type MarkdownLabels = Pick<
  DocsLabels,
  | 'externalLink'
  | 'table'
  | 'calloutNote'
  | 'calloutTip'
  | 'calloutImportant'
  | 'calloutWarning'
  | 'calloutCaution'
  | 'youtubeTitle'
  | 'youtubePlay'
  | 'youtubeHide'
>;

/** Default, and the only string here a reader sees without a screen reader. */
const DEFAULT_EXTERNAL_LINK = '(opens in a new tab)';
/** Default name for a wide table's scroll region. */
const DEFAULT_TABLE = 'Table';

/** Schemes we send to a new tab. `mailto:`/`tel:` are left to the OS. */
const HTTP_SCHEME = /^https?:\/\//i;
/** Any URL with a scheme, or protocol-relative. */
const ABSOLUTE_URL = /^([a-z][a-z0-9+.-]*:|\/\/)/i;
/**
 * The schemes a markdown link may carry.
 *
 * GitHub's own allowlist, which is the bar to match: documentation links to
 * `sms:`, `ftp:` and `irc:` are ordinary, and an allowlist of three silently
 * deleted them. The point of the check is to stop `javascript:`, `data:` and
 * `vbscript:` reaching an `href`, not to have an opinion about protocols.
 *
 * A scheme not listed here — `vscode:`, `obsidian:`, `slack:` — is dropped
 * rather than rendered. That is deliberate: an allowlist that grows on request
 * is safe, one that guesses is not. {@link warnDroppedHref} makes it visible.
 */
const SAFE_SCHEME =
  /^(https?|mailto|tel|sms|ftp|ftps|irc|ircs|xmpp|news|nntp|feed|git|matrix):/i;

/** Hrefs already reported, so a re-render does not repeat the warning. */
const warnedHrefs = new Set<string>();

/**
 * Say something when a link is dropped.
 *
 * A destination that vanishes with the text left behind is the quietest
 * possible failure — the page looks fine and the link is simply gone. Every
 * other rejection in this package names a file and a fix; this one cannot see
 * the file, so it names the href and stays out of production noise.
 */
function warnDroppedHref(href: string): void {
  if (process.env.NODE_ENV === 'production' || warnedHrefs.has(href)) {
    return;
  }
  warnedHrefs.add(href);
  console.warn(
    `@waveso/docs: dropped a link to '${href}' — its URL scheme is not in ` +
      'the allowlist, so the text was kept and the destination removed. Use ' +
      'http, https, mailto, tel, sms, ftp, irc, xmpp or matrix, or render ' +
      'the link yourself with a custom `a` component.',
  );
}
/**
 * A copy of `href` as a browser will parse it.
 *
 * ASCII control characters and spaces are stripped before parsing, so
 * ` javascript:` and `java<TAB>script:` both navigate where the raw string
 * matches no scheme at all — which is how a scheme check gets walked around.
 */
function normaliseUrl(href: string): string {
  return [...href].filter((char) => (char.codePointAt(0) ?? 0) > 0x20).join('');
}

/**
 * Would this href navigate somewhere we are willing to send a reader?
 *
 * Nothing upstream filters it: `remarkDocLinks` skips every href with a scheme
 * (`isRelativeLink` is false for it), so `assertLinks` never sees one either,
 * and `remarkRehype` runs with `allowDangerousHtml` off but passes a link's own
 * url through untouched. Verified against React 19: it neutralises
 * `javascript:` in every obfuscated form, silently — but it lets `vbscript:`
 * and `data:text/html;base64,…` reach the DOM verbatim. So the allowlist is
 * ours to keep.
 *
 * Tested against {@link normaliseUrl}, not the raw string.
 */
function isSafeHref(href: string): boolean {
  const normalised = normaliseUrl(href);
  // No scheme at all — a route, a relative path, `#anchor`, `?query`.
  if (!ABSOLUTE_URL.test(normalised)) {
    return true;
  }
  // Protocol-relative inherits the page's own scheme, which is http(s).
  return normalised.startsWith('//') || SAFE_SCHEME.test(normalised);
}

/*
 * `parseYouTubeId`, `getPlainText` and `isBareUrl` MOVED TO
 * `plugins/remark-youtube.ts`. They were the render-path half of a
 * substitution that now happens once per document in Node, so keeping them
 * here would ship dead detection logic to every browser that loads a docs page.
 */

function joinClassNames(
  ...values: Array<string | undefined>
): string | undefined {
  const joined = values.filter(Boolean).join(' ');
  return joined === '' ? undefined : joined;
}

function toDimension(value: number | string | undefined): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function createAnchor(
  Link: DocsLinkComponent | undefined,
  externalLink: string,
) {
  return function MarkdownAnchor({
    href,
    children,
    ...rest
  }: ComponentProps<'a'>): ReactNode {
    if (href === undefined) {
      return <a {...rest}>{children}</a>;
    }

    // The text survives, the destination does not: the reader still sees what
    // the author wrote, and a `<span>` carries none of an anchor's attributes
    // into a place they would mean something.
    if (!isSafeHref(href)) {
      warnDroppedHref(href);
      return <span>{children}</span>;
    }

    /*
     * NO YOUTUBE BRANCH HERE ANY MORE. Returning `<YouTube>` from the anchor
     * mapping put a `<div>` inside the `<p>` that markdown wraps a link in,
     * which is invalid HTML: the parser closes the paragraph early, the DOM
     * stops matching the server output, and React 19 reports a hydration
     * mismatch and re-renders the root.
     *
     * `remarkYouTube` replaces the whole paragraph at build time instead, so
     * the tree is correct before this map is consulted — and
     * `MarkdownComponents.youtube`, unreachable while the substitution happened
     * here, is now the thing that renders.
     */
    if (HTTP_SCHEME.test(href) || href.startsWith('//')) {
      return (
        <a {...rest} href={href} target="_blank" rel="noopener noreferrer">
          {children}
          {/* The leading space is markup, not copy: it separates the suffix
              from the link text for a screen reader, and a translator should
              not have to remember to type it. */}
          <span className="wave-docs-sr-only"> {externalLink}</span>
        </a>
      );
    }

    // Same-page anchors and non-HTTP schemes (`mailto:`, `tel:`) gain nothing
    // from a router link and break under one.
    if (href.startsWith('#') || ABSOLUTE_URL.test(href) || Link === undefined) {
      return (
        <a {...rest} href={href}>
          {children}
        </a>
      );
    }

    return (
      <Link {...rest} href={href}>
        {children}
      </Link>
    );
  };
}

function createImage(Image: DocsImageComponent | undefined) {
  return function MarkdownImage({
    src,
    alt,
    width,
    height,
    title,
    className,
    sizes,
    loading,
    ...rest
  }: ComponentProps<'img'>): ReactNode {
    const resolvedWidth = toDimension(width);
    const resolvedHeight = toDimension(height);
    /*
     * Lazy by default, never over the author's own choice. `remarkUnwrapImages`
     * lifts a leading image out of its paragraph to a top-level block precisely
     * because it is usually the page's LCP element, and `loading="lazy"` on the
     * LCP element costs it a round trip. Resolve it here rather than writing
     * the default after the spread, where it wins every time and
     * `loading="eager"` — declared on `DocsImageProps`, faithfully forwarded by
     * `next.ts` — is a prop no tree can actually reach.
     */
    const resolvedLoading = loading ?? 'lazy';
    const resolvedClassName = joinClassNames('wave-docs-image', className);

    // `next/image` throws without intrinsic dimensions, and the build-time
    // image resolver is optional (`image-size` is an optional peer). Degrade to
    // a plain `<img>` instead of failing the page.
    if (
      Image !== undefined &&
      typeof src === 'string' &&
      resolvedWidth !== undefined &&
      resolvedHeight !== undefined
    ) {
      return (
        // `rest` first, so nothing below can be overwritten by the tree, and
        // so an attribute the plain branch honours — `decoding`,
        // `fetchPriority` — is not silently dropped by the optimising one.
        <Image
          {...rest}
          src={src}
          alt={alt ?? ''}
          width={resolvedWidth}
          height={resolvedHeight}
          title={title}
          className={resolvedClassName}
          sizes={sizes}
          loading={resolvedLoading}
        />
      );
    }

    return (
      // biome-ignore lint/performance/noImgElement: cannot import `next/image` — this layer stays host-agnostic, and the caller injects an optimising component when it has one.
      <img
        // Before the spread, so a tree that sets `decoding` itself keeps it.
        // The optimising branch needs no equivalent: `next/image` applies
        // `decoding="async"` on its own.
        decoding="async"
        {...rest}
        src={src}
        alt={alt ?? ''}
        width={width}
        height={height}
        title={title}
        className={resolvedClassName}
        sizes={sizes}
        loading={resolvedLoading}
      />
    );
  };
}

/**
 * A table wrapped in its own scroll container.
 *
 * A wide table cannot be made scrollable by CSS alone without an extra
 * element, and a scroll container that is not focusable cannot be scrolled by
 * keyboard at all — hence the `tabIndex`, which is the documented exception to
 * "no tabindex on non-interactive elements", not a violation of it. A labelled
 * `<section>` is a `region` landmark, so the tab stop announces itself instead
 * of being a mystery stop in the tab order.
 */
function createTable(label: string) {
  return function MarkdownTable({
    className,
    ...rest
  }: ComponentProps<'table'>): ReactNode {
    return (
      <section
        className="wave-docs-table-scroll"
        aria-label={label}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard scrolling — see above.
        tabIndex={0}
      >
        <table
          {...rest}
          className={joinClassNames('wave-docs-table', className)}
        />
      </section>
    );
  };
}

/**
 * Build the default component map, optionally injecting host-specific link and
 * image components.
 *
 * Call it once at module scope: every call returns fresh component identities,
 * and remounting the whole document on each render is not what you want.
 *
 * @example
 * ```tsx
 * // Next.js
 * const components = createMarkdownComponents({ Link, Image });
 * // Any other host — plain <a> and <img>
 * const components = createMarkdownComponents();
 * ```
 */
export function createMarkdownComponents(
  options: MarkdownComponentsOptions = {},
): MarkdownComponents {
  const labels = options.labels ?? {};
  const calloutTitles = calloutTitleMap(labels);

  return {
    a: createAnchor(options.Link, labels.externalLink ?? DEFAULT_EXTERNAL_LINK),
    img: createImage(options.Image),
    table: createTable(labels.table ?? DEFAULT_TABLE),
    /*
     * The per-type headings go in as a map, and `Callout` picks. Resolving the
     * heading here would need its rule for an unrecognised `type` — an
     * attribute that arrives unvalidated out of the markdown — and a second copy
     * of that rule is a second thing to keep in step. `undefined` when nothing
     * is set, so an unconfigured site renders exactly the element it did before.
     */
    callout: (props: CalloutProps) => (
      <Callout
        {...props}
        {...(calloutTitles === undefined ? {} : { labels: calloutTitles })}
      />
    ),
    youtube: (props: YouTubeProps) => (
      <YouTube {...youtubeDefaults(labels, props)} />
    ),
  };
}

/** The five headings as `Callout` wants them, or `undefined` if none are set. */
function calloutTitleMap(
  labels: MarkdownLabels,
): Partial<Record<CalloutType, string>> | undefined {
  const titles: Partial<Record<CalloutType, string>> = {};
  let found = false;
  for (const [type, key] of Object.entries(CALLOUT_LABEL_KEYS) as Array<
    [CalloutType, keyof MarkdownLabels]
  >) {
    const value = labels[key];
    if (value !== undefined) {
      titles[type] = value;
      found = true;
    }
  }
  return found ? titles : undefined;
}

/** Which `DocsLabels` key names a given callout type's heading. */
const CALLOUT_LABEL_KEYS = {
  note: 'calloutNote',
  tip: 'calloutTip',
  important: 'calloutImportant',
  warning: 'calloutWarning',
  caution: 'calloutCaution',
} as const satisfies Record<CalloutType, keyof MarkdownLabels>;

/** `props`, with the site's YouTube strings filled in. */
function youtubeDefaults(
  labels: MarkdownLabels,
  props: YouTubeProps,
): YouTubeProps {
  return {
    ...props,
    ...(props.title === undefined && labels.youtubeTitle !== undefined
      ? { title: labels.youtubeTitle }
      : {}),
    ...(labels.youtubePlay === undefined
      ? {}
      : { playLabel: labels.youtubePlay }),
    ...(labels.youtubeHide === undefined
      ? {}
      : { hideLabel: labels.youtubeHide }),
  };
}

/** The map used when a caller supplies none. Plain `<a>` and `<img>`. */
export const defaultMarkdownComponents: MarkdownComponents =
  createMarkdownComponents();
