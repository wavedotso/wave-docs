import { defineConfig } from 'tsdown';

/**
 * Per-file ESM output via Rolldown — transpile, do not bundle.
 *
 * `unbundle` is load-bearing here, not a preference. The package.json
 * `exports` map points individual conditions at individual files: the
 * Node-only half (`./source`, `./render`, `./highlighter`, `./next`,
 * `./vite`) carries `"browser": null` so a client bundler fails with a
 * located "module not found" instead of trying to resolve `node:fs`.
 * That guard only works if `dist/source.js` is genuinely its own file —
 * bundling into shared chunks would smear the Node half into modules the
 * browser condition is supposed to reach.
 *
 * `"use client"` directives survive natively (Rolldown tracks them rather
 * than stripping them), which the `src/react/*` client components rely on,
 * and relative imports are emitted with `.js` extensions so the output
 * resolves under strict ESM / `node16` — the specific thing bare `tsc`
 * will not do for us.
 *
 * ESM-only is forced, not chosen: `unified`, `remark-*`, `rehype-*` and
 * `react-markdown`'s whole lineage are `"type": "module"` with no CJS
 * build. A dual CJS output would resolve to nothing and `attw` would
 * (correctly) reject it.
 *
 * `exports` generation stays disabled — the map is hand-maintained because
 * of the `"browser": null` conditions, which tsdown would overwrite.
 */
export default defineConfig({
  entry: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.{test,spec}.{ts,tsx}',
    // Ambient declarations (JSX intrinsic augmentation) never ship as modules.
    '!src/**/*.d.ts',
    // Fixtures exist only for tests.
    '!src/**/__fixtures__/**',
  ],
  format: 'esm',
  platform: 'neutral',
  unbundle: true,
  dts: true,
  // `src` is not in the published `files`, so sourcemaps would point at paths
  // that never ship — broken dead weight in the tarball.
  sourcemap: false,
  clean: true,
  // Ship the stylesheet alongside the modules. Routing the copy through tsdown
  // rather than a trailing `cp` means it also happens under `--watch`, where
  // `clean: true` would otherwise wipe it.
  copy: [{ from: 'src/styles.css', to: 'dist' }],
  // A library never bundles its deps; every bare import stays external in both
  // the JS and the emitted `.d.ts`. Without this, tsdown inlines type-only
  // packages into `dist/node_modules/**`, which ships a second copy of
  // `@types/hast` inside the tarball and confuses `attw`.
  deps: { neverBundle: true },
});
