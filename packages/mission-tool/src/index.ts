/**
 * The session-granted mission model tools — the companion row of
 * `@khorsheed/dsh-mission` for agent-preset compositions. The row provides
 * NO service (the preset-mount isolate-realm rule forbids service rows), it
 * only registers the model-facing mission tools into the host tools registry
 * and contributes their guidance section, delegating to the global
 * `ctx.mission` service core the main plugin provides at the profile root —
 * the official tool-row shape (the shipped `tool-bash` rows work the same
 * way). Granting is therefore per-session: a preset names the row, its
 * sessions get the tools; every other preset's sessions do not.
 *
 * The package deliberately declares NO `dsh.bundle` patch: installing it as
 * a dependency only makes the module resolvable (a plain dependency, like
 * `@khorsheed/dsh-local-agent-dsh-headless`); an agent preset's
 * `agent.cordis.yml` references the row by name.
 *
 * @module @khorsheed/dsh-mission-tool
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: pulls the core's `Context.mission` service augmentation.
import type {} from '@khorsheed/dsh-mission'
import { missionToolDefinitions, type MissionToolsTier } from '@khorsheed/dsh-mission/tool'

const PACKAGE_NAME = '@khorsheed/dsh-mission-tool'

/**
 * Tag the model-visible tools with their origin (AGENTS.md § Tool origin
 * tagging; seam S12): the capability catalog reads this `Symbol.for`-keyed
 * tag back through `ctx.tools.get()`, so the mission tools attribute to THIS
 * package (the row the preset mounts), not to the service core. The tag is
 * host-side only and never travels on the model wire.
 */
const definePluginTool = <T extends object>(def: T): T =>
  Object.assign(def, {
    [Symbol.for('dsh.tool.origin')]: { channel: 'plugin', owner: PACKAGE_NAME },
  })

/** Plugin configuration. */
export interface MissionToolConfig {
  /**
   * Which model-tool group this row grants: `all` (the default — every tool),
   * `read` (the four queue queries only), or `none` (no model tools, and no
   * guidance section either). The service face, CLI, slash command, and tab
   * are the core's own and unaffected by all three.
   */
  tools?: MissionToolsTier
}

export const Config: z<MissionToolConfig> = z.object({
  tools: z.union([z.const('all'), z.const('read'), z.const('none')]).default('all'),
})

/** Cordis plugin name used by loader diagnostics. */
export const name = 'mission-tool'

/**
 * No hard injects: the `mission` service belongs to another package and is
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

/** Cross-call guidance: after the bash band, beside the other tool sections. */
const MISSION_PROMPT = `Missions track multi-step work. mission_create queues a work item — without a run it lands in this session's implicit run (simple template: queued → active → done | failed); mission_transition moves it along DECLARED edges only, with guards enforced; mission_submit records outputs into the attempt's append-only run-data directory (pass to when several submission schema edges leave the state); mission_annotate appends a namespaced, append-only note; mission_retry opens a fresh attempt and requires a reason plus category (the old one stays immutable); mission_is_releasable checks whether held resources may be destroyed. For batch work, mission_run_create with a template; mission_list / mission_run_status project the queue into five buckets (ready / scheduled / blocked / active / done). dependsOn and scheduledAt are plan data only — they change the projection, they never fire anything. Exporting a run bundle is a human decision and intentionally has no tool.`


/**
 * The `read` group's section: it names only the four tools that group
 * registers, and says who does the writing instead, so the model does not
 * reach for a tool this mount does not have.
 */
const MISSION_READ_PROMPT = `Missions track multi-step work, and this session can read them but not change them. mission_run_list lists the runs; mission_run_status projects one run's queue into five buckets (ready / scheduled / blocked / active / done); mission_list projects across runs with optional bucket and label filters; mission_get opens one mission in full — attempts, history, refs, checkpoints, artifacts, annotations. dependsOn and scheduledAt are plan data only — they change the projection, they never fire anything. Missions are queued, moved, and written by whoever owns the run (a service-face caller, the CLI, or a person at the tab): report what the queue says, and ask for the change rather than attempting it.`


/**
 * Plugin body: register the tools this row grants and their guidance section
 * when the service core is present, degrade to a no-op when it is not.
 * @param ctx - Cordis context (the preset's agent-plane mount).
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: MissionToolConfig = {}): void {
  const tier = config.tools ?? 'all'
  // `none` grants nothing at all: no tools and no section (guidance about an
  // absent tool is a wrong instruction, not a harmless one).
  if (tier === 'none') return
  const service = ctx.get('mission')
  if (service === undefined) {
    // Degrade, don't explode: the core plugin is not mounted in this profile,
    // so there is nothing to delegate to. The tab/service/slash faces are the
    // core's own concern and unaffected; only the model tools stay absent.
    ctx.logger.info(`${PACKAGE_NAME}: the global mission service is absent — the mission tools are not registered`)
    return
  }
  // Deferred injection, NOT an apply-time probe: `ctx.get('tools')` races the
  // tools registry's own mount order on the real composition tree and loses,
  // silently never registering the tools. `ctx.inject` fires when the registry
  // appears and never fires in a composition without one.
  ctx.inject(['tools'], (toolsCtx) => {
    for (const definition of missionToolDefinitions(service, tier)) {
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
    sections?.section({
      name: 'tool:mission', order: 113,
      text: tier === 'read' ? MISSION_READ_PROMPT : MISSION_PROMPT,
    })
  })
}

export { missionToolDefinitions, MISSION_READ_TOOLS, type MissionToolsTier } from '@khorsheed/dsh-mission/tool'
