/*
 * `output: 'export'` — a directory of static files, deployable to any host.
 *
 * Deliberately the harder of the two modes: it is the one where a route that
 * quietly went dynamic fails the build instead of silently costing money, and
 * it is the mode `docs.searchIndex`'s guard exists for. If this site builds,
 * the quick start builds anywhere.
 */
export default { output: 'export' as const };
