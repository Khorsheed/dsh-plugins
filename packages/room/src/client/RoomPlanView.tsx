import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PlanAttempt, PlanTask, RoomPlan } from '../plan.ts'
import type { RoomMember } from '../types.ts'
import type { RoomComposerProps, RoomMutationOutcome } from './slots.ts'
import { RoomRequestIds } from './request-ids.ts'
import css from './RoomPlanView.module.css'

type PlanView = Omit<RoomPlan, 'requests'>
export interface RoomPlanViewProps {
  plan?: PlanView | undefined
  members: readonly RoomMember[]
  command: (json: string) => Promise<RoomMutationOutcome>
  openSession?: ((id: string) => void) | undefined
  stopMember?: ((name: string) => void) | undefined
  t: RoomComposerProps['t']
}

/** Goal review is optional room chrome; ordinary chat never opens this form. */
export function RoomPlanView({ plan, members, command, openSession, stopMember, t }: RoomPlanViewProps): ReactNode {
  const [creating, setCreating] = useState(false)
  const [objective, setObjective] = useState('')
  const [execute, setExecute] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [references, setReferences] = useState('')
  const [artifacts, setArtifacts] = useState('')
  const [reviewTask, setReviewTask] = useState<string | null>(null)
  const [goalControls, setGoalControls] = useState(false)
  const [parallel, setParallel] = useState(plan?.budget.maxParallel ?? 2)
  const [attempts, setAttempts] = useState(plan?.budget.maxAttempts ?? 12)
  const [perTask, setPerTask] = useState(plan?.budget.maxAttemptsPerTask ?? 3)
  const [minutes, setMinutes] = useState((plan?.budget.maxActiveMs ?? 1800000) / 60000)
  useEffect(() => {
    if (plan === undefined) return
    setParallel(plan.budget.maxParallel); setAttempts(plan.budget.maxAttempts); setPerTask(plan.budget.maxAttemptsPerTask); setMinutes(plan.budget.maxActiveMs / 60000)
  }, [plan?.id, plan?.budget.maxParallel, plan?.budget.maxAttempts, plan?.budget.maxAttemptsPerTask, plan?.budget.maxActiveMs])
  const ids = useRef(new RoomRequestIds())
  const revision = useRef<{ id: string; revision: number } | undefined>(undefined)
  const lines = (value: string): string[] => value.split('\n').map(line => line.trim()).filter(Boolean)
  const evidence = { summary: reason.trim(), references: lines(references), artifacts: lines(artifacts) }
  const hasEvidence = evidence.summary !== '' && evidence.references.length > 0
  const status = (value: RoomPlan['status'] | PlanTask['status'] | PlanAttempt['status']): string => t(`plan.status.${value}`)
  const run = async (action: Record<string, unknown>): Promise<void> => {
    if (busy) return
    const requestId = ids.current.forInput('plan', JSON.stringify(action))
    if (revision.current?.id !== requestId) revision.current = { id: requestId, revision: plan?.revision ?? 0 }
    setBusy(true); setError(null)
    try {
      const result = await command(JSON.stringify({ ...action, ...action.action === 'create' ? { id: `goal-${requestId}` } : {}, requestId, expectedRevision: revision.current.revision }))
      if (!result.ok) {
        if (result.message.includes('revision changed')) ids.current.complete('plan', requestId)
        setError(result.message); return
      }
      ids.current.complete('plan', requestId)
      setReviewTask(null); setReason(''); setReferences(''); setArtifacts('')
      if (action.action === 'create') { setCreating(false); setObjective('') }
    } catch { setError(t('composer.error.generic')) }
    finally { setBusy(false) }
  }
  const budget = { maxParallel: parallel, maxAttempts: attempts, maxAttemptsPerTask: perTask, maxActiveMs: Math.round(minutes * 60000) }
  const budgetFields = <div className={css.budget}>
    <label>{t('plan.parallel')}<input type="number" min={1} max={8} value={parallel} onChange={event => setParallel(Number(event.target.value))} /></label>
    <label>{t('plan.attempts')}<input type="number" min={1} max={100} value={attempts} onChange={event => setAttempts(Number(event.target.value))} /></label>
    <label>{t('plan.perTask')}<input type="number" min={1} max={10} value={perTask} onChange={event => setPerTask(Number(event.target.value))} /></label>
    <label>{t('plan.minutes')}<input type="number" min={1} max={1440} value={minutes} onChange={event => setMinutes(Number(event.target.value))} /></label>
  </div>
  const evidenceFields = <div className={css.fields}>
    <label>{t('plan.reason')}<textarea value={reason} onChange={event => setReason(event.target.value)} /></label>
    <label>{t('plan.references')}<textarea value={references} onChange={event => setReferences(event.target.value)} /></label>
    <label>{t('plan.artifacts')}<textarea value={artifacts} onChange={event => setArtifacts(event.target.value)} /></label>
  </div>
  const list = (values: readonly string[]): ReactNode => <ul>{values.map((value, index) => <li key={`${index}:${value}`}>{/^https?:\/\//i.test(value)
    ? <a href={value} target="_blank" rel="noreferrer">{value}</a> : <span className={css.reference}>{value}</span>}</li>)}</ul>
  const attemptView = (attempt: PlanAttempt): ReactNode => <details key={attempt.id} className={css.attempt}>
    <summary>{t('plan.attempt')} {attempt.number} · {status(attempt.status)}</summary>
    <div className={css.reference}>{attempt.id}</div>
    {attempt.error && <p role="status">{attempt.error}</p>}
    {attempt.submission && <><p className={css.text}>{attempt.submission.summary}</p>{list(attempt.submission.references)}{list(attempt.submission.artifacts)}</>}
    {attempt.review && <p>{attempt.review.by} · {attempt.review.reason}</p>}
    {attempt.retry && <p>{attempt.retry.by} · {attempt.retry.reason}</p>}
  </details>
  const taskView = (task: PlanTask): ReactNode => {
    const owner = members.find(member => member.id === task.ownerMemberId)
    const attempt = task.attempts.at(-1)
    const uncertain = attempt?.status === 'uncertain'
    const reviewable = attempt?.status === 'submitted' && attempt.settledAt !== undefined
    return <details key={task.id} id={`room-plan-task-${task.id}`} className={task.parentId === undefined ? css.task : css.childTask}>
      <summary>{task.title} · {task.kind === 'group' ? t('plan.group') : status(task.status)}{owner && ` · ${owner.name}`}</summary>
      <p className={css.text}>{task.instruction}</p>
      {task.parentId && <p>{t('plan.parent')}: {plan?.tasks.find(parent => parent.id === task.parentId)?.title ?? task.parentId}</p>}
      {task.criteria.length > 0 && <><strong>{t('plan.criteria')}</strong>{list(task.criteria)}</>}
      {task.inputRefs.length > 0 && <><strong>{t('plan.inputs')}</strong>{list(task.inputRefs)}</>}
      {task.artifactPaths.length > 0 && <><strong>{t('plan.expectedArtifacts')}</strong>{list(task.artifactPaths)}</>}
      {task.dependsOn.length > 0 && <div>{t('plan.dependencies')}: {task.dependsOn.map(id => <a key={id} className={css.dependency} href={`#room-plan-task-${id}`}>{plan?.tasks.find(task => task.id === id)?.title ?? id}</a>)}</div>}
      <div className={css.actions}>
        {owner?.childSessionId && openSession && <button type="button" onClick={() => openSession(owner.childSessionId!)}>{t('plan.session')}</button>}
        {owner && stopMember && attempt?.startedAt !== undefined && attempt.settledAt === undefined && ['running', 'submitted'].includes(attempt.status) && <button type="button" onClick={() => stopMember(owner.name)}>{t('composer.stop')}</button>}
        {(uncertain || (!closed && (reviewable || task.status === 'failed'))) && <button type="button" onClick={() => { setReviewTask(task.id); setGoalControls(false); setReason(''); setReferences(''); setArtifacts('') }}>{t(uncertain ? 'plan.reconcile' : reviewable ? 'plan.review' : 'plan.retry')}</button>}
      </div>
      {reviewTask === task.id && attempt && <div className={css.review}>
        {evidenceFields}
        <div className={css.actions}>
          {reviewable && <>
            <button type="button" disabled={busy || !hasEvidence} onClick={() => { void run({ action: 'review', taskId: task.id, attemptId: attempt.id, decision: 'accepted', reason, references: lines(references) }) }}>{t('plan.accept')}</button>
            <button type="button" disabled={busy || !hasEvidence} onClick={() => { void run({ action: 'review', taskId: task.id, attemptId: attempt.id, decision: 'rework', reason, references: lines(references) }) }}>{t('plan.rework')}</button>
          </>}
          {uncertain && <>
            <button type="button" disabled={busy || !hasEvidence} onClick={() => { void run({ action: 'reconcile', taskId: task.id, attemptId: attempt.id, outcome: 'submitted', evidence }) }}>{t('plan.reconcileSubmitted')}</button>
            <button type="button" disabled={busy || !hasEvidence} onClick={() => { void run({ action: 'reconcile', taskId: task.id, attemptId: attempt.id, outcome: 'failed', evidence }) }}>{t('plan.reconcileFailed')}</button>
          </>}
          {!uncertain && !reviewable && task.status === 'failed' && <button type="button" disabled={busy || reason.trim() === ''} onClick={() => { void run({ action: 'retry', taskId: task.id, reason }) }}>{t('plan.retry')}</button>}
        </div>
      </div>}
      {task.attempts.map(attemptView)}
    </details>
  }
  const leaf = plan?.tasks.filter(task => task.kind === 'task' && task.status !== 'cancelled') ?? []
  const accepted = leaf.filter(task => task.status === 'accepted').length
  const closed = plan !== undefined && ['completed', 'cancelled'].includes(plan.status)
  const createForm = <div className={css.fields}>
    <label>{t('plan.objective')}<textarea value={objective} onChange={event => setObjective(event.target.value)} /></label>
    <label><input type="checkbox" checked={execute} onChange={event => setExecute(event.target.checked)} />{t('plan.execute')}</label>
    {budgetFields}
    <button type="button" disabled={busy || objective.trim() === ''} onClick={() => { void run({ action: 'create', objective: objective.trim(), mode: execute ? 'execute' : 'draft', budget }) }}>{t(execute ? 'plan.start' : 'plan.saveDraft')}</button>
  </div>
  return <details className={css.root} data-testid="room-plan">
    <summary>{plan === undefined ? t('plan.create') : `${plan.objective} · ${status(plan.status)} · ${t('plan.acceptedCount', { done: accepted, total: leaf.length })}`}</summary>
    {error && <p role="alert">{error}</p>}
    {plan === undefined ? createForm : <>
      <p>{t('plan.revision')}: {plan.revision} · {t('plan.attempts')}: {plan.tasks.reduce((count, task) => count + task.attempts.length, 0)}/{plan.budget.maxAttempts} · {t('plan.parallel')}: {plan.budget.maxParallel}</p>
      {plan.reason && <p role="status">{plan.reason}</p>}
      {!closed && <div className={css.actions}>
        {plan.status === 'running' ? <button type="button" disabled={busy} onClick={() => { void run({ action: 'pause', goalId: plan.id, reason: t('plan.humanPause') }) }}>{t('plan.pause')}</button>
          : <button type="button" disabled={busy} onClick={() => { void run({ action: 'resume' }) }}>{t('plan.resume')}</button>}
      </div>}
      {plan.stages.map(stage => <details key={stage.id} className={css.stage} open>
        <summary>{stage.title}</summary>{plan.tasks.filter(task => task.stageId === stage.id).map(taskView)}
      </details>)}
      {plan.completion && <><p>{plan.completion.summary}</p>{list(plan.completion.references)}{list(plan.completion.artifacts)}</>}
      {!closed && <details className={css.review} open={goalControls} onToggle={event => { const open = event.currentTarget.open; setGoalControls(open); if (open) setReviewTask(null) }}>
        <summary>{t('plan.goalControls')}</summary>
        {goalControls && <>{budgetFields}<button type="button" disabled={busy} onClick={() => { void run({ action: 'budget', budget }) }}>{t('plan.updateBudget')}</button>
        {evidenceFields}
        <div className={css.actions}>
          <button type="button" disabled={busy || !hasEvidence || leaf.length === 0 || accepted !== leaf.length} onClick={() => { void run({ action: 'complete', evidence }) }}>{t('plan.complete')}</button>
          <button type="button" disabled={busy || reason.trim() === ''} onClick={() => { void run({ action: 'cancel', reason }) }}>{t('plan.cancel')}</button>
        </div></>}
      </details>}
      {closed && <button type="button" onClick={() => setCreating(value => !value)}>{t('plan.create')}</button>}
      {closed && creating && createForm}
    </>}
  </details>
}
