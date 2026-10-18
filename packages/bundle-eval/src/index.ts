/**
 * @khorsheed/dsh-bundle-eval — the evaluation family (datasets / mission /
 * lab / eval) plus the dsh-eval mode preset as one thin meta package. The
 * bundle is composition data: cordis.patch.yml re-mounts the members'
 * canonical rows and the preset row, and package.json carries the members as
 * npm dependencies; this module exists so the package has a buildable `lib/`
 * (pack-dist requires one). It registers no service, tool, slot, or command of
 * its own.
 */

/** The mode this bundle installs: the preset row id is `preset-${MODE}`. */
export const MODE = 'dsh-eval' as const

/** Self-mounting member packages whose canonical rows the bundle patch mounts, in cordis.patch.yml row order. */
export const FAMILY_MEMBERS = [
  '@khorsheed/dsh-datasets',
  '@khorsheed/dsh-mission',
  '@khorsheed/dsh-lab',
  '@khorsheed/dsh-eval',
] as const
