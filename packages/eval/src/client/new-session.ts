/**
 * T97 · the doors the global 实验室 panel walks through when an action needs
 * a session. The tab always has one (its own); the panel has none, so each
 * such action opens a NEW evaluation-mode session first:
 *
 * - 「让 Agent 组织」 (新建实验) and 「让 agent 处理」 open it, write the request
 *   into its chat box and leave it there — never sent;
 * - 批准并开始 opens it WITHOUT navigating away and approves under it, because
 *   the approving session is the run's parent and its workspace the run's cwd
 *   (exactly what `/eval run` resolves inside a session).
 *
 * Every host door is probed and an absence degrades: no `sessions.create` →
 * no session (the caller falls back to the clipboard or says so), no preset
 * service → the host's default preset, no rename → an untitled session, no
 * composer → the clipboard. The new session lands where the host's own
 * 「新会话」 puts one: the most recently active workspace.
 * @module @khorsheed/dsh-eval/client
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** The pause schedule between attempts to reach a just-opened session's composer. */
export const DRAFT_RETRIES_MS = [0, 120, 300, 700, 1500, 3000] as const

/**
 * The workspace ui-workspace's 「新会话」 would pick (its private
 * `recentWorkspace` rule, mirrored): the one whose newest session moved last,
 * an empty one by its creation time, ties by the host's order.
 * @param items - the workspace list's rows.
 * @param byId - the session list's rows.
 * @returns the workspace id, or undefined when there is none.
 */
export function recentWorkspaceOf(
  items: ReadonlyArray<{ workspaceId: string; sessionIds: readonly string[]; createdAt?: string }>,
  byId: Readonly<Record<string, { updatedAt?: number } | undefined>>,
): string | undefined {
  let selected: string | undefined
  let selectedTime = Number.NEGATIVE_INFINITY
  for (const item of items) {
    let latest = Number.NEGATIVE_INFINITY
    for (const sessionId of item.sessionIds) {
      const updated = byId[sessionId]?.updatedAt
      if (typeof updated === 'number') latest = Math.max(latest, updated)
    }
    if (latest === Number.NEGATIVE_INFINITY) latest = item.createdAt === undefined ? Number.NEGATIVE_INFINITY : Date.parse(item.createdAt)
    if (selected === undefined || latest > selectedTime) {
      selected = item.workspaceId
      selectedTime = latest
    }
  }
  return selected
}

/** The host doors, structurally (0.2.0 shapes; each one probed). */
interface SessionsDoors {
  create?: (options: { workspaceId?: string }) => Promise<SessionId>
  using?: (
    sessionId: SessionId,
    options: { source: string },
    body: (ref: { binding: { session: { rename(title: string): Promise<unknown> } } }) => Promise<unknown>,
  ) => Promise<unknown>
  open?: (sessionId: SessionId) => void
  list: { getSnapshot(): { byId: Record<string, unknown> } }
}

/** What the doors need from the rest of the client. */
export interface EvalSessionDoorsDeps {
  /**
   * Whether a preset's composition grants the eval tool row: true / false,
   * undefined when the composition is unreadable.
   */
  grants: (presetId: string) => boolean | undefined
  /** Write into a session's composer (the lab face's `insertDraft`). */
  insertDraft: (sessionId: SessionId, text: string) => boolean
  /** Put the caret there (the lab face's `focusComposer`). */
  focusComposer?: (sessionId: SessionId) => void
  /** Injected for tests; real timers otherwise. */
  sleep?: (ms: number) => Promise<void>
}

/** The two doors. */
export interface EvalSessionDoors {
  /**
   * Open a new evaluation-mode session, titled, without navigating to it.
   * @returns its id, or an error message when no session could be made.
   */
  create: (title: string) => Promise<{ ok: true; sessionId: SessionId } | { ok: false; message: string }>
  /**
   * Open a new evaluation-mode session, navigate to it and draft `text` into
   * its chat box (never sent).
   * @returns true when the text landed; false sends the caller to the clipboard.
   */
  startWith: (title: string, text: string) => Promise<boolean>
}

/**
 * Build the panel's session doors.
 * @param ctx - client root context.
 * @param deps - preset criterion and composer access.
 * @returns the doors.
 */
export function createEvalSessionDoors(ctx: Context, deps: EvalSessionDoorsDeps): EvalSessionDoors {
  const getService = ctx.get.bind(ctx) as (name: string) => unknown
  const sessions = ctx.sessions as unknown as SessionsDoors
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))

  const workspace = (): string | undefined => {
    try {
      const list = (getService('workspaces') as {
        list?: { getSnapshot(): { items: Array<{ workspaceId: string; sessionIds: readonly string[]; createdAt?: string }> } }
      } | undefined)?.list
      return recentWorkspaceOf(list?.getSnapshot().items ?? [], sessions.list.getSnapshot().byId as Record<string, { updatedAt?: number }>)
    } catch {
      return undefined
    }
  }

  // The evaluation-mode preset: keep the host's default when it already grants
  // the eval tool row (or when nothing can be read), else the first listed,
  // unbroken preset that does.
  const selectEvalPreset = async (sid: SessionId): Promise<void> => {
    const presets = getService('remote.agentPresets') as {
      list?: () => Promise<{ ok: boolean; value?: { presets: Array<{ id: string; isDefault?: boolean; broken?: unknown }> } }>
      select?: (sessionId: SessionId, presetId: string) => Promise<unknown>
    } | undefined
    if (presets?.list === undefined || presets.select === undefined) return
    try {
      const listed = await presets.list()
      if (!listed.ok || listed.value === undefined) return
      const rows = listed.value.presets.filter(row => row.broken === undefined || row.broken === false)
      const fallback = rows.find(row => row.isDefault === true)
      if (fallback !== undefined && deps.grants(fallback.id) !== false) return
      const target = rows.find(row => deps.grants(row.id) === true)
      if (target !== undefined) await presets.select(sid, target.id)
    } catch { /* the default preset still opens; the lab tab may simply hide there */ }
  }

  const create: EvalSessionDoors['create'] = async (title) => {
    if (sessions.create === undefined) return { ok: false, message: 'sessions.create' }
    let created: SessionId
    try {
      const workspaceId = workspace()
      created = await sessions.create(workspaceId === undefined ? {} : { workspaceId })
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
    await selectEvalPreset(created)
    try {
      await sessions.using?.(created, { source: 'workspaceOperation' }, ref => ref.binding.session.rename(title))
    } catch { /* an untitled session still works */ }
    return { ok: true, sessionId: created }
  }

  const open = (sid: SessionId): boolean => {
    const nav = getService('uiWorkspace') as { openSession?: (target: SessionId) => void } | undefined
    try {
      if (nav?.openSession !== undefined) nav.openSession(sid)
      else if (sessions.open !== undefined) sessions.open(sid)
      else return false
      return true
    } catch {
      return false
    }
  }

  const startWith: EvalSessionDoors['startWith'] = async (title, text) => {
    const made = await create(title)
    if (!made.ok || !open(made.sessionId)) return false
    // The composer mounts with the session view; try until it is there.
    for (const pause of DRAFT_RETRIES_MS) {
      if (pause > 0) await sleep(pause)
      if (deps.insertDraft(made.sessionId, text)) {
        deps.focusComposer?.(made.sessionId)
        return true
      }
    }
    return false
  }

  return { create, startWith }
}
