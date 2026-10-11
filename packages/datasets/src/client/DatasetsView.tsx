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
 * a HUMAN gesture with a page in front of it (T90): 「添加题集」 hands the
 * organizing to an Agent in a new 「题集整理」 session (the tab writes no
 * dataset files itself), the Agent files a proposal, and the person reads the
 * review and confirms — the only proposal → registry path (decision A). The
 * register form stays, under the dialog's 「高级」, for a repository that is
 * already in shape; a registered dataset changes through 「交给 Agent 修改」.
 *
 * The tab shows what the OPERATOR may see: the registration's layers
 * constrain agents, never the human reading their own repository (protocol
 * §3), so a sensitive layer lists here with a quiet marker rather than being
 * hidden. What is genuinely unprotected — the passthrough zone and item.json —
 * is marked loudly, because that is the thing an author can get wrong.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  DatasetOverviewRow, DatasetsCapabilities, ListDatasetsResult, ListItemsResult, OrganizingSetup, RegisterInput, RegistryEntry, UpdateInput,
} from '../types.ts'
import { AddDatasetDialog } from './AddDatasetDialog.tsx'
import type { DatasetsViewProps } from './contract.ts'
import { DatasetDetail } from './DatasetDetail.tsx'
import { classifyError, ErrorState } from './ErrorState.tsx'
import { capabilityOf, Chip, EmptyState, LayersEdit, LayersWordView, ShelfIcon, shortCommit } from './parts.tsx'
import { RegisterForm } from './RegisterForm.tsx'
import { RegistryList } from './RegistryList.tsx'
import { DeleteDialog, DiscardDialog } from './RemoveDialogs.tsx'
import { ReviewPage } from './ReviewPage.tsx'
import {
  buildAddRequest, buildReturnRequest, buildUpdateRequest, type AddDatasetFields, type OrganizeOutcome,
} from './organize.ts'
import { itemKey } from './store.ts'
import css from './DatasetsView.module.css'
import org from './Organize.module.css'

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

/** The last hand-off to an organizing session, and which gesture made it. */
type OrganizeNotice = { outcome: OrganizeOutcome; returned: boolean }

/** The organizing hand-off's one-line verdict and, when nothing landed, the text to paste. */
function OrganizeNoticeView(props: { notice: OrganizeNotice; onDismiss: () => void; t: DatasetsViewProps['t'] }) {
  const { notice: { outcome, returned }, onDismiss, t } = props
  if (outcome.kind === 'failed') {
    return (
      <div className={org.organizeNotice}>
        <ErrorState what={t('organize.failed')} message={outcome.message} compact t={t} />
        <span><Button variant="outline" size="sm" onClick={onDismiss}>{t('organize.dismiss')}</Button></span>
      </div>
    )
  }
  const line = outcome.kind === 'drafted'
    ? t(returned ? 'organize.returned' : 'organize.drafted')
    : outcome.kind === 'copied'
      ? t(returned && outcome.sessionId === undefined ? 'review.returnNoSession' : 'organize.copied')
      : t('organize.manual')
  return (
    <div className={org.organizeNotice} role="status">
      <div>{line}</div>
      {outcome.kind === 'manual' && <pre className={org.manualText}>{outcome.text}</pre>}
      <span><Button variant="outline" size="sm" onClick={onDismiss}>{t('organize.dismiss')}</Button></span>
    </div>
  )
}

/**
 * The 题集 tab body.
 * @param props - composed props (runtime + store + injected + locale shares).
 */
export function DatasetsView(props: DatasetsViewProps) {
  const {
    sessionId, useStore, actions, t,
    capabilities: fetchCapabilities,
    fetchRegistry, previewRepo, register, updateRegistration, unregister, importBindings,
    deletePlan, deleteRegistration, discardPlan, discardProposal,
    listDatasets, readFile, readPassthroughFile,
    overview, itemBrief, validateDataset,
    organizingSetup, proposals: fetchProposals, proposalReview, proposalHead, reviewItem, reviewFiles,
    confirmProposal, returnProposal, pendingReview, confirmPending, startOrganizing, draftInSession,
    itemRuns, datasetExperiments, reviewFocus,
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
  const proposals = useStore(s => s.proposals)
  const review = useStore(s => s.review)
  const selection = useStore(s => s.selection)
  const preview = useStore(s => s.preview)
  const previewLoading = useStore(s => s.previewLoading)
  const previewError = useStore(s => s.previewError)
  // Component-private view state: which registration form is open, the
  // import in flight, the 「添加题集」 dialog, the organizing setup, the last
  // hand-off's verdict, and the registration a confirm just wrote.
  const [registerOpen, setRegisterOpen] = useState<RegisterOpen>(null)
  const [importing, setImporting] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  // T99 · the registration whose 「删除」 dialog is open, and the proposal whose 「放弃」 is.
  const [deleting, setDeleting] = useState<string | null>(null)
  const [discarding, setDiscarding] = useState<{ id: string; name: string } | null>(null)
  const [setup, setSetup] = useState<OrganizingSetup | null>(null)
  const [organized, setOrganized] = useState<OrganizeNotice | null>(null)
  const [done, setDone] = useState<string | null>(null)
  // The instance's gesture availability (null until answered; an absent face
  // member or a failed read leaves every gesture visible — fail-open display,
  // the server's admission rules enforce).
  const [caps, setCaps] = useState<DatasetsCapabilities | null>(null)
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

  // T90: the proposals waiting for a person, with every registry read.
  useEffect(() => {
    let cancelled = false
    void fetchProposals(sessionId).then((result) => {
      if (!cancelled && result.ok) actions.setProposals(result.value)
    })
    return () => { cancelled = true }
  }, [sessionId, refreshRev, actions, fetchProposals])

  // The organizing preset and the datasets home, once (a host without the
  // verb leaves both empty: the request still names the skill).
  useEffect(() => {
    let cancelled = false
    void organizingSetup(sessionId).then((result) => {
      if (!cancelled && result.ok) setSetup(result.value)
    })
    return () => { cancelled = true }
  }, [sessionId, organizingSetup])

  // The capabilities descriptor, once — which gesture groups this instance admits.
  useEffect(() => {
    if (fetchCapabilities === undefined) return
    let cancelled = false
    void fetchCapabilities(sessionId).then((result) => {
      if (!cancelled && result.ok) setCaps(result.value)
    })
    return () => { cancelled = true }
  }, [sessionId, fetchCapabilities])

  const capRegistration = capabilityOf(caps, 'registration')
  const capOrganize = capabilityOf(caps, 'agentOrganize')
  const capImport = capabilityOf(caps, 'bindingImport')
  const capReview = capabilityOf(caps, 'proposalReview')
  const capDelete = capabilityOf(caps, 'delete')
  // 「添加题集」 bundles the organizing hand-off and (under 高级) the register
  // form: it stays while either path is available.
  const canAdd = capOrganize.available || capRegistration.available

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
  // T99 · the dialogs' actions resolve to an error message (kept in the
  // dialog) or null (done: the dialog closes and the list re-reads).
  const finish = (result: { ok: true } | { ok: false; error: { message: string } }): string | null => {
    if (!result.ok) return result.error.message
    actions.setNotice(null)
    actions.refresh()
    return null
  }
  const loadDeletePlan = useCallback((id: string) => deletePlan(sessionId, id), [deletePlan, sessionId])
  const loadDiscardPlan = useCallback((id: string) => discardPlan(sessionId, id), [discardPlan, sessionId])
  const removeRegistration = async (id: string): Promise<string | null> => finish(await unregister(sessionId, id))
  const deleteWithFiles = async (id: string): Promise<string | null> => finish(await deleteRegistration(sessionId, id))
  const discard = async (id: string): Promise<string | null> => finish(await discardProposal(sessionId, id))
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

  // ── T90: the organizing hand-off ─────────────────────────────────────
  const preset = setup?.preset ?? ''
  /** Open a new 题集整理 session with `text` drafted into it. */
  const organize = (name: string, text: string): void => {
    setDone(null)
    void startOrganizing(sessionId, t('organize.sessionTitle', { name }), text, preset).then((outcome) => {
      setOrganized({ outcome, returned: false })
    })
  }
  const submitAdd = (fields: AddDatasetFields): void => {
    setAddOpen(false)
    organize(fields.name.trim(), buildAddRequest(fields, setup?.datasetsHome ?? '', t))
  }
  /** 「交给 Agent 修改」 on a registered dataset. */
  const askAgent = (repo: string): void => {
    const entry = registry?.find(row => row.entry.id === repo)?.entry
    if (entry === undefined) return
    organize(entry.id, buildUpdateRequest({ name: entry.id, checkout: entry.authoringCheckout ?? null, ref: entry.trackedRef }, t))
  }
  // T96 · 「核对并登记」 in the organizing Turn's tail: the card leaves the proposal
  // id for this session's tab; take it now (the tab was just switched to, or
  // was already open) and whenever another lands, and open that review
  // directly — no list, no banner in between.
  useEffect(() => {
    if (reviewFocus === undefined) return
    const take = (): void => {
      const id = reviewFocus.take(sessionId)
      if (id === null) return
      setDone(null)
      actions.openReview({ kind: 'proposal', id })
    }
    take()
    return reviewFocus.subscribe(take)
  }, [reviewFocus, sessionId, actions])
  /** After a confirm: back to the list, re-read, say what was registered. */
  const confirmed = (entry: RegistryEntry): void => {
    actions.openReview(null)
    setOrganized(null)
    setDone(entry.id)
    actions.refresh()
  }
  const reviewOf = review === null
    ? null
    : review.kind === 'proposal'
      ? proposals?.find(proposal => proposal.id === review.id) ?? null
      : null
  /** 「退回给 Agent」 on a proposal: mark it returned, then write the note into its session. */
  const sendBackProposal = (id: string, note: string): void => {
    const proposal = proposals?.find(entry => entry.id === id)
    void returnProposal(sessionId, id, note).then((result) => {
      if (!result.ok) {
        actions.setNotice(result.error.message)
        return
      }
      actions.openReview(null)
      actions.refresh()
      const text = buildReturnRequest(proposal?.registryId ?? id, note, t)
      void draftInSession(proposal?.sessionId ?? '', text).then((outcome) => {
        setOrganized({ outcome, returned: true })
      })
    })
  }
  /** 「退回给 Agent」 on a held version: no organizing session holds it, so open one. */
  const sendBackPending = (repo: string, note: string): void => {
    const entry = registry?.find(row => row.entry.id === repo)?.entry
    if (entry === undefined) return
    actions.openReview(null)
    organize(repo, `${buildUpdateRequest({ name: repo, checkout: entry.authoringCheckout ?? null, ref: entry.trackedRef }, t)}${note.trim()}`)
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

  // The registration's edit form: the one writer of a set's layers, opened
  // from the registration row and from every read-only «agent 可见» word.
  const editRegistration = (repo: string): void => {
    actions.setNotice(null)
    setRegisterOpen({ mode: 'edit', id: repo })
  }

  const registryEmpty = page === 'list' && registry !== null && registry.length === 0
  const waiting = (proposals ?? []).filter(proposal => proposal.status === 'pending')
  const held = (registry ?? []).filter(row => row.latest?.pending !== undefined)

  if (review !== null) {
    const target = review
    return (
      <div className={css.view} data-conversation-composer-overlay="">
        {target.kind === 'proposal'
          ? (
            <ReviewPage
              loadKey={`proposal:${target.id}:${refreshRev}`}
              load={() => proposalReview(sessionId, target.id)}
              loadHead={proposalHead === undefined ? null : () => proposalHead(sessionId, target.id)}
              reviewItem={(set, item) => reviewItem(sessionId, target.id, set, item)}
              reviewFiles={() => reviewFiles(sessionId, target.id)}
              confirm={(registryId, sets) => confirmProposal(sessionId, target.id, registryId, sets)}
              sendBack={reviewOf === null ? null : (note) => { sendBackProposal(target.id, note) }}
              reviewCap={capReview}
              onBack={() => { actions.openReview(null) }}
              onDone={confirmed}
              t={t}
            />
          )
          : (
            <ReviewPage
              loadKey={`pending:${target.repo}:${refreshRev}`}
              load={() => pendingReview(sessionId, target.repo)}
              reviewItem={null}
              reviewFiles={null}
              confirm={(_registryId, sets, loaded) => confirmPending(sessionId, target.repo, loaded.facts.version.commit, sets)}
              sendBack={(note) => { sendBackPending(target.repo, note) }}
              reviewCap={capReview}
              onBack={() => { actions.openReview(null) }}
              onDone={confirmed}
              t={t}
            />
          )}
      </div>
    )
  }

  return (
    <div className={css.view} data-conversation-composer-overlay="">
      {/* T83 · datasets: on the list page the bar is the page's own header,
          so it sits in the content column (版心) above the table — title,
          register, and the register form itself — instead of spanning the
          pane. The detail page keeps the full-width bar: its body is the
          full-width tree + preview, and the bar lines up with that. */}
      <div className={css.bindingBar} data-page={page}>
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
                    {capRegistration.available && (
                      <LayersEdit set={openSet.ref} onEdit={() => { editRegistration(openRow.entry.id) }} variant="bar" t={t} />
                    )}
                  </span>
                </span>
              </>
            )
            : (
              // No count title over an empty registry (T87): the centred
              // empty block below says it, and a 「0 个」 heading beside it
              // would say it twice, one indent apart.
              !registryEmpty && (
                <span className={css.bindingNone}>
                  {registry === null ? t('list.loading') : t('registry.title', { count: registry.length })}
                </span>
              )
            )}
          {page === 'list' && !registryEmpty && (
            <>
              {canAdd && (
                <Button size="sm" variant="outline" onClick={() => { setAddOpen(true) }}>
                  {t('registry.add')}
                </Button>
              )}
              {!canAdd && (
                <span className={css.cellQuiet}>{capOrganize.reason ?? capRegistration.reason}</span>
              )}
              {capImport.available && (
                <Button variant="ghost" size="sm" onClick={runImport} disabled={importing}>
                  {importing ? t('registry.importing') : t('registry.import')}
                </Button>
              )}
            </>
          )}
          {page === 'detail' && openRow !== undefined && capOrganize.available && (
            <Button variant="outline" size="sm" onClick={() => { askAgent(openRow.entry.id) }}>{t('registry.askAgent')}</Button>
          )}
          {page === 'detail' && (
            <Button variant="outline" size="sm" onClick={runValidate} disabled={validating}>
              {validating ? t('detail.validating') : t('detail.validate')}
            </Button>
          )}
        </div>
        {notice !== null && registerOpen === null && (
          <ErrorState what={t('notice.failed')} message={notice} compact t={t} />
        )}
        {organized !== null && <OrganizeNoticeView notice={organized} onDismiss={() => { setOrganized(null) }} t={t} />}
        {done !== null && (
          <div className={css.notice} role="status">
            <span>{t('review.done', { name: done })}</span>
          </div>
        )}
        {page === 'list' && (waiting.length > 0 || held.length > 0) && (
          <div className={org.banners}>
            {waiting.map(proposal => (
              <div key={proposal.id} className={org.banner} data-kind={proposal.kind}>
                <span className={org.bannerText}>
                  {proposal.kind === 'update'
                    ? t('banner.proposalUpdate', { name: proposal.registryId })
                    : t('banner.proposal', { name: proposal.registryId })}
                </span>
                <Button size="sm" variant="primary" onClick={() => { setDone(null); actions.openReview({ kind: 'proposal', id: proposal.id }) }}>
                  {proposal.kind === 'update' ? t('banner.reviewUpdate') : t('banner.review')}
                </Button>
                {capDelete.available && (
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('discard.actionTitle')}
                    onClick={() => { setDiscarding({ id: proposal.id, name: proposal.registryId }) }}
                  >
                    {t('discard.action')}
                  </Button>
                )}
              </div>
            ))}
            {held.map(row => (
              <div key={row.entry.id} className={org.banner} data-kind="pending">
                <span className={org.bannerText}>{t('banner.pending', { name: row.entry.id })}</span>
                <Button size="sm" variant="primary" onClick={() => { setDone(null); actions.openReview({ kind: 'pending', repo: row.entry.id }) }}>
                  {t('banner.reviewUpdate')}
                </Button>
              </div>
            ))}
          </div>
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
            <Button variant="outline" size="sm" onClick={() => { actions.setImported(null) }}>{t('import.dismiss')}</Button>
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
          {/* T87: one centred block — icon, sentence, ONE primary action; the
              bar's own two buttons are hidden meanwhile, so 「登记仓库」 is
              never on screen twice, and the old-binding import is the quiet
              secondary link under it. */}
          {registryEmpty && (
            <EmptyState page icon={<ShelfIcon />} title={t('registry.empty')} hint={t('registry.emptyHint')}>
              {canAdd && (
                <Button size="sm" variant="primary" onClick={() => { setAddOpen(true) }}>
                  {t('registry.emptyAction')}
                </Button>
              )}
              {capImport.available && (
                <button type="button" className={css.emptyLink} onClick={runImport} disabled={importing}>
                  {importing ? t('registry.importing') : t('registry.import')}
                </button>
              )}
              {!canAdd && !capImport.available && (
                <span className={css.cellQuiet}>
                  {capOrganize.reason ?? capRegistration.reason ?? capImport.reason}
                </span>
              )}
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
              caps={caps}
              onOpen={(repo, dataset) => { actions.openDataset({ repo, dataset }) }}
              onAskAgent={askAgent}
              onReview={(repo) => { setDone(null); actions.openReview({ kind: 'pending', repo }) }}
              onEdit={editRegistration}
              onRemove={(repo) => { setDeleting(repo) }}
              t={t}
            />
          )}
        </>
      )}
      {page === 'detail' && detailRow !== null && (
        <DatasetDetail
          dataset={detailRow}
          crumb={openRow === undefined || openDataset === null
            ? null
            : { repo: openRow.entry.id, set: openDataset, ref: openRow.entry.trackedRef }}
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
      <DeleteDialog
        id={deleting}
        sets={registry?.find(row => row.entry.id === deleting)?.sets.map(set => set.set) ?? []}
        experiments={experiments}
        caps={caps}
        loadPlan={loadDeletePlan}
        onDelete={deleteWithFiles}
        onUnregister={removeRegistration}
        onClose={() => { setDeleting(null) }}
        t={t}
      />
      <DiscardDialog
        id={discarding?.id ?? null}
        name={discarding?.name ?? ''}
        caps={caps}
        loadPlan={loadDiscardPlan}
        onDiscard={discard}
        onClose={() => { setDiscarding(null) }}
        t={t}
      />
      <AddDatasetDialog
        open={addOpen}
        datasetsHome={setup?.datasetsHome ?? ''}
        caps={caps}
        onClose={() => { setAddOpen(false) }}
        onOrganize={submitAdd}
        onAdvanced={() => {
          setAddOpen(false)
          actions.setNotice(null)
          setRegisterOpen({ mode: 'new' })
        }}
        canPick={canPick}
        pickDirectory={pickDirectory}
        t={t}
      />
    </div>
  )
}
