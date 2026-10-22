/**
 * Replay a child session's event log through the harness's released-log
 * validator — the exact relationship check every cold read of the stored log
 * runs — so a mirror that emits an unloadable sequence fails the spec instead
 * of the user's history view.
 */
import { KNOWN_SESSION_EVENT_TYPES, type Session } from '@deepseek-ai/dsh-session'
import { assertReleasedV4Relationships } from '@deepseek-ai/dsh-session-format-v3-to-v4'

/** Assert the session's current event log passes the released V4 read path. */
export function expectValidReleasedLog(child: Session): void {
  const artifact = {
    header: { version: 4, id: String(child.id), createdAt: 0, isSeeded: false, delegationDepth: 1 },
    inheritedEventCount: 0,
    events: child.snapshotEvents(),
  } as unknown as Parameters<typeof assertReleasedV4Relationships>[0]
  assertReleasedV4Relationships(artifact, KNOWN_SESSION_EVENT_TYPES)
}
