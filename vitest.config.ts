import { defineConfig } from 'vitest/config';

/**
 * Two projects, because the two halves of this package need different
 * environments and only one of them should pay for a DOM.
 *
 * `node` — the source layer, the pipeline, the highlighter, search-index
 * generation. All of it reads the filesystem or transforms trees; a DOM would
 * be dead weight on the suite that runs most often.
 *
 * `dom` — `src/react/**`. These are the only tests that need to *mount*
 * something. Rendering a component to a string proves it emits the right markup
 * and proves nothing about whether it works: a focus trap, a scrollspy, a
 * keyboard handler and a click-to-load swap are all behaviour that exists only
 * once the component is attached to a document. Before this split there was no
 * DOM anywhere, so every interactive path in the package was verified by reading
 * it — which is how a `<div>` inside a `<p>` shipped in the YouTube mapping.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['src/**/*.{test,spec}.{ts,tsx}'],
          exclude: ['src/react/**'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'dom',
          include: ['src/react/**/*.{test,spec}.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.dom.ts'],
        },
      },
    ],
  },
});
