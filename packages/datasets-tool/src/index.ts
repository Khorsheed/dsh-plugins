/**
 * The session-granted dataset model tools — the companion row of
 * `@khorsheed/dsh-datasets` for agent-preset compositions. The row provides
 * NO service (the preset-mount isolate-realm rule forbids service rows), it
 * only registers the model-facing `datasets_*` tools into the host tools
 * registry and contributes their guidance section, delegating to the global
 * `ctx.datasets` service core the main plugin provides at the profile root —
 * the official tool-row shape (the shipped `tool-bash` rows work the same
 * way). Granting is therefore per-session: a preset names the row, its
 * sessions get the tools; every other preset's sessions do not.
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
// Type-only: pulls the core's `Context.datasets` service augmentation.
import type {} from '@khorsheed/dsh-datasets'
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
   * service, the CLI, `/datasets`, and the session tab are the core's own
   * faces and unaffected by every setting.
   */
  tools?: DatasetsToolGroup
}

export const Config: z<DatasetsToolConfig> = z.object({
  tools: z.union([z.const('all'), z.const('read'), z.const('authoring'), z.const('none')]).default('all'),
})

/** Cordis plugin name used by loader diagnostics. */
export const name = 'datasets-tool'

/**
 * No hard injects: the `datasets` service belongs to another package and is
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

/**
 * Plugin body: register the tools this row grants and their guidance section
 * when the service core is present, degrade to a no-op when it is not.
 * @param ctx - Cordis context (the preset's agent-plane mount).
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: DatasetsToolConfig = {}): void {
  const admitted = new Set(toolsOfGroup(config.tools ?? 'all'))
  // `none` grants nothing at all: no tools and no section (guidance about an
  // absent tool is a wrong instruction, not a harmless one).
  if (admitted.size === 0) return
  const service = ctx.get('datasets')
  if (service === undefined) {
    // Degrade, don't explode: the core plugin is not mounted in this profile,
    // so there is nothing to delegate to. The tab/service/CLI faces are the
    // core's own concern and unaffected; only the model tools stay absent.
    ctx.logger.info(`${PACKAGE_NAME}: the global datasets service is absent — the dataset tools are not registered`)
    return
  }
  // Deferred injection, NOT an apply-time probe: `ctx.get('tools')` races the
  // tools registry's own mount order on the real composition tree and loses,
  // silently never registering the tools. `ctx.inject` fires when the registry
  // appears and never fires in a composition without one.
  ctx.inject(['tools'], (toolsCtx) => {
    for (const definition of datasetToolDefinitions(service, {
      defaultRepo: '',
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
        'Dataset access goes through the datasets_* tools. They resolve against this session\'s bound dataset '
        + 'repository; when no binding exists and a call has no explicit `repo`, the tool says so — ask the '
        + 'human to bind one (/datasets bind). Layers outside the binding\'s whitelist are invisible to you; '
        + 'never try to reach them through other means. Pin a commit with datasets_snapshot before a read '
        + 'series'
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
