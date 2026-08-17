/**
 * Slot contract for harness-owned contributions to the 本地 Agent settings
 * section: a per-harness action seat inside each harness row (next to the
 * login/logout buttons) and an extra-row seat below the harness list. The
 * section only renders contributions filtered by harness id — it never knows
 * what a contributed action does — so the section stays provider-neutral.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * One extra row rendered below the harness rows in the local-agent
     * settings section. Options: `id` (row key), `order` (row position).
     */
    'local-agent.settings.row': {
      kind: 'list'
      scope: 'root'
      owner: LocalAgentSettingsRowOwnerProps
    }
    /**
     * One per-harness action rendered inside a harness row's action area (next
     * to the login/logout buttons), filtered by the row's harness id. Options:
     * `id` (the harness id this action belongs to), `order` (position).
     */
    'local-agent.settings.row-action': {
      kind: 'list'
      scope: 'root'
      owner: LocalAgentSettingsRowOwnerProps
    }
  }
}

/** Owner share of a local-agent settings row or row action (the section supplies nothing). */
export interface LocalAgentSettingsRowOwnerProps {
  /** Marker field: row owner props are intentionally empty. */
  children?: never
}
