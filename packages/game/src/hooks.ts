/**
 * The end-of-turn loop (proposal §6, probes P0-4/P0-5): when a turn that is
 * bound to a game project is about to close, run the checks on what it
 * changed. A failure is steered back into the SAME turn with the findings —
 * at most {@link FIX_CAP} times — and a pass deploys into the play area (or
 * leaves a candidate when auto-confirm is off).
 *
 * `agent/turn-stopping` fires only for a turn completing normally (never on
 * abort or error), so a user's stop is never overridden. Sessions with no
 * bound project are untouched, which is what keeps the hook inert outside the
 * game preset: only `game_open` binds.
 * @module @khorsheed/dsh-game
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type ContextFormed } from '@deepseek-ai/dsh-llm'
import type { GameService, TurnBaseline } from './store.ts'
import { PANEL_CHANGES_MARK, type CheckRecord } from './types.ts'

/** What a dsh-game message is, for the chat row (the text is for the model). */
export type GameMessageOp =
  | { readonly op: 'check-failed'; readonly attempt: number; readonly cap: number; readonly failures: readonly { where: string; message: string }[] }
  | { readonly op: 'attached'; readonly items: readonly string[] }

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A message the game plugin put into the conversation (check findings, attached changes). */
    'dsh-game': { kind: 'dsh-game'; plugin: '@khorsheed/dsh-game' } & ContextFormed & Partial<GameMessageOp>
  }
}

/** Build a dsh-game user message. */
export function gameMessage(text: string, section: string, op: GameMessageOp) {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'dsh-game', plugin: '@khorsheed/dsh-game', form: 'snapshot', sections: [{ name: section, text }], ...op },
  })
}

/** Automatic fix rounds per turn (decision: at most 2). */
export const FIX_CAP = 2

/** The steer text for one failed check (model-facing). */
export function failureText(record: CheckRecord, attempt: number): string {
  const lines = [
    `[游戏检查未通过 ${attempt}/${FIX_CAP}] 这一轮改完的版本没过检查，试玩区还停在上一个版本。`,
    ...record.failures.slice(0, 8).map(f => `- ${f.where}：${f.message}`),
  ]
  if (record.failures.length > 8) lines.push(`- ……另有 ${record.failures.length - 8} 项`)
  if (record.skipped !== undefined) lines.push(`（${record.skipped}）`)
  lines.push(
    attempt < FIX_CAP
      ? '请修好再结束这一轮：先读报错对应的代码，改完不用告诉我，结束时会自动重新检查。若是测试本身写错了，改测试并说明理由。'
      : '这是最后一次自动修复机会；修不好就如实告诉用户卡在哪里。',
  )
  return lines.join('\n')
}

/**
 * Register the hooks on the plugin's scope.
 * @param ctx - the core plugin's context.
 * @param store - the service core.
 */
export function registerTurnHooks(ctx: Context, store: GameService): void {
  /** Steers already sent, per `<session>:<turn>`. */
  const steered = new Map<string, number>()

  ctx.on('agent/turn-stopping', async ({ agent, turn, signal }: { agent: Agent; turn: number; signal: AbortSignal }) => {
    if (signal.aborted) return
    const key = `${agent.session.id}:${turn}`
    const attempt = steered.get(key) ?? 0
    let outcome
    try {
      outcome = await store.checkTurn(agent.session, attempt, FIX_CAP)
    } catch (error) {
      ctx.logger.warn('game: end-of-turn check failed to run', error)
      return
    }
    if (outcome.kind !== 'fail' || signal.aborted) return
    if (attempt >= FIX_CAP) return
    steered.set(key, attempt + 1)
    const text = failureText(outcome.record, attempt + 1)
    agent.steer(gameMessage(text, 'checks', {
      op: 'check-failed', attempt: attempt + 1, cap: FIX_CAP,
      failures: outcome.record.failures.slice(0, 8).map(f => ({ where: f.where, message: f.message.slice(0, 300) })),
    }))
  })

  // Panel changes are sent explicitly (2026-10-10, replacing the automatic
  // attach): the dock writes them into the composer and the user sends. When
  // such a message enters a step, the changes it lists stop being pending.
  // The batch itself is never touched.
  ctx.on('agent/pre-step', async ({ agent, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted || decision.messages.length === 0) return decision
    const text = decision.messages
      .map(m => m.content.map(block => (block.type === 'text' ? block.text : '')).join('\n'))
      .join('\n')
    if (text.includes(PANEL_CHANGES_MARK)) {
      await store.clearSent(agent.session.id, text).catch((error: unknown) => {
        ctx.logger.warn('game: could not clear sent panel changes', error)
      })
    }
    return decision
  }, { prepend: true })

  // Turn reports: snapshot the bound project when a turn starts, record what
  // it changed when the turn ends (whatever its reason), for the turn-tail card.
  const baselines = new Map<string, Promise<TurnBaseline | undefined>>()
  ctx.on('session/event', (session, raw) => {
    const event = raw as unknown as { type?: string; turn?: number; data?: { turn?: number } }
    const turn = event?.data?.turn ?? event?.turn
    if (event?.type === 'turn/start') store.setTurnActive(session.id, true)
    if (event?.type === 'turn/end') store.setTurnActive(session.id, false)
    if (event?.type === 'turn/start' && turn !== undefined) {
      baselines.set(`${session.id}:${turn}`, store.turnBaseline(session.id).catch(() => undefined))
      return
    }
    if (event?.type !== 'turn/end') return
    if (turn !== undefined) {
      steered.delete(`${session.id}:${turn}`)
      const key = `${session.id}:${turn}`
      const base = baselines.get(key)
      baselines.delete(key)
      if (base !== undefined) {
        void base.then(b => (b === undefined ? undefined : store.recordTurn(session.id, turn, b)))
          .catch((error: unknown) => { ctx.logger.warn('game: could not record the turn report', error) })
      }
    } else for (const key of steered.keys()) if (key.startsWith(`${session.id}:`)) steered.delete(key)
  })
}
