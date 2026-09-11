/**
 * Generic versioned dataset storage over git repositories: layered items,
 * commit-pinned reads straight from git objects, deduplicated sparse-checkout
 * worktree views for whole-layer consumption, and per-session bindings whose
 * layer whitelist is enforced on every read path. Three faces share one
 * service core: the `dsh-datasets` CLI, the `/datasets` slash command, and the
 * Typert Remote data face behind the web session tab (wire namespace
 * `datasets`). The model-tool face moved to the companion
 * `@khorsheed/dsh-datasets-tool`, which an agent preset grants per session.
 * The plugin never interprets descriptor
 * semantics and never copies content out of the repository.
 *
 * @module @khorsheed/dsh-datasets
 */
import type { Context } from '@deepseek-ai/cordis'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
// Type-only: pulls the commands Context merge into the program.
import type {} from '@deepseek-ai/dsh-commands'
import type { DatasetBinding } from './binding.ts'
import { DatasetsError } from './dataset.ts'
import { resolveStateRoot, resolveWorktreeRoot } from './defaults.ts'
import { formatList, formatShow, formatWarnings } from './format.ts'
import { createDatasetsService, resolveScope, type DatasetsService } from './service.ts'
import { DatasetsRemoteService } from './remote.ts'

/** Plugin configuration. */
export interface DatasetsPluginConfig {
  /**
   * Default dataset repository when a call carries no explicit `repo` and the
   * session has no binding ('' = none).
   */
  repo?: string
  /** Managed worktree root override ('' = the three-stage default). */
  worktreeRoot?: string
}

export const Config: z<DatasetsPluginConfig> = z.object({
  repo: z.string().default(''),
  worktreeRoot: z.string().default(''),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    datasets: DatasetsService
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'datasets'

/** Required services: the command registry (the `/datasets` slash face). The
 * tool registry and the system-prompt assembly belong to the companion tool
 * row, which owns the model-tool face. */
export const inject = ['commands']

/**
 * Mount the dataset service, the `/datasets` slash command, and the Remote
 * data face. The model tools are deliberately NOT registered here: they moved
 * to the companion `@khorsheed/dsh-datasets-tool`, which an agent preset
 * composes per session — the companion also carries the tool-guidance prompt
 * section.
 * @param ctx - plugin context.
 * @param config - validated plugin config.
 */
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
}

export { datasetToolDefinitions, toolsOfGroup, type DatasetsToolGroup } from './tool.ts'

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
