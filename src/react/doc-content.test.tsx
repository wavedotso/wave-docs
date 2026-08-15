import type { Element, Root } from 'hast';
import type { ComponentProps, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DocContent } from './doc-content.js';
import type { DocsLinkProps } from './markdown-components.js';
import { createMarkdownComponents } from './markdown-components.js';

function element(
  tagName: string,
  properties: Element['properties'],
  children: Element['children'],
): Element {
  return { type: 'element', tagName, properties, children };
}

function text(value: string) {
  return { type: 'text', value } as const;
}

function root(...children: Root['children']): Root {
  return { type: 'root', children };
}

function render(node: ReactNode): string {
  return renderToStaticMarkup(node);
}

describe('DocContent', () => {
  it('renders a custom `callout` element as the Callout component', () => {
    const html = render(
      <DocContent
        hast={root(
          element('callout', { type: 'warning' }, [
            element('p', {}, [text('Mind the gap.')]),
          ]),
        )}
      />,
    );

    expect(html).toContain('wave-docs-callout--warning');
    expect(html).toContain('role="note"');
    expect(html).toContain('aria-label="Warning"');
    expect(html).toContain('Mind the gap.');
  });

  it('falls back to `note` for an unknown callout type', () => {
    const html = render(
      <DocContent
        hast={root(element('callout', { type: 'nonsense' }, [text('hi')]))}
      />,
    );

    expect(html).toContain('wave-docs-callout--note');
    expect(html).toContain('aria-label="Note"');
  });

  it('lets caller components override the defaults', () => {
    const html = render(
      <DocContent
        hast={root(element('h2', { id: 'intro' }, [text('Intro')]))}
        components={{
          h2: (props) => <h2 className="custom">{props.children}</h2>,
        }}
      />,
    );

    expect(html).toBe(
      '<div class="wave-docs-prose"><h2 class="custom">Intro</h2></div>',
    );
  });

  it('carries the prose class, so no caller can forget it', () => {
    /*
     * Nearly every rule in `styles.css` is scoped under `.wave-docs-prose`,
     * `.wave-docs-prose .shiki` among them. The hand-rolled route in the
     * README used to make the consumer type this class on their own
     * `<article>`, and forgetting it left a page whose code blocks kept their
     * syntax colours and lost everything else — which reads as a decision.
     */
    const html = render(
      <DocContent hast={root(element('p', {}, [text('.')]))} />,
    );

    expect(html.startsWith('<div class="wave-docs-prose">')).toBe(true);
  });

  it('appends className rather than substituting for it', () => {
    // Substitution is the bug the wrapper exists to prevent; offering a
    // replace-the-class prop would reintroduce it with a nicer name.
    const html = render(
      <DocContent
        hast={root(element('p', {}, [text('.')]))}
        className="mine"
      />,
    );

    expect(html.startsWith('<div class="wave-docs-prose mine">')).toBe(true);
  });

  it('never passes the hast node to components', () => {
    // The failure this guards against: `passNode: true` (react-markdown's
    // hardcoded default) makes a props-spreading component emit
    // `node="[object Object]"` with no type error anywhere.
    const html = render(
      <DocContent
        hast={root(element('p', {}, [text('Body.')]))}
        components={{
          p: (props: ComponentProps<'p'>) => <p {...props} />,
        }}
      />,
    );

    expect(html).toBe('<div class="wave-docs-prose"><p>Body.</p></div>');
    expect(html).not.toContain('node=');
    expect(html).not.toContain('object Object');
  });
});

describe('markdown components', () => {
  /**
   * ⚠️ DETECTION MOVED TO `remarkYouTube`, so the two tests that used to live
   * here — one per URL form — are now in `render.test.ts`, going through the
   * real pipeline from markdown.
   *
   * They built an `<a>` at the HAST ROOT and asserted the anchor mapping
   * swapped it. That passed, and it is exactly why the suite could not see the
   * bug: in a real document the anchor is inside a `<p>`, and a `<div>` there
   * is invalid HTML that hydrates as a mismatch. A fixture that omits the
   * paragraph omits the defect.
   *
   * What belongs here is the element the pipeline now emits, and the consumer
   * override that could not be reached while the anchor did the work.
   */
  it('renders a <youtube> element through the component map', () => {
    const html = render(
      <DocContent hast={root(element('youtube', { id: 'dQw4w9WgXcQ' }, []))} />,
    );

    expect(html).toContain('i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    expect(html).toContain('aria-label="Play video: YouTube video player"');
    // The whole point: no player bytes until someone asks for them.
    expect(html).not.toContain('<iframe');
  });

  it('lets a consumer replace the youtube component', () => {
    const html = render(
      <DocContent
        hast={root(element('youtube', { id: 'dQw4w9WgXcQ' }, []))}
        components={{ youtube: ({ id }) => <span data-mine={id} /> }}
      />,
    );

    expect(html).toContain('data-mine="dQw4w9WgXcQ"');
    expect(html).not.toContain('ytimg.com');
  });

  it('leaves a labelled YouTube link alone', () => {
    const href = 'https://youtu.be/dQw4w9WgXcQ';
    const html = render(
      <DocContent hast={root(element('a', { href }, [text('the intro')]))} />,
    );

    expect(html).not.toContain('ytimg.com');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('leaves non-video YouTube URLs as links', () => {
    const href = 'https://www.youtube.com/@someone';
    const html = render(
      <DocContent hast={root(element('a', { href }, [text(href)]))} />,
    );

    expect(html).not.toContain('ytimg.com');
    expect(html).toContain(`href="${href}"`);
  });

  it('routes internal links through an injected Link', () => {
    function TestLink({ href, children, ...rest }: DocsLinkProps): ReactNode {
      return (
        <a {...rest} data-testid="router-link" href={href}>
          {children}
        </a>
      );
    }

    const html = render(
      <DocContent
        hast={root(
          element('p', {}, [
            element('a', { href: '/docs/api' }, [text('API')]),
            element('a', { href: '#section' }, [text('Section')]),
          ]),
        )}
        components={createMarkdownComponents({ Link: TestLink })}
      />,
    );

    expect(html).toContain('data-testid="router-link"');
    // Same-page anchors gain nothing from a router link.
    expect(html).toContain('<a href="#section">Section</a>');
  });

  it('renders an image with the injected Image only when sized', () => {
    function TestImage(props: {
      src: string;
      alt: string;
      width: number;
      height: number;
    }): ReactNode {
      return (
        // biome-ignore lint/performance/noImgElement: a test double for an injected image component.
        <img
          data-testid="next-image"
          src={props.src}
          alt={props.alt}
          width={props.width}
          height={props.height}
        />
      );
    }

    const components = createMarkdownComponents({ Image: TestImage });

    const sized = render(
      <DocContent
        hast={root(
          element(
            'img',
            { src: '/a.png', alt: 'A', width: 800, height: 600 },
            [],
          ),
        )}
        components={components}
      />,
    );
    expect(sized).toContain('data-testid="next-image"');

    const unsized = render(
      <DocContent
        hast={root(element('img', { src: '/a.png', alt: 'A' }, []))}
        components={components}
      />,
    );
    expect(unsized).not.toContain('data-testid="next-image"');
    expect(unsized).toContain('loading="lazy"');
  });

  it('wraps tables in a keyboard-reachable scroll region', () => {
    const html = render(
      <DocContent
        hast={root(
          element('table', {}, [
            element('tbody', {}, [
              element('tr', {}, [element('td', {}, [text('cell')])]),
            ]),
          ]),
        )}
      />,
    );

    // A labelled <section> is a `region` landmark without the explicit role.
    expect(html).toContain('<section class="wave-docs-table-scroll"');
    expect(html).toContain('aria-label="Table"');
    expect(html).toContain('tabindex="0"');
  });
});
