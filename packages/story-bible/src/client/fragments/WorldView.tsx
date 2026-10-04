/**
 * 世界记忆: the health line (活跃/超期⚠/已揭/弃置) + the foreshadow cards
 * (longest-slept first, the chapter dot strip with the five dot kinds plus
 * dashed pending circles, and the three exits: 登记揭晓/弃置/转设定) + the
 * world-rules section (canon non-prospective, with source + evidence).
 *
 * The strip's dots: mentions.jsonl per foreshadow (filled, by kind), pending
 * mention items (dashed outline — 待确认虚线圈), and the current planning
 * chapter's planned ops (hollow — the plan promises them). Clicking a dot
 * surfaces its quote in the toast.
 *
 * @module @khorsheed/dsh-story-bible/client
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { ChapterRow, MemoryRecord, MentionEntry, PendingItem } from '../../types.ts'
import type { StoryTabProps } from '../contract.ts'
import type { WorkShell } from '../data.ts'
import css from '../fragments.module.css'

/** The world view's props. */
export interface WorldViewProps {
  readonly props: StoryTabProps
  readonly shell: WorkShell
  readonly workId: string
}

/** Everything one foreshadow card renders, grouped by memory id. */
interface CardData {
  readonly mentions: readonly MentionEntry[]
  readonly pending: readonly PendingItem[]
  readonly plannedChapters: readonly number[]
}

/** 世界记忆 view. */
export function WorldView({ props, shell, workId }: WorldViewProps): ReactNode {
  const { t } = props
  const sessionId = props.sessionId
  const rev = props.useStory(current => current.rev)
  const [health, setHealth] = useState<{ active: number; overdue: number; resolved: number; abandoned: number; currentChapter: number } | null>(null)
  const [active, setActive] = useState<readonly MemoryRecord[]>([])
  const [resolved, setResolved] = useState<readonly MemoryRecord[]>([])
  const [cards, setCards] = useState<Readonly<Record<string, CardData>>>({})
  const [rules, setRules] = useState<readonly MemoryRecord[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [ledgerValue, mentions, pending, canon, chapters] = await Promise.all([
        shell.run(() => props.ledger({ workId })),
        shell.run(() => props.listMentions({ workId })),
        shell.run(() => props.listPending({ workId })),
        shell.run(() => props.listMemories({ workId, layer: 'canon' })),
        shell.run(() => props.listChapters({ workId })),
      ])
      if (cancelled) return
      if (ledgerValue !== null && ledgerValue.ok) {
        setHealth({ ...ledgerValue.counts, currentChapter: ledgerValue.currentChapter })
        setActive(ledgerValue.active)
        setResolved(ledgerValue.resolved)
      }
      const pendingMentions = (pending ?? []).filter(item => item.kind === 'mention')
      const grouped: Record<string, CardData> = {}
      const plannedOf = (chapters ?? [])
        .filter((row: ChapterRow) => row.phase === 'planning' && row.chapter.plan !== undefined)
        .flatMap((row: ChapterRow) => row.chapter.plan!.foreshadowOps.map(op => ({ id: op.id, chapter: row.chapter.n })))
      const ids = new Set([
        ...(ledgerValue?.active ?? []).map(memory => memory.id),
        ...(ledgerValue?.resolved ?? []).map(memory => memory.id),
      ])
      for (const id of ids) {
        grouped[id] = {
          mentions: (mentions ?? []).filter(entry => entry.foreshadowId === id),
          pending: pendingMentions.filter(item => item.payload.foreshadowId === id),
          plannedChapters: plannedOf
            .filter(op => op.id !== undefined && (op.id === id || op.id === id.replace(/^m/, '#') || op.id === id.replace(/^m/, '')))
            .map(op => op.chapter),
        }
      }
      setCards(grouped)
      setRules((canon ?? []).filter(memory => memory.type !== 'prospective' && memory.kind !== '原则'))
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId, rev])

  const exit = (id: string, action: 'resolve' | 'abandon' | 'promote', answer?: string): void => {
    if (sessionId === undefined) return
    void (async () => {
      const value = await shell.run(() => props.foreshadowExit(sessionId, { workId, id, action, ...(answer === undefined ? {} : { answer }) }))
      if (value === null) return
      if (!value.ok) {
        shell.showToast(shell.errorText(value.error))
        return
      }
      props.refresh()
      void shell.reloadShell()
      shell.showToast(t(action === 'resolve' ? 'toast.resolved' : action === 'abandon' ? 'toast.abandoned' : 'toast.promoted'))
    })()
  }

  if (health === null) return <div className={css.notice}>{t('state.loading')}</div>

  return (
    <div className={css.fragRoot}>
      <div className={css.health}>
        <span>{t('wm.active')} <b className={css.healthOk}>{health.active}</b></span>
        <span className={css.healthWarn}>{t('wm.overdue')} <b>{health.overdue}</b> ⚠</span>
        <span>{t('wm.resolved')} <b>{health.resolved}</b></span>
        <span>{t('wm.abandoned')} <b>{health.abandoned}</b></span>
        <span className={css.healthNote}>{t('wm.sorted')}</span>
      </div>
      <div className={css.viewBody}>
        {active.length === 0 && resolved.length === 0 ? (
          <div className={css.notice}>{t('wm.noCards')}</div>
        ) : (
          <>
            {active.map(memory => (
              <ForeshadowCard
                key={memory.id}
                memory={memory}
                data={cards[memory.id] ?? { mentions: [], pending: [], plannedChapters: [] }}
                currentChapter={health.currentChapter}
                props={props}
                onExit={exit}
              />
            ))}
            {resolved.map(memory => (
              <ForeshadowCard
                key={memory.id}
                memory={memory}
                data={cards[memory.id] ?? { mentions: [], pending: [], plannedChapters: [] }}
                currentChapter={health.currentChapter}
                props={props}
                onExit={exit}
                done
              />
            ))}
          </>
        )}
        <div className={css.sectionTitle}>{t('wm.rules')}</div>
        {rules.length === 0 ? (
          <div className={css.notice}>{t('wm.noRules')}</div>
        ) : (
          rules.map(rule => (
            <div key={rule.id} className={css.rule}>
              {rule.content}
              <div className={css.ruleMeta}>
                {rule.firstChapter !== undefined && <span>{t('wm.source', { n: String(rule.firstChapter) })}</span>}
                {rule.autoImported === true && <span> · {t('wm.sourceAuto')}</span>}
                {rule.evidenceInText !== undefined && <span> · {t('wm.evidence', { text: rule.evidenceInText })}</span>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/** One foreshadow card: status chip, meta line, the dot strip, the three exits. */
function ForeshadowCard({ memory, data, currentChapter, props, onExit, done = false }: {
  memory: MemoryRecord
  data: CardData
  currentChapter: number
  props: StoryTabProps
  onExit: (id: string, action: 'resolve' | 'abandon' | 'promote', answer?: string) => void
  done?: boolean
}): ReactNode {
  const { t } = props
  const [exit, setExit] = useState<'resolve' | 'promote' | null>(null)
  const [answer, setAnswer] = useState('')
  const specifics = memory.specifics
  const planted = specifics?.plantedAt ?? memory.firstChapter
  const last = memory.lastActiveChapter ?? planted
  const slept = currentChapter - (last ?? currentChapter)
  const maxDot = Math.max(currentChapter, ...(data.mentions.map(entry => entry.chapter)), ...(data.plannedChapters), 1)

  const submitExit = (event: FormEvent): void => {
    event.preventDefault()
    const trimmed = answer.trim()
    if (trimmed.length === 0 || exit === null) return
    onExit(memory.id, exit, trimmed)
    setExit(null)
    setAnswer('')
  }

  return (
    <div className={css.fcard} data-stale={!done && slept >= 3 || undefined} data-done={done || undefined}>
      <div className={css.fcardHead}>
        <b>{specifics?.question ?? memory.content}</b>
        {done
          ? <span className={css.fcardStatus} data-done="true">{t('wm.done')}</span>
          : <span className={css.fcardStatus} data-open="true">{specifics?.status === 'planted' && slept === 0 ? t('wm.newPlant') : t('wm.open')}</span>}
        {specifics?.tension !== undefined && <span className={css.fcardTension}>{t('wm.tension', { t: String(specifics.tension) })}</span>}
      </div>
      <div className={css.fcardMeta}>
        {planted !== undefined && <span>{t('wm.plantedAt', { n: String(planted) })}</span>}
        {last !== undefined && <span> · {t('wm.lastActive', { n: String(last) })}</span>}
        {!done && slept > 0 && (
          <span className={slept >= 3 ? css.staleWarn : undefined}> · {t(slept >= 3 ? 'wm.sleepingWarn' : 'wm.sleeping', { n: String(slept) })}</span>
        )}
        {done && specifics?.answer !== undefined && <span> → {specifics.answer}</span>}
      </div>
      <div className={css.strip}>
        <span className={css.stripLabel}>1–{maxDot}章</span>
        {Array.from({ length: maxDot }, (_, index) => index + 1).map(n => {
          const mention = data.mentions.find(entry => entry.chapter === n)
          const pending = data.pending.some(item => item.chapter === n)
          const planned = data.plannedChapters.includes(n)
          return (
            <span
              key={n}
              className={css.cell}
              title={mention?.note ?? mention?.kind ?? (pending ? t('pending.title') : planned ? t('reader.planTitle', { n: String(n) }) : undefined)}
            >
              {mention !== undefined && <i className={`${css.dot} ${dotClassOf(mention.kind)}`} />}
              {mention === undefined && pending && <i className={`${css.dot} ${css.dotPending}`} />}
              {mention === undefined && !pending && planned && <i className={`${css.dot} ${css.dotPlanned}`} />}
            </span>
          )
        })}
      </div>
      {!done && props.sessionId !== undefined && (
        exit === null ? (
          <div className={css.fcardOps}>
            <button type="button" onClick={() => { setExit('resolve') }}>{t('wm.resolve')}</button>
            <button type="button" onClick={() => { onExit(memory.id, 'abandon') }}>{t('wm.abandon')}</button>
            <button type="button" onClick={() => { setExit('promote') }}>{t('wm.promote')}</button>
          </div>
        ) : (
          <form className={css.exitForm} onSubmit={submitExit}>
            <input
              className={css.editLine}
              autoFocus
              value={answer}
              placeholder={t('wm.resolvePh')}
              onChange={event => { setAnswer(event.target.value) }}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  event.stopPropagation()
                  setExit(null)
                  setAnswer('')
                }
              }}
            />
            <div className={css.editRow}>
              <button type="submit" className={css.smallButton} data-primary="true">{t('wm.confirm')}</button>
              <button type="button" className={css.smallButton} onClick={() => { setExit(null); setAnswer('') }}>{t('wm.cancelExit')}</button>
            </div>
          </form>
        )
      )}
    </div>
  )
}

/** One mention kind's dot class. */
function dotClassOf(kind: MentionEntry['kind']): string | undefined {
  if (kind === 'planted') return css.dotPlanted
  if (kind === 'hinted') return css.dotHinted
  if (kind === 'advanced') return css.dotAdvanced
  return css.dotResolved
}
