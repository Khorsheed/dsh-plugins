import { useMemo, useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChapterDeletionView } from '../chapter-deletion.ts'
import type { NovelSurfaceProps } from './contract.ts'
import { errorKey } from './use-novel.ts'
import css from './chapter-deletion.module.css'

type Props = Pick<NovelSurfaceProps, 'canvasId' | 'remote' | 'sessionId' | 'navigate' | 't'>
type Target = { readonly deletionId: string; readonly n: number; readonly title: string }

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`
}

function derivedTotal(operation: ChapterDeletionView): number {
  const counts = operation.counts
  return counts.mentions + counts.experiences + counts.relations + counts.history + counts.minds + counts.pending + counts.feedback
}

function targetsOf(operations: readonly ChapterDeletionView[]): Target[] {
  return operations.flatMap(operation => operation.chapters.map(row => ({ deletionId: operation.id, n: row.n, title: row.title })))
}

/** The person's impact preview before one chapter batch is deleted. */
export function DeleteChaptersDialog({ operation, onClose, onDone, ...props }: Props & {
  readonly operation: ChapterDeletionView
  readonly onClose: () => void
  readonly onDone: (cleanupPending: boolean) => void
}): ReactNode {
  const { canvasId, sessionId, remote, navigate, t } = props
  const api = remote()
  const [cards, setCards] = useState<ReadonlySet<string>>(() => new Set(operation.cascadeCards.map(row => row.id)))
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  if (api === undefined || sessionId === undefined) return null
  const apply = (): void => {
    setBusy(true)
    setFailure(null)
    void api.applyChapterDeletion(sessionId, { canvasId, deletionId: operation.id, cards: [...cards] }).then(result => {
      setBusy(false)
      if (!result.ok) { setFailure(t('error.generic', { message: result.error.message })); return }
      if (!result.value.ok) { setFailure(t(errorKey(result.value.error))); return }
      onDone(result.value.cleanupPending === true)
      navigate.refresh()
    }).catch((error: unknown) => {
      setBusy(false)
      setFailure(t('error.generic', { message: error instanceof Error ? error.message : String(error) }))
    })
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={t('delete.title', { count: operation.chapters.length })}
      closeLabel={t('edit.cancel')}
      description={t('delete.summary', { bodies: operation.counts.bodies, plans: operation.counts.plans })}
      footer={(
        <>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>{t('edit.cancel')}</Button>
          <Button size="sm" variant="primary" className={css.dangerButton} disabled={busy} onClick={apply}>{t(busy ? 'delete.applying' : 'delete.confirm')}</Button>
        </>
      )}
    >
      <div className={css.impact}>
        <p className={css.warning}>{t('delete.warning')}</p>
        <Impact title={t('delete.owned')} count={t('delete.ownedCount', { count: derivedTotal(operation) })}>
          <p>{t('delete.bodiesPlans', { bodies: operation.counts.bodies, plans: operation.counts.plans, words: operation.counts.words })}</p>
          <p>{t('delete.records', { mentions: operation.counts.mentions, experiences: operation.counts.experiences, relations: operation.counts.relations, history: operation.counts.history })}</p>
        </Impact>
        <Impact title={t('delete.unlink')} count={t('delete.shared')}>
          <p>{t('delete.sharedDetail')}</p>
        </Impact>
        {operation.cascadeCards.length > 0 && (
          <Impact title={t('delete.cascade')} count={t('delete.cascadeCount', { count: cards.size })}>
            {operation.cascadeCards.map(card => (
              <label key={card.id} className={css.checkRow}>
                <input
                  type="checkbox"
                  checked={cards.has(card.id)}
                  onChange={() => {
                    setCards(current => {
                      const next = new Set(current)
                      if (next.has(card.id)) next.delete(card.id)
                      else next.add(card.id)
                      return next
                    })
                  }}
                />
                <span>{card.name}</span><small>{t('delete.cascadeCandidate')}</small>
              </label>
            ))}
          </Impact>
        )}
        {operation.reviewCards.length > 0 && (
          <Impact title={t('delete.review')} count={t('delete.reviewCount', { count: operation.reviewCards.length })}>
            <p>{operation.reviewCards.map(row => row.name).join('、')}</p>
            <small>{t('delete.reviewDetail')}</small>
          </Impact>
        )}
        <p className={css.recycleNote}>{t('delete.recycleNote')}</p>
        {failure !== null && <p className={css.failure} role="alert">{failure}</p>}
      </div>
    </Modal>
  )
}

function Impact({ title, count, children }: { readonly title: string; readonly count: string; readonly children: ReactNode }): ReactNode {
  return <section className={css.impactGroup}><h3>{title}<span>{count}</span></h3><div className={css.impactBody}>{children}</div></section>
}

/** The recycle bin: per-chapter restore, selected purge and explicit empty-all. */
export function RecycleBinDialog({ operations, size, onClose, ...props }: Props & {
  readonly operations: readonly ChapterDeletionView[]
  readonly size: number
  readonly onClose: () => void
}): ReactNode {
  const { canvasId, sessionId, remote, navigate, t } = props
  const api = remote()
  const targets = useMemo(() => targetsOf(operations), [operations])
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [view, setView] = useState<'list' | 'restore' | 'purge'>('list')
  const [position, setPosition] = useState<'original' | 'next'>('original')
  const [restoreCards, setRestoreCards] = useState(false)
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  if (api === undefined || sessionId === undefined) return null
  const chosen = targets.filter(row => selected.has(`${row.deletionId}:${row.n}`))
  const selectedSize = operations.reduce((sum, operation) => sum + operation.chapters.filter(row => selected.has(`${operation.id}:${row.n}`)).reduce((inner, row) => inner + row.size, 0), 0)
  const groups = (list: readonly Target[]): Map<string, number[]> => {
    const out = new Map<string, number[]>()
    for (const row of list) out.set(row.deletionId, [...out.get(row.deletionId) ?? [], row.n])
    return out
  }
  const toggleAll = (): void => {
    setSelected(current => current.size === targets.length ? new Set() : new Set(targets.map(row => `${row.deletionId}:${row.n}`)))
  }
  const run = async (kind: 'restore' | 'purge', list: readonly Target[]): Promise<void> => {
    setBusy(true)
    setFailure(null)
    const errors: string[] = []
    for (const [deletionId, chapters] of groups(list)) {
      const result = kind === 'restore'
        ? await api.restoreChapters(sessionId, { canvasId, deletionId, chapters, ...(restoreCards ? { cards: operations.find(row => row.id === deletionId)?.cascadeCards.map(row => row.id) ?? [] } : {}), position })
        : await api.purgeChapters(sessionId, { canvasId, deletionId, chapters })
      if (!result.ok) { errors.push(result.error.message); continue }
      if (!result.value.ok) { errors.push(result.value.error ?? 'io'); continue }
      for (const cardError of result.value.cardErrors ?? []) errors.push(cardError)
    }
    setBusy(false)
    if (errors.length > 0) setFailure(t('recycle.operationFailed', { message: errors.join('、') }))
    navigate.refresh()
    if (errors.length === 0) onClose()
  }
  return (
    <Modal
      open
      onClose={view === 'list' ? onClose : () => { setView('list'); setFailure(null) }}
      title={t(view === 'list' ? 'recycle.title' : view === 'restore' ? 'recycle.restoreTitle' : 'recycle.purgeTitle')}
      closeLabel={t('edit.cancel')}
      description={t(view === 'list' ? 'recycle.subtitle' : view === 'restore' ? 'recycle.restoreNote' : 'recycle.purgeNote')}
      footer={view === 'list' ? (
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>{t('recycle.close')}</Button>
          <Button size="sm" variant="outline" disabled={busy || chosen.length === 0} onClick={() => { setView('restore'); setFailure(null) }}>{t('recycle.restoreSelected', { count: chosen.length })}</Button>
          <Button size="sm" variant="primary" className={css.dangerButton} disabled={busy || chosen.length === 0} onClick={() => { setView('purge'); setAck(false); setFailure(null) }}>{t('recycle.purgeSelected', { count: chosen.length })}</Button>
        </>
      ) : view === 'restore' ? (
        <>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setView('list') }}>{t('edit.cancel')}</Button>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => { void run('restore', chosen) }}>{t('recycle.confirmRestore')}</Button>
        </>
      ) : (
        <>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setView('list') }}>{t('edit.cancel')}</Button>
          <Button size="sm" variant="primary" className={css.dangerButton} disabled={busy || !ack} onClick={() => { void run('purge', chosen) }}>{t('recycle.confirmPurge')}</Button>
        </>
      )}
    >
      {view === 'list' ? (
        <div className={css.recycleList}>
          <div className={css.storage}>
            <div><small>{t('recycle.size')}</small><strong>{formatSize(size)}</strong><span>{t('recycle.items', { count: targets.length })}</span></div>
            <Button size="sm" variant="ghost" disabled={busy || targets.length === 0} onClick={() => { setSelected(new Set(targets.map(row => `${row.deletionId}:${row.n}`))); setView('purge'); setAck(false) }}>{t('recycle.emptyAll')}</Button>
          </div>
          <p className={css.muted}>{t('recycle.scope')}</p>
          {targets.length === 0 ? <p className={css.empty}>{t('recycle.empty')}</p> : (
            <>
              <label className={css.selectAll}><input type="checkbox" checked={selected.size === targets.length && targets.length > 0} onChange={toggleAll} />{t('recycle.selectAll')}<span>{selected.size > 0 ? t('recycle.selectedSize', { size: formatSize(selectedSize) }) : ''}</span></label>
              {operations.map(operation => (
                <section key={operation.id} className={css.deletionBatch}>
                  <h3>{t('recycle.batch', { time: operation.updatedAt.slice(0, 16).replace('T', ' ') })}<span>{formatSize(operation.size)}</span></h3>
                  {operation.chapters.map(row => {
                    const key = `${operation.id}:${row.n}`
                    return (
                      <div className={css.recycleRow} key={key} data-selected={selected.has(key) || undefined}>
                        <input type="checkbox" checked={selected.has(key)} aria-label={t('recycle.selectChapter', { n: row.n })} onChange={() => {
                          setSelected(current => {
                            const next = new Set(current)
                            if (next.has(key)) next.delete(key)
                            else next.add(key)
                            return next
                          })
                        }} />
                        <span className={css.recycleChapter}><strong>{t('strip.chapter', { n: row.n })} · {row.title}</strong><small>{row.hasBody ? t('recycle.bodyAndPlan', { words: row.words }) : t('recycle.planOnly')}</small></span>
                        <span className={css.rowSize}>{formatSize(row.size)}</span>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => { setSelected(new Set([key])); setView('restore'); setFailure(null) }}>{t('recycle.restore')}</Button>
                      </div>
                    )
                  })}
                </section>
              ))}
            </>
          )}
        </div>
      ) : view === 'restore' ? (
        <div className={css.confirmView}>
          <p>{t('recycle.restoreSummary', { count: chosen.length, size: formatSize(selectedSize) })}</p>
          <label className={css.field}><span>{t('recycle.position')}</span><select value={position} onChange={event => { setPosition(event.target.value as 'original' | 'next') }}><option value="original">{t('recycle.original')}</option><option value="next">{t('recycle.next')}</option></select></label>
          {chosen.some(row => (operations.find(operation => operation.id === row.deletionId)?.cascadeCards.length ?? 0) > 0) && (
            <label className={css.checkRow}><input type="checkbox" checked={restoreCards} onChange={event => { setRestoreCards(event.target.checked) }} /><span>{t('recycle.restoreCards')}</span></label>
          )}
          <p className={css.muted}>{t('recycle.restoreCardsNote')}</p>
        </div>
      ) : (
        <div className={css.confirmView}>
          <p>{t('recycle.purgeSummary', { count: chosen.length, size: formatSize(selectedSize) })}</p>
          <ul className={css.scopeList}><li>{t('recycle.purgeIncluded')}</li><li>{t('recycle.purgeExcluded')}</li><li>{t('recycle.purgeMetadata')}</li></ul>
          <label className={css.checkRow}><input type="checkbox" checked={ack} onChange={event => { setAck(event.target.checked) }} /><span>{t('recycle.purgeAck')}</span></label>
        </div>
      )}
      {failure !== null && <p className={css.failure} role="alert">{failure}</p>}
    </Modal>
  )
}
