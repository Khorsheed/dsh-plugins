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
import type { ResolvedDatasetRef } from './registry.ts'
import type { DatasetScope, DatasetsService } from './service.ts'

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

/** `all` adds whole-layer materialization (it extracts a read-only cache directory). */
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

const COMMON_DATASET_PARAM = {
  type: 'string',
  required: true,
  description: 'Registered dataset reference `<id>/<set>`, exactly as datasets_list returns it. Never a path: '
    + 'a path is refused, and an unregistered repository is not yours to read.',
} as const

const COMMIT_PARAM = {
  type: 'string',
  description: 'Pinned commit (from datasets_snapshot). Default: the latest commit of the branch the registration tracks.',
} as const

/**
 * The service scope of one resolved reference: the repository by its common
 * dir (no checkout's HEAD is in play), «latest» as the default commit, the one
 * set, and the registration's layers as the explicit whitelist — the same
 * effectiveLayers branch a binding whitelist took, so the ceiling logic is
 * unchanged.
 * @param resolved - the resolved reference.
 * @returns the agent scope.
 */
export function registryScope(resolved: ResolvedDatasetRef): DatasetScope {
  return {
    repo: resolved.entry.commonDir,
    ref: resolved.latest.commit,
    datasets: [resolved.set],
    layers: resolved.layers,
  }
}

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
 *
 * Every tool addresses a dataset by its registry reference `<id>/<set>` and
 * nothing else: the registry is the deployment's human-written list of what
 * agents may use (T73), so an agent never names, and is never shown, a path.
 * @param service - the service every adapter translates to.
 * @param options - the group to build.
 * @returns the admitted definitions — untagged and unregistered, in registration order.
 */
export function datasetToolDefinitions(
  service: DatasetsService,
  options: { group: DatasetsToolGroup },
): ToolDefinition[] {
  const { group } = options
  const definitions: ToolDefinition[] = []
  /** Resolve one call's reference into its registration and scope. */
  const resolve = async (ref: string): Promise<{ resolved: ResolvedDatasetRef; scope: DatasetScope }> => {
    const resolved = await service.registry.resolveRef(ref)
    return { resolved, scope: registryScope(resolved) }
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
      'List the datasets registered in this deployment: one row per set, addressed as `<id>/<set>` — the only '
      + 'form every other datasets_* tool accepts. Each row names the branch the registration tracks, that '
      + 'branch\'s latest commit and date, and the layers agents may read. `query` narrows the rows by a '
      + 'case-insensitive substring of the reference or title. A repository that is not listed is not '
      + 'registered: ask the person to register it on the Datasets tab rather than reading it yourself.',
    parameters: {
      query: { type: 'string', description: 'Case-insensitive substring of the reference or title.' },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => true,
    async execute(args) {
      try {
        const needle = args.query?.trim().toLowerCase() ?? ''
        const rows: JsonValue[] = []
        for (const entry of service.registry.entries()) {
          let latest
          try {
            latest = await service.registry.latest(entry)
          } catch {
            continue // a registration whose tracked branch is gone offers nothing
          }
          for (const set of await service.registry.sets(entry, latest)) {
            if (needle !== '' && !set.ref.toLowerCase().includes(needle) && !set.title.toLowerCase().includes(needle)) continue
            rows.push({
              ref: set.ref,
              title: set.title,
              trackedRef: entry.trackedRef,
              latest: { commit: latest.commit, date: latest.date },
              layers: set.layers,
            })
          }
        }
        return { datasets: rows }
      } catch (error) {
        throw toToolError(error)
      }
    },
  }))

  admissable(defineTool({
    name: 'datasets_show',
    description:
      'Show one registered dataset (or one item of it) at a commit: summary, the full descriptor passthrough, '
      + 'every item with its metadata, and the layer-file listing, filtered to the layers the registration '
      + 'lets agents read.',
    parameters: {
      dataset: COMMON_DATASET_PARAM,
      item: { type: 'string', description: 'When given, show just this item.' },
      commit: COMMIT_PARAM,
    },
    output: jsonOutput(),
    isConcurrencySafe: () => true,
    async execute(args) {
      try {
        const { resolved, scope } = await resolve(args.dataset)
        return (await service.show(scope, resolved.set, args.item, args.commit)) as unknown as JsonValue
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
      dataset: COMMON_DATASET_PARAM,
      commit: COMMIT_PARAM,
    },
    output: jsonOutput(),
    isConcurrencySafe: () => true,
    async execute(args) {
      try {
        const { resolved, scope } = await resolve(args.dataset)
        return (await service.describe(scope, resolved.set, args.commit)) as unknown as JsonValue
      } catch (error) {
        throw toToolError(error)
      }
    },
  }))

  admissable(defineTool({
    name: 'datasets_read',
    description:
      'Read one file of one item layer, straight from the git object at the pinned commit (`git show '
      + '<commit>:<path>`) — no copy materializes outside the repository. The layer must be one the '
      + 'registration lets agents read. For whole-layer consumption use datasets_worktree_path instead.',
    parameters: {
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
    async execute(args) {
      try {
        const { resolved, scope } = await resolve(args.dataset)
        return await service.read(scope, {
          dataset: resolved.set,
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
      'Pin a registered dataset to a commit (default: the tracked branch\'s latest): returns {dataset, commit}. '
      + 'Pass the commit back to datasets_read / datasets_worktree_path for stable reads while the branch '
      + 'keeps moving.',
    parameters: {
      dataset: COMMON_DATASET_PARAM,
      commit: COMMIT_PARAM,
    },
    output: jsonOutput(),
    isConcurrencySafe: () => true,
    async execute(args) {
      try {
        const { resolved, scope } = await resolve(args.dataset)
        const snapshot = await service.snapshot(scope, resolved.set, args.commit)
        return { dataset: `${resolved.entry.id}/${resolved.set}`, commit: snapshot.commit }
      } catch (error) {
        throw toToolError(error)
      }
    },
  }))

  admissable(defineTool({
    name: 'datasets_worktree_path',
    description:
      'Materialize a whole-layer read-only view: the requested layers of the dataset at the pinned commit, '
      + 'extracted from git objects into a content-addressed cache directory (default layers: every layer '
      + 'the registration lets agents read). Returns an ordinary directory path — mount it read-only or read '
      + 'it directly; it is a shared cache and its files are read-only. The registration\'s layers are '
      + 'mechanical: disallowed layer directories are physically absent.',
    parameters: {
      dataset: COMMON_DATASET_PARAM,
      commit: COMMIT_PARAM,
      layers: {
        type: 'array',
        items: { type: 'string' },
        description: 'Layers to expose (default: every layer the registration lets agents read). '
          + 'Intersected with those layers; an empty intersection is an error.',
      },
    },
    output: jsonOutput(),
    async execute(args) {
      try {
        const { resolved, scope } = await resolve(args.dataset)
        return (await service.worktreePath(scope, resolved.set, {
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
      'Create or update one item in the registration\'s authoring checkout (the one working tree a person '
      + 'named for drafts): write its metadata (item.json) and/or layer files. The plugin never commits — '
      + 'review and `git commit` stay with the human\'s normal git flow. Layer files must name layers the '
      + 'descriptor declares and the registration lets agents read. A registration with no authoring '
      + 'checkout refuses every write.',
    parameters: {
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
    async execute(args) {
      try {
        const { resolved, scope } = await resolve(args.dataset)
        const checkout = resolved.entry.authoringCheckout
        if (checkout === null) {
          throw new DatasetsError(
            `${JSON.stringify(resolved.entry.id)} has no authoring checkout, so nothing may be written to it — `
            + 'ask the person to name one in the registration (Datasets tab → the repository\'s registration)',
            'NO_AUTHORING_CHECKOUT',
          )
        }
        return (await service.putItem({ ...scope, repo: checkout }, {
          dataset: resolved.set,
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
      'Validate one registered dataset for authoring hygiene: descriptor shape errors '
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
      dataset: COMMON_DATASET_PARAM,
    },
    output: jsonOutput(),
    isConcurrencySafe: () => true,
    async execute(args) {
      try {
        const { resolved, scope } = await resolve(args.dataset)
        return (await service.validate(scope, resolved.set)) as unknown as JsonValue
      } catch (error) {
        throw toToolError(error)
      }
    },
  }))

  return definitions
}
