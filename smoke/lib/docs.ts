import { createDocsRoute } from '@waveso/docs/next';

/*
 * Resolved against `process.cwd()`, which is the repository root: CI runs
 * `next build smoke` from there, not from inside this directory.
 */
export const docs = createDocsRoute({ contentDir: 'smoke/content' });
