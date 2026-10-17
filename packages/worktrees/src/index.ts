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
import { resolveWorktreesStateRoot, WORKTREES_SWITCHED_EVENT } from './bindings.ts'
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
  /**
   * State root for the per-session worktree bindings (`bindings.json`).
   * Absent/'' resolves to `$DSH_HOME/state/worktrees` (or
   * `<cwd>/.dsh-worktrees` when `DSH_HOME` is unset) — the sidechat/canvas
   * resolve precedent. The bindings file makes active-worktree overrides
   * survive a host restart; when the file cannot be loaded (corrupt,
   * unreadable) the deployment degrades to memory-only and controlled-switch
   * receipts say so (`persisted: false`), never exploding the boot.
   */
  stateRoot?: string | undefined
}

// Bare `z`: schemastery 3.18.4's tightened variance reports TS2375 on the
// annotated form under exactOptionalPropertyTypes (the ankh-guard precedent);
// the interface stays the apply parameter type.
export const Config: z = z.object({
  baseRef: z.string().default('main'),
  visiblePresets: z.array(z.string()).default([]),
  stateRoot: z.string().default(''),
})

// The core key is `worktreesCore`, NOT `worktrees`: the host's experimental
// `worktree` package provides `ctx.worktrees` since 0.2.1, and a duplicate
// cordis provide fails the boot when both are mounted.
declare module '@deepseek-ai/cordis' {
  interface Context {
    worktreesCore: WorktreesService
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
  const service = new WorktreesService(config.baseRef ?? 'main', {
    stateRoot: resolveWorktreesStateRoot(config.stateRoot),
    // Every successful binding SET (legacy switch/create and the controlled
    // switch alike) re-emits as a cordis event. It is an IN-PROCESS event,
    // NOT a browser push: bridging it to clients or re-reading on it is the
    // consumer's job.
    onSwitched: event => ctx.emit(WORKTREES_SWITCHED_EVENT, event),
  })
  ctx.provide('worktreesCore', service)
  ctx.plugin(WorktreesRemoteService, { visiblePresets: config.visiblePresets ?? [] })
  // The model-facing `worktrees` tool is deliberately NOT registered here:
  // it lives in this package's `./tool` composition entry, which agent-preset
  // compositions mount by name (`@khorsheed/dsh-worktrees/tool`) so the
  // capability is granted per session. The definition factory stays in
  // ./tool-definition.ts, beside the service core it adapts.
}
