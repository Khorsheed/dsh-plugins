/**
 * The room's model-facing tools, `room_invite` and `room_task`: the main
 * agent's paths into the room it belongs to. Both are gated at execute time —
 * the calling agent's session must be a room (the journal carries
 * `room/created`); anywhere else the tool answers with readable error text
 * instead of throwing, so the model can see the rejection and self-correct.
 * `room_invite` lands in the same invite path as the human dialog
 * (`invitedBy: 'agent'`), producing an identical member record; `room_task`
 * writes the SHARED task board through the very host functions the capsule UI
 * uses (addTask/closeTask, plus the tool-only updateTask), so an agent-written
 * task is indistinguishable from a human-added one.
 * @module @khorsheed/dsh-room/tool
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { isRoomLog } from './journal.ts'
import type {
  RoomAddTaskRequest, RoomAddTaskResult,
  RoomCloseTaskRequest, RoomCloseTaskResult,
  RoomGetStateRequest, RoomGetStateResult,
  RoomInviteRequest, RoomInviteResult,
  RoomUpdateTaskRequest, RoomUpdateTaskResult,
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
      'Invite a CLI agent member into the current room (only usable inside a room session). '
      + 'The member becomes @-addressable by the human and by other members: pick a short unique '
      + 'name (no whitespace, no "@", e.g. ada/bill/cathy) — it is the addressing name, decoupled '
      + 'from the provider so two instances of one provider can coexist. The instructions are the '
      + 'member\'s role briefing, prepended to its first dispatch and persisted in its own CLI '
      + 'session from then on. Give a firstTask to put the member to work immediately, or omit it '
      + 'to have the member join idle. The provider must be a registered delegation provider id — '
      + 'an unknown one is rejected with the list of available ids, so retry with one of those.',
    parameters: {
      provider: {
        type: 'string',
        required: true,
        description:
          'The local-agent delegation provider id (e.g. kimi-cli / codex-cli / claude-code) — the '
          + 'delegation id the family registered, which may differ from the harness\'s display '
          + 'name. When unsure, call without firstTask first: an unknown id is rejected with the '
          + 'list of available providers to retry with.',
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
              : result.error.code === 'unknown-provider'
                ? ` Unknown delegation provider "${result.error.provider}" (it must be the family's delegation provider id, not the harness's display name). Available: ${
                  result.error.available.length === 0
                    ? 'none (no harness with a delegation provider is registered)'
                    : result.error.available.join(', ')
                }. Retry with one of the available providers.`
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

/** The slice of RoomService the room_task tool drives. */
export interface RoomTaskToolBackend {
  /** Open a pending task on a member's lane (see RoomService.addTask). */
  addTask(request: RoomAddTaskRequest): Promise<RoomAddTaskResult>
  /** Close an open task (see RoomService.closeTask). */
  closeTask(request: RoomCloseTaskRequest): Promise<RoomCloseTaskResult>
  /** Edit an open task's title/blockedBy (see RoomService.updateTask). */
  updateTask(request: RoomUpdateTaskRequest): Promise<RoomUpdateTaskResult>
  /** Replay the room state (the error texts read the roster/open tasks from it). */
  getState(request: RoomGetStateRequest): Promise<RoomGetStateResult>
}

/**
 * Build the room_task tool definition bound to the room service. Every write
 * goes through the same host functions as the capsule UI, so a task the agent
 * opens is a public commitment indistinguishable from a human-added one.
 * @param backend - the room service.
 * @returns a registry-ready tool definition.
 */
export function roomTaskTool(backend: RoomTaskToolBackend) {
  return defineTool({
    name: 'room_task',
    description:
      'Manage the current room\'s SHARED task board (only usable inside a room session). This '
      + 'board is public — every room member and the human sees these tasks, so writing here is '
      + 'a public commitment the room coordinates around; for your private work plan use your own '
      + 'todo tool instead. Actions: "add" (title + member — the roster name owning the task, '
      + 'yourself "main" or any CLI member; optional blockedBy names the member the task waits '
      + 'on, display only) opens a pending task and returns its id; "close" (taskId) marks an '
      + 'open task done; "update" (taskId + a new title and/or blockedBy — null clears the wait) '
      + 'edits an open task. Errors answer with the roster or the open-task list so you can retry '
      + 'with a valid member name or task id.',
    parameters: {
      action: {
        type: 'string',
        enum: ['add', 'close', 'update'],
        required: true,
        description: 'add: open a task (title + member). close: mark a task done (taskId). update: edit title/blockedBy (taskId).',
      },
      title: {
        type: 'string',
        description: 'Task title. Required for add; optional new title for update.',
      },
      member: {
        type: 'string',
        description: 'The roster name owning the task (required for add; e.g. "main" for yourself).',
      },
      taskId: {
        type: 'string',
        description: 'The task id (required for close/update; add\'s success text returns the new id).',
      },
      blockedBy: {
        oneOf: [{ type: 'string' }, { type: 'null' }],
        description:
          'The member this task waits on (must be on the roster; display only, never an automatic '
          + 'dispatch). Optional on add; on update, a string re-targets the wait and null clears it.',
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
    // Board writes mutate only the room journal; two writes never conflict
    // beyond the validations the result text reports back.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) return { text: 'room_task requires a calling agent (exec.agent was undefined).' }
      if (!isRoomLog(agent.session.events)) {
        return { text: 'The current session is not a room; room_task is only usable inside a room session.' }
      }
      const sessionId = agent.session.id
      /** The self-correcting roster suffix: the legal member names, for member-not-found. */
      const rosterHint = async (): Promise<string> => {
        const state = await backend.getState({ sessionId })
        if (!state.ok) return ''
        const names = state.value.members.map(member => member.name)
        return names.length === 0 ? '' : ` The room roster is: ${names.join(', ')}. Retry with one of these names.`
      }
      /** The self-correcting board suffix: the open tasks (id — title), for task-not-found. */
      const openTasksHint = async (): Promise<string> => {
        const state = await backend.getState({ sessionId })
        if (!state.ok) return ''
        const open = state.value.tasks.filter(task => task.status === 'pending' || task.status === 'in_progress')
        if (open.length === 0) return ' The board has no open tasks right now.'
        return ` Open tasks: ${open.map(task => `${task.id} — "${task.title}" (${task.member}, ${task.status})`).join('; ')}. Retry with one of these ids.`
      }
      const failureText = async (code: string): Promise<string> => {
        switch (code) {
          case 'member-not-found':
            return `Unknown member.${await rosterHint()}`
          case 'empty-text':
            return 'The title must be non-blank; retry with a real title.'
          case 'task-not-found':
            return `No task with that id.${await openTasksHint()}`
          case 'task-closed':
            return 'That task is already closed (done/cancelled); closed tasks take no further changes.'
          case 'nothing-to-update':
            return 'update needs at least one field to change: a new title and/or blockedBy (null clears the wait).'
          default:
            return `The room rejected the write (${code}).`
        }
      }
      switch (args.action) {
        case 'add': {
          if (args.title === undefined || args.member === undefined) {
            return { text: 'room_task add requires both title and member (the roster name owning the task, e.g. "main" for yourself).' }
          }
          if (args.blockedBy === null) {
            return { text: 'add takes no null blockedBy — simply omit blockedBy for an unblocked task.' }
          }
          const result = await backend.addTask({
            sessionId,
            member: args.member,
            title: args.title,
            ...args.blockedBy === undefined ? {} : { blockedBy: args.blockedBy },
          })
          if (!result.ok) return { text: `Could not add the task: ${result.error.code}. ${await failureText(result.error.code)}` }
          return {
            text: `Task "${args.title}" is now on ${args.member}'s lane of the shared room board `
              + `(id: ${result.value.id}) — visible to every member and the human. `
              + 'Keep the id to update or close the task later.',
          }
        }
        case 'close': {
          if (args.taskId === undefined) {
            return { text: `room_task close requires taskId.${await openTasksHint()}` }
          }
          const result = await backend.closeTask({ sessionId, taskId: args.taskId })
          if (!result.ok) return { text: `Could not close the task: ${result.error.code}. ${await failureText(result.error.code)}` }
          return { text: `Task ${result.value.id} is done — the shared board shows it closed.` }
        }
        case 'update': {
          if (args.taskId === undefined) {
            return { text: `room_task update requires taskId.${await openTasksHint()}` }
          }
          const result = await backend.updateTask({
            sessionId,
            taskId: args.taskId,
            ...args.title === undefined ? {} : { title: args.title },
            ...args.blockedBy === undefined ? {} : { blockedBy: args.blockedBy },
          })
          if (!result.ok) return { text: `Could not update the task: ${result.error.code}. ${await failureText(result.error.code)}` }
          return { text: `Task ${result.value.id} updated on the shared room board.` }
        }
      }
    },
  })
}
