import { useEffect, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RoomMember } from '../types.ts'

export type RoomModeNames = (sessionId: SessionId) => Promise<ReadonlyMap<string, string>>

const NO_MODE_NAMES: ReadonlyMap<string, string> = new Map()

/** The session's current preset, on both host list-row shapes room supports. */
export function roomPresetOf(row: unknown): string | undefined {
  const value = (row as { projectionValues?: { agentPreset?: unknown }; agentPreset?: unknown } | undefined)
    ?.projectionValues?.agentPreset
    ?? (row as { agentPreset?: unknown } | undefined)?.agentPreset
  return typeof value === 'string' ? value : undefined
}

/** A CLI member's fixed invitation mode, or the main agent's current session mode. */
export function memberModeName(
  member: RoomMember,
  roomPreset: string | undefined,
  names: ReadonlyMap<string, string>,
): string | undefined {
  const preset = member.kind === 'main-agent' ? roomPreset : member.preset
  return preset === undefined ? undefined : names.get(preset) ?? preset
}

/** Load one room's cached mode names; an unreachable read keeps the id fallback. */
export function useMemberModeNames(read: RoomModeNames, sessionId: SessionId): ReadonlyMap<string, string> {
  const [names, setNames] = useState<ReadonlyMap<string, string>>(NO_MODE_NAMES)
  useEffect(() => {
    let cancelled = false
    setNames(NO_MODE_NAMES)
    void read(sessionId).then((loaded) => {
      if (!cancelled) setNames(loaded)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [read, sessionId])
  return names
}
