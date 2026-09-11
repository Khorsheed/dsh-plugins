import type { ISessions, SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'

export interface NavigationCapabilities {
  sessions: ISessions
  workspaces: IWorkspaces
  workspace: UiWorkspace
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
