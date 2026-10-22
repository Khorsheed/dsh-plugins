/**
 * The kit registry: which runtime kits this build ships, and which one a
 * project runs on.
 * @module @khorsheed/dsh-game
 */
import type { BundleFile } from '../types.ts'
import { CANVAS_2D } from './canvas2d.ts'
import { isKitId } from './ids.ts'
import type { KitId, KitRef, RuntimeKit } from './types.ts'

export { isKitId, KIT_IDS } from './ids.ts'

export * from './types.ts'

/** Every shipped kit, by id. */
export const KITS: Readonly<Record<KitId, RuntimeKit>> = {
  '2d-canvas': CANVAS_2D,
}

/** The kit a project without a `runtime` field runs on. */
export const DEFAULT_KIT: RuntimeKit = CANVAS_2D

/**
 * The kit a project runs on.
 * @param ref - the manifest's `runtime` (absent on projects made before kits).
 * @returns the kit; unknown ids fall back to the default.
 */
export function kitOf(ref: KitRef | undefined): RuntimeKit {
  return ref !== undefined && isKitId(ref.kit) ? KITS[ref.kit] : DEFAULT_KIT
}

/**
 * A bundle with the kit's runtime files added. The project's own files win
 * on a path clash (a project should never write under `_dsh/`, but if it
 * does, its file is what it meant to ship).
 */
export function withKitRuntime(files: Readonly<Record<string, BundleFile>>, kit: RuntimeKit): Record<string, BundleFile> {
  return { ...kit.runtimeFiles(), ...files }
}
