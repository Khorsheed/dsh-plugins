/**
 * Generic versioned dataset storage over git repositories: layered items,
 * commit-pinned reads straight from git objects, deduplicated sparse-checkout
 * worktree views for whole-layer consumption, and per-session bindings whose
 * layer whitelist is enforced on every read path. Four faces share one
 * service core: the model tools (first citizen), the `dsh-datasets` CLI, the
 * `/datasets` slash command, and the Typert Remote data face behind the web
 * session tab (wire namespace `datasets`). The plugin never interprets descriptor
 * semantics and never copies content out of the repository.
 *
 * @module @khorsheed/dsh-datasets
 */
import type { Context } from '@deepseek-ai/cordis'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
// Type-only: pulls the commands Context merge into the program.
import type {} from '@deepseek-ai/dsh-commands'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { DatasetBinding } from './binding.ts'
import { DatasetsError } from './dataset.ts'

/**
 * Tag model-visible tools with their origin (AGENTS.md § Tool origin tagging;
 * seam S12): the catalog reads this `Symbol.for`-keyed tag back through
 * `ctx.tools.get()`. The tag is host-side only — the model-facing schema is
 * rebuilt by `schemaOf()` and never carries it.
 */
const definePluginTool = <T extends object>(def: T): T =>
  Object.assign(def, {
    [Symbol.for('dsh.tool.origin')]: { channel: 'plugin', owner: '@khorsheed/dsh-datasets' },
  })
import { resolveStateRoot, resolveWorktreeRoot } from './defaults.ts'
import { formatList, formatShow, formatWarnings } from './format.ts'
import {
  createDatasetsService, resolveScope, type DatasetScope, type DatasetsService,
} from './service.ts'
import { DatasetsRemoteService } from './remote.ts'

/**
 * Which group of model tools the plugin registers. Grouping lives in the
 * plugin because a preset cannot deselect a tool the profile registered: the
 * only place that decides is the registration itself.
 *
 * - `read` — the read verbs (list / show / describe / read / snapshot / validate);
 * - `authoring` — read plus `datasets_put_item` (drafting items into the working tree);
 * - `all` — authoring plus `datasets_worktree_path` (whole-layer materialization). The default;
 * - `none` — no model tools at all. The service, the CLI, `/datasets` and the
 *   session tab are unaffected by every setting: they are the human's faces.
 */
export type DatasetsToolGroup = 'all' | 'read' | 'authoring' | 'none'

/** The read verbs — every tool that only reads the repository. */
const READ_TOOLS = [
  'datasets_list', 'datasets_show', 'datasets_describe', 'datasets_read', 'datasets_snapshot', 'datasets_validate',
] as const

/** Authoring adds the working-tree draft verb (the plugin still never commits). */
const AUTHORING_TOOLS = [...READ_TOOLS, 'datasets_put_item'] as const

/** `all` adds whole-layer materialization (it writes a managed worktree). */
const ALL_TOOLS = [...AUTHORING_TOOLS, 'datasets_worktree_path'] as const

/**
 * The tools one group registers.
 * @param group - the configured group.
 * @returns the admitted tool names (a subset of the eight, in registration order).
 */
export function toolsOfGroup(group: DatasetsToolGroup): readonly string[] {
  switch (group) {
    case 'none': return []
    case 'read': return READ_TOOLS
    case 'authoring': return AUTHORING_TOOLS
    default: return ALL_TOOLS
  }
}

/** Plugin configuration. */
export interface DatasetsPluginConfig {
  /**
   * Default dataset repository when a call carries no explicit `repo` and the
   * session has no binding ('' = none).
   */
  repo?: string
  /** Managed worktree root override ('' = the three-stage default). */
  worktreeRoot?: string
  /**
   * Which model tools to register (default `all` — unchanged behavior). An
   * eval domain, whose agent plans and drafts but never executes, wants
   * `authoring`.
   */
  tools?: DatasetsToolGroup
}

export const Config: z<DatasetsPluginConfig> = z.object({
  repo: z.string().default(''),
  worktreeRoot: z.string().default(''),
  tools: z.union([z.const('all'), z.const('read'), z.const('authoring'), z.const('none')]).default('all'),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    datasets: DatasetsService
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'datasets'

/** Required services: the slash registry and the tool registry. */
export const inject = ['commands', 'tools']

/** The narrow prompt-section registry surface this plugin opportunistically uses. */
interface PromptSections {
  section(section: { name: string; order: number; text: string }): () => void
}

const COMMON_REPO_PARAM = {
  type: 'string',
  description: 'Dataset repository path. Omit to use the session binding (or the configured default).',
} as const

const COMMON_DATASET_PARAM = {
  type: 'string',
  required: true,
  description: 'Dataset id (its directory under datasets/ in the repository).',
} as const

const COMMIT_PARAM = {
  type: 'string',
  description: 'Pinned commit (from datasets_snapshot). Default: the repository HEAD.',
} as const

/** JSON-passthrough output: the canonical value is the whole service result. */
function jsonOutput(): {
  schema: { type: 'json' }
  render: (args: unknown, value: unknown) => { type: 'text'; text: string }[]
} {
  return {
    schema: { type: 'json' },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  }
}

export function apply(ctx: Context, config: DatasetsPluginConfig): void {
  const service = createDatasetsService({
    worktreeRoot: resolveWorktreeRoot(config.worktreeRoot),
    bindingsRoot: join(resolveStateRoot(undefined), 'bindings'),
  })
  ctx.provide('datasets', service)
  const defaultRepo = config.repo ?? ''
  // The web session tab's data face: the same service core behind a Typert
  // Remote (wire namespace `datasets`), session bindings resolved per call.
  ctx.plugin(DatasetsRemoteService, { defaultRepo })

  /** Scope for one tool call: explicit args first, then the session binding. */
  const scopeFor = (exec: { agent?: { session: import('./binding.ts').BindingSession } }, args: { repo?: string }): DatasetScope => {
    const session = exec.agent?.session
    const binding = session === undefined ? undefined : service.binding(session)
    return resolveScope(args, binding, defaultRepo)
  }

  /** Error text for tool failures (the registry reports thrown messages). */
  const toToolError = (error: unknown): Error => {
    if (error instanceof DatasetsError) return new Error(`${error.message} [${error.code}]`)
    return error instanceof Error ? error : new Error(String(error))
  }

  // The configured group decides which tools exist at all. Definitions below
  // are unconditional (one shape, one origin tag); only registration is gated.
  const admitted = new Set(toolsOfGroup(config.tools ?? 'all'))
  /** Register one tool when its group admits it. */
  const registerTool = (definition: ReturnType<typeof defineTool>): void => {
    if (!admitted.has(definition.name)) return
    ctx.tools.register(definePluginTool(definition))
  }

  registerTool(defineTool({
    name: 'datasets_list',
    description:
      'List the datasets in the session\'s bound dataset repository, or one dataset\'s items with their '
      + 'metadata and layer files when `dataset` is given. Layers outside the session binding\'s whitelist '
      + 'are invisible here and everywhere else.',
    parameters: {
      repo: COMMON_REPO_PARAM,
      dataset: { type: 'string', description: 'When given, list this dataset\'s items instead of datasets.' },
      commit: COMMIT_PARAM,
    },
    output: jsonOutput(),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      try {
        const scope = scopeFor(exec, args)
        return (await service.list(scope, args.dataset, args.commit)) as unknown as JsonValue
      } catch (error) {
        throw toToolError(error)
      }
    },
  }))

  registerTool(defineTool({
    name: 'datasets_show',
    description:
      'Show one dataset (or one item of it) at a commit: summary, the full descriptor passthrough, and the '
      + 'layer-file listing, filtered to the session binding\'s layer whitelist.',
    parameters: {
      repo: COMMON_REPO_PARAM,
      dataset: COMMON_DATASET_PARAM,
      item: { type: 'string', description: 'When given, show just this item.' },
      commit: COMMIT_PARAM,
    },
    output: jsonOutput(),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      try {
        const scope = scopeFor(exec, args)
        return (await service.show(scope, args.dataset, args.item, args.commit)) as unknown as JsonValue
      } catch (error) {
        throw toToolError(error)
      }
    },
  }))

  registerTool(defineTool({
    name: 'datasets_describe',
    description:
      'Pass one dataset\'s descriptor (dataset.json) through verbatim. The plugin validates its shape but '
      + 'never interprets its semantics.',
    parameters: {
      repo: COMMON_REPO_PARAM,
      dataset: COMMON_DATASET_PARAM,
      commit: COMMIT_PARAM,
    },
    output: jsonOutput(),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      try {
        const scope = scopeFor(exec, args)
        return (await service.describe(scope, args.dataset, args.commit)) as unknown as JsonValue
      } catch (error) {
        throw toToolError(error)
      }
    },
  }))

  registerTool(defineTool({
    name: 'datasets_read',
    description:
      'Read one file of one item layer, straight from the git object at the pinned commit (`git show '
      + '<commit>:<path>`) — no copy materializes outside the repository. The layer must survive the '
      + 'session binding\'s whitelist. For whole-layer consumption use datasets_worktree_path instead.',
    parameters: {
      repo: COMMON_REPO_PARAM,
      dataset: COMMON_DATASET_PARAM,
      item: { type: 'string', required: true, description: 'Item id.' },
      layer: { type: 'string', required: true, description: 'Layer name (declared by the dataset descriptor).' },
      path: { type: 'string', required: true, description: 'Layer-relative file path.' },
      commit: COMMIT_PARAM,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          content: { type: 'string', required: true },
          commit: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.content }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      try {
        const scope = scopeFor(exec, args)
        return await service.read(scope, {
          dataset: args.dataset,
          item: args.item,
          layer: args.layer,
          path: args.path,
          ...(args.commit !== undefined ? { commit: args.commit } : {}),
        })
      } catch (error) {
        throw toToolError(error)
      }
    },
  }))

  registerTool(defineTool({
    name: 'datasets_snapshot',
    description:
      'Pin a dataset to its current commit: returns {repoPath, commit, datasetId}. Pass the commit back to '
      + 'datasets_read / datasets_worktree_path for stable reads while the repository keeps evolving.',
    parameters: {
      repo: COMMON_REPO_PARAM,
      dataset: COMMON_DATASET_PARAM,
      commit: COMMIT_PARAM,
    },
    output: jsonOutput(),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      try {
        const scope = scopeFor(exec, args)
        return (await service.snapshot(scope, args.dataset, args.commit)) as unknown as JsonValue
      } catch (error) {
        throw toToolError(error)
      }
    },
  }))

  registerTool(defineTool({
    name: 'datasets_worktree_path',
    description:
      'Materialize a whole-layer read-only view: a managed git worktree at the pinned commit, sparse-checkout-'
      + 'limited to the requested layers (default: all layers the session whitelist admits), deduplicated '
      + 'per (repo, commit, layers). Returns an ordinary directory path — mount it read-only, read it '
      + 'directly, but never modify or delete it (it is a shared cache; `dsh-datasets worktree prune` owns '
      + 'cleanup). The whitelist is mechanical: disallowed layer directories are physically absent.',
    parameters: {
      repo: COMMON_REPO_PARAM,
      dataset: COMMON_DATASET_PARAM,
      commit: COMMIT_PARAM,
      layers: {
        type: 'array',
        items: { type: 'string' },
        description: 'Layers to expose (default: every declared layer the session whitelist admits). '
          + 'Intersected with the session binding\'s whitelist; an empty intersection is an error.',
      },
    },
    output: jsonOutput(),
    async execute(args, exec) {
      try {
        const scope = scopeFor(exec, args)
        return (await service.worktreePath(scope, args.dataset, {
          ...(args.commit !== undefined ? { commit: args.commit } : {}),
          ...(args.layers !== undefined ? { layers: args.layers } : {}),
        })) as unknown as JsonValue
      } catch (error) {
        throw toToolError(error)
      }
    },
  }))

  registerTool(defineTool({
    name: 'datasets_put_item',
    description:
      'Create or update one item IN THE WORKING TREE: write its metadata (item.json) and/or layer files. '
      + 'The plugin never commits — review and `git commit` stay with the human\'s normal git flow. Layer '
      + 'files must name layers the descriptor declares and the session whitelist admits.',
    parameters: {
      repo: COMMON_REPO_PARAM,
      dataset: COMMON_DATASET_PARAM,
      item: { type: 'string', required: true, description: 'Item id (created when absent).' },
      metadata: {
        type: 'json',
        description: 'Item metadata object; replaces item.json. Fields follow the dataset\'s declared schema.',
      },
      files: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            layer: { type: 'string', required: true, description: 'Declared layer name.' },
            path: { type: 'string', required: true, description: 'Layer-relative file path.' },
            content: { type: 'string', required: true, description: 'Full file content (utf8).' },
          },
        },
        description: 'Layer files to write.',
      },
    },
    output: jsonOutput(),
    async execute(args, exec) {
      try {
        const scope = scopeFor(exec, args)
        return (await service.putItem(scope, {
          dataset: args.dataset,
          item: args.item,
          ...(args.metadata !== undefined ? { metadata: args.metadata as Record<string, unknown> } : {}),
          ...(args.files !== undefined ? { files: args.files } : {}),
        })) as unknown as JsonValue
      } catch (error) {
        throw toToolError(error)
      }
    },
  }))

  registerTool(defineTool({
    name: 'datasets_validate',
    description:
      'Validate a dataset repository (or one dataset of it) for authoring hygiene: descriptor shape errors '
      + 'and unjudgeable rubrics fail loud; warnings never block. Errors cover the descriptor shape plus, '
      + 'for an item carrying a grading-layer rubric, a rubric with no leaf criteria, a leaf missing '
      + 'id/axis/weight/kind/criterion/evidence, a kind outside objective/llm-draft/human, and a leaf whose '
      + '`negative: true` and weight sign disagree. Warnings cover undeclared modelFacing on layers of a '
      + 'mixed-sensitivity dataset, sensitive-looking item.json field names (note/hint/answer/rubric/'
      + 'grading — item.json is always visible), files covered by no layer directory or register '
      + 'entry (they sit in the always-visible passthrough zone), text files of a modelFacing layer that do '
      + 'not carry the declared `canary`, objective leaves with no executable probe in the verify layer, and '
      + 'a rubric.md referring to a leaf its rubric.yml does not declare.',
    parameters: {
      repo: COMMON_REPO_PARAM,
      dataset: { type: 'string', description: 'When given, validate just this dataset.' },
      commit: COMMIT_PARAM,
    },
    output: jsonOutput(),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      try {
        const scope = scopeFor(exec, args)
        return (await service.validate(scope, args.dataset)) as unknown as JsonValue
      } catch (error) {
        throw toToolError(error)
      }
    },
  }))

  ctx.commands.register({
    name: 'datasets',
    description:
      'Session dataset binding and browsing: /datasets list [dataset] | show <dataset> [item] | '
      + 'bind <repoPath> [--datasets a,b] [--layers x,y] | unbind',
    handler: async (invocation) => {
      const session = invocation.agent.session
      const parts = invocation.rawInput.trim().split(/\s+/).filter(part => part !== '')
      const verb = parts[0]
      const flags = parseSlashFlags(parts.slice(1))
      try {
        switch (verb) {
          case 'list': {
            const scope = resolveScope({}, service.binding(session), defaultRepo)
            const result = await service.list(scope, flags.positionals[0])
            const warnings = result.kind === 'datasets'
              ? result.datasets.flatMap(dataset => dataset.warnings)
              : result.dataset.warnings
            const suffix = warnings.length === 0 ? '' : `\n${formatWarnings(warnings)}`
            return { kind: 'success', text: `${formatList(result)}${suffix}` }
          }
          case 'show': {
            const dataset = flags.positionals[0]
            if (dataset === undefined) return { kind: 'error', text: 'usage: /datasets show <dataset> [item]' }
            const scope = resolveScope({}, service.binding(session), defaultRepo)
            const result = await service.show(scope, dataset, flags.positionals[1])
            const suffix = result.dataset.warnings.length === 0 ? '' : `\n${formatWarnings(result.dataset.warnings)}`
            return { kind: 'success', text: `${formatShow(result)}${suffix}` }
          }
          case 'bind': {
            const repoPath = flags.positionals[0]
            if (repoPath === undefined) {
              return { kind: 'error', text: 'usage: /datasets bind <repoPath> [--datasets a,b] [--layers x,y]' }
            }
            const binding: DatasetBinding = {
              repoPath,
              ...(flags.datasets !== undefined ? { datasets: flags.datasets } : {}),
              ...(flags.layers !== undefined ? { layers: flags.layers } : {}),
            }
            const recorded = service.bind(session, binding)
            return {
              kind: 'success',
              text: `bound ${recorded.repoPath}`
                + `${recorded.datasets !== undefined ? ` datasets: ${recorded.datasets.join(', ')}` : ''}`
                + `${recorded.layers !== undefined ? ` layers: ${recorded.layers.join(', ')}` : ' (all layers)'}`,
            }
          }
          case 'unbind': {
            service.unbind(session)
            return { kind: 'success', text: 'dataset binding cleared' }
          }
          default:
            return {
              kind: 'error',
              text: 'usage: /datasets list [dataset] | show <dataset> [item] | bind <repoPath> [--datasets a,b] [--layers x,y] | unbind',
            }
        }
      } catch (error) {
        return { kind: 'error', text: error instanceof DatasetsError ? `${error.message} [${error.code}]` : String(error) }
      }
    },
  })

  // Model guidance, when the deployment assembles prompts (probed: a minimal
  // composition without the systemPrompt service still gets working tools).
  // The section describes only the tools this group actually registered —
  // guidance about an absent tool is a wrong instruction, not a harmless one.
  const systemPrompt = ctx.get('systemPrompt') as PromptSections | undefined
  if (admitted.size > 0) {
    systemPrompt?.section({
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
  }
}

/** Parsed slash flags: `--datasets a,b` / `--layers x,y` plus positionals. */
function parseSlashFlags(args: readonly string[]): { positionals: string[]; datasets?: string[]; layers?: string[] } {
  const positionals: string[] = []
  let datasets: string[] | undefined
  let layers: string[] | undefined
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ''
    if (arg === '--datasets' || arg === '--layers') {
      const value = args[i + 1]
      if (value === undefined) continue
      i++
      const list = value.split(',').map(entry => entry.trim()).filter(entry => entry !== '')
      if (arg === '--datasets') datasets = list
      else layers = list
    } else {
      positionals.push(arg)
    }
  }
  return {
    positionals,
    ...(datasets !== undefined ? { datasets } : {}),
    ...(layers !== undefined ? { layers } : {}),
  }
}
