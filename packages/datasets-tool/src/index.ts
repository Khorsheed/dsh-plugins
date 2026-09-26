/**
 * The session-granted dataset model tools AND the `/datasets` slash face —
 * the companion row of
 * `@khorsheed/dsh-datasets` for agent-preset compositions. The row provides
 * NO service (the preset-mount isolate-realm rule forbids service rows); it
 * registers the model-facing `datasets_*` tools into the host tools
 * registry, contributes their guidance section, and registers the
 * `/datasets` slash command into the preset's scope layer (preset-visibility
 * rollout A3 — the official `/goal` `/plan` `/compact` shape: only the
 * sessions of a preset naming this row see the command), all delegating to
 * the global
 * `ctx.datasets` service core the main plugin provides at the profile root —
 * the official tool-row shape (the shipped `tool-bash` rows work the same
 * way). Granting is therefore per-session: a preset names the row, its
 * sessions get the tools and the slash command; every other preset's
 * sessions get neither.
 *
 * The package deliberately declares NO `dsh.bundle` patch: installing it as
 * a dependency only makes the module resolvable (a plain dependency, like
 * `@khorsheed/dsh-local-agent-dsh-headless`); an agent preset's
 * `agent.cordis.yml` references the row by name.
 *
 * @module @khorsheed/dsh-datasets-tool
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// The value import also pulls the core's `Context.datasets` service
// augmentation into the program.
import { registerDatasetsSlash } from '@khorsheed/dsh-datasets'
import { datasetToolDefinitions, toolsOfGroup, type DatasetsToolGroup } from '@khorsheed/dsh-datasets/tool'

const PACKAGE_NAME = '@khorsheed/dsh-datasets-tool'

/**
 * Tag the model-visible tools with their origin (AGENTS.md § Tool origin
 * tagging; seam S12): the capability catalog reads this `Symbol.for`-keyed
 * tag back through `ctx.tools.get()`, so the dataset tools attribute to THIS
 * package (the row the preset mounts), not to the service core. The tag is
 * host-side only and never travels on the model wire.
 */
const definePluginTool = <T extends object>(def: T): T =>
  Object.assign(def, {
    [Symbol.for('dsh.tool.origin')]: { channel: 'plugin', owner: PACKAGE_NAME },
  })

/** Plugin configuration. */
export interface DatasetsToolConfig {
  /**
   * Which group of model tools this row grants: `read` (the six read verbs),
   * `authoring` (read plus `datasets_put_item` — the drafting domain an eval
   * agent wants), `all` (authoring plus `datasets_worktree_path`; the
   * default), or `none` (no model tools and no guidance section). The
   * service, the CLI, and the session tab are the core's own faces; the
   * `/datasets` slash command is THIS row's and registers at every tier —
   * the `tools` key gates only the model face.
   */
  tools?: DatasetsToolGroup
}

export const Config: z = z.object({
  tools: z.union([z.const('all'), z.const('read'), z.const('authoring'), z.const('none')]).default('all'),
})

/** Cordis plugin name used by loader diagnostics. */
export const name = 'datasets-tool'

/**
 * The `datasets` core is a declared inject (the owning-family companion
 * exception to the community-service probe rule): a preset's standing scope
 * mounts at registry-activation time, BEFORE the profile's later bundle rows
 * provide the core, so a one-shot ctx.get probe at apply saw ABSENT there and
 * nothing re-ran the row (rc.1 boot order; 3080 production 2026-09-27). The
 * declared inject pends the row until the core provides, then the body
 * applies. The tools registry and the system-prompt assembly still join
 * through deferred injection so their mount order cannot strand the
 * registrations.
 */
export const inject = ['datasets']

/** The narrow prompt-section registry surface this plugin opportunistically uses. */
interface PromptSections {
  section(section: { name: string; order: number; text: string }): () => void
}

/**
 * Plugin body: register the tools this row grants and their guidance section.
 * The declared `datasets` inject pends the row until the core provides, so
 * mount order can no longer strand it; the in-body guard stays as the
 * defensive direct-call path.
 * @param ctx - Cordis context (the preset's agent-plane mount).
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: DatasetsToolConfig = {}): void {
  const service = ctx.get('datasets')
  if (service === undefined) {
    // Degrade, don't explode: the core plugin is not mounted in this profile,
    // so there is nothing to delegate to. The tab/service/CLI faces are the
    // core's own concern and unaffected; only the model tools and the slash
    // command stay absent.
    ctx.logger.info(`${PACKAGE_NAME}: the global datasets service is absent — the dataset tools and /datasets are not registered`)
    return
  }
  // The `/datasets` slash face moved here from the core (preset-visibility
  // rollout A3): registering from this preset mount lands the command in the
  // preset's scope layer, so exactly the granted sessions see it. The human
  // face is NOT tiered — the `tools` key gates the model face only — so this
  // registration stands ahead of the tier gate, through the same deferred
  // door as the tools below (an apply-time probe would race the registry's
  // own mount order and lose).
  ctx.inject(['commands'], (commandCtx) => {
    registerDatasetsSlash(commandCtx, service)
  })
  const admitted = new Set(toolsOfGroup(config.tools ?? 'all'))
  // `none` grants nothing at all: no tools and no section (guidance about an
  // absent tool is a wrong instruction, not a harmless one).
  if (admitted.size === 0) return
  // Deferred injection, NOT an apply-time probe: `ctx.get('tools')` races the
  // tools registry's own mount order on the real composition tree and loses,
  // silently never registering the tools. `ctx.inject` fires when the registry
  // appears and never fires in a composition without one.
  ctx.inject(['tools'], (toolsCtx) => {
    for (const definition of datasetToolDefinitions(service, {
      group: config.tools ?? 'all',
    })) {
      toolsCtx.effect(
        () => toolsCtx.tools.register(definePluginTool(definition)),
        `${PACKAGE_NAME}: ${definition.name} tool`,
      )
    }
  })
  // The guidance describes those tools, so it rides with them — and through
  // the same deferred door, for the same reason. The section names only the
  // verbs this group actually granted.
  ctx.inject(['systemPrompt'], (promptCtx) => {
    const sections = promptCtx.get('systemPrompt') as PromptSections | undefined
    sections?.section({
      name: 'datasets:tools',
      order: 150,
      text:
        'Dataset access goes through the datasets_* tools, and only to the datasets this deployment registered: '
        + 'find them with datasets_list and address each as `<id>/<set>` — never by a path. When the person '
        + 'names a dataset that is not listed, ask them to register it on the Datasets tab; do not read the '
        + 'directory yourself. When a name matches several registered datasets, let the person choose with '
        + 'ask_user_question. Layers the registration does not grant are invisible to you; never try to reach '
        + 'them through other means. Pin a commit with datasets_snapshot before a read series'
        + (admitted.has('datasets_worktree_path')
          ? '; consume whole layers through datasets_worktree_path (read-only, never modify or delete the '
            + 'returned directory)'
          : '')
        + (admitted.has('datasets_put_item')
          ? '; draft items with datasets_put_item and leave `git commit` to the human'
          : '')
        + '.',
    })
  })
}

export { datasetToolDefinitions, toolsOfGroup, type DatasetsToolGroup } from '@khorsheed/dsh-datasets/tool'
