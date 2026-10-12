/**
 * T99 · the two removal confirmations of the 题集 tab.
 *
 * 「删除」 on a repository row opens ONE dialog that carries both ways out,
 * side by side where their consequences are spelled out: 「删除题集和文件」
 * (the registration AND the repository directory go) and 「只移除登记，文件保留」
 * (the old record-only removal). The dialog first asks the host for the
 * plan — the directory, whether it may be deleted, the plugin state that goes
 * with it — so what it shows is what the host will do; the browser never
 * names a path. A repository the host refuses to delete (outside the datasets
 * home, behind a symlink, not the repository root, checked out elsewhere)
 * offers the record-only removal alone, saying the files stay where they are
 * and why.
 *
 * 「放弃」 on a pending-registration banner opens the second dialog: the
 * proposal record goes, and with it the organized repository when the host's
 * plan allows; the organizing session is never touched.
 *
 * The experiments a registration's sets are pinned by are eval's data, read
 * by the browser (this plugin does not depend on eval): the dialog names them
 * and says their history stays but they cannot run again.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { DatasetsCapabilities, DeletePlan, DiscardPlan, KeepReason, RemovalPlan } from '../types.ts'
import type { DatasetExperimentRow, DatasetsViewProps } from './contract.ts'
import { capabilityOf } from './parts.tsx'
import css from './Organize.module.css'

/** How many experiment names the dialog lists before 「等 N 个」. */
const NAMES_SHOWN = 6

/** One experiment that pins a registration, by name. */
export interface RegistrationExperiment {
  key: string
  name: string
}

/**
 * The experiments that pin any set of one registration: a run naming the
 * registration, or (an older run that recorded only a path) naming one of
 * its sets. Runs of one experiment fold into one entry.
 * @param rows - eval's experiment rows.
 * @param registry - the registration id.
 * @param sets - the registration's set ids.
 * @returns the experiments, in first-seen order.
 */
export function registrationExperiments(
  rows: readonly DatasetExperimentRow[], registry: string, sets: readonly string[],
): RegistrationExperiment[] {
  const byKey = new Map<string, string>()
  for (const row of rows) {
    const mine = row.registry === registry || (row.registry === null && row.datasetId !== null && sets.includes(row.datasetId))
    if (!mine) continue
    const key = row.experimentId ?? `name:${row.name}`
    if (!byKey.has(key)) byKey.set(key, row.name)
  }
  return [...byKey].map(([key, name]) => ({ key, name }))
}

/** A plan request's three states. */
type PlanState<P> = { kind: 'loading' } | { kind: 'ready'; plan: P } | { kind: 'failed'; message: string }

/** Ask the host for a plan whenever `id` changes; null id = closed. */
function usePlan<P>(id: string | null, load: (id: string) => Promise<RemoteResult<P>>): PlanState<P> {
  const [state, setState] = useState<PlanState<P>>({ kind: 'loading' })
  useEffect(() => {
    if (id === null) return
    let live = true
    setState({ kind: 'loading' })
    void load(id).then((result) => {
      if (!live) return
      setState(result.ok ? { kind: 'ready', plan: result.value } : { kind: 'failed', message: result.error.message })
    }, (error: unknown) => {
      if (live) setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
    })
    return () => { live = false }
  }, [id, load])
  return state
}

/** The sentence for why the files stay. */
function keepSentence(plan: RemovalPlan, t: DatasetsViewProps['t']): string {
  const reason: KeepReason = plan.keepReason ?? 'not-repo-root'
  if (reason === 'other-checkouts') return t('remove.keep.other-checkouts', { count: plan.otherCheckouts?.length ?? 0 })
  return t(`remove.keep.${reason}`)
}

/** The directory line: a label and the path, monospace, wrapping anywhere. */
function PathBlock(props: { label: string; path: string; tone: 'delete' | 'keep'; children?: ReactNode }) {
  return (
    <div className={css.removePath} data-tone={props.tone}>
      <div className={css.removePathLabel}>{props.label}</div>
      <code className={css.removePathValue}>{props.path}</code>
      {props.children}
    </div>
  )
}

/** The 「用过它的实验」 section; nothing when eval is absent. */
function ExperimentsBlock(props: { experiments: readonly RegistrationExperiment[] | null; t: DatasetsViewProps['t'] }) {
  const { experiments, t } = props
  if (experiments === null) return null
  if (experiments.length === 0) return <p className={css.removeQuiet}>{t('remove.experimentsNone')}</p>
  const shown = experiments.slice(0, NAMES_SHOWN)
  const more = experiments.length - shown.length
  return (
    <div className={css.removeExperiments}>
      <div>{t('remove.experiments', { count: experiments.length })}</div>
      <ul>
        {shown.map(entry => <li key={entry.key}>{entry.name}</li>)}
        {more > 0 && <li className={css.removeQuiet}>{t('remove.experimentsMore', { count: more })}</li>}
      </ul>
      <div className={css.removeQuiet}>{t('remove.experimentsNote')}</div>
    </div>
  )
}

/** The 删除 dialog's props. */
export interface DeleteDialogProps {
  /** The registration being removed; null = closed. */
  id: string | null
  /** The registration's set ids as the list knows them (the plan's own list wins once it lands). */
  sets: readonly string[]
  /** eval's experiment rows; null when this instance has no eval. */
  experiments: readonly DatasetExperimentRow[] | null
  /** This instance's gesture availability; null (unanswered) leaves every option visible. */
  caps: DatasetsCapabilities | null
  loadPlan: (id: string) => Promise<RemoteResult<DeletePlan>>
  /** 「删除题集和文件」; resolves to an error message, or null when done. */
  onDelete: (id: string) => Promise<string | null>
  /** 「只移除登记」; resolves to an error message, or null when done. */
  onUnregister: (id: string) => Promise<string | null>
  onClose: () => void
  t: DatasetsViewProps['t']
}

/**
 * 「删除」: one confirmation, two clearly separate outcomes.
 * @param props - see {@link DeleteDialogProps}.
 */
export function DeleteDialog(props: DeleteDialogProps) {
  const { id, sets, experiments, caps, loadPlan, onDelete, onUnregister, onClose, t } = props
  const state = usePlan(id, loadPlan)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setBusy(false); setError(null) }, [id])
  const plan = state.kind === 'ready' ? state.plan : null
  const deletable = plan?.files === 'delete'
  const capDelete = capabilityOf(caps, 'delete')
  const capRegistration = capabilityOf(caps, 'registration')
  const used = experiments === null || id === null
    ? null
    : registrationExperiments(experiments, id, plan === null ? sets : [...new Set([...sets, ...plan.sets])])

  const run = (action: (id: string) => Promise<string | null>): void => {
    if (id === null) return
    setBusy(true)
    setError(null)
    void action(id).then((message) => {
      setBusy(false)
      if (message === null) onClose()
      else setError(message)
    })
  }

  const name = id ?? ''
  return (
    <Modal
      open={id !== null}
      onClose={onClose}
      title={deletable || state.kind === 'loading' ? t('remove.titleDelete', { id: name }) : t('remove.titleUnregister', { id: name })}
      closeLabel={t('remove.close')}
      className={css.removeDialog as string}
      footer={(
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>{t('remove.cancel')}</Button>
          {!capRegistration.available && <span className={css.help}>{capRegistration.reason}</span>}
          {!capDelete.available && deletable && <span className={css.help}>{capDelete.reason}</span>}
          {deletable
            ? (
              <>
                {capRegistration.available && (
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => { run(onUnregister) }}>
                    {t('remove.unregisterOnly')}
                  </Button>
                )}
                {capDelete.available && (
                  <Button size="sm" variant="outline" className={css.dangerButton as string} disabled={busy} onClick={() => { run(onDelete) }}>
                    {busy ? t('remove.working') : t('remove.delete')}
                  </Button>
                )}
              </>
            )
            : (
              capRegistration.available && (
                <Button size="sm" variant="primary" disabled={busy || state.kind === 'loading'} onClick={() => { run(onUnregister) }}>
                  {busy ? t('remove.working') : t('remove.unregister')}
                </Button>
              )
            )}
        </>
      )}
    >
      <div className={css.removeBody}>
        {state.kind === 'loading' && <p className={css.removeQuiet}>{t('remove.loading')}</p>}
        {state.kind === 'failed' && <p className={css.removeQuiet}>{t('remove.planFailed', { message: state.message })}</p>}
        {plan !== null && deletable && (
          <>
            <PathBlock label={t('remove.pathDelete')} path={plan.path} tone="delete">
              {plan.state.length > 0 && <div className={css.removeQuiet}>{t('remove.stateCount', { count: plan.state.length })}</div>}
            </PathBlock>
            <ExperimentsBlock experiments={used} t={t} />
            <ul className={css.removeChoices}>
              <li><strong>{t('remove.delete')}</strong>{t('remove.choiceDelete')}</li>
              <li><strong>{t('remove.unregisterOnly')}</strong>{t('remove.choiceUnregister')}</li>
            </ul>
            <p className={css.removeWarn} role="note">{t('remove.irreversible')}</p>
          </>
        )}
        {plan !== null && !deletable && (
          <>
            <PathBlock label={t('remove.pathKeep')} path={plan.path} tone="keep">
              <div className={css.removeKeep}>{keepSentence(plan, t)}</div>
              {plan.otherCheckouts !== undefined && plan.otherCheckouts.length > 0 && (
                <ul className={css.removeQuiet}>{plan.otherCheckouts.map(path => <li key={path}><code>{path}</code></li>)}</ul>
              )}
            </PathBlock>
            <ExperimentsBlock experiments={used} t={t} />
            <p className={css.removeQuiet}>{t('remove.unregisterNote')}</p>
          </>
        )}
        {state.kind === 'failed' && <ExperimentsBlock experiments={used} t={t} />}
        {error !== null && <p className={css.removeError} role="alert">{error}</p>}
      </div>
    </Modal>
  )
}

/** The 放弃 dialog's props. */
export interface DiscardDialogProps {
  /** The proposal being discarded; null = closed. */
  id: string | null
  /** The name it would have registered as (the banner's 「{name}」). */
  name: string
  /** This instance's gesture availability; null (unanswered) leaves the confirm visible. */
  caps: DatasetsCapabilities | null
  loadPlan: (id: string) => Promise<RemoteResult<DiscardPlan>>
  /** 「放弃」; resolves to an error message, or null when done. */
  onDiscard: (id: string) => Promise<string | null>
  onClose: () => void
  t: DatasetsViewProps['t']
}

/**
 * 「放弃」 an organizing result.
 * @param props - see {@link DiscardDialogProps}.
 */
export function DiscardDialog(props: DiscardDialogProps) {
  const { id, name, caps, loadPlan, onDiscard, onClose, t } = props
  const state = usePlan(id, loadPlan)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setBusy(false); setError(null) }, [id])
  const plan = state.kind === 'ready' ? state.plan : null
  const deletable = plan?.files === 'delete'
  const capDelete = capabilityOf(caps, 'delete')

  const run = (): void => {
    if (id === null) return
    setBusy(true)
    setError(null)
    void onDiscard(id).then((message) => {
      setBusy(false)
      if (message === null) onClose()
      else setError(message)
    })
  }

  return (
    <Modal
      open={id !== null}
      onClose={onClose}
      title={t('discard.title', { name })}
      closeLabel={t('remove.close')}
      className={css.removeDialog as string}
      footer={(
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>{t('remove.cancel')}</Button>
          {!capDelete.available && <span className={css.help}>{capDelete.reason}</span>}
          {capDelete.available && (
            deletable
              ? (
                <Button size="sm" variant="outline" className={css.dangerButton as string} disabled={busy} onClick={run}>
                  {busy ? t('remove.working') : t('discard.confirmDelete')}
                </Button>
              )
              : (
                <Button size="sm" variant="primary" disabled={busy || state.kind === 'loading'} onClick={run}>
                  {busy ? t('remove.working') : t('discard.confirm')}
                </Button>
              )
          )}
        </>
      )}
    >
      <div className={css.removeBody}>
        {state.kind === 'loading' && <p className={css.removeQuiet}>{t('remove.loading')}</p>}
        {state.kind === 'failed' && <p className={css.removeQuiet}>{t('discard.planFailed', { message: state.message })}</p>}
        {plan !== null && (
          <PathBlock label={deletable ? t('discard.pathDelete') : t('remove.pathKeep')} path={plan.path} tone={deletable ? 'delete' : 'keep'}>
            {!deletable && <div className={css.removeKeep}>{keepSentence(plan, t)}</div>}
          </PathBlock>
        )}
        <p className={css.removeQuiet}>{t('discard.body')}</p>
        {deletable && <p className={css.removeWarn} role="note">{t('remove.irreversible')}</p>}
        {error !== null && <p className={css.removeError} role="alert">{error}</p>}
      </div>
    </Modal>
  )
}
