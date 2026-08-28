/**
 * Local mirror of the official subagent-lineage index.
 *
 * Host ≤0.1.1 exported `indexSubagentDescendants` from
 * `@deepseek-ai/dsh-client-runtime/client`; 0.1.2-alpha.1 moved the helper
 * inside ui-subagent/ui-workspace with no public export
 * (deepseek-harness-alpha @ 6c705be1ce,
 * packages/client/ui-subagent/src/client/subagent-lineage.ts), and the
 * client-bundle purity gate forbids deep value imports from sibling client
 * packages — so the ~20-line walk is mirrored here verbatim. Keep it in sync
 * with the upstream file on host upgrades; the dock's capsule count must
 * match the header tree by construction.
 *
 * @module dsh-taskpilot/client/subagent-lineage
 */

import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'

/** Narrow summary row the lineage walk reads (wire-shaped). */
interface LineageEntry {
  readonly id: SessionId
  readonly parentId?: SessionId
  readonly origin?: 'subagent'
  readonly running: boolean
}

/** Descendant counts for one possible parent Session. */
export interface SubagentDescendantSummary {
  readonly count: number
  readonly runningCount: number
}

/**
 * Index uninterrupted subagent descendants under each ancestor.
 * @param summaries - Session summaries keyed by id.
 * @returns descendant totals keyed by possible parent id.
 */
export function indexSubagentDescendants(
  summaries: Readonly<Record<SessionId, LineageEntry>>,
): ReadonlyMap<SessionId, SubagentDescendantSummary> {
  const indexed = new Map<SessionId, { count: number; runningCount: number }>()
  for (const descendant of Object.values(summaries)) {
    if (descendant.origin !== 'subagent') continue
    const seen = new Set<SessionId>()
    let current: LineageEntry | undefined = descendant
    while (current?.origin === 'subagent' && current.parentId !== undefined && !seen.has(current.id)) {
      seen.add(current.id)
      const aggregate = indexed.get(current.parentId)
      if (aggregate === undefined) {
        indexed.set(current.parentId, { count: 1, runningCount: descendant.running ? 1 : 0 })
      } else {
        aggregate.count += 1
        if (descendant.running) aggregate.runningCount += 1
      }
      current = summaries[current.parentId]
    }
  }
  return indexed
}
