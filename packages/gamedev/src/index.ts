/**
 * @khorsheed/dsh-gamedev — the 游戏开发模式 (dsh-gamedev) mode bundle: the game
 * workbench (build and play a small 2D web game with the agent) plus the
 * mode's own preset row, as one thin meta package. The bundle is composition
 * data: cordis.patch.yml re-mounts the member's canonical rows and the preset
 * row, and package.json carries the member as an npm dependency; this module
 * exists so the package has a buildable `lib/` (pack-dist requires one). It
 * registers no service, tool, slot, or command of its own.
 */

/** The mode this bundle installs: the preset row id is `preset-${MODE}`. */
export const MODE = 'dsh-gamedev' as const

/** Self-mounting member packages whose canonical rows the bundle patch mounts, in cordis.patch.yml row order. */
export const FAMILY_MEMBERS = [
  '@khorsheed/dsh-game',
] as const
