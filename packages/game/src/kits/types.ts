/**
 * The runtime-kit seam (proposal 2026-10-21-game-3d §10.2): everything that
 * depends on HOW a game draws — the runtime the frame gets, the look formats
 * the panel and the checks accept, the blank-screen probe, the skill section
 * and the art styles — lives behind one kit per runtime. The workbench core
 * (projects, versions, checks, the panel) asks the project's kit instead of
 * assuming 2D canvas.
 * @module @khorsheed/dsh-game
 */
import type { ArtStyle, BundleFile, ElementLook } from '../types.ts'

/** The kits this build ships. */
export type KitId = '2d-canvas'

/** A project's pinned runtime (`game.json` `runtime`); absent means `2d-canvas` version 1. */
export interface KitRef {
  readonly kit: KitId
  readonly version: number
}

/** Bundle path prefix the kit's runtime files ride under (never written into a project). */
export const KIT_DIR = '_dsh'

/** The runtime script the loader injects before the game's own scripts. */
export const KIT_RUNTIME_FILE = `${KIT_DIR}/runtime.js`

/** Bare module specifier → bundle path, read by the loader (e.g. `three` → `_dsh/three.module.js`). */
export const KIT_IMPORTS_FILE = `${KIT_DIR}/imports.json`

/** One runtime kit. */
export interface RuntimeKit {
  readonly id: KitId
  /** The runtime version new projects pin. */
  readonly version: number
  readonly label: string
  /**
   * Files added to every bundle of a project on this kit: the runtime
   * script ({@link KIT_RUNTIME_FILE}), vendored libraries, and the bare
   * import map ({@link KIT_IMPORTS_FILE}). Kept out of version snapshots.
   */
  runtimeFiles(): Readonly<Record<string, BundleFile>>
  /** Normalize an element's `look`; null when unusable. */
  normalizeLook(raw: unknown): ElementLook | null
  /** What a usable look needs, worded for the model when one fails. */
  readonly lookHint: string
  /**
   * In-page expression (evaluated after the smoke steps) answering whether
   * the screen is blank: `true` blank, `false` drawn, `null` no canvas.
   */
  readonly blankProbe: string
  /** The kit's part of the `gamedev` skill: the runtime, looks and drawing helpers. */
  readonly skillSection: string
  /** The art styles the gate offers on this kit. */
  readonly styles: readonly ArtStyle[]
}
