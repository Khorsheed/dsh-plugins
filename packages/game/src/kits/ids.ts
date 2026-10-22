/**
 * The shipped kit ids, apart from the kits themselves so the manifest parser
 * (shared with the browser half) can check one without pulling a kit in.
 * @module @khorsheed/dsh-game
 */
import type { KitId } from './types.ts'

/** Every kit id this build ships. */
export const KIT_IDS: readonly KitId[] = ['2d-canvas', '3d-three']

/** Whether a value names a shipped kit. */
export function isKitId(value: unknown): value is KitId {
  return typeof value === 'string' && (KIT_IDS as readonly string[]).includes(value)
}
