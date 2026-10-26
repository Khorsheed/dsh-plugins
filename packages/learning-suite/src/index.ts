/**
 * @khorsheed/dsh-learning-suite — the 学习模式 (dsh-learning) mode bundle: the
 * library (project-organized deep reading) plus the mode's own preset row, as
 * one thin meta package. The bundle is composition data: cordis.patch.yml
 * re-mounts the member's canonical row and the preset row, and package.json
 * carries the member as an npm dependency; this module exists so the package
 * has a buildable `lib/` (pack-dist requires one). It registers no service,
 * tool, slot, or command of its own.
 */

/** The mode this bundle installs: the preset row id is `preset-${MODE}`. */
export const MODE = 'dsh-learning' as const

/** Self-mounting member packages whose canonical rows the bundle patch mounts, in cordis.patch.yml row order. */
export const FAMILY_MEMBERS = [
  '@khorsheed/dsh-library',
  '@khorsheed/dsh-reader',
  '@khorsheed/dsh-transcribe',
  '@khorsheed/dsh-capture',
] as const
