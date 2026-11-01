/**
 * What each agent turn changed in the game, as the data of the one Turn-tail
 * summary card (`@khorsheed/dsh-client-ui-agent-nav`'s `registerTurnSummary`,
 * proposal 2026-10-30-agent-sidebar-navigation). The game draws nothing in
 * the conversation: it hands one plain line per change — the version that went
 * live or waits, a failed check, elements, design chapters, parameters, code,
 * tests — each with the place in the game tab where it can be seen. Looks
 * before and after are shown there, in the 元素 page, not here.
 *
 * @module @khorsheed/dsh-game/client
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { Destination, TurnSummary } from '@khorsheed/dsh-client-ui-agent-nav/src/client/index.ts'
import type { TurnReport } from '../types.ts'
import type { GameNavParams } from './contract.ts'

/**
 * One turn's summary.
 * @param report - the host's report of the turn.
 * @param t - the game's copy.
 * @returns the title and one line per change; no lines when the turn changed nothing.
 */
export function turnSummaryOf(report: TurnReport, t: TranslateNS<'game'>): TurnSummary {
  const rows: Array<{ label: string; destination?: Destination }> = []
  const row = (key: string, label: string, params?: GameNavParams): void => {
    rows.push(params === undefined ? { label } : {
      label,
      destination: { id: `game-turn:${report.projectId}:${report.turn}:${key}`, kind: 'game', params: { projectId: report.projectId, ...params }, label },
    })
  }
  if (report.version !== null) {
    const check = report.check !== null && report.check.ok
      ? ` · ${t('turn.checkOk', { passed: report.check.passed })}${report.check.fixes > 0 ? ` · ${t('turn.fixed', { count: report.check.fixes })}` : ''}`
      : ''
    const said = report.version.kind === 'deployed'
      ? t('turn.deployed', { version: report.version.version })
      : t('turn.candidate', { version: report.version.version })
    row('version', `${said}${check}`, { view: 'play' })
  }
  if (report.check !== null && !report.check.ok) {
    row('check', report.check.gaveUp ? t('turn.gaveUp', { count: report.check.failures }) : t('turn.checkFailed', { count: report.check.failures }), { view: 'versions' })
  }
  for (const e of report.elements.filter(e => e.what === 'look' || e.what === 'new')) {
    row(`element:${e.id}`, e.what === 'new' ? t('turn.elementNew', { name: e.name }) : t('turn.elementLook', { name: e.name }), { view: 'elements', elementId: e.id })
  }
  for (const e of report.elements.filter(e => e.what === 'fields')) {
    row(`fields:${e.id}`, t('turn.elementFields', { name: e.name, fields: (e.fields ?? []).slice(0, 4).join('、') }), { view: 'elements', elementId: e.id })
  }
  const removed = report.elements.filter(e => e.what === 'removed')
  if (removed.length > 0) row('removed', t('turn.elementRemoved', { names: removed.map(e => e.name).join('、') }), { view: 'elements' })
  for (const c of report.chapters) row(`chapter:${c.id}`, t('turn.chapter', { title: c.title }), { view: 'design', chapterId: c.id })
  if (report.params.length > 0) {
    row('params', t('turn.params', { list: report.params.slice(0, 4).map(p => (p.from === undefined ? `${p.label} ${p.to}` : `${p.label} ${p.from}→${p.to}`)).join('、') }), { view: 'play' })
  }
  if (report.code.length > 0) {
    row('code', `${t('turn.code', { count: report.code.length })} · ${report.code.slice(0, 3).join('、')}${report.code.length > 3 ? '…' : ''}`, { view: 'versions' })
  }
  if (report.tests.length > 0) row('tests', t('turn.tests', { count: report.tests.length }), { view: 'versions' })
  return { title: t('turn.title', { title: report.title }), rows }
}
