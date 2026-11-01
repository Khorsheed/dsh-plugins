/**
 * 灵感, the novel's last face (2026-11-01): what the person jots down out of
 * chapter order. 记录灵感 only stores — it asks nothing of the agent. Two
 * lists, 未绑定事件 and 已绑定事件. An unbound idea can be sent to the
 * conversation (排进时间轴: the agent proposes where it goes in that turn,
 * the person agrees, then it writes), or bound by hand to an event whose
 * people or places the idea names (no model call). A bound idea says which
 * event, can be moved to another, and reads 待写入 until the 对账 of the
 * chapter that realizes its event marks it 已写入第 N 章.
 *
 * @module @khorsheed/dsh-canvas-novel/client
 */
import { useState, type ReactNode } from 'react'
import { NOVEL_GENRE_ID, type NovelIdeasResult } from '../types.ts'
import type { NovelSurfaceProps } from './contract.ts'
import { errorKey, useNovelRead } from './use-novel.ts'
import css from './timeline.module.css'

type T = NovelSurfaceProps['t']
type Idea = NonNullable<NovelIdeasResult['ideas']>[number]
type EventOption = NonNullable<NovelIdeasResult['events']>[number]
const TIER_RANK = ['near', 'backlog', 'ready', 'sat', 'hold']

/** The 灵感 face (keyed `novel:ideas`); nothing on a canvas of another genre. */
export function IdeasView(props: NovelSurfaceProps): ReactNode {
  if (props.board.genre?.id !== NOVEL_GENRE_ID) return null
  return <Ideas {...props} />
}

function Ideas(props: NovelSurfaceProps): ReactNode {
  const { canvasId, rev, remote, sessionId, navigate, t } = props
  const api = remote()
  const read = useNovelRead(api, r => r.ideas({ canvasId }), `ideas:${canvasId}`, rev)
  const [filter, setFilter] = useState<'loose' | 'bound'>('loose')
  const [draft, setDraft] = useState<string | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set())
  const [failure, setFailure] = useState<string | null>(null)
  if (api === undefined) return null
  if (read.state === 'loading') return <div className={css.page}><div className={css.muted}>{t('state.loading')}</div></div>
  if (read.state === 'error') return <div className={css.page}><div className={css.warn}>{t('error.generic', { message: read.message })}</div></div>
  if (!read.value.ok) return <div className={css.page}><div className={css.warn}>{t(errorKey(read.value.error))}</div></div>
  const ideas = read.value.ideas ?? []
  const events = read.value.events ?? []
  const readOnly = sessionId === undefined
  const change = async (request: Parameters<typeof api.changeIdea>[1]): Promise<void> => {
    if (sessionId === undefined) return
    setFailure(null)
    const result = await api.changeIdea(sessionId, request)
    if (!result.ok) setFailure(t('error.generic', { message: result.error.message }))
    else if (!result.value.ok) setFailure(t(errorKey(result.value.error)))
    navigate.refresh()
  }
  const sendToTimeline = (ids: readonly string[]): void => {
    if (sessionId === undefined || props.sendToConversation === undefined) return
    const rows = ideas.filter(idea => ids.includes(idea.id))
    props.sendToConversation(sessionId, t('ideas.ask', { list: rows.map((idea, index) => `${index + 1}. [${idea.id}]「${idea.text.length > 60 ? `${idea.text.slice(0, 60)}…` : idea.text}」`).join('\n') }))
    setSent(was => new Set([...was, ...ids]))
    setSelected(new Set())
  }
  const rows = ideas.filter(idea => filter === 'loose' ? idea.eventId === undefined : idea.eventId !== undefined)
  const titleOf = (id: string): string => events.find(event => event.id === id)?.title ?? id
  return (
    <div className={css.page}>
      <div className={css.toolbar}>
        <div className={css.seg} role="group" aria-label={t('ideas.filter')}>
          <button type="button" aria-pressed={filter === 'loose'} onClick={() => { setFilter('loose') }}>{t('ideas.loose', { count: ideas.filter(idea => idea.eventId === undefined).length })}</button>
          <button type="button" aria-pressed={filter === 'bound'} onClick={() => { setFilter('bound') }}>{t('ideas.bound', { count: ideas.filter(idea => idea.eventId !== undefined).length })}</button>
        </div>
        <span style={{ flex: 1 }} />
        {!readOnly && <button type="button" className={css.button} onClick={() => { setDraft(draft === null ? '' : null) }}>{draft === null ? t('ideas.new') : t('ideas.cancel')}</button>}
      </div>
      {draft !== null && (
        <div className={css.ideaNew}>
          <textarea aria-label={t('ideas.new')} placeholder={t('ideas.placeholder')} value={draft} onChange={event => { setDraft(event.target.value) }} />
          <div className={css.row}>
            <button type="button" className={`${css.button} ${css.primary}`} disabled={draft.trim() === ''} onClick={() => { void change({ canvasId, add: draft }).then(() => { setDraft(null) }) }}>{t('ideas.save')}</button>
            <span className={css.muted}>{t('ideas.saveHint')}</span>
          </div>
        </div>
      )}
      {failure !== null && <div className={css.warn}>{failure}</div>}
      {rows.length === 0 && <p className={css.empty}>{filter === 'loose' ? t('ideas.looseEmpty') : t('ideas.boundEmpty')}</p>}
      {rows.map(idea => (
        <div key={idea.id} className={css.idea}>
          {idea.eventId === undefined && !readOnly
            ? <input type="checkbox" aria-label={t('ideas.select')} checked={selected.has(idea.id)} onChange={() => { setSelected(was => { const next = new Set(was); if (next.has(idea.id)) next.delete(idea.id); else next.add(idea.id); return next }) }} />
            : <span />}
          <div className={css.ideaBody}>
            <p className={css.ideaText}>{idea.text}</p>
            <div className={css.row}>
              {idea.eventId !== undefined && <span className={css.state}>{idea.writtenIn === undefined ? t('ideas.pending') : t('ideas.written', { n: idea.writtenIn })}</span>}
              {sent.has(idea.id) && idea.eventId === undefined && <span className={css.state}>{t('ideas.sent')}</span>}
            </div>
            {!readOnly && (
              <div className={css.row}>
                {idea.eventId === undefined && (
                  <>
                    <button type="button" className={css.button} disabled={props.sendToConversation === undefined} onClick={() => { sendToTimeline([idea.id]) }}>{t('ideas.toTimeline')}</button>
                    <button type="button" className={css.button} aria-expanded={open === idea.id} onClick={() => { setOpen(open === idea.id ? null : idea.id) }}>{t('ideas.bindByHand')}</button>
                  </>
                )}
                {idea.eventId !== undefined && idea.writtenIn === undefined && (
                  <button type="button" className={css.chip} aria-expanded={open === idea.id} onClick={() => { setOpen(open === idea.id ? null : idea.id) }}>{t('ideas.boundTo', { title: titleOf(idea.eventId) })} ▾</button>
                )}
                {idea.eventId !== undefined && idea.writtenIn !== undefined && <span className={css.muted}>{t('ideas.boundTo', { title: titleOf(idea.eventId) })}</span>}
                <button type="button" className={css.button} onClick={() => { void change({ canvasId, id: idea.id, delete: true }) }}>{t('ideas.delete')}</button>
              </div>
            )}
            {open === idea.id && <BindChoices idea={idea} events={events} t={t} onBind={eventId => { setOpen(null); void change({ canvasId, id: idea.id, eventId }) }} />}
          </div>
        </div>
      ))}
      {selected.size > 0 && (
        <div className={css.batch}>
          <span className={css.muted}>{t('ideas.selected', { count: selected.size })}</span>
          <button type="button" className={`${css.button} ${css.primary}`} disabled={props.sendToConversation === undefined} onClick={() => { sendToTimeline([...selected]) }}>{t('ideas.toTimeline')}</button>
          <button type="button" className={css.button} onClick={() => { setSelected(new Set()) }}>{t('ideas.clear')}</button>
        </div>
      )}
    </div>
  )
}

/** The events an idea may go to: the ones whose people or places it names first (no model), then the rest on request. */
function BindChoices({ idea, events, onBind, t }: {
  readonly idea: Idea
  readonly events: readonly EventOption[]
  readonly onBind: (eventId: string) => void
  readonly t: T
}): ReactNode {
  const [all, setAll] = useState(false)
  const open = events.filter(event => event.tier !== undefined && event.id !== idea.eventId)
  const hits = (event: EventOption): number => event.mentions.filter(name => name.length >= 2 && idea.text.includes(name)).length
  const ranked = [...open].sort((a, b) => hits(b) - hits(a) || TIER_RANK.indexOf(a.tier ?? '') - TIER_RANK.indexOf(b.tier ?? ''))
  const named = ranked.filter(event => hits(event) > 0)
  const shown = all ? ranked : (named.length > 0 ? named : ranked).slice(0, 3)
  if (open.length === 0) return <p className={css.muted}>{t('ideas.noEvents')}</p>
  return (
    <div className={css.row}>
      <span className={css.muted}>{named.length > 0 && !all ? t('ideas.byNames') : t('ideas.bindTo')}</span>
      {shown.map(event => <button key={event.id} type="button" className={css.chip} onClick={() => { onBind(event.id) }}>{event.title}</button>)}
      {!all && ranked.length > shown.length && <button type="button" className={css.chip} onClick={() => { setAll(true) }}>{t('ideas.more', { count: ranked.length - shown.length })}</button>}
    </div>
  )
}
