/**
 * The model-facing `worktrees` tool DEFINITION. Since the tool-row split the
 * core package no longer registers the tool itself: the companion
 * `@khorsheed/dsh-worktrees-tool` consumes {@link defineWorktreesTool} and
 * mounts it inside agent-preset compositions, so the capability is granted
 * per session (the tool row only ever lives in a preset, never at the
 * profile root). The definition stays here, beside the service core it
 * adapts — a thin adapter over the same `ctx.worktrees` service the Remote
 * data face uses, no logic duplicated.
 *
 * @module @khorsheed/dsh-worktrees
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { WorktreesService } from './service.ts'

/** Parsed arguments of the `worktrees` tool. */
interface WorktreesToolArgs {
  action: 'list' | 'switch' | 'create' | 'remove'
  path?: string
  branch?: string
  confirm?: boolean
}

const description = 'Manage the session\'s git worktrees. '
  + '`list` shows the repository\'s worktrees (path, branch, main?, dirty, stale). '
  + '`switch <path>` makes the session\'s badge/drawer follow that worktree. '
  + '`create <path> [-b <branch>]` creates a git worktree (`git worktree add`) and switches to it. '
  + '`remove <path>` (confirm:true) removes a worktree — ALWAYS confirm with the user first '
  + '(ask via the `ask_user_question` tool if it is available in this session, otherwise ask them '
  + 'in the conversation), and never remove the main worktree or a worktree with uncommitted changes.'

/**
 * Build the model-facing `worktrees` tool definition over one service core.
 * Within one session the model can list / switch / create / remove git
 * worktrees; switching (and creating) sets the session's active-worktree
 * override so the badge/tab follow, and removing (with `confirm: true`)
 * clears an override if it pointed at the removed worktree.
 *
 * The definition is returned UNTAGGED: the registering package applies its
 * own tool-origin tag (AGENTS.md § Tool origin tagging — the owner is
 * whichever package mounts the row).
 * @param service - the worktrees service core (the global `ctx.worktrees`
 *   the core package provides at the profile root).
 * @returns the tool definition, ready for `ctx.tools.register`.
 */
export function defineWorktreesTool(service: WorktreesService) {
  return defineTool({
    name: 'worktrees',
    description,
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['list', 'switch', 'create', 'remove'],
        description: 'What to do: list, switch, create, or remove a worktree.',
      },
      path: {
        type: 'string',
        description: 'Worktree directory. Required for switch/create/remove; ignored for list.',
      },
      branch: {
        type: 'string',
        description: 'Branch to create for `create`. Omit to checkout the base branch.',
      },
      confirm: {
        type: 'boolean',
        description: 'Must be true for `remove` (the caller confirmed with the user).',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: WorktreesToolArgs, exec): Promise<string> {
      if (exec.agent === undefined) return JSON.stringify({ error: 'worktrees: no session agent' })
      const sessionId = exec.agent.id
      const cwd = exec.agent.session.header.cwd ?? ''
      if (cwd === '') return JSON.stringify({ error: 'worktrees: session has no working directory' })
      try {
        switch (args.action) {
          case 'list': {
            const worktrees = await service.listWorktrees(cwd)
            return JSON.stringify({ ok: true, worktrees })
          }
          case 'switch': {
            if (args.path === undefined || args.path === '') return JSON.stringify({ error: 'worktrees: switch requires a path' })
            const info = await service.switchWorktree(sessionId, cwd, args.path)
            return JSON.stringify({ ok: true, active: info })
          }
          case 'create': {
            if (args.path === undefined || args.path === '') return JSON.stringify({ error: 'worktrees: create requires a path' })
            const info = await service.createWorktree(sessionId, cwd, args.path, args.branch)
            return JSON.stringify({ ok: true, created: info })
          }
          case 'remove': {
            if (args.path === undefined || args.path === '') return JSON.stringify({ error: 'worktrees: remove requires a path' })
            const result = await service.removeWorktree(sessionId, cwd, args.path, args.confirm === true)
            return JSON.stringify({ ok: true, removed: args.path, switchedTo: result.switchedTo })
          }
          default:
            return JSON.stringify({ error: `worktrees: unknown action ${String(args.action)}` })
        }
      } catch (error) {
        return JSON.stringify({ error: `worktrees: ${error instanceof Error ? error.message : String(error)}` })
      }
    },
  })
}
