/**
 * The session-granted eval tools AND the `/eval` slash face — the companion
 * row of `@khorsheed/dsh-eval` for agent-preset compositions. The row
 * provides NO service (the preset-mount isolate-realm rule forbids service
 * rows); it registers the five model tools into the host tools registry,
 * contributes their guidance section, and registers the `/eval` slash
 * command into the preset's scope layer (preset-visibility rollout A3 — the
 * official `/goal` `/plan` `/compact` shape: only the sessions of a preset
 * naming this row see the command), all delegating to the global
 * `ctx.dshEval` service core the main plugin provides at the profile root —
 * the official tool-row shape (the shipped `tool-bash` rows work the same
 * way). Granting is therefore per-session: a preset names the row, its
 * sessions get the tools and the slash command; every other preset's
 * sessions get neither.
 *
 * The package deliberately declares NO `dsh.bundle` patch: installing it as a
 * dependency only makes the module resolvable (a plain dependency, like
 * `@khorsheed/dsh-local-agent-dsh-headless`); an agent preset's
 * `agent.cordis.yml` references the row by name.
 *
 * @module @khorsheed/dsh-eval-tool
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// The value import also pulls the core's `Context.dshEval` service
// augmentation into the program.
import { registerEvalSlash } from '@khorsheed/dsh-eval'
import { evalToolDefinitions } from '@khorsheed/dsh-eval/tool'

const PACKAGE_NAME = '@khorsheed/dsh-eval-tool'

/**
 * Tag the model-visible tools with their origin (AGENTS.md § Tool origin
 * tagging; seam S12): the capability catalog reads this `Symbol.for`-keyed
 * tag back through `ctx.tools.get()`, so the eval tools attribute to THIS
 * package (the row the preset mounts), not to the service core. The tag is
 * host-side only and never travels on the model wire.
 */
const definePluginTool = <T extends object>(def: T): T =>
  Object.assign(def, {
    [Symbol.for('dsh.tool.origin')]: { channel: 'plugin', owner: PACKAGE_NAME },
  })

/** Plugin configuration. */
export interface EvalToolConfig {
  /**
   * Whether this row grants the eval tools: `all` (the default) or `none`
   * (no tools and no guidance section — a deployment where the model must
   * not even read conditions and runs). The eval service and the CLI are the
   * core's own and stay mounted either way; the `/eval` slash command is
   * THIS row's human face and registers at every tier — the `tools` key
   * gates only the model face.
   *
   * `all` became FOUR tools with T46: an evaluation preset no longer
   * composes the mission tool row, and `eval_cells` is where the per-cell
   * detail its four read tools used to answer now comes from. It became FIVE
   * with I5·T34: `eval_plan_draft` is the row's one write, and the only one
   * it will have — drafting a plan starts nothing, which is exactly what
   * every other write-class verb in this family does.
   */
  tools?: 'all' | 'none'
}

export const Config: z<EvalToolConfig> = z.object({
  tools: z.union([z.const('all'), z.const('none')]).default('all'),
})

/** Cordis plugin name used by loader diagnostics. */
export const name = 'eval-tool'

/**
 * No hard injects: the `dshEval` service belongs to another package and is
 * PROBED at apply time (community-service inject discipline — inject only
 * inside the owning family), and the tools registry plus the system-prompt
 * assembly join through deferred injection so mount order can never strand
 * the row. A preset naming this row therefore mounts cleanly in every
 * composition.
 */
export const inject = []

/** The narrow prompt-section registry surface this plugin opportunistically uses. */
interface PromptSections {
  section(section: { name: string; order: number; text: string }): () => void
}

/** Cross-call guidance, registered beside the tools it describes. */
const EVAL_PROMPT = `The eval_* tools are four reads and one draft. eval_conditions lists the conditions (subjects under test) a dataset repository declares, each with its hash and readiness — a lock that exists and still matches, and which contract fields are still null. eval_plan_validate checks a dataseek.plan/1 document and reports errors (the plan cannot run) and warnings (not resolved yet). eval_plan_draft is the one tool here that writes: it drafts an experiment — plans/<name>.json plus any new condition files — into the session's bound dataset repository working copy and validates what it wrote, in one call. Use it instead of hand-writing those files; a new condition is always a COPY of one that exists with named fields changed, because two conditions differing in ONE field are a single-factor pair and a declaration written from scratch differs in however many fields its author forgot. eval_run_status projects one run: the run.meta digest and a row per cell with its state, bucket, and what the orchestrator last did to it. eval_cells goes cell by cell instead — bucket, stage and time in it, attempt, the unit's resource and environment fingerprint, checkpoint names, annotation counts per namespace, and the delegation's child session — filterable by bucket / task / condition; called with NO run_id it lists the experiments themselves (every run plus every unstarted plan, with snapshot, matrix size, factors, status and progress), which is how you find a run id in the first place. Those five are the whole eval surface of this session: it grants no mission tools, so do not look for mission_run_list / mission_run_status / mission_list / mission_get — the experiment list and the cells are both eval_cells, and the run digest is eval_run_status. DRAFTING IS NOT STARTING. Starting a run is a HUMAN act: the person approves the plan in the 实验室 tab (计划审阅 › 批准并启动) or runs /eval run <plan.json> in this session, and that session becomes the parent of every delegation — there is no run tool and you must not look for one. Logging each harness in and provisioning its condition are theirs too, and so is the final verdict. Your part is drafting, reading and writing the analysis: draft plans and conditions with eval_plan_draft, report the paths and the validate result back, and stop there; the orchestrator does the executing, and the write verbs (materialize, submit, transition, annotate, archive, export) are its service face, not yours.`


/**
 * Plugin body: register the five tools and their guidance section when
 * the service core is present, degrade to a no-op when it is not.
 * @param ctx - Cordis context (the preset's agent-plane mount).
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: EvalToolConfig = {}): void {
  // NOT named `eval`: a ctx property of that name shadows the global `eval`
  // inside the loader's `with (ctx) { return eval(expr) }` !!js evaluation.
  const service = ctx.get('dshEval')
  if (service === undefined) {
    // Degrade, don't explode: the core plugin is not mounted in this profile,
    // so there is nothing to delegate to. The service and CLI faces are the
    // core's own concern and unaffected; only the model tools and the slash
    // command stay absent.
    ctx.logger.info(`${PACKAGE_NAME}: the global eval service is absent — the eval tools and /eval are not registered`)
    return
  }
  // The `/eval` slash face moved here from the core (preset-visibility
  // rollout A3): registering from this preset mount lands the command in the
  // preset's scope layer, so exactly the granted sessions see it. The human
  // face is NOT tiered — the `tools` key gates the model face only — so this
  // registration stands ahead of the tier gate, through the same deferred
  // door as the tools below (an apply-time probe would race the registry's
  // own mount order and lose).
  ctx.inject(['commands'], (commandCtx) => {
    registerEvalSlash(commandCtx, service)
  })
  // `none` grants nothing at all: no tools and no section (guidance about an
  // absent tool is a wrong instruction, not a harmless one).
  if ((config.tools ?? 'all') === 'none') return
  // Deferred injection, NOT an apply-time probe: `ctx.get('tools')` races the
  // tools registry's own mount order on the real composition tree and loses,
  // silently never registering the tools. `ctx.inject` fires when the registry
  // appears and never fires in a composition without one.
  ctx.inject(['tools'], (toolsCtx) => {
    for (const definition of evalToolDefinitions(service)) {
      toolsCtx.effect(
        () => toolsCtx.tools.register(definePluginTool(definition)),
        `${PACKAGE_NAME}: ${definition.name} tool`,
      )
    }
  })
  // The guidance describes those tools, so it rides with them — and through
  // the same deferred door, for the same reason.
  ctx.inject(['systemPrompt'], (promptCtx) => {
    const sections = promptCtx.get('systemPrompt') as PromptSections | undefined
    sections?.section({ name: 'tool:eval', order: 114, text: EVAL_PROMPT })
  })
}

export { evalToolDefinitions, EVAL_TOOL_NAMES } from '@khorsheed/dsh-eval/tool'
