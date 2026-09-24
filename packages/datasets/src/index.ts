/**
 * Generic versioned dataset storage over git repositories: layered items,
 * commit-pinned reads straight from git objects, content-addressed read-only
 * whole-layer views extracted by `git archive`, and a human-written registry of
 * dataset repositories whose per-set layers are enforced on every agent read. Three faces share one
 * service core: the `dsh-datasets` CLI, the `/datasets` slash command, and the
 * Typert Remote data face behind the web session tab (wire namespace
 * `datasets`) — of which only the CLI and the Remote face mount HERE: the
 * slash command's registration moved to the companion
 * `@khorsheed/dsh-datasets-tool` (preset-visibility rollout A3), which an
 * agent preset mounts per session so only granted sessions see it; the
 * handler and definition stay in `./slash.ts` for the companion to register.
 * The model-tool face lives in the same companion.
 * The plugin never interprets descriptor
 * semantics and never copies content out of the repository.
 *
 * @module @khorsheed/dsh-datasets
 */
import type { Context } from '@deepseek-ai/cordis'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { resolveMaterializedRoot, resolveStateRoot } from './defaults.ts'
import { registryPathOf } from './registry.ts'
import { createDatasetsService, type DatasetsService } from './service.ts'
import { DatasetsRemoteService } from './remote.ts'

/** Plugin configuration. */
export interface DatasetsPluginConfig {
  /** Materialized-layer root override ('' = the three-stage default). */
  materializedRoot?: string
}

export const Config: z<DatasetsPluginConfig> = z.object({
  materializedRoot: z.string().default(''),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    datasets: DatasetsService
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'datasets'

/**
 * No required services: the `/datasets` slash face moved to the companion
 * `@khorsheed/dsh-datasets-tool` row (its registration is what needed the
 * command registry), and everything still here — the service, the Remote
 * face — mounts unconditionally.
 */
export const inject = []

/**
 * Mount the dataset service and the Remote data face. The `/datasets` slash
 * command and the model tools are deliberately NOT registered here: both
 * moved to the companion `@khorsheed/dsh-datasets-tool`, which an agent
 * preset composes per session — the companion also carries the tool-guidance
 * prompt section. There is no configured default repository: every face
 * resolves datasets through the deployment's registry.
 * @param ctx - plugin context.
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: DatasetsPluginConfig): void {
  const service = createDatasetsService({
    materializedRoot: resolveMaterializedRoot(config.materializedRoot),
    bindingsRoot: join(resolveStateRoot(undefined), 'bindings'),
    registryPath: registryPathOf(resolveStateRoot(undefined)),
  })
  ctx.provide('datasets', service)
  // The web session tab's data face: the same service core behind a Typert
  // Remote (wire namespace `datasets`), registrations resolved per call.
  ctx.plugin(DatasetsRemoteService)
}

export { handleDatasetsCommand, registerDatasetsSlash } from './slash.ts'
export { datasetToolDefinitions, toolsOfGroup, type DatasetsToolGroup } from './tool.ts'
