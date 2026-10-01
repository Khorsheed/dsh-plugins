/**
 * T90 · the registration review: what a person reads before 「确认登记」.
 *
 * Two forms of one page. A NEW proposal compares 「原目录 → 题集」: every file
 * of the original directory with what happened to it (拆分 / 原样复制 / 未使用,
 * with the agent's reason), beside every group of dataset files with where it
 * came from (← file · field, 新写) — counts on top, files that sit in no layer
 * flagged 「不分层 · 选手可见」. An UPDATE (a re-filed proposal, or a version
 * the update gate held) compares 「已登记版本 → 新版本」: the same output
 * groups with how many files changed, and the change list itself with every
 * deletion spelled out.
 *
 * The comparison is the host's (`proposalReview` / `pendingReview`), checked
 * against the repository's git objects and the original directory on disk; a
 * blocking finding disables 「确认登记」 here and is refused by the host too.
 * Below it: the three drill-ins (逐条对照一题 / 随机抽看 3 题 / 完整清单),
 * who sees each layer (the agent's suggestion beside the person's choice),
 * the registration name, and the path / branch / checkout under 高级
 * (decision D: the page speaks 「版本 N · 时间」).
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button, Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ProposalProblem, ProposalReview, RegistryEntry, ReviewChange, ReviewFiles, ReviewItem, ReviewOutput, ReviewSource,
} from '../types.ts'
import type { DatasetsViewProps } from './contract.ts'
import { ErrorState } from './ErrorState.tsx'
import { checkDatasetName } from './organize.ts'
import { Chip, shortCommit } from './parts.tsx'
import css from './Organize.module.css'

type T = DatasetsViewProps['t']

/** The page's doors (the caller binds them to one proposal or one held registration). */
export interface ReviewPageProps {
  /** Reload key: a change re-reads the review. */
  loadKey: string
  load: () => Promise<RemoteResult<ProposalReview | undefined | null>>
  /** Null when the drill-ins have no proposal to read (a held version). */
  reviewItem: ((set: string, item: string) => Promise<RemoteResult<ReviewItem>>) | null
  reviewFiles: (() => Promise<RemoteResult<ReviewFiles>>) | null
  confirm: (
    registryId: string, sets: Record<string, { layers: string[] }>, review: ProposalReview,
  ) => Promise<RemoteResult<RegistryEntry>>
  /** Null when there is no organizing session to send it back to. */
  sendBack: ((note: string) => void) | null
  onBack: () => void
  /** After a successful confirm. */
  onDone: (entry: RegistryEntry) => void
  t: T
}

/** The date part of an ISO time, for 「版本 N · 日期」. */
function day(iso: string): string {
  return iso.slice(0, 10)
}

/** The per-set layer choice the page starts from: the agent's suggestion. */
function initialLayers(review: ProposalReview): Record<string, Record<string, boolean>> {
  const out: Record<string, Record<string, boolean>> = {}
  for (const set of review.facts.sets) {
    out[set.set] = {}
    for (const layer of set.layers) out[set.set]![layer.name] = layer.suggested
  }
  return out
}

/** Pick `count` distinct entries at random (Fisher–Yates on a copy). */
export function pickRandom<V>(list: readonly V[], count: number, random: () => number = Math.random): V[] {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const swap = copy[i]!
    copy[i] = copy[j]!
    copy[j] = swap
  }
  return copy.slice(0, count)
}

/** One summary chip per non-zero count, in reading order. */
function summaryChips(review: ProposalReview, t: T): Array<{ key: string; text: string; tone: 'neutral' | 'warn' | 'danger' }> {
  const s = review.compare.summary
  const update = review.compare.mode === 'update'
  const order: Array<[keyof typeof s, 'neutral' | 'warn' | 'danger']> = update
    ? [['added', 'neutral'], ['modified', 'neutral'], ['deleted', 'danger'], ['outside', 'neutral']]
    : [['split', 'neutral'], ['copy', 'neutral'], ['new', 'neutral'], ['unused', 'warn'], ['deleted', 'danger']]
  return order
    .filter(([key]) => s[key] > 0 || key === 'deleted')
    .map(([key, tone]) => ({ key, text: t(`review.sum.${key}`, { count: s[key] }), tone: key === 'deleted' && s[key] === 0 ? 'neutral' : tone }))
}

/** One source row: the path, its disposition, its reason / target and fields. */
function SourceRow(props: { row: ReviewSource; t: T }) {
  const { row, t } = props
  const counts: string[] = []
  if (row.files !== undefined && !row.path.endsWith('/') && row.files !== 1) counts.push(t('review.rowFiles', { count: row.files }))
  if (row.path.endsWith('/') && row.files !== undefined) counts.push(t('review.rowFiles', { count: row.files }))
  const records = row.counted ?? row.count
  if (records !== undefined) counts.push(t('review.rowRecords', { count: records }))
  return (
    <li className={css.cmpRow}>
      <div className={css.cmpHead}>
        <span className={css.cmpPath} title={row.path}>{row.path}</span>
        <Chip tone={row.disposition === 'unused' ? 'warn' : 'neutral'}>{t(`review.disp.${row.disposition}`)}</Chip>
      </div>
      {(row.target !== undefined || counts.length > 0) && (
        <div className={css.cmpNote}>
          {row.target !== undefined && <span className={css.mono}>→ {row.target}</span>}
          {counts.length > 0 && <span>{counts.join(' · ')}</span>}
        </div>
      )}
      {row.reason !== undefined && <div className={css.cmpNote}>{row.reason}</div>}
      {row.fields !== undefined && row.fields.length > 0 && (
        <ul className={css.fieldList}>
          {row.fields.map(field => (
            <li key={field.name}>
              {field.to !== undefined
                ? t('review.fieldTo', { name: field.name, to: field.to })
                : t('review.fieldDropped', { name: field.name, reason: field.reason ?? '' })}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/** Where one output group came from, in words. */
function originText(row: { origin: ReviewOutput['origin']; from?: string | undefined; field?: string | undefined }, t: T): string {
  if (row.origin === 'new') return t('review.originNew')
  if (row.origin === 'unexplained') return t('review.originUnexplained')
  if (row.field !== undefined && row.from !== undefined) return t('review.originSplit', { from: row.from, field: row.field })
  if (row.from !== undefined) return t('review.originFrom', { from: row.from })
  return t(`review.disp.${row.origin}`)
}

/** One output row: the path pattern, where it came from, how many files, which layer. */
function OutputRow(props: { row: ReviewOutput; update: boolean; t: T }) {
  const { row, update, t } = props
  const unlayered = row.zone === 'passthrough' || row.zone === 'item-meta'
  const notes = [t('review.rowFiles', { count: row.files })]
  if (row.items > 1) notes.push(t('review.rowItems', { count: row.items }))
  if (update && (row.added ?? 0) > 0) notes.push(t('review.sum.added', { count: row.added ?? 0 }))
  if (update && (row.modified ?? 0) > 0) notes.push(t('review.sum.modified', { count: row.modified ?? 0 }))
  return (
    <li className={css.cmpRow} data-origin={row.origin}>
      <div className={css.cmpHead}>
        <span className={css.cmpPath} title={row.path}>{row.path}</span>
        {row.origin === 'unexplained'
          ? <Chip tone="danger">{originText(row, t)}</Chip>
          : <span className={css.cmpOrigin}>{originText(row, t)}</span>}
      </div>
      <div className={css.cmpNote}>
        <span>{notes.join(' · ')}</span>
        {row.layer !== undefined && <span className={css.mono}>{t('review.layerTag', { layer: row.layer })}</span>}
        {unlayered && <Chip tone="warn">{t('review.unlayered')}</Chip>}
      </div>
      {row.note !== undefined && <div className={css.cmpNote}>{row.note}</div>}
    </li>
  )
}

/** One changed path of an update. */
function ChangeRow(props: { change: ReviewChange; t: T }) {
  const { change, t } = props
  return (
    <li className={css.cmpRow} data-status={change.status}>
      <div className={css.cmpHead}>
        <span className={css.cmpPath} title={change.path}>{change.path}</span>
        <Chip tone={change.status === 'D' ? 'danger' : 'neutral'}>{t(`review.change.${change.status}`)}</Chip>
      </div>
      <div className={css.cmpNote}>
        <span>{change.visible ? t('review.changeVisible') : t('review.changeHidden')}</span>
        {change.layer !== undefined && <span className={css.mono}>{t('review.layerTag', { layer: change.layer })}</span>}
      </div>
    </li>
  )
}

/** The 「逐条对照」 card: the source record beside the files it became. */
function ItemCompare(props: { view: ReviewItem; t: T }) {
  const { view, t } = props
  return (
    <section className={css.itemCard} aria-label={`${view.set}/${view.item}`}>
      <div className={css.itemTitle}>{`${view.set} / ${view.item}`}</div>
      <div className={css.twoCol}>
        <div className={css.colBox}>
          <div className={css.colHead}>
            {view.source === undefined
              ? t('review.itemNoSource')
              : (
                <>
                  {t('review.itemSource', { file: view.source.file })}
                  {view.source.line !== undefined && <span className={css.muted}> · {t('review.itemLine', { line: view.source.line })}</span>}
                </>
              )}
          </div>
          {view.source?.record !== undefined && <pre className={css.excerpt}>{view.source.record}</pre>}
          {view.source?.missing !== undefined && <div className={css.cmpNote}>{view.source.missing}</div>}
        </div>
        <div className={css.colBox}>
          <div className={css.colHead}>{t('review.itemFiles', { count: view.files.length })}</div>
          <ul className={css.cmpList}>
            {view.files.map(file => (
              <li key={file.path} className={css.cmpRow}>
                <div className={css.cmpHead}>
                  <span className={css.cmpPath} title={file.path}>{file.path.split('/').slice(4).join('/') || file.path}</span>
                  {file.origin !== undefined && <span className={css.cmpOrigin}>{originText({ origin: file.origin, from: file.from, field: file.field }, t)}</span>}
                </div>
                <div className={css.cmpNote}>
                  {file.layer !== undefined && <span className={css.mono}>{t('review.layerTag', { layer: file.layer })}</span>}
                  {(file.zone === 'passthrough' || file.zone === 'item-meta') && <Chip tone="warn">{t('review.unlayered')}</Chip>}
                </div>
                {file.excerpt !== undefined && <pre className={css.excerpt}>{file.excerpt}{file.truncated === true ? '\n…' : ''}</pre>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

/**
 * One finding in the reader's language: `review.finding.<code>[.<kind>]`
 * filled from the server's params. A finding without params (an older host)
 * or an unknown code keeps the server's English message — never a raw key.
 */
function findingText(finding: ProposalProblem, t: T): string {
  if (finding.params === undefined && !PARAMLESS.has(finding.code)) return finding.message
  const kind = finding.params?.kind
  const key = `review.finding.${finding.code}${typeof kind === 'string' ? `.${kind}` : ''}`
  const text = t(key as Parameters<T>[0], finding.params ?? {})
  return text === key ? finding.message : text
}
const PARAMLESS = new Set<ProposalProblem['code']>(['UNCOMMITTED', 'NO_SETS', 'HISTORY_REWRITTEN'])

/** The findings block: blocking problems first, then warnings. */
function Findings(props: { problems: readonly ProposalProblem[]; warnings: readonly ProposalProblem[]; t: T }) {
  const { problems, warnings, t } = props
  if (problems.length === 0 && warnings.length === 0) return null
  return (
    <div className={css.findings}>
      {problems.length > 0 && (
        <div className={css.findingGroup} data-tone="danger" role="alert">
          <div className={css.findingTitle}>{t('review.problems')}</div>
          <ul>{problems.map(problem => <li key={`${problem.code}:${problem.path ?? ''}:${problem.message}`} title={`${problem.code} · ${problem.message}`}>{findingText(problem, t)}</li>)}</ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className={css.findingGroup} data-tone="warn">
          <div className={css.findingTitle}>{t('review.warnings')}</div>
          <ul>{warnings.map(warning => <li key={`${warning.code}:${warning.path ?? ''}:${warning.message}`} title={`${warning.code} · ${warning.message}`}>{findingText(warning, t)}</li>)}</ul>
        </div>
      )}
    </div>
  )
}

/**
 * The review page.
 * @param props - see {@link ReviewPageProps}.
 */
export function ReviewPage(props: ReviewPageProps) {
  const { loadKey, load, reviewItem, reviewFiles, confirm, sendBack, onBack, onDone, t } = props
  const ids = useId()
  const [review, setReview] = useState<ProposalReview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [gone, setGone] = useState(false)
  const [name, setName] = useState('')
  const [layers, setLayers] = useState<Record<string, Record<string, boolean>>>({})
  const [drill, setDrill] = useState<
    | null
    | { kind: 'items'; views: ReviewItem[]; loading: boolean; error: string | null }
    | { kind: 'files'; files: ReviewFiles | null; error: string | null }
  >(null)
  const [returning, setReturning] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  // The loader is a fresh closure every render; `loadKey` alone says when to re-read.
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    let cancelled = false
    setReview(null)
    setLoadError(null)
    setGone(false)
    void loadRef.current().then((result) => {
      if (cancelled) return
      if (!result.ok) {
        setLoadError(result.error.message)
        return
      }
      if (result.value == null) {
        setGone(true)
        return
      }
      setReview(result.value)
      setName(result.value.proposal.registryId)
      setLayers(initialLayers(result.value))
    })
    return () => { cancelled = true }
  }, [loadKey])

  const chips = useMemo(() => (review === null ? [] : summaryChips(review, t)), [review, t])

  if (loadError !== null) {
    return (
      <div className={css.page}>
        <div className={css.pageHead}><Button size="sm" variant="ghost" onClick={onBack}>{t('review.back')}</Button></div>
        <ErrorState what={t('review.error')} message={loadError} t={t} />
      </div>
    )
  }
  if (gone) {
    // The held version was confirmed elsewhere (or the branch moved back): nothing waits.
    return (
      <div className={css.page}>
        <div className={css.pageHead}><Button size="sm" variant="ghost" onClick={onBack}>{t('review.back')}</Button></div>
      </div>
    )
  }
  if (review === null) {
    return (
      <div className={css.page}>
        <div className={css.pageHead}><Button size="sm" variant="ghost" onClick={onBack}>{t('review.back')}</Button></div>
        <div className={css.muted}>{t('review.loading')}</div>
      </div>
    )
  }

  const { proposal, facts, compare, problems, warnings, items } = review
  const update = compare.mode === 'update'
  const trimmed = name.trim()
  const nameOk = checkDatasetName(trimmed)
  const emptySet = facts.sets.some(set => !Object.values(layers[set.set] ?? {}).some(Boolean))
  const canConfirm = problems.length === 0 && nameOk && !emptySet && !busy
  const sourceFiles = compare.sources.reduce((sum, row) => sum + (row.files ?? 0), 0)
  const outputFiles = compare.outputs.reduce((sum, row) => sum + row.files, 0)
  const deletions = (compare.changes ?? []).filter(change => change.status === 'D')
  const otherChanges = (compare.changes ?? []).filter(change => change.status !== 'D')
  const sample = proposal.samples?.[0]
  const firstItem = sample !== undefined ? { set: sample.set, item: sample.item } : items[0]

  const openItems = (picks: ReadonlyArray<{ set: string; item: string }>): void => {
    if (reviewItem === null || picks.length === 0) return
    setDrill({ kind: 'items', views: [], loading: true, error: null })
    void Promise.all(picks.map(pick => reviewItem(pick.set, pick.item))).then((answers) => {
      const failed = answers.find(answer => !answer.ok)
      setDrill({
        kind: 'items',
        views: answers.flatMap(answer => (answer.ok ? [answer.value] : [])),
        loading: false,
        error: failed !== undefined && !failed.ok ? failed.error.message : null,
      })
    })
  }
  const openFiles = (): void => {
    if (reviewFiles === null) return
    setDrill({ kind: 'files', files: null, error: null })
    void reviewFiles().then((answer) => {
      setDrill(answer.ok ? { kind: 'files', files: answer.value, error: null } : { kind: 'files', files: null, error: answer.error.message })
    })
  }
  const submit = (): void => {
    if (!canConfirm) return
    const sets: Record<string, { layers: string[] }> = {}
    for (const set of facts.sets) {
      sets[set.set] = { layers: set.layers.map(layer => layer.name).filter(layer => layers[set.set]?.[layer] === true) }
    }
    setBusy(true)
    setConfirmError(null)
    void confirm(trimmed, sets, review).then((answer) => {
      setBusy(false)
      if (answer.ok) onDone(answer.value)
      else setConfirmError(answer.error.message)
    })
  }

  const versionText = update && facts.registered !== undefined
    ? t('review.versionStep', { from: facts.registered.number, to: facts.version.number, date: day(facts.version.date) })
    : t('review.versionOne', { number: facts.version.number, date: day(facts.version.date) })
  const validateText = !facts.validate.ok
    ? t('review.validateFail', { count: facts.validate.errors.length })
    : facts.validate.warnings > 0 ? t('review.validateWarn', { count: facts.validate.warnings }) : t('review.validateOk')

  return (
    <div className={css.page}>
      <div className={css.column}>
        <div className={css.pageHead}>
          <Button size="sm" variant="ghost" onClick={onBack}>{t('review.back')}</Button>
          <h2 className={css.pageTitle}>
            {update ? t('review.titleUpdate', { name: proposal.registryId }) : t('review.titleNew', { name: proposal.registryId })}
          </h2>
        </div>

        <dl className={css.facts}>
          <div className={css.fact}>
            <dt>{t('review.factSource')}</dt>
            <dd>
              <span>{proposal.source.label}</span>
              <span className={css.muted}> · {t(`review.sourceKind.${proposal.source.kind}`)}</span>
              {proposal.source.path !== undefined && <div className={css.factSub} title={proposal.source.path}>{proposal.source.path}</div>}
              {proposal.source.license !== undefined && <div className={css.factSub}>{proposal.source.license}</div>}
            </dd>
          </div>
          <div className={css.fact}>
            <dt>{t('review.factItems')}</dt>
            <dd>
              <span className={css.factNumber}>{facts.itemCount.toLocaleString()}</span>
              <div className={css.factSub}>{t('review.sets', { count: facts.sets.length, names: facts.sets.map(set => set.set).join('、') })}</div>
            </dd>
          </div>
          <div className={css.fact}>
            <dt>{t('review.factValidate')}</dt>
            <dd><Chip tone={facts.validate.ok ? (facts.validate.warnings > 0 ? 'warn' : 'ok') : 'danger'}>{validateText}</Chip></dd>
          </div>
          <div className={css.fact}>
            <dt>{t('review.factVersion')}</dt>
            <dd title={facts.version.commit}>{versionText}</dd>
          </div>
        </dl>

        {proposal.notes !== undefined && proposal.notes !== '' && (
          <div className={css.notes}>
            <div className={css.findingTitle}>{t('review.notes')}</div>
            <div>{proposal.notes}</div>
          </div>
        )}
        {/* The held version (`pendingReview`'s synthetic `pending-<id>`): no agent wrote an account. */}
        {proposal.id.startsWith('pending-') && (
          <div className={css.notes}>
            <div className={css.findingTitle}>{t('review.heldTitle')}</div>
            <div>{t('review.heldBody')}</div>
          </div>
        )}

        <Findings problems={problems} warnings={warnings} t={t} />

        <section className={css.section} aria-labelledby={`${ids}-compare`}>
          <div className={css.sectionHead}>
            <h3 id={`${ids}-compare`} className={css.sectionTitle}>{update ? t('review.compareUpdate') : t('review.compareNew')}</h3>
            <span className={css.chips}>
              {chips.map(chip => <Chip key={chip.key} tone={chip.tone}>{chip.text}</Chip>)}
            </span>
          </div>
          {!update && compare.sourceRead && compare.sources.length > 0 && (
            <div className={css.muted}>{t('review.untouched', { files: sourceFiles, outputs: outputFiles })}</div>
          )}
          {!update && !compare.sourceRead && compare.sources.length > 0 && <div className={css.warnLine}>{t('review.sourceUnread')}</div>}
          {compare.unlayered.length > 0 && (
            <div className={css.warnLine} title={compare.unlayered.slice(0, 50).join('\n')}>
              {t('review.unlayeredCount', { count: compare.unlayered.length })}
            </div>
          )}
          <div className={css.twoCol}>
            <div className={css.colBox}>
              <div className={css.colHead}>{update ? t('review.changes') : t('review.sources')}</div>
              {update
                ? (
                  <>
                    {deletions.length > 0 && <div className={css.warnLine}>{t('review.deletions', { count: deletions.length })}</div>}
                    <ul className={css.cmpList}>
                      {deletions.map(change => <ChangeRow key={change.path} change={change} t={t} />)}
                      {otherChanges.slice(0, 200).map(change => <ChangeRow key={change.path} change={change} t={t} />)}
                    </ul>
                    {otherChanges.length > 200 && <div className={css.muted}>{t('review.listTruncated')}</div>}
                  </>
                )
                : compare.sources.length === 0
                  ? <div className={css.muted}>{t('review.noSources')}</div>
                  : <ul className={css.cmpList}>{compare.sources.map(row => <SourceRow key={row.path} row={row} t={t} />)}</ul>}
            </div>
            <div className={css.colBox}>
              <div className={css.colHead}>{t('review.outputs')}</div>
              <ul className={css.cmpList}>{compare.outputs.map(row => <OutputRow key={row.path} row={row} update={update} t={t} />)}</ul>
            </div>
          </div>
          {reviewItem !== null && items.length > 0 && (
            <div className={css.drillLinks}>
              {firstItem !== undefined && (
                <button type="button" className={css.link} onClick={() => { openItems([firstItem]) }}>
                  {t('review.itemOne')}{` · ${firstItem.item}`}
                </button>
              )}
              <button type="button" className={css.link} onClick={() => { openItems(pickRandom(items, 3)) }}>{t('review.itemRandom')}</button>
              {reviewFiles !== null && <button type="button" className={css.link} onClick={openFiles}>{t('review.fullList')}</button>}
              {drill !== null && <button type="button" className={css.link} onClick={() => { setDrill(null) }}>{t('review.close')}</button>}
            </div>
          )}
          {drill?.kind === 'items' && (
            <div className={css.drill}>
              {drill.loading && <div className={css.muted}>{t('review.loading')}</div>}
              {drill.error !== null && <ErrorState what={t('review.error')} message={drill.error} compact t={t} />}
              {drill.views.map(view => <ItemCompare key={`${view.set}/${view.item}`} view={view} t={t} />)}
            </div>
          )}
          {drill?.kind === 'files' && (
            <div className={css.drill}>
              {drill.error !== null && <ErrorState what={t('review.error')} message={drill.error} compact t={t} />}
              {drill.files === null && drill.error === null && <div className={css.muted}>{t('review.loading')}</div>}
              {drill.files !== null && (
                <>
                  {drill.files.truncated && <div className={css.muted}>{t('review.listTruncated')}</div>}
                  <ul className={css.fullList}>
                    {drill.files.outputs.map(file => (
                      <li key={file.path}>
                        <span className={css.cmpPath} title={file.path}>{file.path}</span>
                        <span className={css.cmpOrigin}>{originText(file, t)}</span>
                        {file.layer !== undefined
                          ? <span className={css.mono}>{t('review.layerTag', { layer: file.layer })}</span>
                          : (file.zone === 'passthrough' || file.zone === 'item-meta') && <Chip tone="warn">{t('review.unlayered')}</Chip>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </section>

        <section className={css.section} aria-labelledby={`${ids}-layers`}>
          <div className={css.sectionHead}>
            <h3 id={`${ids}-layers`} className={css.sectionTitle}>{t('review.layersTitle')}</h3>
          </div>
          {facts.sets.map(set => (
            <div key={set.set} className={css.layerSet}>
              {facts.sets.length > 1 && <div className={css.colHead}>{set.title === set.set ? set.set : `${set.set} · ${set.title}`}</div>}
              {set.layers.map((layer) => {
                const value = layers[set.set]?.[layer.name] === true
                const word = (visible: boolean): string => (visible ? t('review.layerVisible') : t('review.layerHidden'))
                return (
                  <div key={layer.name} className={css.layerRow}>
                    <div className={css.layerName}>
                      <span className={css.mono}>{layer.name}</span>
                      {layer.reason !== undefined && <span className={css.cmpNote}>{layer.reason}</span>}
                      <span className={css.cmpNote}>
                        {t('review.layerSuggest', { word: word(layer.suggested) })}
                        {layer.registered !== undefined && ` · ${t('review.layerNow', { word: word(layer.registered) })}`}
                      </span>
                    </div>
                    <span className={css.layerToggle}>
                      <span className={value ? css.layerWordOn : css.layerWordOff}>{word(value)}</span>
                      <Switch
                        checked={value}
                        label={`${set.set}/${layer.name} · ${t('review.layerVisible')}`}
                        onChange={(next) => {
                          setLayers({ ...layers, [set.set]: { ...layers[set.set], [layer.name]: next } })
                        }}
                      />
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
          {emptySet && <div className={css.error}>{t('review.keepOne')}</div>}
        </section>

        <section className={css.section}>
          <div className={css.formRow}>
            <label className={css.formLabel} htmlFor={`${ids}-name`}>{t('review.factName')}</label>
            <Input
              id={`${ids}-name`}
              value={name}
              disabled={update}
              onChange={(e) => { setName(e.target.value) }}
              aria-invalid={!nameOk}
              aria-label={t('review.factName')}
            />
            <div className={nameOk ? css.help : css.error}>{nameOk ? t('review.nameHelp') : t('add.nameBad')}</div>
          </div>
          <details className={css.advanced}>
            <summary>{t('review.advanced')}</summary>
            <dl className={css.advList}>
              <dt>{t('review.advRepo')}</dt><dd className={css.mono}>{facts.version.commonDir}</dd>
              <dt>{t('review.advRef')}</dt><dd className={css.mono}>{facts.version.trackedRef}</dd>
              <dt>{t('review.advCheckout')}</dt><dd className={css.mono}>{facts.version.checkout ?? t('review.advNone')}</dd>
              <dt>{t('review.advCommit')}</dt><dd className={css.mono} title={facts.version.commit}>{shortCommit(facts.version.commit)}</dd>
            </dl>
          </details>
        </section>

        {confirmError !== null && <ErrorState what={t('notice.failed')} message={confirmError} compact t={t} />}
        {returning && sendBack !== null && (
          <div className={css.formRow}>
            <label className={css.formLabel} htmlFor={`${ids}-note`}>{t('review.returnNote')}</label>
            <textarea id={`${ids}-note`} className={css.textarea} rows={3} value={note} onChange={(e) => { setNote(e.target.value) }} />
          </div>
        )}
        <div className={css.footer}>
          {sendBack !== null && (returning
            ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => { setReturning(false) }}>{t('review.cancel')}</Button>
                <Button size="sm" variant="outline" disabled={note.trim() === ''} onClick={() => { sendBack(note) }}>{t('review.returnSend')}</Button>
              </>
            )
            : <Button size="sm" variant="outline" onClick={() => { setReturning(true) }}>{t('review.return')}</Button>)}
          <Button size="sm" variant="primary" disabled={!canConfirm} onClick={submit}>
            {busy ? t('review.confirming') : update ? t('review.confirmUpdate') : t('review.confirm')}
          </Button>
        </div>
      </div>
    </div>
  )
}
