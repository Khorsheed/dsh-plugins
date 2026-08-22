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
 * the model tools (agent-first), the `dsh-mission` CLI (scripts), and the
 * `/mission` slash command (humans). Export is deliberately NOT a model tool.
 *
 * @module @khorsheed/dsh-mission
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveDataDir } from './defaults.ts'
import { MissionRemoteService } from './remote.ts'
import { MissionService } from './service.ts'
import { registerMissionSlash } from './slash.ts'
import { registerMissionTools } from './tools.ts'

/** Plugin configuration. */
export interface MissionConfig {
  /** Data root; defaults to $DSH_HOME/state/mission, else `<cwd>/.dsh-mission`. */
  dataDir?: string
}

export const Config: z<MissionConfig> = z.object({
  dataDir: z.string().default(''),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    mission: MissionService
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'mission'

/** Required services: the command registry, the tool registry, and the system-prompt assembly. */
export const inject = ['commands', 'tools', 'systemPrompt']

/** Cross-call guidance: after the bash band, beside the other tool sections. */
const MISSION_PROMPT = `Missions track multi-step work. mission_create queues a work item — without a run it lands in this session's implicit run (simple template: queued → active → done | failed); mission_transition moves it along DECLARED edges only, with guards enforced; mission_submit records outputs into the attempt's append-only run-data directory; mission_annotate appends a namespaced, append-only note; mission_retry opens a fresh attempt (the old one stays immutable); mission_is_releasable checks whether held resources may be destroyed. For batch work, mission_run_create with a template; mission_list / mission_run_status project the queue into five buckets (ready / scheduled / blocked / active / done). dependsOn and scheduledAt are plan data only — they change the projection, they never fire anything. Exporting a run bundle is a human decision and intentionally has no tool.`

/**
 * Mount the mission service, its tools, the slash command, and its prompt section.
 * @param ctx - plugin context.
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: MissionConfig): void {
  const service = new MissionService(resolveDataDir(config.dataDir))
  ctx.provide('mission', service)
  registerMissionTools(ctx, service)
  registerMissionSlash(ctx, service)
  // The Typert Remote data face (wire namespace `mission`) behind the web tab.
  ctx.plugin(MissionRemoteService)
  ctx.systemPrompt.section({ name: 'tool:mission', order: 113, text: MISSION_PROMPT })
}

export { MissionService } from './service.ts'
export { MissionRemoteService } from './remote.ts'
export { MissionStore } from './store.ts'
export { handleMissionCommand, registerMissionSlash } from './slash.ts'
export { resolveDataDir } from './defaults.ts'
export { lintTemplate, loadTemplateFile, parseTemplate, deriveShape, SIMPLE_TEMPLATE } from './template.ts'
export { bucketOf, viewOf, currentAttempt, releasableClosure } from './projection.ts'
export { validateJson, assertSchemaSubset, schemaSubsetProblems, jsonEquals } from './schema.ts'
export type * from './types.ts'
export type { LintResult, LoadedTemplate, MachineShape } from './template.ts'
export type {
  CallOptions, MissionCreateOptions, RunCreateOptions, RunStatus, RunSummary, SubmitFile, SubmitOptions,
  SubmitResult, TransitionResult,
} from './service.ts'
