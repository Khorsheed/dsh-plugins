import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'

/** Product navigation verbs used by the subagent dock row. */
export interface SubagentNavigation {
  subagentAddress: (id: SessionId) => SubagentAddress | undefined
  openResource: (address: string, options: { kind: 'subagentchat' }) => void
  openSession: (id: SessionId) => void
}

/**
 * Open a subagent as a tab in the active right-Sidebar pane, falling back to
 * its conversation page when the host does not provide the Sidebar chat resource.
 * @param navigation - address resolver and product navigation verbs.
 * @param childId - selected subagent session.
 */
export function openSubagent(navigation: SubagentNavigation, childId: SessionId): void {
  const address = navigation.subagentAddress(childId)
  if (address !== undefined) {
    try {
      navigation.openResource(subagentChatAddress(address), { kind: 'subagentchat' })
      return
    } catch {
      // Older hosts and custom compositions without ui-subagent keep the old route.
    }
  }
  navigation.openSession(childId)
}

function subagentChatAddress(address: SubagentAddress): string {
  const query = new URLSearchParams({
    parent: address.parentSessionId,
    mode: address.mode,
  })
  return `dsh-resource://subagentchat/session/${encodeURIComponent(address.childSessionId)}?${query}`
}
