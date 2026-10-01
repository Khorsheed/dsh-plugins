/**
 * The export leak gate's one implementation, shared by every in-host caller
 * of a CONFIRMED export: the Remote face (the web dialog) and any plugin that
 * calls `ctx.mission.exportRunGated` directly. Before T89 the gate lived in
 * the Remote class, so a sibling plugin that wanted the gated export had to
 * reach `ctx.missionRemote` and fabricate the `agent` argument the Remote
 * methods take; the logic moved here so the service face can carry it.
 *
 * Two parts:
 *
 * - **Layer resolution**: a layer is guarded when the caller declares it so,
 *   or when the datasets plugin (probed at call time through `ctx.get`, never
 *   an import) reports it `modelFacing: false` for the referenced snapshot.
 *   No datasets plugin = the caller's declarations alone.
 * - **The check**: the caller's `confirmed` list must cover every guarded
 *   layer of a FRESH plan, or the export refuses (fail-closed). A stale
 *   confirmation never authorizes a changed layer set.
 *
 * The CLI's TTY prompt and the slash command's refusal are separate gates on
 * separate faces and stay where they are.
 */
import type { ExportLayer, SnapshotRef } from './export.ts'
import type { MissionExportPlanRequest } from './types.ts'

/** Which layers of a snapshot are `modelFacing: false`; null = unknown (no probe or probe failed). */
export type LayerProbe = (snapshot: SnapshotRef) => Promise<string[] | null>

/** A datasets-shaped service, duck-typed (mission imports nothing from datasets). */
interface DatasetsListFace {
  list?: (scope: { repo: string }, dataset?: string, commit?: string) => Promise<unknown>
}

/**
 * The probe backed by the datasets plugin, resolved lazily on every call so a
 * datasets plugin mounted after mission is still seen.
 * @param lookup - returns the current `datasets` service, or undefined.
 * @returns a layer probe that never throws.
 */
export function datasetsLayerProbe(lookup: () => unknown): LayerProbe {
  return async (snapshot) => {
    if (snapshot.dataset === undefined) return null
    const datasets = lookup() as DatasetsListFace | undefined
    if (typeof datasets?.list !== 'function') return null
    try {
      const result = await datasets.list(
        { repo: snapshot.repo },
        snapshot.dataset,
        ...(snapshot.commit !== undefined ? [snapshot.commit] : []),
      )
      if (typeof result !== 'object' || result === null) return null
      const layers = (result as { dataset?: { nonModelFacingLayers?: unknown } }).dataset?.nonModelFacingLayers
      if (!Array.isArray(layers)) return null
      return layers.filter((layer): layer is string => typeof layer === 'string')
    } catch {
      return null
    }
  }
}

/**
 * Resolve each requested layer name to `{ name, guarded }`.
 * @param probe - the datasets probe, or null when none is installed.
 * @param request - layer names, explicit guarded declarations, snapshot reference.
 * @returns the layers in request order.
 */
export async function resolveLayers(probe: LayerProbe | null, request: MissionExportPlanRequest): Promise<ExportLayer[]> {
  const declared = new Set(request.guarded ?? [])
  const probed = probe !== null && request.snapshot !== undefined ? await probe(request.snapshot) : null
  return (request.layers ?? []).map(name => ({
    name,
    guarded: declared.has(name) || (probed !== null && probed.includes(name)),
  }))
}

/**
 * The fail-closed check.
 * @param guardedLayers - the fresh plan's guarded layers.
 * @param confirmed - what the human confirmed.
 * @throws when any guarded layer is unconfirmed.
 */
export function assertConfirmed(guardedLayers: readonly string[], confirmed: readonly string[]): void {
  const unconfirmed = guardedLayers.filter(layer => !confirmed.includes(layer))
  if (unconfirmed.length > 0) {
    throw new Error(`mission: export refused — guarded (modelFacing: false) layer(s) not confirmed: ${unconfirmed.join(', ')}`)
  }
}
