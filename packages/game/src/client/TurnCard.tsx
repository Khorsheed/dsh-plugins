/**
 * The turn card: beneath each finished agent turn (the `conversation.chat.turnTail`
 * seat, outside the fold — the canvas-novel precedent), what the turn changed
 * in the game: the version that went live or waits as a candidate, the
 * check, elements, design chapters, parameters, code and tests — each with a
 * jump to the place in the game tab where the change can be seen.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { TurnReport } from '../types.ts'
import type { GameTabInjected, NavTarget } from './contract.ts'
import css from './TurnCard.module.css'

/** The key this package's turn data lives under. */
export const GAME_TURN_KEY = 'dsh-game-turn'

interface EventLike { readonly type: string; readonly data?: unknown }
interface TurnState { readonly turn: number; readonly ended: boolean }
interface LocationData { readonly kind: 'turn'; readonly turn: number; readonly key: string; readonly value: TurnState }

function turnOf(event: EventLike): number | null {
  const turn = (event.data as { turn?: unknown } | null | undefined)?.turn
  return typeof turn === 'number' ? turn : null
}

/** Tracks each turn's number and whether it ended; the report itself comes from the host. */
export const gameTurnDefinition = {
  kind: GAME_TURN_KEY,
  match(event: EventLike): { id: string; role: 'start' | 'update' } | null {
    const turn = turnOf(event)
    if (turn === null) return null
    if (event.type === 'turn/start') return { id: String(turn), role: 'start' }
    if (event.type === 'turn/end') return { id: String(turn), role: 'update' }
    return null
  },
  start(_context: unknown, match: { event: EventLike }): TurnState {
    return { turn: turnOf(match.event) ?? -1, ended: false }
  },
  update(context: { readonly state: TurnState }, match: { event: EventLike }): TurnState {
    return match.event.type === 'turn/end' ? { ...context.state, ended: true } : context.state
  },
  buildLocationData(context: { readonly state: TurnState | undefined }, scope: string, previous: LocationData | null | undefined): LocationData | null {
    if (scope !== 'turn' || context.state === undefined) return null
    if (previous?.kind === 'turn' && previous.turn === context.state.turn && previous.value.ended === context.state.ended) return previous
    return { kind: 'turn', turn: context.state.turn, key: GAME_TURN_KEY, value: context.state }
  },
}

/** Props of the card (ui-chat's turn-tail owner props, structurally, plus our face). */
export type GameTurnCardProps = GameTabInjected & {
  readonly sessionId: string
  readonly turn: { readonly data: { get: (key: string) => unknown }; readonly end?: { readonly seq: number } | null }
  readonly t: TranslateNS<'game'>
}

/** One line of the card. */
function Row({ icon, tone, children, go, t, onGo }: {
  icon: string
  tone?: 'ok' | 'warn' | 'error'
  children: ReactNode
  go?: NavTarget
  t: TranslateNS<'game'>
  onGo: (target: NavTarget) => void
}): ReactNode {
  return <li className={css.row} data-tone={tone}>
    <span className={css.icon} aria-hidden="true">{icon}</span>
    <span className={css.text}>{children}</span>
    {go !== undefined && <button type="button" className={css.go} onClick={() => { onGo(go) }}>{t('turn.see')}</button>}
  </li>
}

/** The card. Renders nothing until the turn ended and only when it changed something. */
export function GameTurnCard(props: GameTurnCardProps): ReactNode {
  const { t, api, sessionId, openAt, subscribeSessionEvents } = props
  let state: TurnState | undefined
  try {
    state = (props.turn.data.get(GAME_TURN_KEY) as TurnState | undefined) ?? undefined
  } catch {
    state = undefined
  }
  const turn = state?.turn
  const ended = state?.ended === true || props.turn.end != null
  const [report, setReport] = useState<TurnReport | null>(null)
  const [rev, setRev] = useState(0)
  useEffect(() => subscribeSessionEvents(id => { if (id === sessionId) setRev(n => n + 1) }), [subscribeSessionEvents, sessionId])
  useEffect(() => {
    if (turn === undefined || !ended) return
    let live = true
    // The host writes the report right after turn/end; a second read covers the race.
    const read = () => api.turnReport(sessionId as never, turn).then(r => { if (live && r.ok) setReport(r.value) }).catch(() => {})
    void read()
    const again = setTimeout(() => { void read() }, 1500)
    return () => { live = false; clearTimeout(again) }
  }, [api, sessionId, turn, ended, rev])

  if (report === null) return null
  const looks = report.elements.filter(e => e.what === 'look' || e.what === 'new')
  const fieldOnly = report.elements.filter(e => e.what === 'fields')
  const removed = report.elements.filter(e => e.what === 'removed')
  return <section className={css.card} aria-label={t('turn.title', { title: report.title })}>
    <header className={css.head}>
      <span className={css.badge} aria-hidden="true">◆</span>
      <strong>{t('turn.title', { title: report.title })}</strong>
      <span className={css.spacer} />
      <button type="button" className={css.open} onClick={() => { openAt({ view: 'play' }) }}>{t('turn.openPanel')}</button>
    </header>
    <ul className={css.list}>
      {report.version !== null && <Row t={t} onGo={openAt} icon="▶" tone={report.version.kind === 'deployed' ? 'ok' : 'warn'} go={{ view: 'play' }}>
        {report.version.kind === 'deployed' ? t('turn.deployed', { version: report.version.version }) : t('turn.candidate', { version: report.version.version })}
        {report.check !== null && report.check.ok && <span className={css.meta}>{t('turn.checkOk', { passed: report.check.passed })}{report.check.fixes > 0 ? ` · ${t('turn.fixed', { count: report.check.fixes })}` : ''}</span>}
      </Row>}
      {report.check !== null && !report.check.ok && <Row t={t} onGo={openAt} icon="!" tone={report.check.gaveUp ? 'warn' : 'error'} go={{ view: 'versions' }}>
        {report.check.gaveUp ? t('turn.gaveUp', { count: report.check.failures }) : t('turn.checkFailed', { count: report.check.failures })}
      </Row>}
      {looks.map(e => <Row key={`l${e.id}`} t={t} onGo={openAt} icon="◇" go={{ view: 'elements', elementId: e.id }}>
        {e.what === 'new' ? t('turn.elementNew', { name: e.name }) : t('turn.elementLook', { name: e.name })}
      </Row>)}
      {fieldOnly.length > 0 && fieldOnly.map(e => <Row key={`f${e.id}`} t={t} onGo={openAt} icon="◇" go={{ view: 'elements', elementId: e.id }}>
        {t('turn.elementFields', { name: e.name, fields: (e.fields ?? []).slice(0, 4).join('、') })}
      </Row>)}
      {removed.length > 0 && <Row t={t} onGo={openAt} icon="−" go={{ view: 'elements' }}>{t('turn.elementRemoved', { names: removed.map(e => e.name).join('、') })}</Row>}
      {report.chapters.map(c => <Row key={`c${c.id}`} t={t} onGo={openAt} icon="¶" go={{ view: 'design', chapterId: c.id }}>{t('turn.chapter', { title: c.title })}</Row>)}
      {report.params.length > 0 && <Row t={t} onGo={openAt} icon="≡" go={{ view: 'play' }}>
        {t('turn.params', { list: report.params.slice(0, 4).map(p => (p.from === undefined ? `${p.label} ${p.to}` : `${p.label} ${p.from}→${p.to}`)).join('、') })}
      </Row>}
      {report.code.length > 0 && <Row t={t} onGo={openAt} icon="{}" go={{ view: 'versions' }}>
        {t('turn.code', { count: report.code.length })}<span className={css.meta}>{report.code.slice(0, 3).join('、')}{report.code.length > 3 ? '…' : ''}</span>
      </Row>}
      {report.tests.length > 0 && <Row t={t} onGo={openAt} icon="✓" go={{ view: 'versions' }}>{t('turn.tests', { count: report.tests.length })}</Row>}
    </ul>
  </section>
}
