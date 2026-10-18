/**
 * @khorsheed/dsh-writing — the 写作模式 (dsh-writing) mode bundle: the writing
 * family (the inspiration canvas and its full-length-novel genre) plus the
 * mode's own preset row, as one thin meta package. The bundle is composition
 * data: cordis.patch.yml re-mounts the members' canonical rows and the preset
 * row, and package.json carries the members as npm dependencies; this module
 * exists so the package has a buildable `lib/` (pack-dist requires one). It
 * registers no service, tool, slot, or command of its own.
 */

/** The mode this bundle installs: the preset row id is `preset-${MODE}`. */
export const MODE = 'dsh-writing' as const

/** Self-mounting member packages whose canonical rows the bundle patch mounts, in cordis.patch.yml row order. */
export const FAMILY_MEMBERS = [
  '@khorsheed/dsh-canvas',
  '@khorsheed/dsh-canvas-novel',
] as const

/**
 * Root-row overrides the bundle adds on top of the verbatim member rows.
 * canvas's own patch mounts `canvas-agent` ENABLED for every session (the
 * community default); a mode pack scopes the canvas tools to the mode's
 * sessions instead, so the bundle disables the root row and lets the preset
 * row's grant be the only live one (both live at once register the same tool
 * names twice and fail the boot).
 */
export const FAMILY_ROOT_OVERRIDES = ['canvas-agent'] as const
