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

/** Plugin configuration. */
export interface WorktreesPluginConfig {
  /**
   * Branch the committed segment (`base...HEAD`) and ahead/behind are
   * measured against. '' disables the committed segment entirely.
   */
  baseRef?: string | undefined
  /**
   * Agent-preset ids the session-header badge stays visible for. Absent or
   * empty keeps the badge unconditionally visible (the zero-change default);
   * a non-empty list hides the badge in sessions whose preset id is outside
   * it, while sessions with NO preset stay visible (fail-open: the gate hides
   * dev chrome in non-dev sessions, never breaks preset-less deployments).
   * Reaches the browser through the Remote's `badgeConfig` method — the web
   * boot composes client entries without config, so the client apply never
   * sees this object.
   */
  visiblePresets?: string[] | undefined
}

// Bare `z`: schemastery 3.18.4's tightened variance reports TS2375 on the
// annotated form under exactOptionalPropertyTypes (the ankh-guard precedent);
// the interface stays the apply parameter type.
export const Config: z = z.object({
  baseRef: z.string().default('main'),
  visiblePresets: z.array(z.string()).default([]),
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
  ctx.plugin(WorktreesRemoteService, { visiblePresets: config.visiblePresets ?? [] })
  // The model-facing `worktrees` tool is deliberately NOT registered here:
  // it moved to the companion `@khorsheed/dsh-worktrees-tool`, which mounts
  // the tool row inside agent-preset compositions (session-granted). The
  // definition factory stays exported from ./tool.ts for that companion.
}
