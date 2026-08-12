import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { CalloutType } from './callout.js';
import { CALLOUT_TYPES, Callout } from './callout.js';

/**
 * The label each type must announce, spelled out rather than read from the
 * component's own map — a test that imports the answer asserts nothing about
 * it. The first assertion below keeps the table honest if a sixth type lands.
 */
const LABELS: ReadonlyArray<readonly [CalloutType, string]> = [
  ['note', 'Note'],
  ['tip', 'Tip'],
  ['important', 'Important'],
  ['warning', 'Warning'],
  ['caution', 'Caution'],
];

describe('Callout', () => {
  it('covers every type the pipeline can emit', () => {
    expect(LABELS.map(([type]) => type)).toEqual([...CALLOUT_TYPES]);
  });

  it.each(LABELS)('announces a %s callout as "%s"', (type, label) => {
    render(<Callout type={type}>Body</Callout>);

    // The coloured border says "warning" to nobody using a screen reader, and
    // nothing at all to the 8% of men who cannot separate red from green. An
    // exact name match here also proves the icon stays out of the name.
    expect(screen.getByRole('note', { name: label })).toBeInTheDocument();
  });

  it.each(LABELS)('carries the %s modifier class for styling', (type) => {
    render(<Callout type={type}>Body</Callout>);

    expect(screen.getByRole('note')).toHaveClass(
      'wave-docs-callout',
      `wave-docs-callout--${type}`,
    );
  });

  it('shows the label to sighted readers too', () => {
    render(<Callout type="caution">Body</Callout>);

    expect(screen.getByRole('note')).toHaveTextContent('Caution');
  });

  it('renders its children inside the callout', () => {
    render(
      <Callout type="tip">
        <p>Run the dev server first.</p>
      </Callout>,
    );

    const body = screen.getByText('Run the dev server first.');
    expect(screen.getByRole('note')).toContainElement(body);
  });

  it('nests a prose block validly, as the parser reads it', () => {
    // Markdown fills a callout with paragraphs, lists and code blocks. A label
    // rendered as anything a `<p>` cannot contain — or a body that is itself a
    // `<p>` — would be closed early by the HTML parser, and the hydrated DOM
    // would stop matching the server output. Parse it rather than trust JSX.
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(
      <Callout type="important">
        <p>Read this first.</p>
      </Callout>,
    );

    expect(
      host.querySelector('.wave-docs-callout__body > p')?.textContent,
    ).toBe('Read this first.');
    expect(host.querySelectorAll('.wave-docs-callout')).toHaveLength(1);
  });

  it('degrades an unrecognised type to a note', () => {
    // `type` is an unvalidated hast attribute. An unstyled, unlabelled box is
    // the one outcome worse than calling it a note.
    render(<Callout type="danger">Body</Callout>);

    const callout = screen.getByRole('note', { name: 'Note' });
    expect(callout).toHaveClass('wave-docs-callout--note');
  });

  it('degrades a missing type to a note', () => {
    render(<Callout>Body</Callout>);

    expect(screen.getByRole('note', { name: 'Note' })).toHaveClass(
      'wave-docs-callout--note',
    );
  });

  it('accepts the keyword in the case markdown wrote it', () => {
    // `> [!WARNING]` is the spelling GitHub documents.
    render(<Callout type="WARNING">Body</Callout>);

    expect(screen.getByRole('note', { name: 'Warning' })).toHaveClass(
      'wave-docs-callout--warning',
    );
  });

  it('lets a title override the default label', () => {
    render(
      <Callout type="warning" title="Breaking change">
        Body
      </Callout>,
    );

    const callout = screen.getByRole('note', { name: 'Breaking change' });
    expect(callout).toHaveTextContent('Breaking change');
    // Overriding the wording must not lose the type's styling.
    expect(callout).toHaveClass('wave-docs-callout--warning');
  });

  it('falls back to the type label when the title is blank', () => {
    // A blank title would leave the callout with an empty accessible name —
    // the one thing this component exists to provide.
    render(
      <Callout type="caution" title="   ">
        Body
      </Callout>,
    );

    expect(screen.getByRole('note', { name: 'Caution' })).toBeInTheDocument();
  });

  it('merges a consumer class without dropping its own', () => {
    render(
      <Callout type="tip" className="custom">
        Body
      </Callout>,
    );

    expect(screen.getByRole('note')).toHaveClass(
      'wave-docs-callout',
      'wave-docs-callout--tip',
      'custom',
    );
  });
});
