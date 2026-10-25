/**
 * The room's model-facing tool DEFINITIONS, `room_invite` and
 * `room_message` (plus `room_read` and `room_plan`): the main
 * agent's paths into the room it belongs to. `room_invite` and
 * `room_message` PROMOTE: calling them in a plain session turns it into a
 * room (ensureRoom) instead of rejecting.
 * `room_invite` lands in the same invite path as the human dialog
 * (`invitedBy: 'agent'`), producing an identical member record; `room_message` dispatches
 * a message to a member through the same engine path as the human's
 * `@member text`, minus the user bubble (the caller is the room's own agent).
 *
 * Since the tool-row split (M4') the core never REGISTERS these tools: the
 * factories are consumed by the package's `./tool` subpath row
 * ({@link file://./tool.ts}), which mounts them inside agent-preset
 * compositions (session-granted, never at the profile root). The definitions
 * are therefore returned UNTAGGED — the registering row applies its own
 * tool-origin tag (AGENTS.md § Tool origin tagging — the owner is whichever
 * package mounts the row).
 *
 * Internal module: not on the package's exports map (consumers reach it only
 * through `./src/*`).
 *
 * @module @khorsheed/dsh-room
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {
  RoomGetStateRequest, RoomGetStateResult,
  RoomInviteRequest, RoomInviteResult,
  RoomMessageRequest, RoomMessageResult,
} from './types.ts'

/** The slice of RoomService the tool drives. */
export interface RoomInviteToolBackend {
  /** Validate and journal an invitation (see RoomService.inviteMember). */
  inviteMember(request: RoomInviteRequest, invitedBy: 'human' | 'agent'): Promise<RoomInviteResult>
}

/**
 * Build the room_invite tool definition bound to the room service.
 * @param backend - the room service.
 * @returns a registry-ready tool definition.
 */
export function roomInviteTool(backend: RoomInviteToolBackend) {
  return defineTool({
    name: 'room_invite',
    description:
      'Invite a CLI agent member into the current session (any session works — inviting promotes it '
      + 'into a room: the multi-agent group conversation surface wakes up on it). '
      + 'The member becomes @-addressable by the human and by other members: pick a short unique '
      + 'name (no whitespace, no "@", e.g. ada/bill/cathy) — it is the addressing name, decoupled '
      + 'from the provider so two instances of one provider can coexist; prefer a function-style '
      + 'name (e.g. design-review / restart-test) when the member has a standing role, so the human '
      + 'and the other members can tell what it is for. Give a short public role (what everyone '
      + 'else sees) and private instructions: the instructions are the member\'s own briefing, '
      + 'prepended to its first dispatch and persisted in its own CLI '
      + 'session from then on. Give a firstTask to put the member to work immediately, or omit it '
      + 'to have the member join idle. A member keeps its own CLI session and accumulates context '
      + 'across rounds, so prefer inviting over a one-shot subagent_* delegation whenever the work '
      + 'expects follow-ups with the same agent — reserve one-shot delegations for self-contained '
      + 'tasks with no continuation. room_read lists the invitable providers and modes (it works before '
      + 'the session is a room too); the provider may be its id or the harness name (e.g. claude-code).',
    parameters: {
      provider: {
        type: 'string',
        required: true,
        description:
          'The CLI to invite: a provider id from room_read, or the harness name / display name '
          + '(claude-code, Claude Code, codex, kimi). An unknown one is rejected with the available ids.',
      },
      name: {
        type: 'string',
        required: true,
        description: 'The member\'s @-addressing name: unique in this room, no whitespace, no "@".',
      },
      role: {
        type: 'string',
        description: 'Short public role (≤30 chars, e.g. 代码审查 / 实现 / 测试): what the other members and the human see. Keep it a phrase; details go in instructions.',
      },
      instructions: {
        type: 'string',
        required: true,
        description: 'The member\'s private instructions (responsibilities, constraints, output expectations). Only this member ever reads them.',
      },
      firstTask: {
        type: 'string',
        description: 'Optional first task, dispatched to the member as soon as it joins. Its result is reported back to you automatically — do not sleep or poll room_read for it.',
      },
      note: {
        type: 'string',
        description: 'Optional: what you will wait for before acting on the first task\'s result (e.g. "wait until every invited member greeted"). The room uses it to decide when to hand you the report.',
      },
      cwd: {
        type: 'string',
        description: 'Optional working directory for the member (empty: inherits the room session\'s cwd).',
      },
      mode: {
        type: 'string',
        description: 'The member\'s dsh mode: a host agent preset id (e.g. dsh-gamedev, dsh-video). The member '
          + 'can then call that mode\'s plugin tools (and sees its skills) besides its own CLI tools. '
          + 'Omit it to keep this room\'s own mode — the usual choice; pass the mode the human asked for '
          + 'when they named one, or "none" for a member with only its own CLI tools. An unknown id is '
          + 'rejected with the available ids.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    // Invitations mutate only the room journal; two invites never conflict
    // beyond a duplicate name, which the result text reports back.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) return { text: 'room_invite requires a calling agent (exec.agent was undefined).' }
      // No room gate: inviteMember PROMOTES the calling session into a room.
      const result = await backend.inviteMember({
        sessionId: agent.session.id,
        provider: args.provider,
        name: args.name,
        instructions: args.instructions,
        ...args.role === undefined ? {} : { role: args.role },
        ...args.firstTask === undefined ? {} : { firstTask: args.firstTask },
        ...args.note === undefined ? {} : { note: args.note },
        ...args.cwd === undefined ? {} : { cwd: args.cwd },
        ...args.mode === undefined || args.mode.trim() === '' ? { inheritPreset: true } : args.mode.trim() === 'none' ? {} : { preset: args.mode.trim() },
      }, 'agent')
      if (!result.ok) {
        const hint = result.error.code === 'duplicate-name'
          ? ' Pick a different name and retry.'
          : result.error.code === 'invalid-name'
            ? ' Names must be non-empty and free of whitespace and "@"; retry with a valid name.'
            : result.error.code === 'role-too-long'
              ? ' The role must be at most 30 characters; shorten it and move details into instructions.'
            : result.error.code === 'local-agent-unavailable'
              ? ' The local-agent delegation facade is not mounted; CLI members cannot join right now.'
              : result.error.code === 'unknown-provider'
                ? ` Unknown delegation provider "${result.error.provider}" (it must be the family's delegation provider id, not the harness's display name). Available: ${
                  result.error.available.length === 0
                    ? 'none (no harness with a delegation provider is registered)'
                    : result.error.available.join(', ')
                }. Retry with one of the available providers.`
                : result.error.code === 'unknown-preset'
                  ? ` Unknown mode "${result.error.preset}". Available: ${result.error.available.join(', ') || 'none'}; or "none" for no mode.`
                  : ''
        return { text: `Could not invite "${args.name}": ${result.error.code}.${hint}` }
      }
      return {
        text: result.value.pendingFirstTask
          ? `Member ${result.value.name} joined the room and its first task was dispatched.${modeNote(result.value.preset)}`
          : `Member ${result.value.name} joined the room (idle; @-address it to dispatch work).${modeNote(result.value.preset)}`,
      }
    },
  })
}

/** The invite receipt's mode line, so the caller can tell the human which mode the member runs. */
function modeNote(preset: string | undefined): string {
  return preset === undefined ? ' Mode: none (its own CLI tools only).' : ` Mode: ${preset}.`
}

/** The slice of RoomService the room_message tool drives. */
export interface RoomMessageToolBackend {
  /** Dispatch one message to one member (see RoomService.messageMember). */
  messageMember(request: RoomMessageRequest): Promise<RoomMessageResult>
  /** Replay the room state (the error text reads the live roster from it). */
  getState(request: RoomGetStateRequest): Promise<RoomGetStateResult>
}

/**
 * Build the room_message tool definition bound to the room service: the main
 * agent's way to hand a member a message/task — the model-facing equivalent
 * of the human's `@member text`, minus the user bubble (the caller is the
 * room's own agent, not the human).
 * @param backend - the room service.
 * @returns a registry-ready tool definition.
 */
export function roomMessageTool(backend: RoomMessageToolBackend) {
  return defineTool({
    name: 'room_message',
    description:
      'Send a message to another member of the current room (works in any session — it promotes the '
      + 'session into a room if it is not one yet). '
      + 'A member is an independent session: the message runs asynchronously in its own session. '
      + 'kind "task" (default) hands it work — its final reply is reported back to you automatically, '
      + 'quoting the message id, so do not poll; kind "notify" is an FYI that is never reported back. '
      + 'After sending, end your turn: never sleep or poll for the result (room_read included) — the '
      + 'report arrives on its own. Writing "@name" in a reply reaches nobody; only this tool does. '
      + 'Pass inReplyTo with a message id (e.g. m12) when answering one. The member argument is a '
      + 'roster name (read room_read for current names); an unknown name is rejected with the live '
      + 'roster, so retry with one of those.',
    parameters: {
      member: {
        type: 'string',
        required: true,
        description: 'The addressee\'s roster name (read room_read for current names; new rooms name the native member "dsh").',
      },
      text: {
        type: 'string',
        required: true,
        description: 'The message text the member receives.',
      },
      kind: {
        type: 'string',
        enum: ['task', 'notify'],
        description: 'task (default): its reply is reported back to you. notify: FYI, no report.',
      },
      inReplyTo: {
        type: 'string',
        description: 'Optional id of the message this answers (e.g. m12).',
      },
      task: {
        type: 'string',
        description: 'Optional: which task this belongs to — "new" or a task number from room_read (e.g. "2"). Use it when the human\'s latest message was filed under the wrong task: it re-files that message too. Omit to stay in the current task.',
      },
      note: {
        type: 'string',
        description: 'Optional: what you will wait for before acting on this result, in your own words (e.g. "wait until all three greeted, then tell the user once" / "hand it to claude for review as soon as it is done"). The room uses it to decide when to hand you the report.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    // A dispatch mutates only the room journal; two messages never conflict
    // beyond the roster validation the result text reports back.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) return { text: 'room_message requires a calling agent (exec.agent was undefined).' }
      // No room gate: messageMember PROMOTES the calling session into a room.
      const sessionId = agent.session.id
      const result = await backend.messageMember({ sessionId, member: args.member, text: args.text,
        ...args.kind === undefined ? {} : { kind: args.kind as 'task' | 'notify' },
        ...args.inReplyTo === undefined ? {} : { inReplyTo: args.inReplyTo },
        ...args.note === undefined ? {} : { note: args.note },
        ...args.task === undefined ? {} : { task: args.task } })
      if (!result.ok) {
        if (result.error.code === 'member-not-found') {
          const state = await backend.getState({ sessionId })
          const names = state.ok ? state.value.members.map(member => member.name) : []
          const hint = names.length === 0 ? '' : ` The room roster is: ${names.join(', ')}. Retry with one of these names.`
          return { text: `Could not message "${args.member}": unknown member.${hint}` }
        }
        if (result.error.code === 'self-message') return { text: 'You cannot message yourself; pick another member.' }
        if (result.error.code === 'unknown-task') return { text: `No task "${args.task}" in this room; pass "new" or a task number from room_read.` }
        if (result.error.code === 'empty-text') {
          return { text: 'The message text must be non-blank; retry with real content.' }
        }
        return { text: `Could not message "${args.member}": ${result.error.code}.` }
      }
      const value = result.value
      if (value.held !== undefined) {
        return { text: value.held === 'paused'
          ? `Held: the room is paused; the message to ${value.member} is delivered when the human resumes it.`
          : value.held === 'hop-limit'
            ? `Held: this chain of messages reached the room's hop limit; the human decides whether ${value.member} gets it.`
            : `Held: the room asks the human to confirm member messages; ${value.member} gets it once confirmed.` }
      }
      return {
        text: args.kind === 'notify'
          ? `Sent ${value.messageId} to ${value.member} as an FYI; no report will come back.`
          : `Sent ${value.messageId} to ${value.member}. It runs asynchronously; its final reply comes back to you `
            + 'automatically as a report citing this id. Do not sleep, wait, or poll room_read for it — end your turn; '
            + 'the human already sees the member\'s reply in the room, so do not repeat it when the report arrives.',
      }
    },
  })
}

/** Native room tools use the same bounded context reader as the external MCP bridge. */
export function roomReadTool(backend: { readRoomContext(sessionId: string): Promise<string> }) {
  return defineTool({
    name: 'room_read',
    description: 'Read the current room: roster with each member\'s role, the coordinator, the tasks with their numbers (for the task parameter), deliveries, recent outcomes and available harness providers. In a session that is not a room yet it returns the invitable providers and modes instead. Reading does not wake any member. Use it to look around, not to wait for a result — reports arrive on their own.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }] },
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      if (exec.agent === undefined) return { text: 'room_read requires a calling agent.' }
      try { return { text: await backend.readRoomContext(exec.agent.session.id) } }
      catch (error) { return { text: String(error) } }
    },
  })
}

/** Formal planning uses the same strict command grammar exposed by room_read. */
export function roomPlanTool(backend: { commandPlan(sessionId: string, command: string): Promise<string> }) {
  return defineTool({
    name: 'room_plan',
    description: 'Organize a requested goal into stages and dependent tasks, submit evidence, review/rework results, and pause/resume. Read room_read for current plan and planCommands JSON schema. Ordinary small tasks use room_message without a formal goal. A native run finishing only submits a result; acceptance requires evidence review.',
    parameters: { command: { type: 'string', required: true, description: 'JSON command matching room_read planCommands: action, requestId, expectedRevision and action fields. Create mode execute is for authorized execution; draft saves a proposal without dispatch.' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }] },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (exec.agent === undefined) return { text: 'room_plan requires a calling agent.' }
      try { return { text: await backend.commandPlan(exec.agent.session.id, args.command) } }
      catch (error) { return { text: String(error) } }
    },
  })
}

/** The slice of RoomService the help tool drives. */
export interface RoomHelpToolBackend {
  /** Ask another session for help, or write again on a thread (see RoomService.askHelp). */
  askHelp(request: { readonly sessionId: string; readonly session?: string; readonly help?: string; readonly text: string }, caller: Agent): Promise<string>
}

/**
 * Build the room_help tool definition bound to the room service.
 * @param backend - the room service.
 * @returns a registry-ready tool definition.
 */
export function roomHelpTool(backend: RoomHelpToolBackend) {
  return defineTool({
    name: 'room_help',
    description:
      'Ask another session — outside this room — for help: typically the session that built the thing you are stuck on, '
      + 'which still has the whole context. The helper keeps working in its own session (if it is busy, your request waits '
      + 'in its queue) and its final answer plus a short handoff comes back to you on its own, so end your turn after asking; '
      + 'never poll. Name the session by its title, its id, or the @ mention the human wrote. The first ask of a session the '
      + 'human did not @ in this room waits for the human\'s approval. To answer the helper\'s question or ask it more, call '
      + 'again with the help id and no session.',
    parameters: {
      session: {
        type: 'string',
        description: 'The session to ask (title, id, or @ mention). Omit when continuing a thread with help.',
      },
      help: {
        type: 'string',
        description: 'The help id of an existing thread, to answer its question or follow up.',
      },
      text: {
        type: 'string',
        required: true,
        description: 'What you need, self-contained: the helper does not see this room. Include the error, what you tried, where things are.',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) return { text: 'room_help requires a calling agent (exec.agent was undefined).' }
      return { text: await backend.askHelp({ sessionId: agent.session.id, text: args.text,
        ...args.session === undefined ? {} : { session: args.session },
        ...args.help === undefined ? {} : { help: args.help } }, agent) }
    },
  })
}
