/**
 * @khorsheed/dsh-writing — the 写作模式 (dsh-writing) mode bundle: the writing
 * family (the inspiration canvas and its full-length-novel genre) plus the
 * mode's own preset row, as one thin meta package. The bundle is composition
 * data: cordis.patch.yml re-mounts the members' canonical rows (minus the
 * companion `./agent` composition rows — those live only in the preset row's
 * grant list) plus the preset row, and package.json carries the members as
 * npm dependencies; this module exists so the package has a buildable `lib/`
 * (pack-dist requires one). It registers no service, tool, slot, or command
 * of its own.
 */

/** The mode this bundle installs: the preset row id is `preset-${MODE}`. */
export const MODE = 'dsh-writing' as const

/** Self-mounting member packages whose canonical rows the bundle patch mounts, in cordis.patch.yml row order. */
export const FAMILY_MEMBERS = [
  '@khorsheed/dsh-canvas',
  '@khorsheed/dsh-canvas-novel',
  '@khorsheed/dsh-reader',
  '@khorsheed/dsh-transcribe',
] as const
