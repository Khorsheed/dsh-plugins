import type { LocalAgentModelDirectory } from '../types.ts'

/**
 * Scope a harness's served directory to its curated model list (models.json):
 * the list IS the invite picker's vocabulary, in the list's own order — a
 * listed value the endpoint no longer serves stays as a bare row (the member
 * dialog shows it the same way). No list support, or none configured, keeps
 * the directory as served. Mirrors the member dialog's scoping rule so the
 * invite picker and the member configuration show the same candidates.
 * @param directory - the harness's served directory.
 * @param list - the curated shortlist values, or null when unsupported.
 * @returns the scoped directory.
 */
export function scopeDirectoryToList(
  directory: LocalAgentModelDirectory,
  list: readonly string[] | null | undefined,
): LocalAgentModelDirectory {
  if (list === undefined || list === null || list.length === 0) return directory
  const byValue = new Map(directory.entries.flatMap(entry => entry.resolvedModel === undefined
    ? [[entry.value, entry]] as const
    : [[entry.value, entry] as const, [entry.resolvedModel, entry] as const]))
  const entries = list.map(value => byValue.get(value) ?? { value, label: value, source: 'configuration' as const })
  return { ...directory, entries }
}
