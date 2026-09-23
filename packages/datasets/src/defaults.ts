/**
 * Default directory resolution, shared by the cordis plugin, the CLI, and the
 * invariant companion so all three agree on where materialized layers, the
 * registry, and the legacy session bindings live. Managed state must survive a restart, so it anchors
 * to DSH_HOME rather than any process-lifetime directory.
 */
import { join } from 'node:path'

/**
 * Resolve the materialized-layer root: an explicit value wins, then
 * `$DSH_HOME/state/datasets/materialized`, then `<cwd>/.dsh-datasets/materialized`.
 * @param configured - plugin/CLI-provided override, or ''/undefined.
 * @returns the materialized root directory.
 */
export function resolveMaterializedRoot(configured: string | undefined): string {
  if (configured !== undefined && configured !== '') return configured
  const home = process.env.DSH_HOME
  if (home !== undefined && home !== '') return join(home, 'state', 'datasets', 'materialized')
  return join(process.cwd(), '.dsh-datasets', 'materialized')
}

/**
 * Resolve the plugin state root (`registry.json`, and the legacy session
 * bindings under `bindings/`): an explicit value wins, then `$DSH_HOME/state/datasets`,
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
