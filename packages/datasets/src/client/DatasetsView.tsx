/**
 * The 题集 conversation view (the 'datasets' tab beside chat and trajectory).
 * Two pages, one shell (ui-spec §四): a LIST of datasets — one row each, with
 * the snapshot, the item count, the slot ← layer mapping, the canary, the
 * `validate` outcome and the experiments that used it — and a DETAIL page for
 * one dataset: the file tree with a slot marker on every leaf, «选手将看到»,
 * «可判性», «作答记录», and the selected file's preview.
 *
 * This module owns the fetches and the page switch; the two pages own their
 * layout, and `parts.tsx` owns the vocabulary they share. Every write here is
 * a HUMAN gesture with a form in front of it (binding, dataset skeleton, item
 * skeleton, item import) and every one of them lands in the working tree only
 * — the commit stays the human's, and the tab says so on each form.
 *
 * The tab shows what the OPERATOR may see: the binding's whitelist constrains
 * the session's agent, never the human reading their own repository (protocol
 * §3), so a sensitive layer lists here with a quiet marker rather than being
 * hidden. What is genuinely unprotected — the passthrough zone and item.json —
 * is marked loudly, because that is the thing an author can get wrong.
 */

import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { BindForm } from './BindForm.tsx'
import type { DatasetBinding, DatasetOverviewRow, ListItemsResult } from '../types.ts'
import type { DatasetsViewProps } from './contract.ts'
import { DatasetDetail } from './DatasetDetail.tsx'
import { DatasetList } from './DatasetList.tsx'
import { ErrorState } from './ErrorState.tsx'
import { snapshotCell } from './parts.tsx'
import { SkeletonForm } from './SkeletonForm.tsx'
import { itemKey, type DatasetsForm } from './store.ts'
import css from './DatasetsView.module.css'

/** The dataset row the detail page is about, synthesized when the list has not answered yet. */
function rowOf(rows: readonly DatasetOverviewRow[] | undefined, id: string): DatasetOverviewRow {
  return rows?.find(row => row.id === id)
    ?? { id, itemCount: 0, layers: [], nonModelFacingLayers: [], slotLayers: {}, canary: false, warnings: [], validate: null }
}

/**
 * The 题集 tab body.
 * @param props - composed props (runtime + store + injected + locale shares).
 */
export function DatasetsView(props: DatasetsViewProps) {
  const {
    sessionId, useSessions, useStore, actions, t,
    fetchBinding, bindSession, unbindSession, listDatasets, readFile, readPassthroughFile,
    overview, itemBrief, validateDataset, scaffoldDataset, scaffoldItem, importItem,
    itemRuns, datasetExperiments,
    isLoopback, pickDirectory, previewRepo,
  } = props
  const { useHostDescription } = props
  const binding = useStore(s => s.binding)
  const bindingLoaded = useStore(s => s.bindingLoaded)
  const notice = useStore(s => s.notice)
  const overviewValue = useStore(s => s.overview)
  const listLoading = useStore(s => s.listLoading)
  const listError = useStore(s => s.listError)
  const refreshRev = useStore(s => s.refreshRev)
  const page = useStore(s => s.page)
  const openDataset = useStore(s => s.openDataset)
  const openItem = useStore(s => s.openItem)
  const items = useStore(s => s.items)
  const sharedLayers = useStore(s => s.sharedLayers)
  const passthrough = useStore(s => s.passthrough)
  const slotFilter = useStore(s => s.slotFilter)
  const briefs = useStore(s => s.briefs)
  const briefLoading = useStore(s => s.briefLoading)
  const briefError = useStore(s => s.briefError)
  const runs = useStore(s => s.runs)
  const experiments = useStore(s => s.experiments)
  const validated = useStore(s => s.validated)
  const validating = useStore(s => s.validating)
  const form = useStore(s => s.form)
  const skeleton = useStore(s => s.skeleton)
  const selection = useStore(s => s.selection)
  const preview = useStore(s => s.preview)
  const previewLoading = useStore(s => s.previewLoading)
  const previewError = useStore(s => s.previewError)
  // Component-private view state: whether the bind/edit form is open.
  const [bindOpen, setBindOpen] = useState(false)
  // Which item briefs have been asked for. A REF, not store state: the request
  // sets a loading flag, the flag re-renders, and a re-render that re-ran the
  // effect would cancel the very request it just started (the effect's cleanup
  // drops the answer). The ref keeps the guard out of the dependency list.
  const requestedBriefs = useRef(new Set<string>())
  const currentCwd = useSessions(s => s.byId[sessionId]?.cwd)
  const canPick = isLoopback && useHostDescription(description => description?.canOpenPath === true)

  // The binding on mount and after every refresh, then the list page's rows.
  useEffect(() => {
    let cancelled = false
    actions.setListLoading(true)
    actions.setListError(null)
    void fetchBinding(sessionId).then((result) => {
      if (cancelled) return
      if (!result.ok) {
        actions.setListLoading(false)
        // Settle the bar too: an unanswerable binding read must not leave the
        // tab on "loading" forever (a dead session errors on every fetch).
        // setBinding resets the list error as part of its cascade, so the
        // error goes on after it.
        actions.setBinding(null)
        actions.setListError(result.error.message)
        return
      }
      actions.setBinding(result.value)
      if (result.value === null) {
        actions.setListLoading(false)
        return
      }
      void overview(sessionId).then((answer) => {
        if (cancelled) return
        actions.setListLoading(false)
        if (answer.ok) actions.setOverview(answer.value)
        else actions.setListError(answer.error.message)
      })
    })
    return () => { cancelled = true }
  }, [sessionId, refreshRev, actions, fetchBinding, overview])

  // The «用于的实验» column, once per binding. A null answer means this
  // instance carries no eval plugin, and the column never renders.
  useEffect(() => {
    if (binding === null || experiments !== null) return
    let cancelled = false
    void datasetExperiments(sessionId).then((rows) => {
      if (!cancelled && rows !== null) actions.setExperiments(rows)
    })
    return () => { cancelled = true }
  }, [sessionId, binding, experiments, actions, datasetExperiments])

  // One dataset's items when its detail page opens (cached afterwards).
  useEffect(() => {
    if (openDataset === null || items[openDataset] !== undefined) return
    let cancelled = false
    const dataset = openDataset
    void listDatasets(sessionId, dataset).then((result) => {
      if (cancelled || !result.ok) return
      if (result.value.kind === 'items') actions.setDetails(dataset, result.value as ListItemsResult)
    })
    return () => { cancelled = true }
  }, [sessionId, openDataset, items, actions, listDatasets])

  // The open item's brief and its answer record, once per item per refresh.
  useEffect(() => {
    if (openDataset === null || openItem === null) return
    const key = itemKey(openDataset, openItem)
    if (requestedBriefs.current.has(`${refreshRev}:${key}`)) return
    requestedBriefs.current.add(`${refreshRev}:${key}`)
    actions.setBriefLoading(key, true)
    void itemBrief(sessionId, openDataset, openItem).then((result) => {
      actions.setBriefLoading(key, false)
      if (result.ok) actions.setBrief(key, result.value)
      else actions.setBriefError(key, result.error.message)
    })
    void itemRuns(sessionId, openDataset, openItem).then((answer) => {
      actions.setRuns(key, answer)
    })
  }, [sessionId, refreshRev, openDataset, openItem, actions, itemBrief, itemRuns])

  // The selected file's content; a stale request is dropped when the selection moves.
  useEffect(() => {
    if (selection === null) return
    let cancelled = false
    const target = selection
    actions.setPreviewLoading(true)
    actions.setPreviewError(null)
    const request = target.kind === 'passthrough'
      ? readPassthroughFile(sessionId, { dataset: target.dataset, path: target.path })
      : readFile(sessionId, {
        dataset: target.dataset,
        ...(target.item !== null ? { item: target.item } : {}),
        layer: target.layer, path: target.path,
      })
    void request.then((result) => {
      if (cancelled) return
      actions.setPreviewLoading(false)
      if (result.ok) actions.setPreview(result.value)
      else actions.setPreviewError(result.error.message)
    })
    return () => { cancelled = true }
  }, [sessionId, selection, actions, readFile, readPassthroughFile])

  const submitBinding = (next: DatasetBinding): void => {
    void bindSession(sessionId, next).then((result) => {
      if (result.ok) {
        actions.setNotice(null)
        setBindOpen(false)
        actions.refresh()
      } else {
        actions.setNotice(result.error.message)
      }
    })
  }
  const clearBinding = (): void => {
    void unbindSession(sessionId).then((result) => {
      if (result.ok) {
        actions.setNotice(null)
        actions.refresh()
      } else {
        actions.setNotice(result.error.message)
      }
    })
  }

  /** Run one write gesture, then refresh what it could have changed. */
  const submitForm = (values: Record<string, string>): void => {
    const dataset = openDataset
    const call = form === 'newDataset'
      ? scaffoldDataset(sessionId, {
        id: values['id'] ?? '',
        ...(values['name'] !== undefined && values['name'] !== '' ? { name: values['name'] } : {}),
      })
      : form === 'newItem' && dataset !== null
        ? scaffoldItem(sessionId, { dataset, item: values['item'] ?? '' })
        : form === 'importItem' && dataset !== null
          ? importItem(sessionId, {
            dataset, item: values['item'] ?? '', sourceDir: values['sourceDir'] ?? '',
          })
          : null
    if (call === null) return
    void call.then((result) => {
      if (!result.ok) {
        actions.setNotice(result.error.message)
        return
      }
      actions.setNotice(null)
      actions.setSkeleton(result.value)
      // The write landed in the working tree; every read here is at HEAD, so
      // the list is refreshed for the commit the human is about to make (and
      // the skeleton panel says as much).
      actions.refresh()
    })
  }

  const runValidate = (): void => {
    if (openDataset === null) return
    const dataset = openDataset
    actions.setValidating(true)
    void validateDataset(sessionId, dataset).then((result) => {
      actions.setValidating(false)
      if (!result.ok) {
        actions.setNotice(result.error.message)
        return
      }
      const one = result.value.datasets.find(entry => entry.id === dataset)
      if (one !== undefined) actions.setValidated(dataset, one)
    })
  }

  const rows = overviewValue?.datasets ?? []
  const detailRow = openDataset === null ? null : rowOf(rows, openDataset)
  // The session's agent-readable layer set: the binding's explicit whitelist
  // when written, else the modelFacing floor (sensitive layers are blocked by
  // default; a dataset declaring none reads fully).
  const agentLayers = detailRow === null
    ? new Set<string>()
    : binding?.layers !== undefined
      ? new Set(binding.layers)
      : detailRow.nonModelFacingLayers.length === 0
        ? new Set(detailRow.layers)
        : new Set(detailRow.layers.filter(layer => !detailRow.nonModelFacingLayers.includes(layer)))
  const validatedRow = openDataset === null ? undefined : validated[openDataset]

  const openForm = (next: Exclude<DatasetsForm, null>): void => {
    actions.setNotice(null)
    actions.setForm(next)
  }

  return (
    <div className={css.view} data-conversation-composer-overlay="">
      <div className={css.bindingBar}>
        <div className={css.bindingSummary}>
          {page === 'detail' && (
            <Button size="sm" variant="ghost" onClick={() => { actions.openDataset(null) }}>
              {t('detail.back')}
            </Button>
          )}
          {binding !== null
            ? (
              <>
                <span className={css.bindingRepo} title={binding.repoPath}>
                  {page === 'detail' && detailRow !== null
                    ? `${detailRow.id} · ${overviewValue === null ? binding.repoPath : snapshotCell(overviewValue.repo, overviewValue.commit)}`
                    : t('binding.repo', { repo: binding.repoPath })}
                </span>
                <span className={css.bindingScope}>
                  {binding.datasets !== undefined ? binding.datasets.join(', ') : t('binding.allDatasets')}
                  {' · '}
                  {binding.layers !== undefined
                    ? t('binding.agentVisible', { layers: binding.layers.join(', ') })
                    : t('binding.agentVisibleFloor')}
                </span>
              </>
            )
            : (
              <span className={css.bindingNone}>
                {bindingLoaded ? t('binding.none') : t('list.loading')}
              </span>
            )}
          {page === 'list' && (
            <>
              <Button size="sm" onClick={() => { openForm('newDataset') }} disabled={binding === null}>
                {t('list.newDataset')}
              </Button>
              {binding === null
                ? (
                  <Button size="sm" variant="outline" onClick={() => { setBindOpen(true) }}>
                    {t('binding.bind')}
                  </Button>
                )
                : (
                  <Button size="sm" onClick={() => { setBindOpen(true) }}>
                    {t('binding.edit')}
                  </Button>
                )}
              {binding !== null && <Button size="sm" onClick={clearBinding}>{t('binding.unbind')}</Button>}
            </>
          )}
          {page === 'detail' && (
            <>
              <Button size="sm" onClick={() => { openForm('newItem') }}>{t('detail.newItem')}</Button>
              <Button size="sm" onClick={() => { openForm('importItem') }}>{t('detail.importItem')}</Button>
              <Button size="sm" onClick={runValidate} disabled={validating}>
                {validating ? t('detail.validating') : t('detail.validate')}
              </Button>
            </>
          )}
        </div>
        {notice !== null && !bindOpen && form === null && (
          <ErrorState what={t('notice.failed')} message={notice} path={binding?.repoPath} compact t={t} />
        )}
        {validatedRow !== undefined && (
          <div className={validatedRow.errors.length > 0 ? `${css.notice} ${css.noticeError}` : css.notice}>
            {validatedRow.errors.length === 0
              ? t('detail.validateOk', { warnings: validatedRow.warnings.length })
              : t('detail.validateFound', {
                errors: validatedRow.errors.length,
                warnings: validatedRow.warnings.length,
              })}
            {validatedRow.errors.slice(0, 3).map(error => (
              <div key={error.message} className={css.noticeLine}>{error.code}: {error.message}</div>
            ))}
          </div>
        )}
        {skeleton !== null && (
          <div className={css.notice}>
            <div>
              {t('skeleton.written', { count: skeleton.written.length })}
              {skeleton.skipped.length > 0 && ` · ${t('skeleton.skipped', { count: skeleton.skipped.length })}`}
            </div>
            {skeleton.written.map(path => <div key={path} className={css.noticeLine}>{path}</div>)}
            {skeleton.notes.map(note => <div key={note} className={css.noticeLine}>{note}</div>)}
            <div className={css.noticeLine}>{t('skeleton.commitHint')}</div>
            <Button size="sm" onClick={() => { actions.setSkeleton(null) }}>{t('skeleton.dismiss')}</Button>
          </div>
        )}
        {form !== null && (
          <SkeletonForm
            form={form}
            onSubmit={submitForm}
            onCancel={() => { actions.setForm(null) }}
            notice={notice}
            t={t}
          />
        )}
        {bindOpen && (
          <BindForm
            initial={binding}
            onSubmit={submitBinding}
            onCancel={() => { setBindOpen(false) }}
            currentCwd={currentCwd}
            canPick={canPick}
            pickDirectory={pickDirectory}
            previewRepo={path => previewRepo(sessionId, path)}
            notice={notice}
            t={t}
          />
        )}
      </div>
      {page === 'list' && (
        <>
          {bindingLoaded && binding === null && <div className={css.empty}>{t('list.unbound')}</div>}
          {listLoading && overviewValue === null && binding !== null && (
            <div className={css.empty}>{t('list.loading')}</div>
          )}
          {!listLoading && listError !== null && overviewValue === null && (
            <ErrorState what={t('list.error')} message={listError} path={binding?.repoPath} t={t} />
          )}
          {overviewValue !== null && overviewValue.datasets.length === 0 && (
            <div className={css.empty}>{t('list.empty')}</div>
          )}
          {overviewValue !== null && overviewValue.datasets.length > 0 && (
            <DatasetList
              repo={overviewValue.repo}
              commit={overviewValue.commit}
              rows={overviewValue.datasets}
              experiments={experiments}
              onOpen={(dataset) => { actions.openDataset(dataset) }}
              t={t}
            />
          )}
        </>
      )}
      {page === 'detail' && detailRow !== null && (
        <DatasetDetail
          dataset={detailRow}
          items={items[detailRow.id] ?? []}
          sharedLayers={sharedLayers[detailRow.id] ?? {}}
          passthrough={passthrough[detailRow.id] ?? []}
          sensitiveLayers={new Set(detailRow.nonModelFacingLayers)}
          agentLayers={agentLayers}
          openItem={openItem}
          onOpenItem={(item) => { actions.openItem(item) }}
          slotFilter={slotFilter}
          onSlotFilter={(slots) => { actions.setSlotFilter(slots) }}
          selection={selection}
          onSelect={(next) => { actions.select(next) }}
          brief={openItem === null ? undefined : briefs[itemKey(detailRow.id, openItem)]}
          briefLoading={openItem !== null && briefLoading[itemKey(detailRow.id, openItem)] === true}
          briefError={openItem === null ? undefined : briefError[itemKey(detailRow.id, openItem)]}
          runs={openItem === null ? undefined : runs[itemKey(detailRow.id, openItem)]}
          preview={preview}
          previewLoading={previewLoading}
          previewError={previewError}
          t={t}
        />
      )}
    </div>
  )
}
