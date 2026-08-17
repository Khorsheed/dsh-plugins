/**
 * Slot contract for extra rows contributed into the 本地 Agent settings
 * section: the additive seat for a harness-level switch that needs no auth
 * action of its own (e.g. the dsh DeepSeek enable/disable toggle). The
 * section only stacks rows; a row draws its own internals, including its
 * label, through its own inject face — so the section stays provider-neutral
 * (it never knows which harness a row belongs to).
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
  }
}

/** Owner share of a local-agent settings row (the section supplies nothing). */
export interface LocalAgentSettingsRowOwnerProps {
  /** Marker field: row owner props are intentionally empty. */
  children?: never
}
