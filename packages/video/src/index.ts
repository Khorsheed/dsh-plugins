/**
 * @khorsheed/dsh-video-suite — the 剪辑模式 (dsh-video) mode bundle: the video
 * studio (podcast and conversation editing) plus the mode's own preset row, as
 * one thin meta package. The bundle is composition data: cordis.patch.yml
 * re-mounts the member's canonical row and the preset row, and package.json
 * carries the member as an npm dependency; this module exists so the package
 * has a buildable `lib/` (pack-dist requires one). It registers no service,
 * tool, slot, or command of its own.
 */

/** The mode this bundle installs: the preset row id is `preset-${MODE}`. */
export const MODE = 'dsh-video' as const

/** Self-mounting member packages whose canonical rows the bundle patch mounts, in cordis.patch.yml row order. */
export const FAMILY_MEMBERS = [
  '@khorsheed/dsh-video-studio',
  '@khorsheed/dsh-transcribe',
  '@khorsheed/dsh-local-agent',
  '@khorsheed/dsh-local-agent-kimi',
  '@khorsheed/dsh-local-agent-codex',
  '@khorsheed/dsh-local-agent-claude-code',
  '@khorsheed/dsh-local-agent-dsh',
  '@khorsheed/dsh-room',
] as const

/**
 * Card-less family library installed alongside (npm dependency, no patch rows
 * of its own beyond what the members' canonical rows already name) — the
 * provisioned sub-dsh face local-agent-dsh resolves. Same deps-only treatment
 * as @khorsheed/dsh-bundle-local-agent and @khorsheed/dsh-dev-suite.
 */
export const FAMILY_DEPS_ONLY = [
  '@khorsheed/dsh-local-agent-dsh-headless',
] as const
