/**
 * @khorsheed/dsh-dev-suite — the 开发模式 (dsh-dev) mode bundle: the dev family
 * (local-agent core + the kimi / codex / claude-code / dsh delegation
 * providers, worktrees, room, typesafe) plus the mode's own preset row, as one
 * thin meta package. The bundle is composition data: cordis.patch.yml re-mounts
 * the members' canonical rows and the preset row, and package.json carries the
 * members as npm dependencies; this module exists so the package has a
 * buildable `lib/` (pack-dist requires one). It registers no service, tool,
 * slot, or command of its own.
 */

/** The mode this bundle installs: the preset row id is `preset-${MODE}`. */
export const MODE = 'dsh-dev' as const

/** Self-mounting member packages whose canonical rows the bundle patch mounts, in cordis.patch.yml row order. */
export const FAMILY_MEMBERS = [
  '@khorsheed/dsh-local-agent',
  '@khorsheed/dsh-local-agent-kimi',
  '@khorsheed/dsh-local-agent-codex',
  '@khorsheed/dsh-local-agent-claude-code',
  '@khorsheed/dsh-local-agent-dsh',
  '@khorsheed/dsh-worktrees',
  '@khorsheed/dsh-room',
  '@khorsheed/dsh-typesafe',
] as const

/**
 * Card-less family library installed alongside (npm dependency, no patch rows
 * of its own beyond what the members' canonical rows already name) — the
 * provisioned sub-dsh face local-agent-dsh resolves. Same deps-only treatment
 * as @khorsheed/dsh-bundle-local-agent.
 */
export const FAMILY_DEPS_ONLY = [
  '@khorsheed/dsh-local-agent-dsh-headless',
] as const
