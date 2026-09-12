/**
 * Mirror a sub-dsh session's events into the parent-side dsh subagent session,
 * so a dsh delegation shows its full conversation (task, replies, thinking)
 * and real token usage in the standard 子代理 surface — the same fidelity the
 * other family harnesses get from their CLI transcript files. The sub-dsh
 * writes a real dsh session into the harness scoped home with the SAME id as
 * the parent-side child session and the same SessionEvent format, so the
 * mirror copies finalized `user/message`/`assistant/message` events verbatim
 * (no parsing, no re-encoding): reasoning blocks render natively and usage
 * rides the assistant events' own `usage` field into the tokenUsage
 * projection.
 *
 * Round scoping: the parent provider appends one `turn/start` per delegation
 * round, and the sub-dsh session numbers its turns identically (fresh = 1,
 * each resume +1), so a round's span is the sub-dsh events from its
 * `turn/start` with `turn === round` to the next `turn/start`. The sub-dsh's
 * own scaffolding user messages (agent-instructions, plugin, skill-catalog
 * sources) are filtered — only the caller task (`source.kind === 'user'`)
 * crosses. The sub-dsh's own `step/start`/`step/end` pairs cross verbatim
 * (each carries its (turn, step) coordinates): the real-time conversation
 * assembler only registers a step — and materializes its assistant message —
 * at a boundary, so without them the live subsession view renders the prompt
 * and tool cards but no replies. Turn boundaries are NOT copied: the parent's
 * real-time spawn→settle boundaries stay the authoritative timing.
 *
 * `todo/write` passthrough: the sub-dsh's task list is a standing whole-list
 * snapshot (last-wins). Each pass appends the round's LATEST snapshot only
 * when it differs from the child session's last mirrored one, so repeated
 * passes never duplicate an identical snapshot and the child's `todos`
 * projection (and the official TodoPanel in non-takeover views) reads the
 * member's task list for free.
 * @module @khorsheed/dsh-local-agent-dsh/session-mirror
 */

import { readFile, readdir } from 'node:fs/promises'
import { resolveDshSessionLog } from './session-log.ts'
import type { DshSessionLog } from './session-log.ts'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { zstdDecompress } from 'node:zlib'
import type { Context } from '@deepseek-ai/cordis'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionEventMap, SessionSeq } from '@deepseek-ai/dsh-session'
// Type-only: the 'todo/write' SessionEventMap merge (the passthrough mirror).
import type {} from '@deepseek-ai/dsh-tool-todo'
import type { LocalAgentToolCalls } from '@khorsheed/dsh-local-agent/types'
import { persistChildSession } from '@khorsheed/dsh-local-agent'

/** Decompress one zstd session log (Node ≥22.15 built-in; engines require ^22.19). */
const decompressZstd = promisify(zstdDecompress)

/** Every zstd frame's little-endian magic number, marking a frame start in the stream. */
const ZSTD_FRAME_MAGIC = 0xfd2fb528

/**
 * Decompress a multi-frame zstd session log. The persistence layer appends
 * one frame per flush batch, and Node's single-shot `zstdDecompress` stops at
 * the first frame's end (a streaming decoder does the same), so each frame
 * start is scanned and decompressed independently. A magic-looking byte
 * sequence inside compressed data fails decompression and is skipped.
 * @param content - the raw `.zstd` file bytes.
 * @returns the concatenated plaintext of every frame.
 */
async function decompressZstdFrames(content: Buffer): Promise<string> {
  const parts: string[] = []
  for (let offset = 0; offset + 4 <= content.length; offset += 1) {
    if (content.readUInt32LE(offset) !== ZSTD_FRAME_MAGIC) continue
    try {
      parts.push((await decompressZstd(content.subarray(offset))).toString('utf8'))
    } catch {
      // Not a real frame start; keep scanning.
    }
  }
  return parts.join('')
}

/** One session log read back: its events, and which file they came from. */
export interface SubDshEventLog {
  /** The session's events, header line excluded. */
  readonly events: SessionEvent[]
  /** The log file the events were read from (its generation and encoding). */
  readonly log: DshSessionLog
}

/**
 * Read a sub-dsh session's event log from the scoped home. The session lives
 * at `<homeDir>/sessions/<workspace>/<id>/` (the runner passes the bare uuid);
 * WHICH file inside that directory holds the history is the host's choice —
 * `session.jsonl` on the original generation, `session.v3.jsonl.zstd` on host
 * 0.1.5 — so the name is resolved, never assumed (see
 * {@link resolveDshSessionLog}). The first line is the header, the rest are
 * events.
 * @param homeDir - the `dsh` harness's scoped home.
 * @param sessionId - the sub-dsh session id (same uuid as the child session).
 * @returns the events and their source file, or undefined when the session is
 *   absent or unreadable.
 */
export async function readSubDshEvents(homeDir: string, sessionId: string): Promise<SubDshEventLog | undefined> {
  let workspaces: string[]
  try {
    workspaces = await readdir(join(homeDir, 'sessions'))
  } catch {
    return undefined
  }
  for (const workspace of workspaces) {
    for (const name of [sessionId, `session-${sessionId}`]) {
      const log = await resolveDshSessionLog(join(homeDir, 'sessions', workspace, name))
      if (log === undefined) continue
      let text: string
      try {
        const content = await readFile(log.path)
        text = log.compressed ? await decompressZstdFrames(content) : content.toString('utf8')
      } catch {
        continue
      }
      const events: SessionEvent[] = []
      for (const line of text.split('\n')) {
        if (line === '') continue
        try {
          const parsed = JSON.parse(line) as { type?: string }
          if (parsed.type === 'session') continue
          events.push(parsed as SessionEvent)
        } catch {
          // A torn tail line (killed mid-flush) is skipped, not fatal.
        }
      }
      if (events.length > 0) return { events, log }
    }
  }
  return undefined
}

/** The result of one dsh session-mirror pass. */
export interface DshMirrorDelta {
  /** Text of each content event this pass newly mirrored (delta progress payloads); mirrored step boundaries carry no text. */
  texts: string[]
  /** Total round events mirrored into the child session after this pass. */
  total: number
  /**
   * The round's observed model identifier, read from the sub-dsh session's
   * own assistant events: the `message.source` of the round's LAST
   * `assistant/message`, formatted `provider/model` (the same shape the
   * effectiveSettings snapshot reports the configured model in) or the bare
   * model when no provider is named. Absent when the round's events name no
   * model — absence is recorded, never guessed.
   */
  observedModel?: string
  /**
   * The round's token usage: the span's assistant events' own `usage` fields
   * summed (each event carries one LLM call's accounting, the same caliber
   * the tokenUsage projection sums). Absent when the round recorded none.
   */
  usage?: TokenUsage
  /**
   * The round's tool-call accounting: the span's `tool/call` events counted
   * under the names they carry. Read off the SAME round window the model and
   * usage come from — the pre-skip span, so a settle pass a live poll already
   * drained still reports the round's real count. Absent when the round made
   * no tool call.
   */
  toolCalls?: LocalAgentToolCalls
  /**
   * The session-log file this pass read, by basename (`session.jsonl.zstd`,
   * `session.v3.jsonl.zstd`, …). Carried so a read-back says WHICH generation
   * it read rather than leaving a future filename change to look like an empty
   * session — the failure this field exists because of. Absent when no log was
   * found, which is the same "nothing to read" the other fields report by
   * staying absent.
   */
  sessionLogFile?: string
}

/**
 * Sum one more assistant event's usage into a running round total. Each
 * sub-dsh assistant event carries ONE LLM call's accounting; the round's
 * windows (live polls, settle pass) recompute it from the round's span, so
 * the total is span-derived and never double counts across passes.
 */
function addEventUsage(total: TokenUsage | undefined, usage: unknown): TokenUsage | undefined {
  const raw = usage as { inputTokens?: unknown; outputTokens?: unknown; cacheReadTokens?: unknown; cacheWriteTokens?: unknown } | undefined
  if (raw === undefined || typeof raw !== 'object') return total
  const num = (value: unknown): number => {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  const merged: TokenUsage = {
    inputTokens: (total?.inputTokens ?? 0) + num(raw.inputTokens),
    outputTokens: (total?.outputTokens ?? 0) + num(raw.outputTokens),
  }
  const cacheRead = (total?.cacheReadTokens ?? 0) + num(raw.cacheReadTokens)
  const cacheWrite = (total?.cacheWriteTokens ?? 0) + num(raw.cacheWriteTokens)
  if (cacheRead > 0) merged.cacheReadTokens = cacheRead
  if (cacheWrite > 0) merged.cacheWriteTokens = cacheWrite
  return merged
}

/**
 * Extract the round's observed model and token usage from its event span:
   the LAST assistant event's `message.source` names the model that ran, and
 * the assistant events' `usage` fields sum to the round's accounting.
 */
function roundObservation(span: readonly SessionEvent[]): {
  observedModel?: string
  usage?: TokenUsage
  toolCalls?: LocalAgentToolCalls
} {
  let observedModel: string | undefined
  let usage: TokenUsage | undefined
  // Tool calls counted over the same round window, keyed by the name the
  // sub-dsh's own `tool/call` event carries — the tool's dsh name, verbatim.
  const byName: Record<string, number> = {}
  let toolCount = 0
  for (const event of span) {
    if (event.type === 'tool/call') {
      const name = (event.data as { name?: unknown }).name
      toolCount += 1
      const key = typeof name === 'string' && name !== '' ? name : 'tool'
      byName[key] = (byName[key] ?? 0) + 1
      continue
    }
    if (event.type !== 'assistant/message') continue
    const data = event.data as {
      message?: { source?: { provider?: unknown; model?: unknown } }
      usage?: unknown
    }
    const source = data.message?.source
    if (source !== undefined && typeof source === 'object') {
      const model = typeof source.model === 'string' && source.model !== '' ? source.model : undefined
      if (model !== undefined) {
        const provider = typeof source.provider === 'string' && source.provider !== '' ? source.provider : undefined
        observedModel = provider === undefined ? model : `${provider}/${model}`
      }
    }
    usage = addEventUsage(usage, data.usage)
  }
  return {
    ...observedModel === undefined ? {} : { observedModel },
    ...usage === undefined ? {} : { usage },
    // Zero is not reported: a round that made no tool call and a round whose
    // events were never read are different facts, and only absence can say
    // the second one honestly.
    ...toolCount === 0 ? {} : { toolCalls: { count: toolCount, byName } },
  }
}

/** How much of the live event stream crosses into the child session. */
export type DshLiveMirrorGranularity = 'event' | 'token'

/** Flatten a mirrored message event's content to plain text for delta progress. */
function mirroredEventText(event: SessionEvent): string {
  // user/message carries content directly; assistant/message wraps it in `message`.
  const data = event.data as {
    content?: readonly { type?: string; text?: string }[]
    message?: { content?: readonly { type?: string; text?: string }[] }
  }
  const content = data.message?.content ?? data.content ?? []
  return content
    .filter(block => (block.type === 'text' || block.type === 'reasoning') && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('')
}

/** The delta-progress text for one mirrored tool event. */
function mirroredToolText(event: SessionEvent): string {
  if (event.type === 'tool/call') {
    return `[工具 ${(event.data as { name?: string }).name ?? 'tool'}]`
  }
  const data = event.data as { message?: { content?: readonly { content?: readonly { text?: string }[] }[] } }
  const result = data.message?.content?.[0]?.content?.map(block => block.text ?? '').join('') ?? ''
  return result === '' ? '[工具结果]' : `[工具结果] ${result}`
}

/**
 * Find the child-session seq of the mirrored `tool/call` carrying `callId`,
 * so a mirrored `tool/result`'s `sourceEventSeqs` points at the CHILD's call
 * event — the source event's own seqs reference the sub-dsh session's
 * numbering and are meaningless here.
 */
function findMirroredCallSeq(childSession: Session, callId: string): SessionSeq | undefined {
  for (let index = childSession.snapshotEvents().length - 1; index >= 0; index -= 1) {
    const event = childSession.snapshotEvents()[index]
    if (event?.type !== 'tool/call') continue
    if ((event.data as { callId?: string }).callId === callId) return event.seq
  }
  return undefined
}

/**
 * Append one mirrored `tool/call` or `tool/result` event — the native tool
 * card pair, so the child session renders the sub-dsh's tool activity with
 * the standard conversation's tool rows instead of not at all. Shared by the
 * file mirror's span loop and the live driver's per-event mirror.
 */
function appendMirroredToolEvent(childSession: Session, event: SessionEvent): string {
  if (event.type === 'tool/call') {
    childSession.append('tool/call', event.data as SessionEventMap['tool/call'])
  } else if (event.type === 'tool/result') {
    const data = event.data as { message: { source: { callId: string } } }
    const callSeq = findMirroredCallSeq(childSession, String(data.message.source.callId))
    childSession.append(
      'tool/result',
      event.data as SessionEventMap['tool/result'],
      {
        surfaceOp: 'append',
        ...callSeq === undefined ? {} : { sourceEventSeqs: [callSeq] },
      },
    )
  }
  return mirroredToolText(event)
}

/**
 * Append one mirrored `step/start` or `step/end` boundary verbatim — the event
 * carries its own (turn, step) coordinates, so the child session's location
 * index registers the same step the sub-dsh wrote. Shared by the file
 * mirror's span loop and the live driver's per-event mirror. An interrupted
 * step crosses as an OPEN pair (start without end): the location resolves to
 * the step either way, and no boundary is ever synthesized.
 */
function appendMirroredStepBoundary(childSession: Session, event: SessionEvent): void {
  if (event.type === 'step/start') {
    childSession.append('step/start', event.data)
  } else if (event.type === 'step/end') {
    childSession.append('step/end', event.data)
  }
}

/**
 * Append one appendable message event verbatim and report its delta text —
 * the single append path shared by the file mirror's span loop and the live
 * driver's per-event mirror, so both transports produce identical child
 * sessions.
 */
function appendMirroredMessageEvent(childSession: Session, event: SessionEvent): string {
  if (event.type === 'user/message') {
    childSession.append('user/message', event.data, { surfaceOp: 'append' })
  } else if (event.type === 'assistant/message') {
    // Verbatim copy: content blocks (text/reasoning) and usage ride the
    // event's own fields, so the tokenUsage projection counts the round.
    childSession.append('assistant/message', event.data, { surfaceOp: 'append' })
  }
  return mirroredEventText(event)
}

/**
 * Mirror ONE live-pushed sub-dsh session event (the serve mode's
 * `session/event` wire notification) into the child session. This is the
 * live driver's transport-side entry into the SAME fold the file mirror
 * owns: the filter (only the caller task's `user/message`, every
 * `assistant/message`, the tool events, and the `step/start`/`step/end`
 * boundaries cross — verbatim; turn boundaries stay the parent's; scaffolding
 * stays behind) and the verbatim append are exactly `mirrorDshSession`'s
 * span-loop rules. The 0.1.5 sub-dsh emits no per-chunk events (the
 * `assistant/chunk` type is retired — an interrupted attempt settles as
 * `assistant/attempt`, which carries no surface content and never crosses),
 * so the `token` granularity no longer streams deltas into the child log;
 * live text rides the run-progress channel only.
 * The caller owns offset/dedupe (the live runtime pushes
 * each event once) and persistence batching.
 * @param childSession - the parent-side dsh subagent session.
 * @param event - the live event from the resident sub-dsh.
 * @param _options - granularity; retained for caller compatibility — the
 *   retirement of per-chunk events leaves the mirror granularity-invariant.
 * @returns the mirrored text for delta progress, or undefined when the event
 *   was filtered out or carries no progress text (a step boundary crosses but
 *   is structure, not content).
 */
export function mirrorDshLiveEvent(
  childSession: Session,
  event: SessionEvent,
  _options?: { granularity?: DshLiveMirrorGranularity },
): string | undefined {
  if (event.type === 'user/message' && event.data.source.kind === 'user') {
    return appendMirroredMessageEvent(childSession, event)
  }
  if (event.type === 'assistant/message') {
    return appendMirroredMessageEvent(childSession, event)
  }
  if (event.type === 'tool/call' || event.type === 'tool/result') {
    return appendMirroredToolEvent(childSession, event)
  }
  if (event.type === 'step/start' || event.type === 'step/end') {
    appendMirroredStepBoundary(childSession, event)
    return undefined
  }
  return undefined
}

/**
 * Mirror the current round's events from the sub-dsh session into the child
 * session, then persist (a live session syncs through the core's cached write
 * handle, a standalone one through a one-shot handle; see
 * {@link persistIfStandalone}). Runs both
 * from the provider's live poll (while the
 * sub-dsh writes its log in batches — a torn final zstd frame is skipped
 * until the next pass) and after the child process exits (the settle pass);
 * the round's already-mirrored prefix in the child session is the offset, so
 * the settle pass is a no-op when polling kept up. An aborted round still
 * preserves its partial work and real usage. All failures degrade to a warn:
 * the delegation result is already settled.
 * @param ctx - host context carrying session persistence.
 * @param childSession - the parent-side dsh subagent session.
 * @param homeDir - the `dsh` harness's scoped home.
 * @param subSessionId - the sub-dsh session id (same uuid as the child session).
 * @returns the newly mirrored events' texts and the round's mirrored total.
 */
export async function mirrorDshSession(
  ctx: Context,
  childSession: Session,
  homeDir: string,
  subSessionId: string,
): Promise<DshMirrorDelta> {
  const empty: DshMirrorDelta = { texts: [], total: 0 }
  try {
    const read = await readSubDshEvents(homeDir, subSessionId)
    if (read === undefined) return empty
    const { events, log } = read
    // The round mirrors the sub-dsh turn with the same number: the parent's
    // turn/start count IS this round's number (appended before spawn), and the
    // sub-dsh numbers its turns identically across fresh and resume rounds.
    const round = childSession.snapshotEvents().filter(event => event.type === 'turn/start').length
    if (round === 0) return empty
    let start = -1
    let end = events.length
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index]
      if (event?.type !== 'turn/start') continue
      if (start === -1 && event.data.turn === round) {
        start = index
        continue
      }
      if (start !== -1) {
        end = index
        break
      }
    }
    if (start === -1) return empty
    // The child session's messages after its last turn/start are this round's
    // already-mirrored prefix (a live poll may have appended them); skip it so
    // the settle pass never duplicates what polling mirrored. The span is
    // filtered to APPENDABLE events first — scaffolding user messages
    // (non-'user' sources) never cross, so they must not occupy skip
    // positions either. The two filter sets must stay IDENTICAL — step
    // boundaries included on both sides — or a repeated pass misaligns the
    // prefix and re-appends (a second step/start for the same (turn, step)
    // makes the live assembler throw).
    let lastTurnStart = -1
    for (let index = 0; index < childSession.snapshotEvents().length; index += 1) {
      if (childSession.snapshotEvents()[index]?.type === 'turn/start') lastTurnStart = index
    }
    const mirrored = childSession.snapshotEvents().slice(lastTurnStart + 1)
      .filter(event =>
        event.type === 'user/message' || event.type === 'assistant/message'
        || event.type === 'tool/call' || event.type === 'tool/result'
        || event.type === 'step/start' || event.type === 'step/end')
      .length
    const roundSpan = events.slice(start, end)
      .filter(event =>
        (event.type === 'user/message' && event.data.source.kind === 'user')
        || event.type === 'assistant/message'
        || event.type === 'tool/call'
        || event.type === 'tool/result'
        || event.type === 'step/start'
        || event.type === 'step/end')
    const span = roundSpan.slice(mirrored)
    const texts: string[] = []
    let appended = 0
    for (const event of span) {
      appended += 1
      if (event.type === 'step/start' || event.type === 'step/end') {
        // A boundary is structure, not content: it crosses verbatim (its own
        // (turn, step) coordinates) but contributes no delta text.
        appendMirroredStepBoundary(childSession, event)
        continue
      }
      texts.push(
        event.type === 'tool/call' || event.type === 'tool/result'
          ? appendMirroredToolEvent(childSession, event)
          : appendMirroredMessageEvent(childSession, event),
      )
    }
    // The round's observation comes from the round's OWN window (the
    // pre-skip roundSpan, not the delta): the last assistant event names the
    // model that ran, and the assistant events' usage sums to the round's
    // accounting, whatever the live-poll / settle split was.
    const observation = roundObservation(roundSpan)
    // todo/write passthrough, counted independently of the message prefix
    // skip: the snapshot is a standing whole list (last-wins), so a pass
    // appends the round's latest snapshot only when it differs from the
    // child's last mirrored one — repeated passes never duplicate an
    // identical snapshot, and intermediate snapshots stay out of the log.
    let todosAppended = 0
    const latestTodos = events.slice(start, end).filter(event => event.type === 'todo/write').at(-1)
    const mirroredTodos = childSession.snapshotEvents().slice(lastTurnStart + 1)
      .filter(event => event.type === 'todo/write')
    if (latestTodos !== undefined && latestTodos.type === 'todo/write') {
      if (JSON.stringify(mirroredTodos.at(-1)?.data) !== JSON.stringify(latestTodos.data)) {
        // todo/write's append takes no surface options (log-only UI state).
        childSession.append('todo/write', latestTodos.data)
        todosAppended = 1
      }
    }
    if (appended > 0 || todosAppended > 0) {
      await persistChildSession(ctx, childSession)
    }
    return {
      texts,
      total: mirrored + mirroredTodos.length + appended + todosAppended,
      sessionLogFile: log.filename,
      ...observation,
    }
  } catch (error) {
    ctx.logger.warn(`subagent-dsh: session mirror failed: ${error instanceof Error ? error.message : String(error)}`)
    return empty
  }
}

/**
 * Persist the child session's mirrored events. Thin wrapper over the core's
 * {@link persistChildSession}: a live session syncs through the core's cached
 * per-child write handle (host 0.1.5's live write-behind never checkpoints a
 * mirror session — it has no agent loop — so production child logs stayed
 * header-only until the explicit sync), a standalone one through a one-shot
 * handle flow. Kept under the historical name for the live driver.
 */
export async function persistIfStandalone(ctx: Context, childSession: Session): Promise<void> {
  await persistChildSession(ctx, childSession)
}
