/**
 * Worktree status visibility: a per-session repo/worktree badge in the
 * session header and a changes drawer (uncommitted/committed file tree with
 * per-file diffs, IDE-style commit log, full repository browse) over a Typert
 * Remote data face. The plugin never writes to the repository — every query
 * is a git read — and never interprets change semantics; it renders git
 * facts.
 *
 * @module @khorsheed/dsh-worktrees
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { WorktreesRemoteService } from './remote.ts'
import { WorktreesService } from './service.ts'
import { registerWorktreesTool } from './tool.ts'

/** Plugin configuration. */
export interface WorktreesPluginConfig {
  /**
   * Branch the committed segment (`base...HEAD`) and ahead/behind are
   * measured against. '' disables the committed segment entirely.
   */
  baseRef?: string
}

export const Config: z<WorktreesPluginConfig> = z.object({
  baseRef: z.string().default('main'),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    worktrees: WorktreesService
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'worktrees'

/**
 * Plugin body: provide the service core, then mount the Remote data face.
 * @param ctx - Cordis context.
 * @param config - plugin configuration (baseRef defaulted by the schema).
 */
export function apply(ctx: Context, config: WorktreesPluginConfig): void {
  const service = new WorktreesService(config.baseRef ?? 'main')
  ctx.provide('worktrees', service)
  ctx.plugin(WorktreesRemoteService, {})
  // The model-facing tool needs the tools plugin; `registerWorktreesTool`
  // probes it and degrades to badge/drawer-only when a composition omits it.
  registerWorktreesTool(ctx)
}
