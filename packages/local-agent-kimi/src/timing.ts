import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { ownSelfRounds } from '@khorsheed/dsh-local-agent'
import type { LocalAgentMemberModelTiming } from '@khorsheed/dsh-local-agent/types'
import { findKimiSessionDir, readKimiTranscript, type KimiTranscriptLine } from './session-view.ts'
import { kimiStreamFromUnit } from './session-mirror.ts'

/**
 * Reconstruct a member's historical model streams and tool intervals from its wire log.
 * The member's own log (when given) says which self-opened rounds are rounds of
 * their own, so the `turn:step` keys match the child's turns.
 */
export async function readKimiModelTiming(homeDir: string, cliSessionId: string, memberEvents?: readonly SessionEvent[]): Promise<LocalAgentMemberModelTiming | undefined> {
  const dir = await findKimiSessionDir(homeDir, cliSessionId)
  if (dir === undefined) return undefined
  const transcript = await readKimiTranscript(dir, memberEvents === undefined ? {} : { ownRounds: ownSelfRounds(memberEvents) })
  const units: KimiTranscriptLine[][] = []
  for (const line of transcript.lines) {
    const last = units.at(-1)
    const lastHead = last?.[0]
    if (lastHead !== undefined && lastHead.kind !== 'user' && line.kind !== 'user' && line.wireStep !== undefined && line.wireStep === lastHead.wireStep) last!.push(line)
    else units.push([line])
  }
  const streams: LocalAgentMemberModelTiming['streams'] = {}
  const requestStarts: NonNullable<LocalAgentMemberModelTiming['requestStarts']> = {}
  const toolTimings: LocalAgentMemberModelTiming['toolTimings'] = {}
  for (const unit of units) {
    const head = unit[0]
    if (head === undefined || head.kind === 'user' || head.wireStep === undefined) continue
    const key = `${head.turn}:${head.wireStep}`
    const stream = kimiStreamFromUnit(unit, transcript.stepTimings)
    if (stream.length > 0) streams[key] = stream
    const requestAt = transcript.stepTimings.get(key)?.requestAt
    if (requestAt !== undefined) requestStarts[key] = requestAt
  }
  for (const line of transcript.lines) {
    if (line.kind === 'tool' && line.timing !== undefined) toolTimings[line.id] = line.timing
  }
  return { streams, requestStarts, toolTimings }
}
