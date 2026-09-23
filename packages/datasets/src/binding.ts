/**
 * The LEGACY per-session dataset binding record — read-only history since T73.
 *
 * Before the deployment registry each session bound one repository, stored as
 * `<stateRoot>/bindings/<encoded-session-id>.json` ({version: 1, binding}).
 * Nothing reads a binding to decide what a session may use any more: the
 * registry is the only source, and the one consumer left is the registry's
 * one-click import ({@link RepoRegistry.importBindings}), which folds these
 * files into registrations and leaves every file byte-identical. The files are
 * never deleted automatically; an operator removes them by hand once imported.
 */
import { DatasetsError } from './dataset.ts'
import { normalizeRepoPath } from './repo-path.ts'

/** A legacy session binding. Absent fields meant "everything in the repo". */
export interface DatasetBinding {
  /**
   * Absolute, `~`-free, symlink-resolved path of the git repository holding
   * the datasets — see {@link normalizeRepoPath}.
   */
  repoPath: string
  /** Dataset-id whitelist; absent = every dataset in the repository. */
  datasets?: string[]
  /** Layer whitelist; absent = every layer. */
  layers?: string[]
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string' && entry !== '')
}

/**
 * Validate a legacy binding object (as the registry's import reads it from a
 * store record) and put its `repoPath` in canonical form — records written
 * before normalization carry a literal `~` or a trailing slash.
 * @param value - the candidate binding.
 * @returns the validated binding, `repoPath` normalized.
 */
export function validateBinding(value: unknown): DatasetBinding {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DatasetsError('binding must be an object {repoPath, datasets?, layers?}', 'SHAPE_INVALID')
  }
  const record = value as Record<string, unknown>
  const repoPath = record['repoPath']
  if (typeof repoPath !== 'string' || repoPath.trim() === '') {
    throw new DatasetsError('binding requires a non-empty "repoPath"', 'SHAPE_INVALID')
  }
  const datasets = record['datasets']
  if (datasets !== undefined && !isStringArray(datasets)) {
    throw new DatasetsError('binding "datasets" must be an array of dataset ids', 'SHAPE_INVALID')
  }
  const layers = record['layers']
  if (layers !== undefined && !isStringArray(layers)) {
    throw new DatasetsError('binding "layers" must be an array of layer names', 'SHAPE_INVALID')
  }
  return {
    repoPath: normalizeRepoPath(repoPath),
    ...(datasets !== undefined ? { datasets: [...datasets] } : {}),
    ...(layers !== undefined ? { layers: [...layers] } : {}),
  }
}

/** Path-safe encoding of one directory segment (mirrors the persistence backend's). */
export function encodeSegment(raw: string): string {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      out += ch
    } else {
      out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
    }
  }
  return out
}
