/**
 * Default directory resolution, shared by the cordis plugin, the CLI, and the
 * invariant companion so all three agree on where managed worktrees and
 * session bindings live. Managed state must survive a restart, so it anchors
 * to DSH_HOME rather than any process-lifetime directory.
 */
import { join } from 'node:path'

/**
 * Resolve the managed worktree root: an explicit value wins, then
 * `$DSH_HOME/state/datasets/worktrees`, then `<cwd>/.dsh-datasets/worktrees`.
 * @param configured - plugin/CLI-provided override, or ''/undefined.
 * @returns the managed worktree root directory.
 */
export function resolveWorktreeRoot(configured: string | undefined): string {
  if (configured !== undefined && configured !== '') return configured
  const home = process.env.DSH_HOME
  if (home !== undefined && home !== '') return join(home, 'state', 'datasets', 'worktrees')
  return join(process.cwd(), '.dsh-datasets', 'worktrees')
}

/**
 * Resolve the plugin state root (session bindings live under its `bindings/`
 * subdirectory): an explicit value wins, then `$DSH_HOME/state/datasets`,
 * then `<cwd>/.dsh-datasets`.
 * @param configured - CLI-provided override, or ''/undefined.
 * @returns the plugin state root directory.
 */
export function resolveStateRoot(configured?: string): string {
  if (configured !== undefined && configured !== '') return configured
  const home = process.env.DSH_HOME
  if (home !== undefined && home !== '') return join(home, 'state', 'datasets')
  return join(process.cwd(), '.dsh-datasets')
}
