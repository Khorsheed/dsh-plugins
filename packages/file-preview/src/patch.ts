import type { ApplyHunksResult, PatchHunk, PatchOperation } from '@deepseek-ai/dsh-fs-patch'
import type { FilePreviewResultDiff } from './fold.ts'

/** The official patch parser and its optional pure text updater. */
export type FilePreviewPatchParser = ((patch: string) => PatchOperation[]) & {
  applyHunks?: (before: string, hunks: readonly PatchHunk[]) => ApplyHunksResult
}

/** Load the optional parser without making older hosts fail module evaluation. */
export async function loadFilePreviewPatchParser(): Promise<FilePreviewPatchParser | undefined> {
  try {
    const { parsePatch, applyHunks } = await import('@deepseek-ai/dsh-fs-patch')
    return Object.assign((patch: string) => parsePatch(patch), { applyHunks })
  } catch { return undefined }
}

/** Read apply_patch's model argument without executing it. */
export function patchOperationsFromArguments(
  name: string, args: unknown, parse: FilePreviewPatchParser | undefined,
): readonly PatchOperation[] | undefined {
  if (name !== 'apply_patch' || parse === undefined || args === null || typeof args !== 'object') return undefined
  const input = (args as Record<string, unknown>).input
  if (typeof input !== 'string') return undefined
  try { return parse(input) } catch { return undefined }
}

/** Parse one native apply_patch call's JSON arguments. */
export function patchOperationsFromToolCall(
  name: string, argumentsJson: string, parse: FilePreviewPatchParser | undefined,
): readonly PatchOperation[] | undefined {
  try { return patchOperationsFromArguments(name, JSON.parse(argumentsJson), parse) } catch { return undefined }
}

/** A stopped commit does not identify which Add operations completed. */
export function patchStopped(meta: unknown): boolean {
  return meta !== null && typeof meta === 'object' && (meta as Record<string, unknown>).stopped === true
}

/** Merge creations into the applied hunks in patch order, retaining unrelated metadata. */
export function mergePatchDiffs(
  operations: readonly PatchOperation[], diffs: readonly FilePreviewResultDiff[], stopped: boolean,
  applyHunks?: FilePreviewPatchParser['applyHunks'],
): readonly FilePreviewResultDiff[] {
  if (stopped) return diffs
  const candidates = operations.flatMap(operation =>
    operation.kind === 'update' && operation.moveTo !== undefined ? [operation.path, operation.moveTo] : [operation.path])
  const remaining = diffs.map((diff) => {
    const canonical = diff.path.replaceAll('\\', '/')
    const matches = candidates.filter(candidate =>
      candidate !== '' && (canonical === candidate || canonical.endsWith(`/${candidate.replace(/^\.\//, '')}`)))
    return matches.length === 1 ? { ...diff, path: matches[0]! } : diff
  })
  const merged: FilePreviewResultDiff[] = []
  const take = (paths: readonly string[]): FilePreviewResultDiff[] => {
    const wanted = new Set(paths)
    const taken: FilePreviewResultDiff[] = []
    for (let index = 0; index < remaining.length;) {
      if (!wanted.has(remaining[index]!.path)) { index++; continue }
      taken.push(remaining.splice(index, 1)[0]!)
    }
    return taken
  }
  for (const operation of operations) {
    if (operation.kind === 'add') {
      merged.push({ path: operation.path, oldText: null, newText: operation.content })
      continue
    }
    if (operation.kind !== 'update' || operation.moveTo === undefined) {
      merged.push(...take([operation.path]))
      continue
    }
    const source = take([operation.path])
    merged.push(...source)
    const destination = take([operation.moveTo])
    if (destination.length > 0) {
      merged.push(...destination)
      continue
    }
    const before = source.find(diff => diff.oldText !== null)?.oldText
    const applied = typeof before !== 'string' || applyHunks === undefined ? undefined : applyHunks(before, operation.hunks)
    if (applied?.ok === true) merged.push({ path: operation.moveTo, oldText: null, newText: applied.after })
  }
  return [...merged, ...remaining]
}
