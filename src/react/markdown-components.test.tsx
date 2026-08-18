/**
 * The component map, exercised through the tree it is actually handed.
 *
 * Going via `DocContent` rather than calling the mapped components directly is
 * deliberate: `hast-util-to-jsx-runtime` renames hast properties on the way in
 * (`fetchpriority` → `fetchPriority`), and a test that hand-builds React props
 * would prove the rename works when it does not.
 */

import { render, screen } from '@testing-library/react';
import type { Element, Root } from 'hast';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { DocContent } from './doc-content.js';
import type { DocsImageProps } from './markdown-components.js';
import { createMarkdownComponents } from './markdown-components.js';

function element(
  tagName: string,
  properties: Element['properties'],
  children: Element['children'] = [],
): Element {
  return { type: 'element', tagName, properties, children };
}

function text(value: string) {
  return { type: 'text', value } as const;
}

function root(...children: Root['children']): Root {
  return { type: 'root', children };
}

/**
 * The props an optimising component is handed.
 *
 * Wider than {@link DocsImageProps} on purpose: the point of several tests
 * below is that attributes the plain `<img>` branch honours reach this branch
 * too, and a double typed to the narrow contract could not see them arrive.
 */
interface TestImageProps extends DocsImageProps {
  decoding?: 'async' | 'auto' | 'sync' | undefined;
  fetchPriority?: 'auto' | 'high' | 'low' | undefined;
}

function TestImage(props: TestImageProps): ReactNode {
  // biome-ignore lint/performance/noImgElement: a test double for an injected image component.
  return <img data-testid="injected" {...props} alt={props.alt} />;
}

const optimised = createMarkdownComponents({ Image: TestImage });

/**
 * The `<img>` this tree rendered, whichever branch produced it. Scoped to its
 * own container: two renders in one test both stay in the document, and a
 * document-wide query would silently assert against the first of them.
 */
function renderImage(
  properties: Element['properties'],
  components?: ReturnType<typeof createMarkdownComponents>,
): HTMLImageElement {
  const { container } = render(
    <DocContent
      hast={root(element('img', properties))}
      {...(components === undefined ? {} : { components })}
    />,
  );
  const image = container.querySelector('img');
  if (image === null) {
    throw new Error('expected an image in the rendered tree');
  }
  return image;
}

const SIZED = { src: '/a.png', alt: 'A', width: 800, height: 600 };

describe('markdown images', () => {
  it('lazy-loads by default on both branches', () => {
    expect(renderImage(SIZED).getAttribute('loading')).toBe('lazy');

    const injected = renderImage(SIZED, optimised);
    expect(injected).toHaveAttribute('data-testid', 'injected');
    expect(injected.getAttribute('loading')).toBe('lazy');
  });

  it('honours an authored loading="eager" on the plain branch', () => {
    // `remarkUnwrapImages` lifts a leading image to a top-level block precisely
    // because it is usually the LCP element, and `loading="lazy"` on the LCP
    // element costs it a round trip. Written after the spread, the default won
    // every time and `eager` could not be expressed at all.
    expect(
      renderImage({ ...SIZED, loading: 'eager' }).getAttribute('loading'),
    ).toBe('eager');
  });

  it('honours an authored loading="eager" through the injected component', () => {
    expect(
      renderImage({ ...SIZED, loading: 'eager' }, optimised).getAttribute(
        'loading',
      ),
    ).toBe('eager');
  });

  it('forwards `sizes` on both branches', () => {
    // Declared on `DocsImageProps` and forwarded by `next.ts`, but never
    // populated here — a prop a consumer could read about and not reach.
    expect(renderImage({ ...SIZED, sizes: '50vw' }).getAttribute('sizes')).toBe(
      '50vw',
    );
    expect(
      renderImage({ ...SIZED, sizes: '50vw' }, optimised).getAttribute('sizes'),
    ).toBe('50vw');
  });

  it('hands the injected component the attributes the plain branch honours', () => {
    // The two branches disagreed: `fetchpriority` reached the `<img>` — next to
    // a hardcoded `loading="lazy"`, which contradicts it — and vanished
    // entirely through the optimising one, which spread nothing.
    const image = renderImage(
      { ...SIZED, fetchpriority: 'high', decoding: 'sync' },
      optimised,
    );

    expect(image.getAttribute('fetchpriority')).toBe('high');
    expect(image.getAttribute('decoding')).toBe('sync');
  });

  it('lets a tree keep its own `decoding` on the plain branch', () => {
    expect(
      renderImage({ ...SIZED, decoding: 'sync' }).getAttribute('decoding'),
    ).toBe('sync');
  });

  it('still decodes off the main thread when the tree says nothing', () => {
    expect(renderImage(SIZED).getAttribute('decoding')).toBe('async');
  });

  it('degrades to a plain `<img>` when the image has no intrinsic size', () => {
    // `next/image` throws without dimensions and the resolver is an optional
    // peer, so an unsized image must not take the injected branch.
    const image = renderImage({ src: '/a.png', alt: 'A' }, optimised);

    expect(image).not.toHaveAttribute('data-testid');
    expect(image.className).toBe('wave-docs-image');
  });
});

/**
 * Every href below is one a markdown author can write today.
 *
 * Nothing upstream filters them: `remarkDocLinks` skips any href carrying a
 * scheme, so `assertLinks` never inspects one either, and `remarkRehype` copies
 * a link's url through verbatim. Verified against React 19 as well — it
 * neutralises `javascript:` in every obfuscated form, silently, but hands
 * `vbscript:` and `data:text/html` straight to the DOM.
 */
const UNSAFE_HREFS = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  // Browsers strip ASCII control characters and spaces before parsing a URL,
  // so both of these navigate where the raw string matches no known scheme.
  ' javascript:alert(1)',
  'java\tscript:alert(1)',
  'vbscript:msgbox(1)',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
];

const SAFE_HREFS = [
  'https://example.com/a',
  'http://example.com/a',
  '//example.com/a',
  'mailto:hi@example.com',
  'tel:+441234567890',
  '#section',
  '/docs/api',
  './sibling',
  /*
   * GitHub's own allowlist, and the reason it is not shorter. An allowlist of
   * `https|mailto|tel` looked safe and silently deleted every one of these —
   * the reader saw the link text with the destination gone and nothing said so.
   * A docs site linking `sms:` for a support number or `ftp:` for a download is
   * ordinary; the check exists to stop `javascript:`, not to rank protocols.
   */
  'sms:+441234567890',
  'ftp://files.example.com/spec.pdf',
  'ftps://files.example.com/spec.pdf',
  'irc://irc.example.com/support',
  'ircs://irc.example.com/support',
  'xmpp:support@example.com',
  'news:comp.lang.javascript',
  'matrix:r/support:example.com',
];

function renderLink(href: string): void {
  render(
    <DocContent
      hast={root(element('p', {}, [element('a', { href }, [text('click')])]))}
    />,
  );
}

describe('markdown links', () => {
  for (const href of UNSAFE_HREFS) {
    it(`renders ${JSON.stringify(href)} as inert text`, () => {
      renderLink(href);

      expect(screen.queryByRole('link')).toBeNull();
      // The text survives — the reader still sees what the author wrote.
      expect(screen.getByText('click')).toBeInTheDocument();
      expect(document.querySelector('[href]')).toBeNull();
    });
  }

  for (const href of SAFE_HREFS) {
    it(`keeps ${JSON.stringify(href)} navigable`, () => {
      renderLink(href);

      expect(screen.getByRole('link')).toHaveAttribute('href', href);
    });
  }

  it('sends an external link to a new tab, and says so', () => {
    renderLink('https://example.com/a');

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('target', '_blank');
    // `noopener` is what keeps the new tab from reaching back through
    // `window.opener`.
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveTextContent('opens in a new tab');
  });

  it('never routes an unsafe href through an injected Link', () => {
    // The router branch is the one place an href leaves this file untested by
    // the checks above — a `next/link` given `javascript:` would render the
    // anchor itself.
    function TestLink({
      href,
      children,
    }: {
      href: string;
      children?: ReactNode;
    }) {
      return (
        <a data-testid="router-link" href={href}>
          {children}
        </a>
      );
    }

    render(
      <DocContent
        hast={root(
          element('p', {}, [
            element('a', { href: 'javascript:alert(1)' }, [text('click')]),
          ]),
        )}
        components={createMarkdownComponents({ Link: TestLink })}
      />,
    );

    expect(screen.queryByTestId('router-link')).toBeNull();
    expect(screen.getByText('click')).toBeInTheDocument();
  });
});

describe('the optimising branch gets what the plain one does', () => {
  /*
   * ⚠️ `createImage`'s COMMENT PROMISED THIS AND `wrapNextImage` BROKE IT. The
   * comment said `rest` goes first so an attribute the plain `<img>` honours —
   * it named `decoding` and `fetchPriority` — is not silently dropped by the
   * optimising one. `wrapNextImage` destructures a fixed list of props, so both
   * were dropped, on exactly the images most likely to want them: the hero
   * image a resolver gave dimensions to.
   *
   * They are declared props now. A closed interface at a component seam is the
   * right shape; a comment promising an open one was not.
   */
  function Spy(props: DocsImageProps): ReactNode {
    seen = props;
    // A `<span>`, not an `<img>`: the subject is the props this component was
    // handed, and rendering a real image only invites the lint rule that exists
    // to push consumers towards `next/image` — which is the thing being stood
    // in for here.
    return <span data-src={props.src} />;
  }
  let seen: DocsImageProps | undefined;

  it('forwards decoding and fetchPriority to a custom Image', () => {
    const components = createMarkdownComponents({ Image: Spy });
    const MarkdownImage = components.img;
    if (MarkdownImage === undefined) throw new Error('no img component');

    render(
      <MarkdownImage
        src="/hero.png"
        alt="Hero"
        width={1200}
        height={630}
        decoding="sync"
        fetchPriority="high"
      />,
    );

    expect(seen).toMatchObject({ decoding: 'sync', fetchPriority: 'high' });
  });

  it('defaults decoding to async without overriding the author', () => {
    const components = createMarkdownComponents({ Image: Spy });
    const MarkdownImage = components.img;
    if (MarkdownImage === undefined) throw new Error('no img component');

    render(
      <MarkdownImage src="/hero.png" alt="Hero" width={1200} height={630} />,
    );

    expect(seen?.decoding).toBe('async');
  });
});
