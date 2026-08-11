import type { ComponentProps, ComponentType, JSX, ReactNode } from 'react';

import type { CalloutProps } from './callout.js';
import { Callout } from './callout.js';
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
}

/** Schemes we send to a new tab. `mailto:`/`tel:` are left to the OS. */
const HTTP_SCHEME = /^https?:\/\//i;
/** Any URL with a scheme, or protocol-relative. */
const ABSOLUTE_URL = /^([a-z][a-z0-9+.-]*:|\/\/)/i;
/** YouTube ids are 11 characters of base64url. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Extract a video id from a YouTube watch/short/embed URL.
 *
 * Returns `undefined` for anything else, including YouTube URLs that are not a
 * single video (channels, playlists) — those stay ordinary links.
 */
export function parseYouTubeId(href: string): string | undefined {
  let url: URL;
  try {
    url = new URL(href, 'https://example.invalid');
  } catch {
    return undefined;
  }

  const host = url.hostname.replace(/^(www|m)\./, '');
  const segments = url.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be') {
    const [id] = segments;
    return id !== undefined && VIDEO_ID.test(id) ? id : undefined;
  }

  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') {
    return undefined;
  }

  if (url.pathname === '/watch') {
    const id = url.searchParams.get('v');
    return id !== null && VIDEO_ID.test(id) ? id : undefined;
  }

  const [prefix, id] = segments;
  if ((prefix === 'embed' || prefix === 'shorts') && id !== undefined) {
    return VIDEO_ID.test(id) ? id : undefined;
  }

  return undefined;
}

/** Collapse a link's children to plain text, or `undefined` if not plain. */
function getPlainText(children: ReactNode): string | undefined {
  if (typeof children === 'string') {
    return children;
  }
  if (Array.isArray(children) && children.every((c) => typeof c === 'string')) {
    return children.join('');
  }
  return undefined;
}

/**
 * Whether this anchor is a bare URL rather than a labelled link.
 *
 * remark-gfm autolinks bare URLs into `<a href="X">X</a>`, sometimes dropping
 * the scheme from the label (`www.youtube.com/...`). Only those become video
 * facades: `[the intro](https://youtu.be/x)` keeps its label and stays a link.
 */
function isBareUrl(href: string, children: ReactNode): boolean {
  const text = getPlainText(children);
  if (text === undefined) {
    return false;
  }
  const strip = (value: string) =>
    value.replace(HTTP_SCHEME, '').replace(/\/$/, '');
  return strip(text) === strip(href);
}

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

function createAnchor(Link: DocsLinkComponent | undefined) {
  return function MarkdownAnchor({
    href,
    children,
    ...rest
  }: ComponentProps<'a'>): ReactNode {
    if (href === undefined) {
      return <a {...rest}>{children}</a>;
    }

    if (isBareUrl(href, children)) {
      const videoId = parseYouTubeId(href);
      if (videoId !== undefined) {
        return <YouTube id={videoId} />;
      }
    }

    if (HTTP_SCHEME.test(href) || href.startsWith('//')) {
      return (
        <a {...rest} href={href} target="_blank" rel="noopener noreferrer">
          {children}
          <span className="wave-docs-sr-only"> (opens in a new tab)</span>
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
    ...rest
  }: ComponentProps<'img'>): ReactNode {
    const resolvedWidth = toDimension(width);
    const resolvedHeight = toDimension(height);

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
        <Image
          src={src}
          alt={alt ?? ''}
          width={resolvedWidth}
          height={resolvedHeight}
          title={title}
          className={joinClassNames('wave-docs-image', className)}
          loading="lazy"
        />
      );
    }

    return (
      // biome-ignore lint/performance/noImgElement: cannot import `next/image` — this layer stays host-agnostic, and the caller injects an optimising component when it has one.
      <img
        {...rest}
        src={src}
        alt={alt ?? ''}
        width={width}
        height={height}
        title={title}
        className={joinClassNames('wave-docs-image', className)}
        loading="lazy"
        decoding="async"
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
function MarkdownTable({
  className,
  ...rest
}: ComponentProps<'table'>): ReactNode {
  return (
    <section
      className="wave-docs-table-scroll"
      aria-label="Table"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard scrolling — see above.
      tabIndex={0}
    >
      <table
        {...rest}
        className={joinClassNames('wave-docs-table', className)}
      />
    </section>
  );
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
  return {
    a: createAnchor(options.Link),
    img: createImage(options.Image),
    table: MarkdownTable,
    callout: Callout,
    youtube: YouTube,
  };
}

/** The map used when a caller supplies none. Plain `<a>` and `<img>`. */
export const defaultMarkdownComponents: MarkdownComponents =
  createMarkdownComponents();
