/**
 * The model-tool face of the dataset service: the eight `datasets_*` adapters,
 * grouped by what they may do (read / authoring / all).
 *
 * This module is the core's `./tool` export: it BUILDS the definitions and
 * registers nothing. Creating the tools is the companion
 * `@khorsheed/dsh-datasets-tool`'s job — a preset composes that row per
 * session, and the companion applies its own origin tag (attribution follows
 * the mounting package, never this service core).
 * @module @khorsheed/dsh-datasets
 */
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { DatasetsError } from './dataset.ts'
import { resolveScope, type DatasetScope, type DatasetsService } from './service.ts'

/**
 * Which group of model tools a companion-row mount grants. Grouping lives
 * here, beside the definitions: the row that registers them is the only place
 * that can decide, and a preset cannot deselect a tool one of its own rows
 * already registered.
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
 * The tools one group grants.
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

/**
 * Build the dataset tool definitions of one group.
 * @param service - the service every adapter translates to.
 * @param options - the group to build and the repository a binding-less call falls back to.
 * @returns the admitted definitions — untagged and unregistered, in registration order.
 */
export function datasetToolDefinitions(
  service: DatasetsService,
  options: { defaultRepo: string; group: DatasetsToolGroup },
): ToolDefinition[] {
  const { defaultRepo, group } = options
  const definitions: ToolDefinition[] = []
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
  const admitted = new Set(toolsOfGroup(group))
  /** Admit one tool when its group contains it. */
  const admissable = (definition: ToolDefinition): void => {
    if (admitted.has(definition.name)) definitions.push(definition)
  }

  admissable(defineTool({
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

  admissable(defineTool({
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

  admissable(defineTool({
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

  admissable(defineTool({
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

  admissable(defineTool({
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

  admissable(defineTool({
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

  admissable(defineTool({
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

  admissable(defineTool({
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

  return definitions
}
