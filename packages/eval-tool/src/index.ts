/**
 * The session-granted eval read tools — the companion row of
 * `@khorsheed/dsh-eval` for agent-preset compositions. The row provides NO
 * service (the preset-mount isolate-realm rule forbids service rows), it only
 * registers the three read-only model tools into the host tools registry and
 * contributes their guidance section, delegating to the global `ctx.dshEval`
 * service core the main plugin provides at the profile root — the official
 * tool-row shape (the shipped `tool-bash` rows work the same way). Granting is
 * therefore per-session: a preset names the row, its sessions get the tools;
 * every other preset's sessions do not.
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
// Type-only: pulls the core's `Context.dshEval` service augmentation.
import type {} from '@khorsheed/dsh-eval'
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
   * Whether this row grants the three read tools: `all` (the default) or
   * `none` (no tools and no guidance section — a deployment where the model
   * must not even read conditions and runs). The eval service, the
   * `/eval` slash face, and the CLI are the core's own and stay mounted
   * either way.
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
const EVAL_PROMPT = `The eval_* tools are READ ONLY, all three of them. eval_conditions lists the conditions (subjects under test) a dataset repository declares, each with its hash and readiness — a lock that exists and still matches, and which contract fields are still null. eval_plan_validate checks a dataseek.plan/1 document and reports errors (the plan cannot run) and warnings (not resolved yet). eval_run_status projects one run: the run.meta digest and a row per cell with its state, bucket, and what the orchestrator last did to it. Starting a run is a HUMAN act: the person runs /eval run <plan.json> in this session, and that session becomes the parent of every delegation — there is no run tool and you must not look for one. Your part is drafting and reading: propose conditions and plans as data files (copy an existing condition and change exactly ONE field), validate them, and hand them to the human for approval; the orchestrator does the executing, and the write verbs (materialize, submit, transition, annotate, archive, export) are its service face, not yours.`


/**
 * Plugin body: register the three read tools and their guidance section when
 * the service core is present, degrade to a no-op when it is not.
 * @param ctx - Cordis context (the preset's agent-plane mount).
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: EvalToolConfig = {}): void {
  // `none` grants nothing at all: no tools and no section (guidance about an
  // absent tool is a wrong instruction, not a harmless one).
  if ((config.tools ?? 'all') === 'none') return
  // NOT named `eval`: a ctx property of that name shadows the global `eval`
  // inside the loader's `with (ctx) { return eval(expr) }` !!js evaluation.
  const service = ctx.get('dshEval')
  if (service === undefined) {
    // Degrade, don't explode: the core plugin is not mounted in this profile,
    // so there is nothing to delegate to. The service, CLI, and /eval slash
    // faces are the core's own concern and unaffected; only the model tools
    // stay absent.
    ctx.logger.info(`${PACKAGE_NAME}: the global eval service is absent — the eval tools are not registered`)
    return
  }
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
