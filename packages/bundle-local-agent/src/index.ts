/**
 * @khorsheed/dsh-bundle-local-agent — the local-agent family (core + the kimi /
 * codex / claude-code / dsh delegation providers) as one thin meta package.
 * The bundle is composition data: cordis.patch.yml re-mounts the members'
 * canonical rows and package.json carries the members as npm dependencies;
 * this module exists so the package has a buildable `lib/` (pack-dist
 * requires one). It registers no service, tool, slot, or command of its own.
 */

/** Self-mounting member packages whose canonical rows the bundle patch mounts, in cordis.patch.yml row order. */
export const FAMILY_MEMBERS = [
  '@khorsheed/dsh-local-agent',
  '@khorsheed/dsh-local-agent-kimi',
  '@khorsheed/dsh-local-agent-codex',
  '@khorsheed/dsh-local-agent-claude-code',
  '@khorsheed/dsh-local-agent-dsh',
] as const

/**
 * Card-less family libraries installed alongside (npm dependencies, no patch
 * rows of their own beyond what the members' canonical rows already name).
 */
export const FAMILY_DEPS_ONLY = [
  '@khorsheed/dsh-local-agent-tool-subagent',
  '@khorsheed/dsh-local-agent-dsh-headless',
] as const
