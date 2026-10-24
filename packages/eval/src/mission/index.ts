/**
 * Generic task management: a **mission** is one work item (state, labels,
 * plan data, attempts, opaque resource refs, artifact index, append-only
 * namespaced annotations); a **run** is a batch of missions created from a
 * template whose declared state machine the run freezes and enforces —
 * declaration IS enforcement: undeclared transitions fail loud, guards are
 * deterministic, and nothing ever transitions automatically.
 *
 * Three faces share one service kernel ({@link MissionService} over a locked,
 * atomically-written JSON store): the service face `ctx.mission` (the
 * in-process cross-package contract other plugins consume via `ctx.get`),
 * the `dsh-mission` CLI (scripts), and the `/mission` slash command
 * (humans) — of which only the service and the CLI mount HERE: the slash
 * command's registration lives in the `./tool` composition row
 * `@khorsheed/dsh-eval/mission/tool` (preset-visibility rollout A3), which an
 * agent preset mounts per session so only granted sessions see it; the
 * handler and definition stay in `./slash.ts` for the companion to register.
 * The model-tool face lives in the same companion.
 * Export is deliberately NOT a model tool.
 *
 * The web session tab and its Typert Remote data face are retired: the eval
 * family's 实验室 surface carries the human gestures (retry, release gate,
 * gated export) through eval's own Remote, and the default preset never
 * showed the tab (R6).
 *
 * Mounted by the eval row itself since mission folded into eval (2026-10-24);
 * there is no separate `mission` row.
 *
 * @module @khorsheed/dsh-eval/mission
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveDataDir } from './defaults.ts'
import { datasetsLayerProbe } from './gate.ts'
import { MissionService } from './service.ts'

/** Plugin configuration. */
export interface MissionConfig {
  /** Data root; defaults to $DSH_HOME/state/mission, else `<cwd>/.dsh-mission`. */
  dataDir?: string
}

export const Config: z = z.object({
  dataDir: z.string().default(''),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    mission: MissionService
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'mission'

/**
 * No required services: the `/mission` slash face lives in the companion
 * `@khorsheed/dsh-eval/mission/tool` row (its registration is what needed the
 * command registry), and the only thing still here — the service — mounts
 * unconditionally.
 */
export const inject = []

/**
 * Mount the mission service. The `/mission` slash command and the model
 * tools are deliberately NOT registered here: both live in the `./tool`
 * composition row `@khorsheed/dsh-eval/mission/tool`, which an agent preset
 * composes per session — the companion also carries the tool-guidance prompt
 * section.
 * @param ctx - plugin context.
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: MissionConfig): void {
  const service = new MissionService(resolveDataDir(config.dataDir))
  // The gated export's guarded-layer probe: the datasets plugin, looked up
  // per call (duck-typed, optional — absent means explicit declarations only).
  service.setLayerProbe(datasetsLayerProbe(() => ctx.get('datasets')))
  ctx.provide('mission', service)
}

export { MissionService } from './service.ts'
export { MissionStore } from './store.ts'
export { assertConfirmed, datasetsLayerProbe, resolveLayers, type LayerProbe } from './gate.ts'
export { handleMissionCommand, registerMissionSlash } from './slash.ts'
export { resolveCliDataDir, resolveDataDir } from './defaults.ts'
export { lintTemplate, loadTemplateFile, parseTemplate, deriveShape, SIMPLE_TEMPLATE } from './template.ts'
export { bucketOf, viewOf, currentAttempt, releasableClosure } from './projection.ts'
export { validateJson, assertSchemaSubset, schemaSubsetProblems, jsonEquals } from './schema.ts'
export { missionToolDefinitions, MISSION_READ_TOOLS, type MissionToolsTier } from './tool-definition.ts'
export type * from './types.ts'
export type { LintResult, LoadedTemplate, MachineShape } from './template.ts'
export type {
  CallOptions, MissionCreateOptions, RetryOptions, RunCreateOptions, RunStatus, RunSummary, SubmitFile, SubmitOptions,
  SubmitResult, TransitionResult,
} from './service.ts'
