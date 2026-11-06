/**
 * The member session's background command cards (member-self-started-rounds
 * M2, prototype states 8–9 and 15): a turn that started a background command
 * shows that command's live card in its tail, under the reply that launched
 * it. The tail is the originating call's own turn — a finished turn folds
 * its tool rows, so the card sits where the turn stays visible, not inside
 * the fold. The row itself is not replaced: `tool.call.toolview` is keyed by
 * tool name, and taking `Bash` would take every member's Bash row.
 *
 * A Conversation Definition keeps each turn's `Bash` call ids as Turn data;
 * the tail entry reads them and, only when the turn has one, follows the
 * session's local-agent read — a session that is not a family member (or
 * whose harness does not support background tasks) answers null and shows
 * nothing.
 */
import { useSyncExternalStore, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RoomState } from '../types.ts'
import { sessionActivityItems } from './member-activity-view.ts'
import { CommandCard, useMemberActivity, type MemberActivityFace } from './MemberActivity.tsx'

/** The Turn-data key the definition writes and the tail reads. */
export const ACTIVITY_CALLS_KEY = 'room/activity-calls'

/** Tool names whose calls can start a CLI background command (Kimi's Bash). */
export const BACKGROUND_COMMAND_TOOLS: ReadonlySet<string> = new Set(['Bash'])

interface EventLike { readonly type: string; readonly data?: unknown }
interface CallsState { readonly turn: number; readonly calls: readonly string[] }

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' ? value as Record<string, unknown> : null

const turnOf = (event: EventLike): number | null => {
  const turn = record(event.data)?.['turn']
  return typeof turn === 'number' ? turn : null
}

/** The Conversation Definition: each turn's background-capable call ids. */
export const activityCallsDefinition = {
  kind: ACTIVITY_CALLS_KEY,
  match(event: EventLike): { id: string; role: 'start' | 'update' } | null {
    const turn = turnOf(event)
    if (turn === null) return null
    if (event.type === 'turn/start') return { id: String(turn), role: 'start' }
    if (event.type === 'tool/call' && BACKGROUND_COMMAND_TOOLS.has(String(record(event.data)?.['name']))) return { id: String(turn), role: 'update' }
    return null
  },
  start(_context: unknown, match: { readonly event: EventLike }): CallsState {
    return { turn: turnOf(match.event) ?? -1, calls: [] }
  },
  update(context: { readonly state: CallsState }, match: { readonly event: EventLike }): CallsState {
    const callId = record(match.event.data)?.['callId']
    if (typeof callId !== 'string' || context.state.calls.includes(callId)) return context.state
    return { ...context.state, calls: [...context.state.calls, callId] }
  },
  buildLocationData(
    context: { readonly state: CallsState | undefined },
    scope: string,
    previous: { kind: 'turn'; turn: number; key: string; value: { calls: readonly string[] } } | null | undefined,
  ) {
    if (scope !== 'turn' || context.state === undefined || context.state.calls.length === 0) return null
    if (previous?.kind === 'turn' && previous.turn === context.state.turn && previous.key === ACTIVITY_CALLS_KEY
      && previous.value.calls === context.state.calls) return previous
    return { kind: 'turn' as const, turn: context.state.turn, key: ACTIVITY_CALLS_KEY, value: { calls: context.state.calls } }
  },
}

/** The Turn-tail owner props this entry reads (ui-chat's, structurally). */
export interface ActivityTurnOwner {
  readonly turn: { readonly data: { get: (key: string) => unknown } }
}

/** The turn's background-capable call ids (none when the definition never ran). */
export function turnActivityCalls(owner: ActivityTurnOwner | null | undefined): ReadonlySet<string> {
  try {
    const calls = record(owner?.turn.data.get(ACTIVITY_CALLS_KEY))?.['calls']
    return new Set(Array.isArray(calls) ? calls.filter((call): call is string => typeof call === 'string') : [])
  } catch {
    return new Set()
  }
}

/** What the tail entry is injected with. */
export interface MemberActivityTailInjected {
  readonly memberActivity: MemberActivityFace
  /** The cached room holding this member session (dispatcher names), when one was pulled. */
  readonly memberRoom: (childSessionId: string) => { readonly state: RoomState; readonly member: { readonly name: string } } | undefined
  /** Re-render when the room cache changes. */
  readonly subscribeRooms: (listener: () => void) => () => void
}

type Props = ActivityTurnOwner & MemberActivityTailInjected & { readonly sessionId: string; readonly t: TranslateNS<'room'> }

/** The tail entry: nothing unless the turn called Bash. */
export function MemberActivityTail(props: Props): ReactNode {
  const calls = turnActivityCalls(props)
  if (calls.size === 0) return null
  return <TailCards {...props} calls={calls} />
}

function TailCards({ sessionId, calls, memberActivity, memberRoom, subscribeRooms, t }: Props & { readonly calls: ReadonlySet<string> }): ReactNode {
  useMemberActivity(memberActivity.store, [sessionId])
  useSyncExternalStore(subscribeRooms, () => memberRoom(sessionId)?.state)
  const read = memberActivity.store.get(sessionId)
  const room = memberRoom(sessionId)
  const items = sessionActivityItems(read, calls, room?.member.name ?? '', sessionId, room?.state)
  if (items.length === 0) return null
  const keepAliveUntil = read?.processAlive === true ? read.keepAliveUntil : undefined
  return <>{items.map(item => <CommandCard key={item.id} item={item} keepAliveUntil={keepAliveUntil} reveals={memberActivity.reveals} t={t} />)}</>
}
