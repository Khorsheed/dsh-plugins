/**
 * Generic task management: a **mission** is one work item (state, labels,
 * plan data, attempts, opaque resource refs, artifact index, append-only
 * namespaced annotations); a **run** is a batch of missions created from a
 * template whose declared state machine the run freezes and enforces —
 * declaration IS enforcement: undeclared transitions fail loud, guards are
 * deterministic, and nothing ever transitions automatically.
 *
 * Four faces share one service kernel ({@link MissionService} over a locked,
 * atomically-written JSON store): the service face `ctx.mission` (the
 * in-process cross-package contract other plugins consume via `ctx.get`),
 * the `dsh-mission` CLI (scripts), the `/mission` slash command (humans),
 * and the Typert Remote data face behind the web session tab — of which only
 * the service, the CLI and the Remote face mount HERE: the slash command's
 * registration moved to the companion `@khorsheed/dsh-mission-tool`
 * (preset-visibility rollout A3), which an agent preset mounts per session so
 * only granted sessions see it; the handler and definition stay in
 * `./slash.ts` for the companion to register. The model-tool
 * face lives in the same companion.
 * Export is deliberately NOT a model tool.
 *
 * @module @khorsheed/dsh-mission
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveDataDir } from './defaults.ts'
import { MissionRemoteService } from './remote.ts'
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
 * No required services: the `/mission` slash face moved to the companion
 * `@khorsheed/dsh-mission-tool` row (its registration is what needed the
 * command registry), and everything still here — the service, the Remote
 * face — mounts unconditionally.
 */
export const inject = []

/**
 * Mount the mission service and the Remote data face. The `/mission` slash
 * command and the model tools are deliberately NOT registered here: both
 * moved to the companion `@khorsheed/dsh-mission-tool`, which an agent preset
 * composes per session — the companion also carries the tool-guidance prompt
 * section.
 * @param ctx - plugin context.
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: MissionConfig): void {
  const service = new MissionService(resolveDataDir(config.dataDir))
  ctx.provide('mission', service)
  // The Typert Remote data face (wire namespace `mission`) behind the web tab.
  ctx.plugin(MissionRemoteService)
}

export { MissionService } from './service.ts'
export { MissionRemoteService } from './remote.ts'
export { MissionStore } from './store.ts'
export { handleMissionCommand, registerMissionSlash } from './slash.ts'
export { resolveCliDataDir, resolveDataDir } from './defaults.ts'
export { lintTemplate, loadTemplateFile, parseTemplate, deriveShape, SIMPLE_TEMPLATE } from './template.ts'
export { bucketOf, viewOf, currentAttempt, releasableClosure } from './projection.ts'
export { validateJson, assertSchemaSubset, schemaSubsetProblems, jsonEquals } from './schema.ts'
export { missionToolDefinitions, MISSION_READ_TOOLS, type MissionToolsTier } from './tool.ts'
export type * from './types.ts'
export type { LintResult, LoadedTemplate, MachineShape } from './template.ts'
export type {
  CallOptions, MissionCreateOptions, RetryOptions, RunCreateOptions, RunStatus, RunSummary, SubmitFile, SubmitOptions,
  SubmitResult, TransitionResult,
} from './service.ts'
