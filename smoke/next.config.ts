/*
 * Both output modes from one app. CI builds it twice — the default mode is
 * where the `.body` and the prerender manifest live, and `output: 'export'`
 * is the mode where a missing static asset is a 404 rather than a slow route.
 */
const agentRules = false; // See site/next.config.ts — Next 16 writes AGENTS.md
export default process.env.SMOKE_EXPORT === '1'
  ? { output: 'export' as const, agentRules }
  : { agentRules };
