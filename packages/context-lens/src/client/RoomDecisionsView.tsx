/**
 * The 房间 tab: the decision-model calls the room made during this turn (its
 * own scenarios — automatic task filing, automatic report timing), listed
 * like requests (#n · scenario, the probability the outcome was taken with,
 * input → output tokens, latency) and opened like one: the model facts, the
 * state the room sent, the fixed question, the candidates with their
 * probabilities and the outcome — or, through `{ }`, the request and response
 * as JSON.
 *
 * @module @khorsheed/dsh-context-lens/client
 */
import { useState, type ReactNode } from 'react'
import type { RoomDecisionRow } from '../types.ts'
import type { InspectorTabProps } from './contract.ts'
import { fmt } from './aggregate.ts'
import css from './TokenView.module.css'
import raw from './RawView.module.css'
import own from './RoomDecisionsView.module.css'

type T = InspectorTabProps['t']

/** The scenario's display name. */
function scenarioName(scenario: string, t: T): string {
  return scenario === 'task-filing' ? t('room.scenario.filing') : scenario === 'report-timing' ? t('room.scenario.timing') : scenario
}

/** A JSON value as compact display text. */
function show(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

/** The candidates and their probabilities, from the recorded response. */
function candidates(row: RoomDecisionRow, t: T): readonly [string, number][] {
  const answers = Array.isArray(row.response) ? row.response as { answer?: unknown; probabilities?: Record<string, number> }[] : []
  const answer = answers[0]
  if (answer === undefined) return []
  if (answer.probabilities !== undefined) return Object.entries(answer.probabilities)
  // A yes / no question reports the yes probability as its answer.
  return typeof answer.answer === 'number' ? [[t('room.yes'), answer.answer], [t('room.no'), 1 - answer.answer]] : []
}

/** The outcome sentence. */
function verdict(row: RoomDecisionRow, t: T): string {
  if (row.failure !== undefined) return t('room.verdict.failed', { reason: row.failure.reason })
  if (row.scenario === 'task-filing') {
    return row.about.task === undefined ? t('room.verdict.new') : t('room.verdict.task', { number: String(row.about.task.number), title: row.about.task.title })
  }
  return t(row.outcome === 'later' ? 'room.verdict.later' : 'room.verdict.now', { from: row.about.from ?? '', to: row.about.to ?? '' })
}

/** The 房间 tab body. */
export function RoomDecisionsView({ decisions, selectedId, onSelect, t }: {
  readonly decisions: readonly RoomDecisionRow[]
  readonly selectedId: string | null
  readonly onSelect: (id: string) => void
  readonly t: T
}): ReactNode {
  const [json, setJson] = useState(false)
  const index = Math.max(0, decisions.findIndex(row => row.id === selectedId))
  const row = decisions[index]
  return <div className={css.md}>
    <nav className={css.reqList} aria-label={t('room.tab')}>
      {decisions.map((entry, i) => (
        <button key={entry.id} type="button" className={entry === row ? css.reqItemSel : css.reqItem} aria-pressed={entry === row} onClick={() => onSelect(entry.id)}>
          <span className={css.reqName}>#{i + 1} · {scenarioName(entry.scenario, t)}</span>
          <span className={entry.failure === undefined ? own.prob : own.failed}>{entry.failure !== undefined ? t('room.failed') : entry.probability === undefined ? '—' : entry.probability.toFixed(2)}</span>
          <span className={css.reqIo}>{entry.inputTokens === undefined ? '—' : `${fmt(entry.inputTokens)} → ${fmt(entry.outputTokens ?? 0)}`}</span>
          <span className={css.reqTime}>{entry.latencyMs === undefined ? '—' : `${(entry.latencyMs / 1000).toFixed(1)}s`}</span>
        </button>
      ))}
    </nav>
    {row !== undefined && <div className={css.reqDetail}>
      <div className={css.detailHead}>
        <b>#{index + 1} · {scenarioName(row.scenario, t)}</b>
        <button type="button" className={css.jsonToggle} aria-label={t('view.raw')} title={t('view.raw')} aria-pressed={json} onClick={() => setJson(value => !value)}>{'{ }'}</button>
      </div>
      <div className={css.metrics}>
        <div><span>{t('room.model')}</span><b className={own.small}>{row.model}</b><span>typesafe</span></div>
        <div><span>{t('req.input')}</span><b>{row.inputTokens === undefined ? '—' : fmt(row.inputTokens)}<small>tok</small></b><span>{t('req.output')} {row.outputTokens === undefined ? '—' : fmt(row.outputTokens)} tok</span></div>
        <div><span>{t('lens.duration')}</span><b>{row.latencyMs === undefined ? '—' : `${(row.latencyMs / 1000).toFixed(1)}s`}</b><span /></div>
        <div><span>{t('room.cache')}</span><b className={own.small}>{row.cached === undefined ? '—' : row.cached ? t('room.cacheHit') : t('room.cacheMiss')}</b><span /></div>
      </div>
      {json ? <>
        <section><h3 className={css.sectionTitle}>{t('room.request')}</h3><pre className={raw.pre}>{JSON.stringify({ model: row.model, ...row.request }, null, 2)}</pre></section>
        <section><h3 className={css.sectionTitle}>{t('room.response')}</h3><pre className={raw.pre}>{JSON.stringify(row.failure === undefined ? row.response ?? null : { failure: row.failure }, null, 2)}</pre></section>
      </> : <>
        <section>
          <h3 className={css.sectionTitle}>{t('room.state')}<span>{t('room.stateNote')}</span></h3>
          <dl className={own.kv}>
            {Object.entries((row.request.state ?? {}) as Record<string, unknown>).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{show(value)}</dd></div>)}
          </dl>
        </section>
        <section>
          <h3 className={css.sectionTitle}>{t('room.question')}<span>{t('room.questionNote')}</span></h3>
          <p className={own.box}>{show((Array.isArray(row.request.questions) ? (row.request.questions[0] as { instructions?: unknown } | undefined)?.instructions : undefined) ?? '')}</p>
        </section>
        {candidates(row, t).length > 0 && <section>
          <h3 className={css.sectionTitle}>{t('room.candidates')}</h3>
          <div className={own.opts}>
            {candidates(row, t).map(([label, p]) => (
              <div key={label} className={own.opt}><span>{label}</span><span className={own.bar}><i style={{ width: `${Math.round(p * 100)}%` }} /></span><span className={own.pc}>{p.toFixed(2)}</span></div>
            ))}
          </div>
        </section>}
        <p className={row.failure === undefined ? own.verdict : own.verdictFailed}><b>{t('room.verdict')}</b>{verdict(row, t)}</p>
      </>}
    </div>}
  </div>
}
