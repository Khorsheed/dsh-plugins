/**
 * The `ask_user_question` tool read as a question and its answer. A room
 * member (kimi / codex / claude-code / dsh CLI) asks the human through its
 * member channel, the main session through the host's own tool; in either
 * trace it is one tool call whose result is JSON or an error line. This module
 * turns the call's arguments, its result and — when the call's own arguments
 * are missing (member mirrors before 10-27 22:00 dropped nested arguments) or
 * its timing is not real (a mirror writes call and result together) — the
 * room's own `room/question` record into one view.
 *
 * @module @khorsheed/dsh-context-lens/ask
 */

/** One option of a question. */
export interface AskOption {
  label: string
  description?: string
}

/** One question as asked. */
export interface AskQuestion {
  id: string
  question: string
  header?: string
  options: AskOption[]
  multiSelect?: boolean
}

/** One question's answer: the chosen option labels, and the human's own text. */
export interface AskAnswer {
  id: string
  selected: string[]
  custom?: string
}

/**
 * How the question ended: answered (possibly after it expired), expired
 * unanswered (still answerable in the room), cancelled by the human, aborted
 * before an answer, the asking CLI's own wait timing out, still waiting, or
 * another failure (shown verbatim).
 */
export type AskOutcome = 'answered' | 'expired' | 'cancelled' | 'aborted' | 'timeout' | 'pending' | 'failed'

/** What the panel renders for one `ask_user_question` call. */
export interface AskView {
  /** The questions; absent when neither the call nor the room recorded them. */
  questions?: AskQuestion[]
  answers?: AskAnswer[]
  outcome: AskOutcome
  /** Answered after the question had expired (the room's late answer). */
  late?: boolean
  /** The failure's own text, when the outcome is `failed`. */
  detail?: string
  /** How long the human took: the room's asked → answered span, else the call's own span. */
  waitMs?: number
  /** Where the questions came from. */
  source?: 'arguments' | 'room'
  /**
   * The call's own failure when the room still recorded an answer: the
   * member's wait ended (kimi's MCP timeout) before the human answered, so
   * this call itself did not receive it.
   */
  callOutcome?: Exclude<AskOutcome, 'answered' | 'pending'>
}

/** The room's record of one question (see room.ts). */
export interface RoomQuestionRecord {
  id: string
  member?: string
  memberId?: string
  runId?: string
  questions: AskQuestion[]
  askedAt: number
  resolvedAt?: number
  outcome?: 'answered' | 'cancelled'
  answers?: AskAnswer[]
  late?: boolean
}

/** Whether a tool name is the question tool, bare or behind an MCP prefix. */
export const isAskTool = (name: string): boolean => name.endsWith('ask_user_question')

const str = (value: unknown): string | undefined => typeof value === 'string' && value.trim() !== '' ? value : undefined

/** Questions from a call's arguments or a room record; undefined when none parse. */
export function readQuestions(value: unknown): AskQuestion[] | undefined {
  let source = value
  if (typeof source === 'string') {
    try { source = JSON.parse(source) } catch { return undefined }
  }
  const list = (source as { questions?: unknown } | undefined)?.questions ?? source
  if (!Array.isArray(list)) return undefined
  const questions: AskQuestion[] = []
  for (const [index, raw] of list.entries()) {
    if (typeof raw !== 'object' || raw === null) continue
    const q = raw as Record<string, unknown>
    const question = str(q['question'])
    if (question === undefined) continue
    const options = Array.isArray(q['options']) ? q['options'].flatMap((o): AskOption[] => {
      const label = str((o as Record<string, unknown> | null)?.['label'])
      if (label === undefined) return []
      const description = str((o as Record<string, unknown>)['description'])
      return [{ label, ...description === undefined ? {} : { description } }]
    }) : []
    const header = str(q['header'])
    const multi = q['multi_select'] ?? q['multiSelect']
    questions.push({
      id: str(q['id']) ?? String(index),
      question,
      ...header === undefined ? {} : { header },
      options,
      ...multi === true ? { multiSelect: true } : {},
    })
  }
  return questions.length === 0 ? undefined : questions
}

/** Answers from a result's JSON or a room record; undefined when none parse. */
export function readAnswers(value: unknown): AskAnswer[] | undefined {
  let source = value
  if (typeof source === 'string') {
    try { source = JSON.parse(source) } catch { return undefined }
  }
  const list = (source as { answers?: unknown } | undefined)?.answers ?? source
  if (!Array.isArray(list)) return undefined
  const answers = list.flatMap((raw): AskAnswer[] => {
    if (typeof raw !== 'object' || raw === null) return []
    const a = raw as Record<string, unknown>
    const id = str(a['id'])
    if (id === undefined) return []
    const selected = Array.isArray(a['selected']) ? a['selected'].filter((s): s is string => typeof s === 'string') : []
    const custom = str(a['custom'])
    return [{ id, selected, ...custom === undefined ? {} : { custom } }]
  })
  return answers.length === 0 ? undefined : answers
}

/** A failed result's kind, read from its text (CLIs report failures as plain text, not always flagged). */
export function readFailure(text: string): Exclude<AskOutcome, 'answered' | 'pending'> {
  if (/Request timed out|-32001/i.test(text)) return 'timeout'
  if (/aborted before the user answered/i.test(text)) return 'aborted'
  if (/user cancelled/i.test(text)) return 'cancelled'
  if (/expired|过期|没有回答|did not answer|not answered|房间.{0,6}停止|room.{0,12}stopped/i.test(text)) return 'expired'
  return 'failed'
}

const sameAnswers = (a: AskAnswer[] | undefined, b: AskAnswer[] | undefined): boolean =>
  a !== undefined && b !== undefined && JSON.stringify(a.map(x => [x.id, x.selected, x.custom ?? ''])) === JSON.stringify(b.map(x => [x.id, x.selected, x.custom ?? '']))

/**
 * The view of one call.
 * @param input.arguments - the call's raw arguments.
 * @param input.execution - its result and span, when it ran.
 * @param input.room - the room's record of this question, when one matched.
 */
export function askView(input: {
  arguments: string
  execution?: { result?: string; running: boolean; start?: number; end?: number } | undefined
  room?: RoomQuestionRecord | undefined
}): AskView {
  const own = readQuestions(input.arguments)
  const questions = own ?? input.room?.questions
  const source: AskView['source'] = own !== undefined ? 'arguments' : input.room?.questions !== undefined ? 'room' : undefined
  const result = input.execution?.result
  const fromResult = result === undefined ? undefined : readAnswers(result)
  const room = input.room
  const span = input.execution?.start !== undefined && input.execution.end !== undefined ? input.execution.end - input.execution.start : undefined
  const roomWait = room?.resolvedAt !== undefined && room.outcome === 'answered' ? room.resolvedAt - room.askedAt : undefined
  const base = {
    ...questions === undefined ? {} : { questions },
    ...source === undefined ? {} : { source },
  }
  // The room's answer is the truth for a member's question (a late answer
  // arrives after the call already failed); the call's own result otherwise.
  if (room?.outcome === 'answered' && room.answers !== undefined) {
    const wait = roomWait ?? span
    const callFailure = result !== undefined && fromResult === undefined ? readFailure(result) : undefined
    return {
      ...base, outcome: 'answered', answers: room.answers,
      ...room.late === true ? { late: true } : {},
      ...wait === undefined ? {} : { waitMs: wait },
      ...callFailure === undefined ? {} : { callOutcome: callFailure },
    }
  }
  if (fromResult !== undefined) return { ...base, outcome: 'answered', answers: fromResult, ...span === undefined ? {} : { waitMs: span } }
  if (room?.outcome === 'cancelled') return { ...base, outcome: 'expired' }
  if (result === undefined) return { ...base, outcome: input.execution?.running === false ? 'failed' : 'pending' }
  const failure = readFailure(result)
  return { ...base, outcome: failure, ...failure === 'failed' ? { detail: result } : {}, ...span === undefined ? {} : { waitMs: span } }
}

/** Whether a room record answers the same as a call's result (the fallback match's tie-breaker). */
export function answersMatch(record: RoomQuestionRecord, result: string | undefined): boolean {
  return result !== undefined && sameAnswers(record.answers, readAnswers(result))
}
