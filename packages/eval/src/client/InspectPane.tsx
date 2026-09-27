/**
 * 查看 (T85 §二 / T86): the one pane every 「查看」 in the lab opens, drawn
 * the same in either container — the host's right sidebar (default) or the
 * page's own Sheet (fallback, {@link InspectSheet}).
 *
 * The host sidebar has no header row, no subtitle and no content history, so
 * the pane draws all three: ‹ 返回 (only when there is something under the
 * top), the page's title, the source line (dataset @ commit, run, attempt),
 * and ✕. The stack is the container's; the pane only draws its top.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { EvalJudgePromptView } from '../types.ts'
import type { LabViewInjected, LabViewProps } from './contract.ts'
import { ItemMaterials, JudgePromptActual, JudgePromptPreviewBody, type Answer, type ItemInspectFaces } from './Inspect.tsx'
import { targetKey, type InspectTarget } from './inspect-target.ts'
import css from './LabView.module.css'

type T = LabViewProps['t']

/** The reads the pane's pages use: the lab tab's own injected face, a subset. */
export type InspectReads =
  & Pick<LabViewInjected, 'fetchExperimentArtifact' | 'fetchCell' | 'fetchCellArtifact' | 'fetchReport' | 'fetchRunUnits' | 'openSession'
    | 'fetchPlanReview' | 'fetchExperiment' | 'fetchExperiments'>
  & { [K in 'fetchItemMaterials' | 'fetchDatasetFile' | 'fetchJudgePromptPreview' | 'fetchJudgePrompt']: LabViewInjected[K] | undefined }

/**
 * The pane's reads out of the lab's injected face.
 * @param face - the lab tab's injected face.
 */
export function inspectReadsOf(face: LabViewInjected): InspectReads {
  const { fetchItemMaterials, fetchDatasetFile, fetchJudgePromptPreview, fetchJudgePrompt,
    fetchExperimentArtifact, fetchCell, fetchCellArtifact, fetchReport, fetchRunUnits, openSession,
    fetchPlanReview, fetchExperiment, fetchExperiments } = face
  return {
    fetchItemMaterials, fetchDatasetFile, fetchJudgePromptPreview, fetchJudgePrompt,
    fetchExperimentArtifact, fetchCell, fetchCellArtifact, fetchReport, fetchRunUnits, openSession,
    fetchPlanReview, fetchExperiment, fetchExperiments,
  }
}

/** Flatten a remote result into the pane's answer shape. */
export function flat<V>(result: { ok: true; value: V } | { ok: false; error: { message: string } }): Answer<V> {
  return result.ok ? { ok: true, value: result.value } : { ok: false, message: result.error.message }
}

/**
 * The item faces of one experiment, or null when the host half predates them.
 * @param reads - the injected reads.
 * @param sessionId - the session the reads are made in.
 * @param experimentId - the experiment whose pinned dataset is read.
 */
export function itemFaces(reads: InspectReads, sessionId: SessionId, experimentId: string): ItemInspectFaces | null {
  const { fetchItemMaterials, fetchDatasetFile, fetchJudgePromptPreview } = reads
  if (fetchItemMaterials === undefined || fetchDatasetFile === undefined) return null
  return {
    materials: item => fetchItemMaterials(sessionId, { experimentId, item }).then(flat),
    file: request => fetchDatasetFile(sessionId, { experimentId, ...request }).then(flat),
    preview: fetchJudgePromptPreview === undefined
      ? null
      : (item, judge) => fetchJudgePromptPreview(sessionId, { experimentId, item, ...(judge === null ? {} : { judge }) }).then(flat),
  }
}

/**
 * The title a target's page carries — the header's and the host chip's.
 * @param target - the page on top.
 * @param t - translate.
 */
export function inspectTitle(target: InspectTarget | undefined, t: T): string {
  if (target === undefined) return t('inspect.paneTitle')
  switch (target.page) {
    case 'item': return t('inspect.title', { item: target.item })
    case 'judge-prompt': return t('judgePrompt.previewTitle')
    case 'judge-prompt-actual': return t('judgePrompt.actualTitle', { cell: target.label })
    case 'plan-file': return 'plan.json'
    case 'design-part': return t(target.part === 'notes' ? 'design.notes' : target.part === 'checks' ? 'review.checks' : 'design.advanced')
    case 'record': return t('inspect.recordTitle', { record: target.label })
    case 'artifact': return target.path.split('/').pop() ?? target.path
    case 'analysis': return target.name
    case 'report-part': return t(target.part === 'audit' ? 'report.audit' : 'report.exportFold')
    case 'answer-file': return target.name
  }
}

/** What every page gets: its target, the reads, and the way to go one level down. */
export interface InspectPageProps<P extends InspectTarget['page']> {
  target: Extract<InspectTarget, { page: P }>
  reads: InspectReads
  sessionId: SessionId
  /** Open a further target on top of this one. */
  onPush: (target: InspectTarget) => void
  /** Replace the top with a variant of itself (an item tab, a picker) — no new level. */
  onReplace: (target: InspectTarget) => void
  /** The header's quiet line, once the page knows it. */
  setSub: (sub: string | null) => void
  t: T
}

/** The item page: the five tabs over the pinned dataset. */
function ItemPage(props: InspectPageProps<'item'>) {
  const { target, reads, sessionId, onReplace, setSub, t } = props
  const faces = useMemo(() => itemFaces(reads, sessionId, target.experimentId), [reads, sessionId, target.experimentId])
  if (faces === null) return <div className={css.dim}>{t('inspect.unsupported')}</div>
  return (
    <ItemMaterials
      item={target.item}
      faces={faces}
      tab={target.tab ?? 'task'}
      onTab={(tab) => { onReplace({ ...target, tab }) }}
      onSub={setSub}
      t={t}
    />
  )
}

/** The pre-run judge prompt, with its pickers. */
function JudgePromptPage(props: InspectPageProps<'judge-prompt'>) {
  const { target, reads, sessionId, onReplace, t } = props
  const faces = useMemo(() => itemFaces(reads, sessionId, target.experimentId), [reads, sessionId, target.experimentId])
  if (faces?.preview == null) return <div className={css.dim}>{t('inspect.unsupported')}</div>
  return (
    <JudgePromptPreviewBody
      items={target.items}
      judges={target.judges}
      item={target.item ?? target.items[0] ?? ''}
      judge={target.judge === undefined ? (target.judges[0] ?? null) : target.judge}
      onPick={(item, judge) => { onReplace({ ...target, item, judge }) }}
      preview={faces.preview}
      t={t}
    />
  )
}

/** The prompt.md one cell's judge actually received. */
function JudgePromptActualPage(props: InspectPageProps<'judge-prompt-actual'>) {
  const { target, reads, sessionId, setSub, t } = props
  const { fetchJudgePrompt } = reads
  const { runId, missionId, attempt } = target
  useEffect(() => { setSub(`${runId} · ${missionId} · attempt ${String(attempt)}`) }, [runId, missionId, attempt, setSub])
  const read = useCallback((judge: string | null, sample: string | null): Promise<Answer<EvalJudgePromptView>> => {
    if (fetchJudgePrompt === undefined) return Promise.resolve({ ok: false, message: t('inspect.unsupported') })
    return fetchJudgePrompt(sessionId, {
      runId, missionId, attempt, ...(judge === null ? {} : { judge }), ...(sample === null ? {} : { sample }),
    }).then(flat)
  }, [fetchJudgePrompt, sessionId, runId, missionId, attempt, t])
  return <JudgePromptActual read={read} t={t} />
}

/** The pages this build draws; a page added later registers here. */
const PAGES: { [P in InspectTarget['page']]?: (props: InspectPageProps<P>) => ReactNode } = {
  'item': ItemPage,
  'judge-prompt': JudgePromptPage,
  'judge-prompt-actual': JudgePromptActualPage,
}

/**
 * Extend the page table (the lab's further pages live beside the lab pages
 * whose parts they reuse, and register here instead of importing them).
 * @param page - the page id.
 * @param component - its body.
 */
export function registerInspectPage<P extends InspectTarget['page']>(page: P, component: (props: InspectPageProps<P>) => ReactNode): void {
  (PAGES as Record<string, unknown>)[page] = component
}

/** The props of the pane. */
export interface InspectPaneProps {
  /** Bottom first; the top is drawn. Empty draws the recent list. */
  stack: readonly InspectTarget[]
  /** Recently seen targets, newest first — the floor under the stack. */
  recent: readonly InspectTarget[]
  reads: InspectReads
  sessionId: SessionId
  onPush: (target: InspectTarget) => void
  onReplace: (target: InspectTarget) => void
  onBack: () => void
  onClose: () => void
  t: T
}

/**
 * The pane: header, then the top target's page.
 * @param props - the stack and the ways to move it.
 */
export function InspectPane(props: InspectPaneProps) {
  const { stack, recent, reads, sessionId, onPush, onReplace, onBack, onClose, t } = props
  const top = stack.at(-1)
  // The source line belongs to the page that reported it: a new top shows
  // none until its own page says (no stale commit under another item).
  const topKey = top === undefined ? '' : targetKey(top)
  const [said, setSaid] = useState<{ key: string; sub: string | null }>({ key: '', sub: null })
  const setSub = useCallback((sub: string | null) => { setSaid({ key: topKey, sub }) }, [topKey])
  const sub = said.key === topKey ? said.sub : null
  const Page = top === undefined ? undefined : PAGES[top.page] as ((p: InspectPageProps<InspectTarget['page']>) => ReactNode) | undefined
  return (
    <div className={css.inspectPane} data-page={top?.page ?? 'empty'}>
      <header className={css.sheetHead}>
        {stack.length > 1 && (
          <Button variant="ghost" size="sm" onClick={onBack} aria-label={t('inspect.back')}>‹ {t('inspect.back')}</Button>
        )}
        <div className={css.sheetTitles}>
          <div className={css.sheetTitle}>{inspectTitle(top, t)}</div>
          {sub !== null && <div className={css.sheetSub}>{sub}</div>}
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label={t('inspect.close')}>✕</Button>
      </header>
      <div className={css.sheetBody}>
        {top === undefined && (
          recent.length === 0
            ? <div className={css.dim}>{t('inspect.nothing')}</div>
            : (
              <>
                <div className={css.dim}>{t('inspect.recent')}</div>
                <ul className={css.inspectList}>
                  {recent.map(target => (
                    <li key={targetKey(target)}>
                      <button type="button" className={css.inspectFile} onClick={() => { onPush(target) }}>
                        {inspectTitle(target, t)}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )
        )}
        {top !== undefined && Page === undefined && <div className={css.dim}>{t('inspect.unsupported')}</div>}
        {top !== undefined && Page !== undefined && (
          <Page key={topKey} target={top} reads={reads} sessionId={sessionId} onPush={onPush} onReplace={onReplace} setSub={setSub} t={t} />
        )}
      </div>
    </div>
  )
}
