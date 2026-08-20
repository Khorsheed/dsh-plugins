/**
 * The datasets conversation view (the 'datasets' tab beside chat and
 * trajectory): the session's dataset binding and browser. Top binding bar
 * (current binding + whitelist display, bind/edit/unbind gestures — binding
 * writes stay human operations), a dataset → item → layer → file tree on the
 * left, and the selected file's content preview on the right, rendered by the
 * official reader primitives (see preview.tsx). All data comes from the
 * injected Remote callbacks; the whitelist the binding declares is enforced
 * host-side, so the tree only ever shows what the session may see.
 *
 * The tree follows the IDE explorer anatomy (VS Code): compact 24px rows,
 * chevron disclosure at every group level, hairline indent guides under each
 * expanded group, the official folder glyphs for layers (they ARE repo
 * directories) and a minimal inline file glyph for leaves (no official
 * per-extension icon set exists — see the M2 Agent Note), and full-row subtle
 * hover/selected backgrounds. Item metadata stays OUT of the tree (an
 * explorer has no chips); it surfaces in the preview header when one of the
 * item's files is selected. The preview pane's skeleton follows the products
 * tab: a single quiet header line (icon + path + metadata + commit), a
 * hairline below it, then the content.
 */

import { useEffect, useState } from 'react'
import {
  Button, IconChevronDownOutline14, IconChevronRightOutline14,
  IconFolderClose16, IconFolderOpen16, Input, Pill,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DatasetBinding, ItemRecord, JsonObject, ListItemsResult } from '../types.ts'
import type { DatasetsViewProps } from './contract.ts'
import { DatasetPreview } from './preview.tsx'
import type { DatasetSelection } from './store.ts'
import css from './DatasetsView.module.css'

/** Parse a comma-separated whitelist field; blank means "everything" (absent). */
function parseList(raw: string): string[] | undefined {
  const list = raw.split(',').map(entry => entry.trim()).filter(entry => entry !== '')
  return list.length === 0 ? undefined : list
}

/** At most this many metadata chips show in the preview header; the rest collapse into +N. */
const MAX_META_PILLS = 3

/** One metadata entry as quiet chip text: scalars inline, containers summarized. */
function metaPillText(key: string, value: unknown): string {
  if (Array.isArray(value)) return `${key} [${value.length}]`
  if (value !== null && typeof value === 'object') return `${key} {…}`
  return `${key}: ${String(value)}`
}

/** The selected item's metadata as quiet chips in the preview header — never raw JSON. */
function MetaPills(props: { metadata: JsonObject; t: DatasetsViewProps['t'] }) {
  const { metadata, t } = props
  const entries = Object.entries(metadata)
  if (entries.length === 0) return null
  const shown = entries.slice(0, MAX_META_PILLS)
  const rest = entries.length - shown.length
  return (
    <span className={css.metaPills} title={JSON.stringify(metadata, null, 2)}>
      {shown.map(([key, value]) => <Pill key={key} className={css.metaPill}>{metaPillText(key, value)}</Pill>)}
      {rest > 0 && <Pill className={css.metaPill}>{t('tree.moreMeta', { count: rest })}</Pill>}
    </span>
  )
}

/** The leaf file glyph: a minimal inline document outline (the official icon
 * set ships folder glyphs but no file icon — see the M2 Agent Note). */
function FileIcon() {
  return (
    <svg className={css.fileIcon} width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 1.5h5.5L13 5v9.5H4V1.5Z M9.5 1.5V5H13"
        stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"
      />
    </svg>
  )
}

/** A group-row chevron: the official 14px disclosure glyphs. */
function Chevron(props: { open: boolean }) {
  return props.open
    ? <IconChevronDownOutline14 className={css.chevron} />
    : <IconChevronRightOutline14 className={css.chevron} />
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
      <Input
        value={repo}
        onChange={event => { setRepo(event.target.value) }}
        placeholder={t('binding.form.repo')}
        aria-label={t('binding.form.repo')}
      />
      <Input
        value={datasets}
        onChange={event => { setDatasets(event.target.value) }}
        placeholder={t('binding.form.datasets')}
        aria-label={t('binding.form.datasets')}
      />
      <Input
        value={layers}
        onChange={event => { setLayers(event.target.value) }}
        placeholder={t('binding.form.layers')}
        aria-label={t('binding.form.layers')}
      />
      <div className={css.bindFormActions}>
        <Button type="submit" variant="primary" size="sm">{t('binding.form.submit')}</Button>
        <Button type="button" size="sm" onClick={onCancel}>{t('binding.form.cancel')}</Button>
      </div>
    </form>
  )
}

/** One layer group: a collapsible folder row, then its file leaves under a guide. */
function LayerNode(props: {
  dataset: string
  /** Item id, or null for a dataset-level (shared) layer. */
  item: string | null
  layer: string
  paths: readonly string[]
  selection: DatasetSelection | null
  onSelect: (selection: DatasetSelection) => void
  t: DatasetsViewProps['t']
}) {
  const { dataset, item, layer, paths, selection, onSelect, t } = props
  const [open, setOpen] = useState(true)
  return (
    <div className={css.layer}>
      <button type="button" className={css.row} onClick={() => { setOpen(!open) }} aria-expanded={open}>
        <Chevron open={open} />
        {open ? <IconFolderOpen16 className={css.folderIcon} /> : <IconFolderClose16 className={css.folderIcon} />}
        <span className={css.rowTitle}>{layer}</span>
        <span className={css.rowCount}>· {t('tree.fileCount', { count: paths.length })}</span>
      </button>
      {open && (
        <div className={css.children}>
          {paths.map((path) => {
            const selected = selection !== null
              && selection.dataset === dataset && selection.item === item
              && selection.layer === layer && selection.path === path
            return (
              <button
                key={path}
                type="button"
                className={selected ? `${css.fileRow} ${css.fileRowSelected}` : css.fileRow}
                onClick={() => { onSelect({ dataset, item, layer, path }) }}
              >
                <FileIcon />
                <span className={css.fileName}>{path}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** One item: a disclosure row; its layers (and their files) sit under a guide. */
function ItemNode(props: {
  dataset: string
  item: ItemRecord
  selection: DatasetSelection | null
  onSelect: (selection: DatasetSelection) => void
  t: DatasetsViewProps['t']
}) {
  const { dataset, item, selection, onSelect, t } = props
  const [open, setOpen] = useState(false)
  return (
    <div className={css.item}>
      <button type="button" className={css.row} onClick={() => { setOpen(!open) }} aria-expanded={open}>
        <Chevron open={open} />
        <span className={css.rowTitle}>{item.id}</span>
      </button>
      {open && (
        <div className={css.children}>
          {Object.entries(item.layers).map(([layer, paths]) => (
            <LayerNode
              key={layer}
              dataset={dataset}
              item={item.id}
              layer={layer}
              paths={paths}
              selection={selection}
              onSelect={onSelect}
              t={t}
            />
          ))}
        </div>
      )}
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
  const sharedLayers = useStore(s => s.sharedLayers)
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
      if (result.value.kind === 'items') {
        const detail = result.value as ListItemsResult
        actions.setItems(dataset, detail.items, detail.datasetLayers)
      }
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
      dataset: target.dataset,
      ...(target.item !== null ? { item: target.item } : {}),
      layer: target.layer, path: target.path,
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

  const selectedItem = selection === null || selection.item === null
    ? undefined
    : items[selection.dataset]?.find(item => item.id === selection.item)

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
              <Button size="sm" onClick={() => { setFormOpen(true) }}>
                {t('binding.edit')}
              </Button>
              <Button size="sm" onClick={clearBinding}>
                {t('binding.unbind')}
              </Button>
            </div>
          )
          : (
            <div className={css.bindingSummary}>
              <span className={css.bindingNone}>
                {bindingLoaded ? t('binding.none') : t('list.loading')}
              </span>
              <Button size="sm" variant="outline" onClick={() => { setFormOpen(true) }}>
                {t('binding.bind')}
              </Button>
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
                  className={css.row}
                  onClick={() => { actions.expand(expanded ? null : dataset.id) }}
                  aria-expanded={expanded}
                >
                  <Chevron open={expanded} />
                  <span className={css.rowTitleStrong}>{dataset.id}</span>
                  <span className={css.rowCount}>· {t('list.itemCount', { count: dataset.itemCount })}</span>
                </button>
                {dataset.name !== undefined && (
                  <div className={css.datasetNote} title={dataset.name}>{dataset.name}</div>
                )}
                {expanded && (
                  <div className={css.children}>
                    {Object.keys(sharedLayers[dataset.id] ?? {}).length > 0 && (
                      <div className={css.sharedGroup}>
                        <div className={css.sharedLabel}>{t('tree.shared')}</div>
                        {Object.entries(sharedLayers[dataset.id] ?? {}).map(([layer, paths]) => (
                          <LayerNode
                            key={layer}
                            dataset={dataset.id}
                            item={null}
                            layer={layer}
                            paths={paths}
                            selection={selection}
                            onSelect={(next) => { actions.select(next) }}
                            t={t}
                          />
                        ))}
                      </div>
                    )}
                    {(items[dataset.id] ?? []).map(item => (
                      <ItemNode
                        key={item.id}
                        dataset={dataset.id}
                        item={item}
                        selection={selection}
                        onSelect={(next) => { actions.select(next) }}
                        t={t}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </nav>
        <section className={css.preview}>
          {selection !== null && (
            <div className={css.previewHeader}>
              <FileIcon />
              <span className={css.previewPath}>
                {selection.item ?? t('tree.shared')} / {selection.layer}/{selection.path}
              </span>
              {selectedItem?.metadata !== undefined && (
                <MetaPills metadata={selectedItem.metadata} t={t} />
              )}
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
              <div className={css.previewContent}>
                <DatasetPreview
                  key={`${selection.item}/${selection.layer}/${selection.path}`}
                  path={selection.path}
                  content={preview.content}
                  t={t}
                />
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
