/**
 * The datasets conversation view (the 'datasets' tab beside chat and
 * trajectory): the session's dataset binding and browser. Top binding bar
 * (current binding + whitelist display, bind/edit/unbind gestures — binding
 * writes stay human operations), a dataset → item → layer → file tree on the
 * left, and the selected file's content preview on the right, rendered by the
 * official reader primitives (see preview.tsx). All data comes from the
 * injected Remote callbacks; the whitelist the binding declares is enforced
 * host-side, so the tree only ever shows what the session may see.
 */

import { useEffect, useState } from 'react'
import type { DatasetBinding, ItemRecord, ListItemsResult } from '../types.ts'
import type { DatasetsViewProps } from './contract.ts'
import { DatasetPreview } from './preview.tsx'
import type { DatasetSelection } from './store.ts'
import css from './DatasetsView.module.css'

/** Parse a comma-separated whitelist field; blank means "everything" (absent). */
function parseList(raw: string): string[] | undefined {
  const list = raw.split(',').map(entry => entry.trim()).filter(entry => entry !== '')
  return list.length === 0 ? undefined : list
}

/**
 * The bind/edit form: repo path plus optional dataset and layer whitelists.
 * Local state only — the submitted binding lands in the store through the
 * Remote round-trip, never directly.
 */
function BindingForm(props: {
  initial: DatasetBinding | null
  onSubmit: (binding: DatasetBinding) => void
  onCancel: () => void
  t: DatasetsViewProps['t']
}) {
  const { initial, onSubmit, onCancel, t } = props
  const [repo, setRepo] = useState(initial?.repoPath ?? '')
  const [datasets, setDatasets] = useState(initial?.datasets?.join(', ') ?? '')
  const [layers, setLayers] = useState(initial?.layers?.join(', ') ?? '')
  return (
    <form
      className={css.bindForm}
      onSubmit={(event) => {
        event.preventDefault()
        const path = repo.trim()
        if (path === '') return
        const datasetList = parseList(datasets)
        const layerList = parseList(layers)
        onSubmit({
          repoPath: path,
          ...(datasetList !== undefined ? { datasets: datasetList } : {}),
          ...(layerList !== undefined ? { layers: layerList } : {}),
        })
      }}
    >
      <div className={css.bindFormTitle}>{t('binding.form.title')}</div>
      <input
        className={css.bindInput}
        value={repo}
        onChange={event => { setRepo(event.target.value) }}
        placeholder={t('binding.form.repo')}
        aria-label={t('binding.form.repo')}
      />
      <input
        className={css.bindInput}
        value={datasets}
        onChange={event => { setDatasets(event.target.value) }}
        placeholder={t('binding.form.datasets')}
        aria-label={t('binding.form.datasets')}
      />
      <input
        className={css.bindInput}
        value={layers}
        onChange={event => { setLayers(event.target.value) }}
        placeholder={t('binding.form.layers')}
        aria-label={t('binding.form.layers')}
      />
      <div className={css.bindFormActions}>
        <button type="submit" className={css.action}>{t('binding.form.submit')}</button>
        <button type="button" className={css.action} onClick={onCancel}>{t('binding.form.cancel')}</button>
      </div>
    </form>
  )
}

/** One item's layer/file tree (files are the leaf rows that drive the preview). */
function ItemNode(props: {
  dataset: string
  item: ItemRecord
  selection: DatasetSelection | null
  onSelect: (selection: DatasetSelection) => void
}) {
  const { dataset, item, selection, onSelect } = props
  const [open, setOpen] = useState(false)
  return (
    <div className={css.item}>
      <button type="button" className={css.itemRow} onClick={() => { setOpen(!open) }}>
        <span className={css.twisty}>{open ? '▾' : '▸'}</span>
        <span className={css.itemId}>{item.id}</span>
        {item.metadata !== undefined && (
          <span className={css.itemMeta} title={JSON.stringify(item.metadata, null, 2)}>
            {JSON.stringify(item.metadata)}
          </span>
        )}
      </button>
      {open && Object.entries(item.layers).map(([layer, paths]) => (
        <div key={layer} className={css.layer}>
          <div className={css.layerRow}>{layer} ({paths.length})</div>
          {paths.map((path) => {
            const selected = selection !== null
              && selection.dataset === dataset && selection.item === item.id
              && selection.layer === layer && selection.path === path
            return (
              <button
                key={path}
                type="button"
                className={selected ? `${css.fileRow} ${css.fileRowSelected}` : css.fileRow}
                onClick={() => { onSelect({ dataset, item: item.id, layer, path }) }}
              >
                {path}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/**
 * The datasets tab body.
 * @param props - composed props (runtime + store + injected + locale shares).
 */
export function DatasetsView(props: DatasetsViewProps) {
  const {
    sessionId, useStore, actions, t,
    fetchBinding, bindSession, unbindSession, listDatasets, readFile,
  } = props
  const binding = useStore(s => s.binding)
  const bindingLoaded = useStore(s => s.bindingLoaded)
  const notice = useStore(s => s.notice)
  const datasets = useStore(s => s.datasets)
  const listLoading = useStore(s => s.listLoading)
  const listError = useStore(s => s.listError)
  const refreshRev = useStore(s => s.refreshRev)
  const expandedDataset = useStore(s => s.expandedDataset)
  const items = useStore(s => s.items)
  const selection = useStore(s => s.selection)
  const preview = useStore(s => s.preview)
  const previewLoading = useStore(s => s.previewLoading)
  const previewError = useStore(s => s.previewError)
  // Component-private view state: whether the bind/edit form is open.
  const [formOpen, setFormOpen] = useState(false)

  // Fetch the binding on mount and after bind/unbind refreshes, then the
  // dataset list of the bound scope; a stale request is dropped on cleanup.
  useEffect(() => {
    let cancelled = false
    actions.setListLoading(true)
    actions.setListError(null)
    void fetchBinding(sessionId).then((result) => {
      if (cancelled) return
      if (!result.ok) {
        actions.setListLoading(false)
        actions.setListError(result.error.message)
        return
      }
      actions.setBinding(result.value)
      if (result.value === null) {
        actions.setListLoading(false)
        return
      }
      void listDatasets(sessionId).then((list) => {
        if (cancelled) return
        actions.setListLoading(false)
        if (list.ok) {
          actions.setDatasets(list.value.kind === 'datasets' ? list.value.datasets : [])
        } else {
          actions.setListError(list.error.message)
        }
      })
    })
    return () => { cancelled = true }
  }, [sessionId, refreshRev, actions, fetchBinding, listDatasets])

  // Load one dataset's items when it expands (cached in the store afterwards).
  useEffect(() => {
    if (expandedDataset === null || items[expandedDataset] !== undefined) return
    let cancelled = false
    const dataset = expandedDataset
    void listDatasets(sessionId, dataset).then((result) => {
      if (cancelled || !result.ok) return
      if (result.value.kind === 'items') actions.setItems(dataset, (result.value as ListItemsResult).items)
    })
    return () => { cancelled = true }
  }, [sessionId, expandedDataset, items, actions, listDatasets])

  // Read the selected file's content; a stale request is dropped when the
  // selection moves.
  useEffect(() => {
    if (selection === null) return
    let cancelled = false
    const target = selection
    actions.setPreviewLoading(true)
    actions.setPreviewError(null)
    void readFile(sessionId, {
      dataset: target.dataset, item: target.item, layer: target.layer, path: target.path,
    }).then((result) => {
      if (cancelled) return
      actions.setPreviewLoading(false)
      if (result.ok) actions.setPreview(result.value)
      else actions.setPreviewError(result.error.message)
    })
    return () => { cancelled = true }
  }, [sessionId, selection, actions, readFile])

  const submitBinding = (next: DatasetBinding): void => {
    void bindSession(sessionId, next).then((result) => {
      if (result.ok) {
        actions.setNotice(null)
        setFormOpen(false)
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

  return (
    <div className={css.view} data-conversation-composer-overlay="">
      <div className={css.bindingBar}>
        {binding !== null
          ? (
            <div className={css.bindingSummary}>
              <span className={css.bindingRepo} title={binding.repoPath}>
                {t('binding.repo', { repo: binding.repoPath })}
              </span>
              <span className={css.bindingScope}>
                {binding.datasets !== undefined ? binding.datasets.join(', ') : t('binding.allDatasets')}
                {' · '}
                {binding.layers !== undefined ? binding.layers.join(', ') : t('binding.allLayers')}
              </span>
              <button type="button" className={css.action} onClick={() => { setFormOpen(true) }}>
                {t('binding.edit')}
              </button>
              <button type="button" className={css.action} onClick={clearBinding}>
                {t('binding.unbind')}
              </button>
            </div>
          )
          : (
            <div className={css.bindingSummary}>
              <span className={css.bindingNone}>
                {bindingLoaded ? t('binding.none') : t('list.loading')}
              </span>
              <button type="button" className={css.action} onClick={() => { setFormOpen(true) }}>
                {t('binding.bind')}
              </button>
            </div>
          )}
        {notice !== null && <div className={css.notice}>{notice}</div>}
        {formOpen && (
          <BindingForm
            initial={binding}
            onSubmit={submitBinding}
            onCancel={() => { setFormOpen(false) }}
            t={t}
          />
        )}
      </div>
      <div className={css.body}>
        <nav className={css.tree} aria-label={t('open')}>
          {bindingLoaded && binding === null && <div className={css.empty}>{t('list.unbound')}</div>}
          {listLoading && datasets === null && binding !== null && (
            <div className={css.empty}>{t('list.loading')}</div>
          )}
          {!listLoading && listError !== null && datasets === null && (
            <div className={css.empty}>{t('list.error')}: {listError}</div>
          )}
          {datasets !== null && datasets.length === 0 && binding !== null && (
            <div className={css.empty}>{t('list.empty')}</div>
          )}
          {datasets?.map((dataset) => {
            const expanded = dataset.id === expandedDataset
            return (
              <div key={dataset.id} className={css.dataset}>
                <button
                  type="button"
                  className={css.datasetRow}
                  onClick={() => { actions.expand(expanded ? null : dataset.id) }}
                >
                  <span className={css.twisty}>{expanded ? '▾' : '▸'}</span>
                  <span className={css.datasetId}>{dataset.id}</span>
                  {dataset.name !== undefined && <span className={css.datasetName}>{dataset.name}</span>}
                  <span className={css.datasetCount}>{t('list.itemCount', { count: dataset.itemCount })}</span>
                </button>
                {expanded && (items[dataset.id] ?? []).map(item => (
                  <ItemNode
                    key={item.id}
                    dataset={dataset.id}
                    item={item}
                    selection={selection}
                    onSelect={(next) => { actions.select(next) }}
                  />
                ))}
              </div>
            )
          })}
        </nav>
        <section className={css.preview}>
          {selection !== null && (
            <div className={css.previewHeader}>
              <span className={css.previewPath}>
                {selection.item} / {selection.layer}/{selection.path}
              </span>
              {preview !== null && (
                <span className={css.previewCommit}>@{preview.commit.slice(0, 7)}</span>
              )}
            </div>
          )}
          {selection === null && <div className={css.empty}>{t('preview.empty')}</div>}
          {selection !== null && previewLoading && <div className={css.empty}>{t('preview.loading')}</div>}
          {selection !== null && !previewLoading && previewError !== null && (
            <div className={css.empty}>{t('preview.error')}: {previewError}</div>
          )}
          {selection !== null && !previewLoading && previewError === null && preview !== null && (
            <div className={css.previewScroll}>
              <DatasetPreview
                key={`${selection.item}/${selection.layer}/${selection.path}`}
                path={selection.path}
                content={preview.content}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
