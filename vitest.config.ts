import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/**
 * Two projects, because the two halves of this package need different
 * environments and only one of them should pay for a DOM.
 *
 * `node` — the source layer, the pipeline, the highlighter, search-index
 * generation. All of it reads the filesystem or transforms trees; a DOM would
 * be dead weight on the suite that runs most often.
 *
 * `browser` — real Chromium, via Playwright. Everything the other two cannot
 * see: jsdom has no layout at all (`clientWidth` and `offsetTop` are 0), no
 * `HTMLDialogElement.showModal`, no `:modal`, and no `command` on
 * `HTMLButtonElement` — so every geometry claim the stylesheet makes, and every
 * one of the four native behaviours that justify `<dialog>` over `popover`, is
 * unassertable there. Deliberately OUT of `pnpm test`: it costs a browser
 * launch, and the sub-seven-second inner loop is worth protecting. CI runs
 * `pnpm test:browser` beside it.
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
          // `*.browser.test.ts` also ends in `.test.ts`, so both of the other
          // projects would otherwise claim it and run it without a browser.
          exclude: ['src/react/**', 'src/**/*.browser.test.*'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'dom',
          include: ['src/react/**/*.{test,spec}.{ts,tsx}'],
          exclude: ['src/**/*.browser.test.*'],
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.dom.ts'],
        },
      },
      {
        /*
         * React has to be pre-bundled alongside the testing library, or Vite
         * optimises `@testing-library/react` with a React of its own and the
         * components under test get a second copy — which surfaces as
         * `Cannot read properties of null (reading 'useCallback')`, four frames
         * inside React, with nothing pointing at dependency optimisation.
         */
        optimizeDeps: {
          include: [
            'react',
            'react/jsx-runtime',
            'react/jsx-dev-runtime',
            'react-dom',
            'react-dom/client',
            '@testing-library/react',
          ],
        },
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.{ts,tsx}'],
          browser: {
            enabled: true,
            // A factory, not a string: vitest 4 moved the provider out of
            // core so the browser deps are only resolved when this project runs.
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
            headless: true,
          },
        },
      },
    ],
  },
});
