/**
 * The session-granted dataset model tools AND the `/datasets` slash face —
 * this package's `./tool`
 * composition entry (the canvas `./agent` pattern) for agent-preset
 * compositions. The row provides
 * NO service (the preset-mount isolate-realm rule forbids service rows); it
 * registers the model-facing `datasets_*` tools into the host tools
 * registry, contributes their guidance section, and registers the
 * `/datasets` slash command into the preset's scope layer (preset-visibility
 * rollout A3 — the official `/goal` `/plan` `/compact` shape: only the
 * sessions of a preset naming this row see the command), all delegating to
 * the global
 * `ctx.datasets` service core the core row provides at the profile root —
 * the official tool-row shape (the shipped `tool-bash` rows work the same
 * way). Granting is therefore per-session: a preset names the row, its
 * sessions get the tools and the slash command; every other preset's
 * sessions get neither.
 *
 * This entry used to ship as the standalone companion package
 * `@khorsheed/dsh-datasets-tool`; the T88 evaluation-family fold (2026-10-01,
 * the room 0.2.0 / local-agent precedent) moved it into the core package as
 * this subpath row, and the old package name is retired. An agent preset's
 * `agent.cordis.yml` references the row by name:
 * `- id: datasets-tool / name: '@khorsheed/dsh-datasets/tool'` (the row id is
 * unchanged). The package's own bundle patch mounts ONLY the core row — a
 * profile-root tool row would grant every session, exactly what the split
 * removed.
 *
 * @module @khorsheed/dsh-datasets/tool
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: pulls this package's `Context.datasets` service augmentation.
import type {} from './index.ts'
import { registerDatasetsSlash } from './slash.ts'
import { datasetToolDefinitions, toolsOfGroup, type DatasetsToolGroup } from './tool-definition.ts'

const PACKAGE_NAME = '@khorsheed/dsh-datasets'

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
   * default), `organize` (authoring plus `datasets_propose_registration`, and
   * the shipped `dataset-authoring` skill — introduced for the 「题集整理」
   * preset at T90, the evaluation mode's tier since T102 folded organizing
   * into it),
   * or `none` (no model tools and no guidance section). The
   * service, the CLI, and the session tab are the core's own faces; the
   * `/datasets` slash command is THIS row's and registers at every tier —
   * the `tools` key gates only the model face.
   */
  tools?: DatasetsToolGroup
}

export const Config: z = z.object({
  tools: z.union([z.const('all'), z.const('read'), z.const('authoring'), z.const('organize'), z.const('none')]).default('all'),
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

/** The narrow skill registry surface the `organize` tier registers its skill into. */
interface SkillRegistrySlice {
  register(skill: {
    name: string
    description: string
    content: string
    source: string
    provider?: string
  }): () => void
}

/** The shipped skill, parsed from its SKILL.md frontmatter. */
interface SkillFile {
  readonly name: string
  readonly description: string
  readonly content: string
}

/** This package's root (`src/` in the source plane, `lib/` once built — both one level down). */
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The shipped skill's directory: SKILL.md plus the build-copied protocol (`protocol.en.md` / `protocol.zh.md`). */
export const AUTHORING_SKILL_DIR = join(PACKAGE_ROOT, 'skills', 'dataset-authoring')

/**
 * Resolve the skill's install-relative placeholders to real absolute paths
 * (T94): `{{skillDir}}` → the skill's directory (where the protocol ships),
 * `{{packageDir}}` → this package's root (its `lib/cli.js`). The skill reaches
 * the model as text through the host registry, so a relative path would mean
 * nothing to it — and an unresolvable reference is what sent the organizing
 * agent searching the whole disk.
 * @param content - the SKILL.md body.
 * @returns the body with every placeholder replaced.
 */
export function resolveSkillPaths(content: string): string {
  return content.replaceAll('{{skillDir}}', AUTHORING_SKILL_DIR).replaceAll('{{packageDir}}', PACKAGE_ROOT)
}

/**
 * Load the shipped `dataset-authoring` skill (`skills/dataset-authoring/SKILL.md`,
 * listed in package.json `files`), its install paths resolved. A missing or
 * malformed file is a warning, never a boot failure.
 * @returns the parsed skill, or undefined when it cannot be read.
 */
export function loadAuthoringSkill(): SkillFile | undefined {
  const file = join(AUTHORING_SKILL_DIR, 'SKILL.md')
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw)
  const frontmatter = match?.[1] ?? ''
  const skillName = /^name:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim()
  const description = /^description:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim()
  const content = match?.[2]
  if (skillName === undefined || description === undefined || content === undefined) return undefined
  return { name: skillName, description, content: resolveSkillPaths(content) }
}

/**
 * The `organize` tier's guidance — since T102 the evaluation mode's one
 * datasets section. It states both jobs the session now does and where each
 * may read: USING a registered dataset goes through the tools by `<id>/<set>`
 * (the generic `datasets:tools` rule, unchanged), and ORGANIZING data into a
 * new dataset is the one job that reads directories — the original data, the
 * target repository and the shipped protocol, nothing else. One section, not
 * the generic one plus an organizing one: two sections, one forbidding
 * directory reads and one requiring them, is the contradiction the T102 brief
 * asked not to ship.
 */
const ORGANIZE_GUIDANCE =
  'Registered datasets are used through the datasets_* tools only: find them with datasets_list and address each '
  + 'as `<id>/<set>` — never by a path, and never read, glob or grep a registered dataset\'s directory yourself. '
  + 'When a name matches several registered datasets, let the person choose with ask_user_question. Layers a '
  + 'registration does not grant are invisible to you; never try to reach them through other means. Pin a commit '
  + 'with datasets_snapshot before a read series; draft items into a registered dataset with datasets_put_item and '
  + 'leave its `git commit` to the person.\n'
  + 'Organizing — turning data into a dataset repository, changing one the person hands you with its checkout, or '
  + 'reworking a proposal they returned — is the one job that reads directories. Load the dataset-authoring skill first and follow it step by step: check git, look at the '
  + 'data, ask every key question in one go, never modify the original data, convert the whole dataset (no '
  + 'sampling), give every file and field a disposition, commit per batch, and check with '
  + 'datasets_propose_registration {dryRun: true} until it passes. Validation rules come from those checks, and the '
  + 'protocol ships with the skill at the paths it names: read only the original directory, the target repository, '
  + 'and that protocol — never search the disk, read any plugin\'s source or lib, or read another dsh instance\'s '
  + 'directories. Then file the proposal with datasets_propose_registration and stop: only the person registers, '
  + 'on the Datasets tab.'

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
  if (config.tools === 'organize') {
    // The organizing tier (the evaluation mode's since T102): one guidance
    // section covering both using registered datasets and organizing new
    // ones (the generic section alone forbids reading directories, which is
    // exactly the organizing job on the ORIGINAL data), and the shipped skill.
    // Both only here, so the read / authoring / all tiers' prompts and skill
    // lists stay byte-identical.
    ctx.inject(['systemPrompt'], (promptCtx) => {
      const sections = promptCtx.get('systemPrompt') as PromptSections | undefined
      sections?.section({ name: 'datasets:organize', order: 150, text: ORGANIZE_GUIDANCE })
    })
    ctx.inject(['skills'], (skillCtx) => {
      const skills = skillCtx.get('skills') as SkillRegistrySlice | undefined
      if (skills === undefined) return
      const skill = loadAuthoringSkill()
      if (skill === undefined) {
        ctx.logger.warn(`${PACKAGE_NAME}: the shipped dataset-authoring skill could not be read — not registered`)
        return
      }
      skillCtx.effect(() => skills.register({
        name: skill.name,
        description: skill.description,
        content: skill.content,
        source: 'runtime',
        provider: PACKAGE_NAME,
      }), `${PACKAGE_NAME}: ${skill.name} skill`)
    })
    return
  }
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

export { datasetToolDefinitions, toolsOfGroup, type DatasetsToolGroup } from './tool-definition.ts'
