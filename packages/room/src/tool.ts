/**
 * The `room_invite` model-facing tool: the main agent's invitation path into
 * the room it belongs to. Gated at execute time — the calling agent's
 * session must be a room (the journal carries `room/created`); anywhere else
 * the tool answers with readable error text instead of throwing, so the model
 * can see the rejection and (for name collisions) retry with another name.
 * Success lands in the same invite path as the human dialog
 * (`invitedBy: 'agent'`), producing an identical member record.
 * @module @khorsheed/dsh-room/tool
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { isRoomLog } from './journal.ts'
import type { RoomInviteRequest, RoomInviteResult } from './types.ts'

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
      'Invite a CLI agent member into the current room (only usable inside a room session). '
      + 'The member becomes @-addressable by the human and by other members: pick a short unique '
      + 'name (no whitespace, no "@", e.g. ada/bill/cathy) — it is the addressing name, decoupled '
      + 'from the provider so two instances of one provider can coexist. The instructions are the '
      + 'member\'s role briefing, prepended to its first dispatch and persisted in its own CLI '
      + 'session from then on. Give a firstTask to put the member to work immediately, or omit it '
      + 'to have the member join idle.',
    parameters: {
      provider: {
        type: 'string',
        required: true,
        description: 'The local-agent CLI provider id (e.g. kimi / claude-code / codex).',
      },
      name: {
        type: 'string',
        required: true,
        description: 'The member\'s @-addressing name: unique in this room, no whitespace, no "@".',
      },
      instructions: {
        type: 'string',
        required: true,
        description: 'The member\'s role instructions (responsibilities, constraints, output expectations).',
      },
      firstTask: {
        type: 'string',
        description: 'Optional first task, dispatched to the member as soon as it joins.',
      },
      cwd: {
        type: 'string',
        description: 'Optional working directory for the member (empty: inherits the room session\'s cwd).',
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
      if (!isRoomLog(agent.session.events)) {
        return { text: 'The current session is not a room; room_invite is only usable inside a room session.' }
      }
      const result = await backend.inviteMember({
        sessionId: agent.session.id,
        provider: args.provider,
        name: args.name,
        instructions: args.instructions,
        ...args.firstTask === undefined ? {} : { firstTask: args.firstTask },
        ...args.cwd === undefined ? {} : { cwd: args.cwd },
      }, 'agent')
      if (!result.ok) {
        const hint = result.error.code === 'duplicate-name'
          ? ' Pick a different name and retry.'
          : result.error.code === 'invalid-name'
            ? ' Names must be non-empty and free of whitespace and "@"; retry with a valid name.'
            : result.error.code === 'local-agent-unavailable'
              ? ' The local-agent delegation facade is not mounted; CLI members cannot join right now.'
              : ''
        return { text: `Could not invite "${args.name}": ${result.error.code}.${hint}` }
      }
      return {
        text: result.value.pendingFirstTask
          ? `Member ${result.value.name} joined the room and its first task was dispatched.`
          : `Member ${result.value.name} joined the room (idle; @-address it to dispatch work).`,
      }
    },
  })
}
