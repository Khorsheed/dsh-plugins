/**
 * The model-facing `worktrees` tool. Within one session the model can list /
 * switch / create / remove git worktrees; switching (and creating) sets the
 * session's active-worktree override so the badge/drawer follow, and removing
 * (with `confirm: true`) clears an override if it pointed at the removed
 * worktree. The tool is a thin adapter over the same `ctx.worktrees` service
 * core the Remote data face uses — no logic is duplicated here.
 *
 * @module @khorsheed/dsh-worktrees
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

/**
 * Tag model-visible tools with their origin (AGENTS.md § Tool origin tagging;
 * seam S12): the capability catalog reads this `Symbol.for`-keyed tag back
 * through `ctx.tools.get()`, so the `worktrees` tool attributes to this plugin
 * (channel `plugin`) instead of falling back to heuristics. The tag is
 * host-side only and never travels on the model wire. The generic form (not
 * `typeof defineTool`) keeps typert from raising TS2321 on the helper.
 */
const definePluginTool = <T extends object>(def: T): T =>
  Object.assign(def, {
    [Symbol.for('dsh.tool.origin')]: { channel: 'plugin', owner: '@khorsheed/dsh-worktrees' },
  })

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
 * Register the model-facing `worktrees` tool.
 * @param ctx - the Cordis context (must already carry `ctx.worktrees`).
 * @returns whether the tool was registered (false when the tools registry is
 *   absent — a badge/drawer-only degrade).
 */
export function registerWorktreesTool(ctx: Context): boolean {
  // Probe the tools registry via ctx.get (property access `ctx.tools` requires
  // the plugin to declare `inject: ['tools']`, which would make a composition
  // without the tools bundle pend the WHOLE plugin). Probing lets the tool be
  // skipped while the badge/drawer still mount.
  const tools = ctx.get?.('tools') as { register: (definition: ReturnType<typeof defineTool>) => unknown } | undefined
  if (tools === undefined) return false
  tools.register(definePluginTool(defineTool({
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
      const service = ctx.worktrees
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
  })))
  return true
}
