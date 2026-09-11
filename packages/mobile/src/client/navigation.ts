import type { ISessions, SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'

export interface NavigationCapabilities {
  sessions: ISessions
  workspaces: IWorkspaces
  workspace: UiWorkspace
}

export type LibraryGrouping = 'time' | 'workspace'
export const GROUPING_KEY = 'dsh.mobile.grouping'
export interface SessionGroup { key: string; label: string; rows: SessionSummary[] }

/** Group an ordered projection without joining different directories with the same basename. */
export function groupSessions(rows: SessionSummary[], mode: LibraryGrouping, labels: { today: string; yesterday: string; earlier: string; workspace: string }, now = new Date()): SessionGroup[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime()
  const groups = new Map<string, SessionGroup>()
  for (const row of rows) {
    const key = mode === 'workspace' ? row.cwd || '' : row.updatedAt >= today ? 'today' : row.updatedAt >= yesterday ? 'yesterday' : 'earlier'
    let group = groups.get(key)
    if (!group) {
      const label = mode === 'workspace' ? key.split(/[\\/]/).filter(Boolean).at(-1) || labels.workspace : labels[key as 'today' | 'yesterday' | 'earlier']
      group = { key, label, rows: [] }; groups.set(key, group)
    }
    group.rows.push(row)
  }
  if (mode === 'workspace') {
    const counts = new Map<string, number>()
    for (const group of groups.values()) counts.set(group.label, (counts.get(group.label) ?? 0) + 1)
    for (const group of groups.values()) if ((counts.get(group.label) ?? 0) > 1 && group.key) group.label = group.key
  }
  return [...groups.values()]
}

/** Optional official services can disappear without removing basic mobile presentation. */
export class MobileNavigation {
  private value: NavigationCapabilities | undefined
  private listeners = new Set<() => void>()
  readonly getSnapshot = () => this.value
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  set(value: NavigationCapabilities | undefined) {
    this.value = value
    for (const listener of this.listeners) listener()
  }
}

/** The Host owns metadata and membership; this projection only orders visible ordinary sessions. */
export function recentSessions(state: SessionListState, archived: readonly string[], query: string): SessionSummary[] {
  const hidden = new Set(archived)
  const term = query.trim().toLocaleLowerCase()
  return state.ids.flatMap(id => {
    const row = state.byId[id]
    if (!row || hidden.has(id) || row.origin === 'subagent' || (row.blank && id !== state.current)) return []
    if (term && !`${row.title ?? ''} ${row.displayTitle} ${row.cwd ?? ''}`.toLocaleLowerCase().includes(term)) return []
    return [row]
  }).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
}
