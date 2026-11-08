/**
 * A member CLI's own subagents in the member session (member-cli-subagents
 * M5; UI source of truth: proposals/prototypes/member-activity.html, the
 * 「成员会话」 group and 「运行卡片 · 正在等子智能体」): the `Agent` /
 * `AgentSwarm` / `Task` call row becomes a live card in the shared card
 * shell (MemberActivity.tsx) — spinner and running clock, the latest step on
 * a second line, 「展开」 = its ordered steps, 「打开」 = the mirrored
 * grandchild session. An `AgentSwarm` call is one group card with a row per
 * subagent. A settled call without a grandchild reads 「暂不支持查看过程」.
 * Outside a member session (local-agent answers null, or nothing is read)
 * the row is a plain tool row, the host's generic shape.
 *
 * The room run card's 「正在等子智能体：探索 · 6 分钟」 reads the same store.
 *
 * Data: local-agent's `memberSubagentCalls` read, duck-typed through the
 * room's gateway probe, one read per member session shared by every card of
 * that session, polled on the room's 4 s cadence only while a card or run
 * row still changes.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import type { LocalAgentSubagentCall, LocalAgentSubagentCalls, LocalAgentSubagentStep } from '@khorsheed/dsh-local-agent/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { formatTokens } from './RoomStatsLine.tsx'
import { ActivityCardShell, StatusPill, type ActivityReveals } from './MemberActivity.tsx'
import { durationParts, type ActivityItem, type ActivityStatus } from './member-activity-view.ts'
import {
  cardWantsPolling, foregroundWait, groupRows, subagentCardModel, totalTokens,
  type SubagentCallFacts, type SubagentEntry, type TokenUsage,
} from './subagent-card-view.ts'
import css from './MemberActivity.module.css'

type T = TranslateNS<'room'>

/** The member read the store polls (local-agent's Remote, duck-typed). */
export type SubagentCallsRead = (childSessionId: string) => Promise<LocalAgentSubagentCalls | null | undefined>

interface Entry {
  value: LocalAgentSubagentCalls | null | undefined
  reads: number
  lastAt: number
  timer: ReturnType<typeof setInterval> | undefined
  inFlight: boolean
  readonly wants: Set<() => boolean>
}

/**
 * Shared reads per member session. A follower says whether it still needs
 * fresh reads; the entry reads now (when it has nothing recent) and then on
 * the cadence while any follower wants it. The last unfollow stops the timer.
 */
export class SubagentCallsStore {
  private readonly entries = new Map<string, Entry>()
  private readonly listeners = new Set<() => void>()
  private version = 0

  constructor(private readonly read: SubagentCallsRead, private readonly intervalMs = 4_000) {}

  /** Follow one member session while `wants()` keeps answering true. */
  follow(id: string, wants: () => boolean): () => void {
    let entry = this.entries.get(id)
    if (entry === undefined) this.entries.set(id, entry = { value: undefined, reads: 0, lastAt: 0, timer: undefined, inFlight: false, wants: new Set() })
    const current = entry
    current.wants.add(wants)
    if (current.reads === 0 || Date.now() - current.lastAt >= this.intervalMs) void this.pull(id)
    current.timer ??= setInterval(() => {
      if ([...current.wants].some(want => want())) void this.pull(id)
    }, this.intervalMs)
    return () => {
      current.wants.delete(wants)
      if (current.wants.size > 0 || current.timer === undefined) return
      clearInterval(current.timer)
      current.timer = undefined
    }
  }

  /** The member's latest read (undefined before the first one lands). */
  get(id: string): LocalAgentSubagentCalls | null | undefined {
    return this.entries.get(id)?.value
  }

  /** How many reads of the member landed. */
  reads(id: string): number {
    return this.entries.get(id)?.reads ?? 0
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getVersion = (): number => this.version

  private async pull(id: string): Promise<void> {
    const entry = this.entries.get(id)
    if (entry === undefined || entry.inFlight) return
    entry.inFlight = true
    let value: LocalAgentSubagentCalls | null | undefined
    try {
      value = await this.read(id)
    } catch {
      value = undefined
    } finally {
      entry.inFlight = false
    }
    entry.reads += 1
    entry.lastAt = Date.now()
    const changed = JSON.stringify(entry.value) !== JSON.stringify(value)
    entry.value = value
    // The read count is part of what a card decides on (a settled call with no record).
    this.version += 1
    if (changed || entry.reads <= 3) for (const listener of this.listeners) listener()
  }
}

/** What the subagent cards and the run row are injected with. */
export interface SubagentCardsFace {
  readonly store: SubagentCallsStore
  readonly reveals: ActivityReveals
  /** Open a grandchild session (the right sidebar's subagent chat; the whole page on a phone). */
  readonly open: (grandchildSessionId: string, memberSessionId: string) => void
}

/* ------------------------------------------------------------- copy */

/** A running clock: 1:12, 1:02:05. */
export function runningClock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = String(seconds % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** The subagent type's name: 探索 / 编写 / 通用 …, the CLI's own word otherwise. */
export function subagentTypeName(type: string | undefined, t: T): string {
  if (type === undefined) return t('sub.type.default')
  const key = `sub.type.${type}`
  const named = (t as unknown as (key: string) => string)(key)
  return named === key ? type : named
}

function usageText(usage: TokenUsage | undefined, status: ActivityStatus, t: T): string | undefined {
  if (usage === undefined) return undefined
  if (status === 'running') return t('sub.usage.used', { total: formatTokens(totalTokens(usage)) })
  const input = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
  const cache = usage.cacheReadTokens ?? 0
  return cache > 0
    ? t('sub.usage.splitCache', { input: formatTokens(input), cache: formatTokens(cache), output: formatTokens(usage.outputTokens) })
    : t('sub.usage.split', { input: formatTokens(input), output: formatTokens(usage.outputTokens) })
}

/** The status pill: a running subagent reads its clock (the host's run card), every other state the shared words. */
function SubagentPill({ item, now, t }: { readonly item: ActivityItem; readonly now: number; readonly t: T }): ReactNode {
  if (item.status !== 'running') return <StatusPill item={item} now={now} t={t} />
  return (
    <span className={css.pill} data-status="running">
      <span className={css.dot} aria-hidden />
      {t('sub.status.running', { time: runningClock(now - item.startedAt) })}
    </span>
  )
}

function stepSeconds(ms: number | undefined, t: T): string {
  return ms === undefined ? '' : t('sub.step.seconds', { s: (ms / 1000).toFixed(1) })
}

/** One step's words (the tool's name and recognized argument in mono). */
function stepText(step: LocalAgentSubagentStep): ReactNode {
  if (step.kind === 'tool') return <span className={css.mono}>{step.summary === undefined ? step.name : `${step.name} ${step.summary}`}</span>
  return step.text ?? ''
}

/** The second line of a running card: what the subagent did last. */
function latestLine(call: LocalAgentSubagentCall): ReactNode | undefined {
  const last = call.steps.at(-1)
  if (last === undefined || (last.kind === 'request' && last.text === undefined)) return undefined
  return stepText(last)
}

/** The ordered steps (the expanded single card). */
export function SubagentSteps({ call, t }: { readonly call: LocalAgentSubagentCall; readonly t: T }): ReactNode {
  return (
    <div className={css.steps} data-testid="subagent-steps">
      {call.stepsOmitted !== undefined && <div className={css.more}>{t('sub.step.omitted', { count: String(call.stepsOmitted) })}</div>}
      {call.steps.map((step, index) => {
        const latest = call.state === 'running' && index === call.steps.length - 1
        return (
          <div
            key={index}
            className={css.step}
            data-step={step.kind}
            {...latest ? { 'data-latest': '' } : {}}
            {...step.kind === 'tool' && step.failed === true ? { 'data-failed': '' } : {}}
          >
            <span className={css.stepKind}>
              {step.kind === 'request' ? t('sub.step.request', { n: String(step.index) }) : step.kind === 'tool' ? t('sub.step.tool') : t('sub.step.reply')}
            </span>
            <span className={css.stepText}>{stepText(step)}</span>
            {step.kind !== 'reply' && <span className={css.stepTime}>{stepSeconds(step.durationMs, t)}</span>}
          </div>
        )
      })}
    </div>
  )
}

/** Re-render each second while something runs. */
function useTicker(running: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return undefined
    const timer = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [running])
  return running ? Math.max(now, Date.now()) : Date.now()
}

/** Scroll the card into view when the run row (「看子智能体」) asked for it. */
function useReveal(reveals: ActivityReveals | undefined, callId: string): RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (reveals?.take(callId) === undefined) return
    requestAnimationFrame(() => { ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }) })
  }, [reveals, callId])
  return ref
}

/* ------------------------------------------------------------- cards */

/** One subagent: collapsed to a line (plus the latest step while running); 「展开」 its steps. */
export function SubagentCard({ entry, background, memberSessionId, face, t }: {
  readonly entry: SubagentEntry
  readonly background: boolean
  readonly memberSessionId: string
  readonly face: Pick<SubagentCardsFace, 'open'>
  readonly t: T
}): ReactNode {
  const { call, item } = entry
  const [open, setOpen] = useState(false)
  const now = useTicker(call.state === 'running')
  const tag = background ? t('sub.tag.background') : call.ordinal > 1 ? t('sub.tag.resumed', { n: String(call.ordinal) }) : undefined
  // The prototype keeps the latest step under the head while expanded too.
  const line = call.state === 'cancelled' ? t('sub.line.cancelled')
      : call.state === 'lost' ? t('sub.line.lost')
        : call.state === 'running' ? latestLine(call) : undefined
  const usage = usageText(call.usage, call.state, t)
  return (
    <ActivityCardShell
      item={item}
      kindLabel={subagentTypeName(call.name, t)}
      now={now}
      t={t}
      spin={call.state === 'running'}
      {...tag === undefined ? {} : { tag }}
      {...usage === undefined ? {} : { usage }}
      status={<SubagentPill item={item} now={now} t={t} />}
      line={line}
      rows={open && call.steps.length > 0 ? <SubagentSteps call={call} t={t} /> : undefined}
      actions={(
        <>
          {call.steps.length > 0 && (
            <button type="button" className={css.link} aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
              {open ? t('sub.action.collapse') : t('sub.action.expand')}
            </button>
          )}
          <button type="button" className={css.link} onClick={() => { face.open(call.sessionId, memberSessionId) }}>{t('sub.action.open')}</button>
        </>
      )}
    />
  )
}

/** An `AgentSwarm` call: one card, a row per subagent (expanded by default), each one openable. */
export function SubagentGroupCard({ model, memberSessionId, face, t }: {
  readonly model: Extract<ReturnType<typeof subagentCardModel>, { kind: 'group' }>
  readonly memberSessionId: string
  readonly face: Pick<SubagentCardsFace, 'open'>
  readonly t: T
}): ReactNode {
  const [open, setOpen] = useState(true)
  const now = useTicker(model.status === 'running')
  const first = model.entries[0]!
  const item: ActivityItem = { ...first.item, id: `${first.call.callId}:group`, label: model.description ?? '', status: model.status }
  const summary = (['done', 'running', 'failed', 'cancelled', 'lost'] as const)
    .flatMap(status => model.counts[status] > 0 ? [t(`sub.group.${status}`, { count: String(model.counts[status]) })] : [])
    .join(' · ')
  const { shown, more } = groupRows(model.entries)
  return (
    <ActivityCardShell
      item={item}
      kindLabel={t('sub.group', { count: String(model.entries.length) })}
      now={now}
      t={t}
      icon="◇◇"
      {...model.usage === undefined ? {} : { usage: t('sub.usage.total', { total: formatTokens(totalTokens(model.usage)) }) }}
      status={(
        <span className={css.pill} data-status={model.status}>
          {model.status === 'running' && <span className={css.dot} aria-hidden />}
          {model.status === 'running' ? `${t('sub.status.pending')} · ${summary}` : summary}
        </span>
      )}
      rows={open ? (
        <div className={css.rows} data-testid="subagent-rows">
          {shown.map((entry, index) => (
            <div key={entry.item.id} className={css.row}>
              <span className={css.rowIndex}>{index + 1}</span>
              <b>{subagentTypeName(entry.call.name, t)}</b>
              <span className={css.desc} title={entry.item.label}>{entry.item.label}</span>
              <SubagentPill item={entry.item} now={now} t={t} />
              <button type="button" className={css.link} onClick={() => { face.open(entry.call.sessionId, memberSessionId) }}>{t('sub.action.open')}</button>
            </div>
          ))}
          {more > 0 && <div className={css.more}>{t('sub.group.more', { count: String(more) })}</div>}
        </div>
      ) : undefined}
      actions={(
        <button type="button" className={css.link} aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
          {open ? t('sub.action.collapse') : t('sub.action.expand')}
        </button>
      )}
    />
  )
}

/** A card with no grandchild behind it: running (no record yet) or 「暂不支持查看过程」. */
export function SubagentStubCard({ kind, type, description, background = false, startedAt, t }: {
  readonly kind: 'pending' | 'unsupported'
  readonly type?: string | undefined
  readonly description?: string | undefined
  readonly background?: boolean
  readonly startedAt?: number | undefined
  readonly t: T
}): ReactNode {
  const running = kind === 'pending'
  const now = useTicker(running && startedAt !== undefined)
  const item: ActivityItem = {
    id: `stub:${type ?? ''}:${description ?? ''}`, member: '', childSessionId: '', kind: 'subagent',
    label: description ?? '', status: running ? 'running' : 'cancelled', startedAt: startedAt ?? now,
  }
  return (
    <ActivityCardShell
      item={item}
      kindLabel={subagentTypeName(type, t)}
      now={now}
      t={t}
      spin={running}
      {...running && background ? { tag: t('sub.tag.background') } : {}}
      status={(
        <span className={css.pill} data-status={running ? 'running' : 'cancelled'}>
          {running && <span className={css.dot} aria-hidden />}
          {running
            ? startedAt === undefined ? t('sub.status.pending') : t('sub.status.running', { time: runningClock(now - startedAt) })
            : t('sub.status.unsupported')}
        </span>
      )}
    />
  )
}

/* ------------------------------------------------------------- the toolview */

/** A tool block as `tool.call.toolview` hands it (structural). */
interface ToolBlockLike {
  readonly time?: number
  readonly argsRaw?: string
  readonly callTime?: number | null
  readonly call?: { readonly argsRaw?: string } | null
  readonly content?: readonly { readonly type?: string; readonly text?: string }[]
  readonly isError?: boolean
}

/** The owner props this toolview reads (ui-tool's ToolCallOwnerProps, structurally) plus the injected face. */
export interface SubagentToolViewProps {
  readonly callId: string
  readonly toolName: string
  readonly phase: 'preparing' | 'start' | 'result'
  readonly block: ToolBlockLike
  readonly sessionId: string
  readonly subagents: SubagentCardsFace
  readonly t: T
}

/** The facts the card takes from its tool row. */
export function toolFacts(props: Pick<SubagentToolViewProps, 'callId' | 'toolName' | 'phase' | 'block'>): SubagentCallFacts {
  const { block } = props
  const argsRaw = props.phase === 'result' ? block.call?.argsRaw : block.argsRaw
  const startedAt = props.phase === 'result' ? block.callTime ?? undefined : block.time
  return {
    callId: props.callId,
    toolName: props.toolName,
    phase: props.phase,
    ...argsRaw === undefined ? {} : { argsRaw },
    ...startedAt === undefined ? {} : { startedAt },
  }
}

/** The plain row (the host's generic shape) for a call outside a member session. */
function PlainToolRow({ toolName, facts }: { readonly toolName: string; readonly facts: SubagentCallFacts }): ReactNode {
  let summary: string | undefined
  try {
    const args = JSON.parse(facts.argsRaw ?? '') as Record<string, unknown>
    summary = typeof args['description'] === 'string' ? args['description'] : undefined
  } catch {
    summary = undefined
  }
  return (
    <div className={css.plain} data-testid="subagent-plain-row">
      <span aria-hidden>✦</span>
      <b>{toolName}</b>
      {summary !== undefined && <span className={css.plainSummary}>{summary}</span>}
    </div>
  )
}

/** The `Agent` / `AgentSwarm` / `Task` row in a member session. */
export function SubagentToolView(props: SubagentToolViewProps): ReactNode {
  const { sessionId, subagents, t } = props
  const facts = toolFacts(props)
  useSyncExternalStore(subagents.store.subscribe, subagents.store.getVersion, subagents.store.getVersion)
  const model = subagentCardModel(facts, subagents.store.get(sessionId), sessionId)
  const wants = useRef<() => boolean>(() => false)
  wants.current = () => cardWantsPolling(model, facts, subagents.store.reads(sessionId))
  useEffect(() => subagents.store.follow(sessionId, () => wants.current()), [subagents.store, sessionId])
  const ref = useReveal(subagents.reveals, props.callId)
  let card: ReactNode
  switch (model.kind) {
    case 'fallback': return <PlainToolRow toolName={props.toolName} facts={facts} />
    case 'pending':
      card = <SubagentStubCard kind="pending" type={model.type} description={model.description} background={model.background} startedAt={model.startedAt} t={t} />
      break
    case 'unsupported':
      card = <SubagentStubCard kind="unsupported" type={model.type} description={model.description} t={t} />
      break
    case 'single':
      card = <SubagentCard entry={model.entry} background={model.background} memberSessionId={sessionId} face={subagents} t={t} />
      break
    case 'group':
      card = <SubagentGroupCard model={model} memberSessionId={sessionId} face={subagents} t={t} />
      break
  }
  return <div ref={ref} data-subagent-call={props.callId}>{card}</div>
}

/* ------------------------------------------------------------- the room run row */

/**
 * The room run row's current action while the member waits for a foreground
 * subagent: 「正在等子智能体：探索 · 6 分钟」 and 「看子智能体」 (the member
 * session, scrolled to that call's card). Nothing otherwise.
 */
export function RunSubagentWait({ face, childSessionId, startedAt, executionId, openSession, t, className, linkClassName, fullClassName, shortClassName }: {
  readonly face: SubagentCardsFace | undefined
  readonly childSessionId: string | undefined
  readonly startedAt: number
  readonly executionId?: string | undefined
  readonly openSession: (sessionId: string) => void
  readonly t: T
  readonly className?: string | undefined
  readonly linkClassName?: string | undefined
  /** The two wordings (a narrow row shows the short one). */
  readonly fullClassName?: string | undefined
  readonly shortClassName?: string | undefined
}): ReactNode {
  const store = face?.store
  useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.getVersion ?? zero, store?.getVersion ?? zero)
  useEffect(() => (store === undefined || childSessionId === undefined ? undefined : store.follow(childSessionId, () => true)), [store, childSessionId])
  const now = useTicker(true)
  if (face === undefined || childSessionId === undefined) return null
  const call = foregroundWait(face.store.get(childSessionId), { startedAt, executionId })
  if (call === undefined) return null
  const parts = durationParts(now - call.startedAt, false)
  const name = subagentTypeName(call.name, t)
  const time = t(`bg.time.${parts.key}`, parts.vars as Record<string, string>)
  return (
    <>
      <span className={className} data-testid="run-subagent-wait">
        <span className={fullClassName}>· {t('run.waitSubagent', { name, time })}</span>
        {shortClassName !== undefined && <span className={shortClassName} aria-hidden>· {t('run.waitSubagentShort', { name, time })}</span>}
      </span>
      <button
        type="button"
        className={linkClassName}
        onClick={(event) => {
          event.stopPropagation()
          face.reveals.request(call.callId, false)
          openSession(childSessionId)
        }}
      >
        {t('run.viewSubagent')}
      </button>
    </>
  )
}
const noopSubscribe = (): (() => void) => () => {}
const zero = (): number => 0
