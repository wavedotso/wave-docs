/*
 * `output: 'export'` — a directory of static files, deployable to any host.
 *
 * Deliberately the harder of the two modes: it is the one where a route that
 * quietly went dynamic fails the build instead of silently costing money, and
 * it is the mode `docs.searchIndex`'s guard exists for. If this site builds,
 * the quick start builds anywhere.
 */
export default {
  output: 'export' as const,
  /*
   * ⚠️ OFF, OR NEXT WRITES `AGENTS.md` AND `CLAUDE.md` INTO THIS DIRECTORY.
   * Next 16 generates them on `dev` and on `build`, which means an untracked
   * pair appears in the repository every time anyone looks at the harness —
   * and a `CLAUDE.md` inside `site/` would silently override this project's
   * own instructions for anything working in here.
   */
  agentRules: false,
};
