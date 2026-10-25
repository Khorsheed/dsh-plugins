/**
 * Cross-session help: a member of a room asks another session for help. The
 * helper stays where it is — its own session, queue, model and context — and
 * the room carries the thread both ways:
 *
 * - the request lands in the helper's session as an ordinary follow-up (the
 *   host's own queue: it waits for the helper's current turn), carrying a
 *   `room-help` source the chat renders as a card pointing back to the room;
 * - while a thread is open the helper's agent carries two agent-local tools,
 *   `room_help_reply` (final answer plus a short handoff) and `room_help_ask`
 *   (a question back to the asker), registered on that agent only;
 * - the helper's messages reach the asking member as report-origin dispatches
 *   (the same path a member's report takes: joins a running turn, wakes an
 *   idle one); a helper turn that ends without the reply tool hands over its
 *   last answer instead, so a thread never hangs on a forgotten call.
 *
 * The room journals the thread as `room/help` + `room/help-message` +
 * `room/help-state`.
 * @module @khorsheed/dsh-room/help
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type ContextFormed, type MessageSource } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { RoomHelp, RoomHelpMessageEvent } from './types.ts'

/** The producer-owned source kind of a help message in the helper's session. */
export const HELP_KIND = 'room-help'

const PACKAGE_NAME = '@khorsheed/dsh-room'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** room producer: a help request (or a follow-up on it) from a member of another session's room. */
    'room-help': {
      kind: 'room-help'
      plugin: '@khorsheed/dsh-room'
      /** The help thread. */
      help: string
      /** The asking room's session and title. */
      room: string
      roomTitle: string
      /** The asking member's name. */
      from: string
      /** `request`: the thread's first message; `message`: the asker writing again. */
      op: 'request' | 'message'
      /** The asker's own words (the card shows these; the content adds the model-facing framing). */
      text: string
    } & ContextFormed
  }
}

/** The fields of a help source. */
export interface HelpSource {
  readonly help: string
  readonly room: string
  readonly roomTitle: string
  readonly from: string
  readonly op: 'request' | 'message'
  readonly text: string
}

/** The source a help message carries into the helper's session. */
export function helpSource(fields: HelpSource): MessageSource {
  return Object.freeze({ kind: HELP_KIND, plugin: PACKAGE_NAME, ...fields }) as MessageSource
}

/** A message source's help fields, when it is one. */
export function readHelpSource(source: unknown): HelpSource | undefined {
  const value = source as Partial<HelpSource> & { kind?: unknown } | null
  if (value?.kind !== HELP_KIND || typeof value.help !== 'string' || typeof value.room !== 'string') return undefined
  return {
    help: value.help, room: value.room,
    roomTitle: typeof value.roomTitle === 'string' ? value.roomTitle : '',
    from: typeof value.from === 'string' ? value.from : '',
    op: value.op === 'message' ? 'message' : 'request',
    text: typeof value.text === 'string' ? value.text : '',
  }
}

/**
 * Fold a room's help threads from its log.
 * @param events - the room's events.
 * @returns the threads, oldest first.
 */
export function replayHelps(events: readonly SessionEvent[]): RoomHelp[] {
  const helps = new Map<string, RoomHelp>()
  for (const event of events) {
    if (event.type === 'room/help') {
      helps.set(event.data.id, { ...event.data, state: 'queued', messages: [], time: event.time })
    } else if (event.type === 'room/help-message') {
      const help = helps.get(event.data.help)
      if (help !== undefined) helps.set(help.id, { ...help, messages: [...help.messages, { ...event.data, time: event.time }] })
    } else if (event.type === 'room/help-state') {
      const help = helps.get(event.data.help)
      if (help === undefined) continue
      const { error: _old, ...rest } = help
      helps.set(help.id, { ...rest, state: event.data.state, ...event.data.error === undefined ? {} : { error: event.data.error } })
    }
  }
  return [...helps.values()]
}

/**
 * The session ids a log's human messages @-referenced (the host's
 * `@[title](dsh-session:…)` mentions): the human pointing at a session is
 * consent for the room to ask it.
 * @param events - the room's events.
 * @returns the referenced session ids.
 */
export function referencedSessions(events: readonly SessionEvent[]): Set<string> {
  const ids = new Set<string>()
  for (const event of events) {
    if (event.type !== 'user/message' || event.data.source.kind !== 'user') continue
    for (const block of event.data.content) {
      if (block.type === 'text') for (const id of mentionedSessions(block.text)) ids.add(id)
    }
  }
  return ids
}

/**
 * The session ids a text's `dsh-session:` mentions name.
 * @param text - message or argument text.
 * @returns the ids, in order.
 */
export function mentionedSessions(text: string): string[] {
  return [...text.matchAll(/dsh-session:([A-Za-z0-9_-]+)/gu)].flatMap((match) => {
    const id = decodeSessionUri(match[1]!)
    return id === undefined ? [] : [id]
  })
}

/**
 * The member a 「成员（房间）」 label names (the label the @ menu writes for a
 * room member, inside an `@[…](dsh-session:…)` mention or typed as text).
 * @param name - the session argument as given.
 * @param roomTitle - the room's resolved title.
 * @returns the member name, or undefined when the label names the room itself.
 */
export function memberFromLabel(name: string | undefined, roomTitle: string): string | undefined {
  if (name === undefined) return undefined
  const label = /@\[((?:\\.|[^\\\]])*)\]\(dsh-session:/u.exec(name)?.[1]?.replace(/\\(.)/gu, '$1') ?? name.trim()
  const suffix = `（${roomTitle}）`
  if (!label.endsWith(suffix) || label === suffix) return undefined
  return label.slice(0, -suffix.length).replace(/^@/u, '').trim() || undefined
}

/** The session id inside a `dsh-session:` payload (base64url JSON string), if well-formed. */
function decodeSessionUri(payload: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return typeof parsed === 'string' ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * The help threads a helper's session has received (newest last), from the
 * help sources in its own log.
 * @param events - the helper's session events.
 * @returns one entry per thread.
 */
export function receivedHelps(events: readonly SessionEvent[]): HelpSource[] {
  const seen = new Map<string, HelpSource>()
  for (const event of events) {
    if (event.type !== 'user/message') continue
    const source = readHelpSource(event.data.source)
    if (source !== undefined && !seen.has(source.help)) seen.set(source.help, source)
  }
  return [...seen.values()]
}

/**
 * The answer a helper's turn ended with: the last assistant text after the
 * help message was claimed and before the next message from anyone else.
 * @param events - the helper's session events.
 * @param messageId - the help message.
 * @returns the text, '' when the turn produced none (or never ran).
 */
export function turnAnswer(events: readonly SessionEvent[], messageId: string): string {
  const start = events.findIndex(event => event.type === 'user/message' && String(event.data.id) === messageId)
  if (start < 0) return ''
  let answer = ''
  for (const event of events.slice(start + 1)) {
    if (event.type === 'user/message' && readHelpSource(event.data.source) === undefined && event.data.source.kind === 'user') break
    if (event.type === 'assistant/message') {
      const text = event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim()
      if (text !== '') answer = text
    }
  }
  return answer
}

/** Whether the helper's log holds the help message (it was claimed from the queue). */
export function claimed(events: readonly SessionEvent[], messageId: string): boolean {
  return events.some(event => event.type === 'user/message' && String(event.data.id) === messageId)
}

/** The request as the helper's model reads it. */
export function requestPrompt(help: { id: string; fromName: string; text: string }, roomTitle: string): string {
  return [
    `[Help request from ${help.fromName} in the room "${roomTitle}" · help ${help.id}]`,
    help.text,
    '',
    `${help.fromName} works in another session and is asking you for help. Work on it here as usual.`
    + ' When you are done, call room_help_reply with your final answer and a short handoff (two or three lines: what you'
    + ' found or changed, where, what they should do next) — the room hands both to them. If you need something from them'
    + ' first, call room_help_ask; their answer arrives as a new message. If you change code for them, do it on a git'
    + ' worktree branch so their checkout is untouched.',
  ].join('\n')
}

/** The asker writing again on a thread, as the helper reads it. */
export function messagePrompt(help: { id: string; fromName: string }, roomTitle: string, text: string): string {
  return [
    `[${help.fromName} in the room "${roomTitle}" · help ${help.id}]`,
    text,
    '',
    'Continue the help. Call room_help_reply when you are done, or room_help_ask if you need more from them.',
  ].join('\n')
}

/** A helper's message as the asking member reads it. */
export function askerPrompt(help: RoomHelp, message: Pick<RoomHelpMessageEvent, 'kind' | 'text' | 'handoff' | 'fallback'>): string {
  if (message.kind === 'question') {
    return [
      `[Question from "${help.target.title}" about your help request · help ${help.id}]`,
      message.text,
      '',
      `Answer with room_help (help: "${help.id}"). Answer it yourself from what you know; ask the human only if you cannot.`,
    ].join('\n')
  }
  return [
    `[Help reply from "${help.target.title}" · help ${help.id}]`,
    message.text,
    ...message.handoff === undefined ? [] : ['', `Handoff: ${message.handoff}`],
    '',
    'Carry on with this in the room. To ask them more, call room_help again with this help id.',
  ].join('\n')
}

/** Tag a helper tool with this package as its origin (AGENTS.md § Tool origin tagging). */
const tagged = <T extends object>(def: T): T =>
  Object.assign(def, { [Symbol.for('dsh.tool.origin')]: { channel: 'plugin', owner: PACKAGE_NAME } })

/** What the helper tools need from the room. */
export interface HelperBackend {
  /** Record the helper's question or reply on a thread and carry it to the asker. */
  helperMessage(agent: Agent, request: { help?: string; kind: 'question' | 'reply'; text: string; handoff?: string }): Promise<string>
}

/**
 * The two helper tools, registered on one helper agent only.
 * @param backend - the room service.
 * @returns the tool definitions.
 */
export function helperTools(backend: HelperBackend) {
  const helpParam = {
    type: 'string' as const,
    description: 'The help id from the request (e.g. the id after "help" in its first line). Omit when you were asked once.',
  }
  return [
    tagged(defineTool({
      name: 'room_help_reply',
      description:
        'Answer a help request another session sent you: your final answer plus a short handoff. The room hands both to '
        + 'whoever asked. Call it once you are done (you can reply again later if they ask more).',
      parameters: {
        help: helpParam,
        text: { type: 'string', required: true, description: 'Your final answer: what you found, what you did, the result.' },
        handoff: { type: 'string', required: true, description: 'Two or three lines for them: what changed, where (branch, files), what to do next.' },
      },
      output: { schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: value.text }] },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        if (exec.agent === undefined) return { text: 'room_help_reply requires a calling agent.' }
        return { text: await backend.helperMessage(exec.agent, { ...args.help === undefined ? {} : { help: args.help }, kind: 'reply', text: args.text, handoff: args.handoff }) }
      },
    })),
    tagged(defineTool({
      name: 'room_help_ask',
      description:
        'Ask whoever sent you a help request a question before you can finish it. Their answer arrives as a new message; '
        + 'end your turn after asking.',
      parameters: {
        help: helpParam,
        question: { type: 'string', required: true, description: 'What you need to know.' },
      },
      output: { schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: value.text }] },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        if (exec.agent === undefined) return { text: 'room_help_ask requires a calling agent.' }
        return { text: await backend.helperMessage(exec.agent, { ...args.help === undefined ? {} : { help: args.help }, kind: 'question', text: args.question }) }
      },
    })),
  ]
}

/** Build a help message for the helper's session. */
export function helpMessage(text: string, source: HelpSource) {
  return createUserMessage({ content: [{ type: 'text', text }], source: helpSource(source) })
}
