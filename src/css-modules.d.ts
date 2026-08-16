/**
 * Vite's `?inline` query, for the browser test project.
 *
 * `styles.browser.test.ts` imports the stylesheet as a string and injects it,
 * so the assertions run against the real cascade rather than a fixture. Only
 * the browser project resolves this; `tsdown` excludes `*.d.ts` from its
 * entries, so nothing here ships.
 */
declare module '*.css?inline' {
  const css: string;
  export default css;
}
