/**
 * The 题集 conversation view (the 'datasets' tab beside chat and trajectory).
 * Two pages, one shell (ui-spec §四): the LIST is the deployment's dataset
 * registry — grouped by repository, one row per set with its tracked branch's
 * tip, the tip's date and the layers agents may read — and a DETAIL page for
 * one set: the file tree with a slot marker on every leaf, «选手将看到»,
 * «可判性», «作答记录», and the selected file's preview.
 *
 * T73: the tab no longer shows a session binding. What an agent may use is
 * what a human registered here (the register form, «从旧绑定登记», edit,
 * remove), and every read below names one registration by its id — the host
 * resolves that to the repository's common dir at its tracked branch's tip, so
 * the page never reads a checkout's HEAD or working tree.
 *
 * This module owns the fetches and the page switch; the pages own their
 * layout, and `parts.tsx` owns the vocabulary they share. Every write here is
 * a HUMAN gesture with a form in front of it (registration, dataset skeleton,
 * item skeleton, item import); skeleton writes land in the registration's
 * authoring checkout only — the commit stays the human's, and the tab says so
 * on each form. Reads show the tracked branch, so a fresh skeleton appears
 * here once it is committed there.
 *
 * The tab shows what the OPERATOR may see: the registration's layers
 * constrain agents, never the human reading their own repository (protocol
 * §3), so a sensitive layer lists here with a quiet marker rather than being
 * hidden. What is genuinely unprotected — the passthrough zone and item.json —
 * is marked loudly, because that is the thing an author can get wrong.
 */

import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DatasetOverviewRow, ListDatasetsResult, ListItemsResult, RegisterInput, UpdateInput } from '../types.ts'
import type { DatasetsViewProps } from './contract.ts'
import { DatasetDetail } from './DatasetDetail.tsx'
import { classifyError, ErrorState } from './ErrorState.tsx'
import { Chip, EmptyState, LayersWordView, shortCommit } from './parts.tsx'
import { RegisterForm } from './RegisterForm.tsx'
import { RegistryList } from './RegistryList.tsx'
import { SkeletonForm } from './SkeletonForm.tsx'
import { itemKey, type DatasetsForm } from './store.ts'
import css from './DatasetsView.module.css'

/** A path's own name — its last segment (ui-spec §九 keeps the rest on a title). */
function lastSegment(path: string): string {
  return path.replace(/\/+$/, '').split('/').filter(Boolean).pop() ?? path
}

/** The dataset row the detail page is about, synthesized when the list has not answered yet. */
function rowOf(rows: readonly DatasetOverviewRow[] | undefined, id: string): DatasetOverviewRow {
  return rows?.find(row => row.id === id)
    ?? { id, itemCount: 0, layers: [], nonModelFacingLayers: [], slotLayers: {}, canary: false, warnings: [], validate: null }
}

/** Which registration form is open: none, a new registration, or one registration's edit. */
type RegisterOpen = null | { mode: 'new' } | { mode: 'edit'; id: string }

/**
 * The 题集 tab body.
 * @param props - composed props (runtime + store + injected + locale shares).
 */
export function DatasetsView(props: DatasetsViewProps) {
  const {
    sessionId, useStore, actions, t,
    fetchRegistry, previewRepo, register, updateRegistration, unregister, importBindings,
    listDatasets, readFile, readPassthroughFile,
    overview, itemBrief, validateDataset, scaffoldDataset, scaffoldItem, importItem,
    itemRuns, datasetExperiments,
    isLoopback, pickDirectory,
  } = props
  const { useHostDescription } = props
  const registry = useStore(s => s.registry)
  const notice = useStore(s => s.notice)
  const imported = useStore(s => s.imported)
  const openRepo = useStore(s => s.openRepo)
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
  const itemCounts = useStore(s => s.itemCounts)
  const validated = useStore(s => s.validated)
  const validating = useStore(s => s.validating)
  const form = useStore(s => s.form)
  const skeleton = useStore(s => s.skeleton)
  const selection = useStore(s => s.selection)
  const preview = useStore(s => s.preview)
  const previewLoading = useStore(s => s.previewLoading)
  const previewError = useStore(s => s.previewError)
  // Component-private view state: which registration form is open, which
  // registration a «新建题集» form writes into, and the import in flight.
  const [registerOpen, setRegisterOpen] = useState<RegisterOpen>(null)
  const [formRepo, setFormRepo] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  // Which item briefs have been asked for. A REF, not store state: the request
  // sets a loading flag, the flag re-renders, and a re-render that re-ran the
  // effect would cancel the very request it just started (the effect's cleanup
  // drops the answer). The ref keeps the guard out of the dependency list.
  const requestedBriefs = useRef(new Set<string>())
  const canPick = isLoopback && useHostDescription(description => description?.canOpenPath === true)

  // The registry on mount and after every refresh.
  useEffect(() => {
    let cancelled = false
    actions.setListLoading(true)
    actions.setListError(null)
    void fetchRegistry(sessionId).then((result) => {
      if (cancelled) return
      actions.setListLoading(false)
      if (result.ok) actions.setRegistry(result.value)
      else actions.setListError(result.error.message)
    })
    return () => { cancelled = true }
  }, [sessionId, refreshRev, actions, fetchRegistry])

  // The open registration's rows (item counts, slot mapping, validate) for the detail page.
  useEffect(() => {
    if (openRepo === null) return
    let cancelled = false
    void overview(sessionId, openRepo).then((answer) => {
      if (cancelled) return
      if (answer.ok) actions.setOverview(answer.value)
      else actions.setListError(answer.error.message)
    })
    return () => { cancelled = true }
  }, [sessionId, openRepo, refreshRev, actions, overview])

  // The «题数» cells: one set-less list read per registration (the registry
  // itself carries no counts, and the host face stays as it is). Re-read with
  // every registry answer, so a refresh refreshes the counts too.
  useEffect(() => {
    if (registry === null) return
    let cancelled = false
    for (const row of registry) {
      if (row.problem !== undefined || row.sets.length === 0) continue
      const repo = row.entry.id
      void listDatasets(sessionId, repo).then((result) => {
        if (cancelled) return
        if (!result.ok || result.value.kind !== 'datasets') {
          actions.setItemCounts(repo, null)
          return
        }
        const counts: Record<string, number> = {}
        for (const dataset of (result.value as ListDatasetsResult).datasets) counts[dataset.id] = dataset.itemCount
        actions.setItemCounts(repo, counts)
      })
    }
    return () => { cancelled = true }
  }, [sessionId, registry, actions, listDatasets])

  // The «用于» cells, once. A null answer means this instance carries no eval
  // plugin, and the cells never render.
  useEffect(() => {
    if (registry === null || experiments !== null) return
    let cancelled = false
    void datasetExperiments(sessionId).then((rows) => {
      if (!cancelled && rows !== null) actions.setExperiments(rows)
    })
    return () => { cancelled = true }
  }, [sessionId, registry, experiments, actions, datasetExperiments])

  // One dataset's items when its detail page opens (cached afterwards).
  useEffect(() => {
    if (openRepo === null || openDataset === null || items[openDataset] !== undefined) return
    let cancelled = false
    const dataset = openDataset
    void listDatasets(sessionId, openRepo, dataset).then((result) => {
      if (cancelled || !result.ok) return
      if (result.value.kind === 'items') actions.setDetails(dataset, result.value as ListItemsResult)
    })
    return () => { cancelled = true }
  }, [sessionId, openRepo, openDataset, items, actions, listDatasets])

  // The open item's brief and its answer record, once per item per refresh.
  useEffect(() => {
    if (openRepo === null || openDataset === null || openItem === null) return
    const key = itemKey(openDataset, openItem)
    if (requestedBriefs.current.has(`${refreshRev}:${openRepo}:${key}`)) return
    requestedBriefs.current.add(`${refreshRev}:${openRepo}:${key}`)
    actions.setBriefLoading(key, true)
    void itemBrief(sessionId, openRepo, openDataset, openItem).then((result) => {
      actions.setBriefLoading(key, false)
      if (result.ok) actions.setBrief(key, result.value)
      else actions.setBriefError(key, result.error.message)
    })
    void itemRuns(sessionId, openDataset, openItem).then((answer) => {
      actions.setRuns(key, answer)
    })
  }, [sessionId, refreshRev, openRepo, openDataset, openItem, actions, itemBrief, itemRuns])

  // The selected file's content; a stale request is dropped when the selection moves.
  useEffect(() => {
    if (selection === null || openRepo === null) return
    let cancelled = false
    const target = selection
    actions.setPreviewLoading(true)
    actions.setPreviewError(null)
    const request = target.kind === 'passthrough'
      ? readPassthroughFile(sessionId, openRepo, { dataset: target.dataset, path: target.path })
      : readFile(sessionId, openRepo, {
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
  }, [sessionId, openRepo, selection, actions, readFile, readPassthroughFile])

  /** Settle one registry gesture: close the form and re-read on success, keep the reason on failure. */
  const settle = (result: { ok: true } | { ok: false; error: { message: string } }): void => {
    if (result.ok) {
      actions.setNotice(null)
      setRegisterOpen(null)
      actions.refresh()
    } else {
      actions.setNotice(result.error.message)
    }
  }
  const submitRegister = (input: RegisterInput): void => {
    void register(sessionId, input).then(settle)
  }
  const submitUpdate = (input: UpdateInput): void => {
    void updateRegistration(sessionId, input).then(settle)
  }
  const removeRegistration = (id: string): void => {
    void unregister(sessionId, id).then(settle)
  }
  const runImport = (): void => {
    setImporting(true)
    void importBindings(sessionId).then((result) => {
      setImporting(false)
      if (!result.ok) {
        actions.setNotice(result.error.message)
        return
      }
      actions.setNotice(null)
      actions.setImported(result.value)
      actions.refresh()
    })
  }

  // The registration a write form targets: the open one on the detail page,
  // the heading's own on the list page.
  const writeRepo = page === 'detail' ? openRepo : formRepo

  /** Run one write gesture, then refresh what it could have changed. */
  const submitForm = (values: Record<string, string>): void => {
    const dataset = openDataset
    const repo = writeRepo
    if (repo === null) return
    const call = form === 'newDataset'
      ? scaffoldDataset(sessionId, repo, {
        id: values['id'] ?? '',
        ...(values['name'] !== undefined && values['name'] !== '' ? { name: values['name'] } : {}),
      })
      : form === 'newItem' && dataset !== null
        ? scaffoldItem(sessionId, repo, { dataset, item: values['item'] ?? '' })
        : form === 'importItem' && dataset !== null
          ? importItem(sessionId, repo, {
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
      actions.refresh()
    })
  }

  const runValidate = (): void => {
    if (openRepo === null || openDataset === null) return
    const dataset = openDataset
    actions.setValidating(true)
    void validateDataset(sessionId, openRepo, dataset).then((result) => {
      actions.setValidating(false)
      if (!result.ok) {
        actions.setNotice(result.error.message)
        return
      }
      const one = result.value.datasets.find(entry => entry.id === dataset)
      if (one !== undefined) actions.setValidated(dataset, one)
    })
  }

  const openRow = registry?.find(row => row.entry.id === openRepo)
  const openSet = openRow?.sets.find(set => set.set === openDataset)
  const detailRow = openDataset === null ? null : rowOf(overviewValue?.datasets, openDataset)
  // The agent-readable layer set comes from the registration (the registry's
  // layers for this set, else the host's modelFacing floor — `sets` already
  // carries whichever applies).
  const agentLayers = new Set(openSet?.layers ?? [])
  const validatedRow = openDataset === null ? undefined : validated[openDataset]
  const editing = registerOpen?.mode === 'edit'
    ? registry?.find(row => row.entry.id === registerOpen.id)?.entry
    : undefined

  const openForm = (next: Exclude<DatasetsForm, null>, repo?: string): void => {
    actions.setNotice(null)
    if (repo !== undefined) setFormRepo(repo)
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
          {page === 'detail' && openRow !== undefined && openSet !== undefined
            ? (
              <>
                <span className={css.bindingTitle}>
                  <span className={css.bindingRepo} title={openRow.entry.commonDir}>
                    {openRow.latest === undefined
                      ? openSet.ref
                      : `${openSet.ref} · ${openRow.entry.trackedRef}@${shortCommit(openRow.latest.commit)}`}
                  </span>
                  <span className={css.bindingScope}>
                    {t('registry.colVisible')} · <LayersWordView layers={openSet.layers} t={t} />
                  </span>
                </span>
              </>
            )
            : (
              <span className={css.bindingNone}>
                {registry === null ? t('list.loading') : t('registry.title', { count: registry.length })}
              </span>
            )}
          {page === 'list' && (
            <>
              <Button size="sm" variant="primary" onClick={() => { setRegisterOpen({ mode: 'new' }) }}>
                {t('registry.register')}
              </Button>
              <Button size="sm" onClick={runImport} disabled={importing}>
                {importing ? t('registry.importing') : t('registry.import')}
              </Button>
            </>
          )}
          {page === 'detail' && openRow?.entry.authoringCheckout != null && (
            <>
              <Button size="sm" onClick={() => { openForm('newItem') }}>{t('detail.newItem')}</Button>
              <Button size="sm" onClick={() => { openForm('importItem') }}>{t('detail.importItem')}</Button>
            </>
          )}
          {page === 'detail' && (
            <Button size="sm" onClick={runValidate} disabled={validating}>
              {validating ? t('detail.validating') : t('detail.validate')}
            </Button>
          )}
        </div>
        {notice !== null && registerOpen === null && form === null && (
          <ErrorState what={t('notice.failed')} message={notice} compact t={t} />
        )}
        {imported !== null && (
          <div className={css.notice}>
            <div>
              {imported.imported.length === 0 && imported.dangling.length === 0
                ? t('import.nothing')
                : t('import.done', {
                    created: imported.imported.filter(entry => entry.created).length,
                    merged: imported.imported.filter(entry => !entry.created).length,
                  })}
            </div>
            {imported.imported.map(entry => (
              <div key={entry.id} className={css.importLine}>
                {entry.created
                  ? t('import.created', { id: entry.id, sessions: entry.sessions, paths: entry.paths.length })
                  : t('import.existing', { id: entry.id, sessions: entry.sessions, paths: entry.paths.length })}
              </div>
            ))}
            {imported.dangling.map((entry) => {
              const kind = classifyError(entry.reason)
              return (
                <div key={entry.repoPath} className={css.importDangling} title={`${entry.repoPath}\n${entry.reason}`}>
                  {t('import.dangling', {
                    name: lastSegment(entry.repoPath),
                    sessions: entry.sessions,
                    why: kind === 'pathMissing'
                      ? t('import.why.missing')
                      : kind === 'notGitRepo' ? t('import.why.notRepo') : t('import.why.other'),
                  })}
                </div>
              )
            })}
            <Button size="sm" onClick={() => { actions.setImported(null) }}>{t('import.dismiss')}</Button>
          </div>
        )}
        {validatedRow !== undefined && (
          <div className={css.notice}>
            <span className={css.chipRow}>
              <Chip tone={validatedRow.errors.length > 0 ? 'danger' : 'ok'}>
                {validatedRow.errors.length === 0
                  ? t('detail.validateOk', { warnings: validatedRow.warnings.length })
                  : t('detail.validateFound', {
                    errors: validatedRow.errors.length,
                    warnings: validatedRow.warnings.length,
                  })}
              </Chip>
            </span>
            {/* validate's own sentences, each with its code on the row's title
                rather than printed in front of it (ui-spec §九). */}
            {validatedRow.errors.slice(0, 3).map(error => (
              <div key={error.message} className={css.noticeLine} title={error.code}>{error.message}</div>
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
        {registerOpen !== null && (
          <RegisterForm
            key={registerOpen.mode === 'edit' ? registerOpen.id : '(new)'}
            initial={editing}
            canPick={canPick}
            pickDirectory={pickDirectory}
            previewRepo={(path, trackedRef) => previewRepo(sessionId, path, trackedRef)}
            onRegister={submitRegister}
            onUpdate={submitUpdate}
            onCancel={() => {
              actions.setNotice(null)
              setRegisterOpen(null)
            }}
            notice={notice}
            t={t}
          />
        )}
      </div>
      {page === 'list' && (
        <>
          {/* No registration is the tab's FIRST screen on a new deployment:
              ui-spec §九 wants the next step on it, and the button that takes it. */}
          {registry !== null && registry.length === 0 && (
            <EmptyState title={t('registry.empty')} hint={t('registry.emptyHint')}>
              <Button size="sm" variant="primary" onClick={() => { setRegisterOpen({ mode: 'new' }) }}>
                {t('registry.emptyAction')}
              </Button>
            </EmptyState>
          )}
          {listLoading && registry === null && <div className={css.empty}>{t('list.loading')}</div>}
          {!listLoading && listError !== null && registry === null && (
            <ErrorState what={t('list.error')} message={listError} t={t} />
          )}
          {registry !== null && registry.length > 0 && (
            <RegistryList
              rows={registry}
              experiments={experiments}
              itemCounts={itemCounts}
              onOpen={(repo, dataset) => { actions.openDataset({ repo, dataset }) }}
              onNewDataset={(repo) => { openForm('newDataset', repo) }}
              onEdit={(repo) => {
                actions.setNotice(null)
                setRegisterOpen({ mode: 'edit', id: repo })
              }}
              onRemove={removeRegistration}
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
