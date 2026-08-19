/**
 * Data-root resolution, shared by the cordis plugin, the CLI, and the
 * invariant companion so all three agree on where runs live. The root must
 * survive restarts and be reachable from outside the host process (scripts),
 * so it anchors to config / DSH_HOME rather than any process-lifetime dir.
 */
import { join } from 'node:path'

/**
 * Resolve the data root: an explicit value (plugin config / `--data-dir`)
 * wins, then `$DSH_HOME/state/mission`, then `<cwd>/.dsh-mission`.
 * @param configDataDir - plugin/CLI-provided override, or ''/undefined.
 * @returns the mission data root.
 */
export function resolveDataDir(configDataDir: string | undefined): string {
  if (configDataDir !== undefined && configDataDir !== '') return configDataDir
  const home = process.env.DSH_HOME
  if (home !== undefined && home !== '') return join(home, 'state', 'mission')
  return join(process.cwd(), '.dsh-mission')
}
