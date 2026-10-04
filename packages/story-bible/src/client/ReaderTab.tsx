/**
 * The chapter reader tab: the plan card pinned at the current chapter's
 * head (POV/goal/foreshadow ops/hook + the ✓确认计划 gate), the numbered
 * chapter grid with prev/next by seq, the phase lamp (规划中→写作中→已审过
 * →已抽取, with the ✓审过本章 gate as the lamp's own verb), the recap
 * banner, and the manuscript body rendered through the shared content pane
 * (markdown, serif measure). A chapter still in planning shows the outline
 * draft view (its adopted wall ideas + its plan) instead of an empty body.
 *
 * @module @khorsheed/dsh-story-bible/client
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { ContentPane } from '@khorsheed/dsh-client-ui-content-preview/src/client/index.ts'
import type { ChapterRow, ForeshadowOp, MemoryRecord } from '../types.ts'
import { foreshadowRefOf, memoryNumberOf } from '../types.ts'
import type { StoryTabProps } from './contract.ts'
import { useWorkShell } from './data.ts'
import { chapterPreviewRead, previewTranslator, structuredLabels } from './preview.ts'
import { WorkStrip } from './WorkStrip.tsx'
import { IconCheckOutlineMedium, IconExternalOutlineMedium } from './icons.tsx'
import css from './reader.module.css'
import rootCss from './workstrip.module.css'

/** The lamp's four stations, in order (已审过 is the user's gate, before 已抽取). */
const PHASES = ['planning', 'writing', 'reviewed', 'extracted'] as const

/** The reader tab body. */
export function ReaderTab(props: StoryTabProps): ReactNode {
  const { t } = props
  const sessionId = props.sessionId
  const shell = useWorkShell(props)
  const focus = shell.focus
  const story = props.useStory(current => current)
  const [chapters, setChapters] = useState<readonly ChapterRow[] | null>(null)
  const [outlines, setOutlines] = useState<readonly MemoryRecord[]>([])

  // The chapter index: on a switch, and again whenever the shared rev moves.
  useEffect(() => {
    if (focus === null) {
      setChapters(null)
      return
    }
    let cancelled = false
    void (async () => {
      const [rows, draftOutline] = await Promise.all([
        shell.run(() => props.listChapters({ workId: focus.workId })),
        shell.run(() => props.listMemories({ workId: focus.workId, layer: 'intent', kind: '章节', intentStatus: 'active' })),
      ])
      if (cancelled) return
      if (rows !== null) setChapters(rows)
      if (draftOutline !== null) setOutlines(draftOutline)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.workId, story.rev])

  // The showing chapter: the store's explicit pick (the plan row's 「去确认」),
  // else the planning chapter, else the newest.
  const showing = useMemo(() => {
    if (chapters === null || chapters.length === 0) return null
    if (story.readerN !== null) {
      const picked = chapters.find(row => row.chapter.n === story.readerN)
      if (picked !== undefined) return picked
    }
    return chapters.find(row => row.phase === 'planning') ?? chapters[chapters.length - 1]!
  }, [chapters, story.readerN])

  const seqAt = showing === null || chapters === null ? -1 : chapters.indexOf(showing)
  const step = (delta: number): void => {
    if (chapters === null || seqAt < 0) return
    const next = chapters[seqAt + delta]
    if (next !== undefined) props.openReaderAt(next.chapter.n)
  }

  return (
    <div className={rootCss.root}>
      <WorkStrip
        t={t}
        sessionId={sessionId}
        works={shell.works}
        focus={focus}
        counts={shell.info === null ? null : { chapters: shell.info.counts.chapters, pending: shell.info.counts.pending }}
        workspaces={[]}
        onSwitch={shell.switchWork}
        onCreate={shell.createWork}
      />
      {shell.fatal !== null && (
        <div className={rootCss.notice} onClick={() => { shell.setFatal(null) }}>{shell.fatal}</div>
      )}
      {focus === null ? (
        <div className={rootCss.notice}>
          {shell.works === null ? t('state.loading') : (
            <>
              <span>{t('state.noFocus')}</span>
              <span>{t('state.noFocusHint')}</span>
            </>
          )}
        </div>
      ) : chapters === null ? (
        <div className={rootCss.notice}>{t('state.loading')}</div>
      ) : showing === null ? (
        <div className={rootCss.notice}>{t('reader.empty')}</div>
      ) : (
        <div className={rootCss.root}>
          <PlanCard
            t={t}
            row={showing}
            sessionId={sessionId}
            onConfirm={() => {
              if (sessionId === undefined) return
              void (async () => {
                const value = await shell.run(() => props.confirmChapterPlan(sessionId, { workId: focus.workId, n: showing.chapter.n }))
                if (value === null) return
                if (!value.ok) {
                  shell.showToast(shell.errorText(value.error))
                  return
                }
                props.refresh()
                shell.showToast(t('toast.planConfirmed'))
              })()
            }}
          />
          <div className={css.readHead}>
            <button type="button" className={css.navButton} disabled={seqAt <= 0} onClick={() => { step(-1) }}>
              {t('reader.prev')}
            </button>
            <span className={css.chapterTitle}>
              <b>{t('reader.chapterN', { n: String(showing.chapter.n) })}</b> · {showing.chapter.title}
            </span>
            <button type="button" className={css.navButton} disabled={chapters === null || seqAt >= chapters.length - 1} onClick={() => { step(1) }}>
              {t('reader.next')}
            </button>
          </div>
          <div className={css.readNums}>
            {(chapters ?? []).map(row => (
              <button
                key={row.chapter.n}
                type="button"
                className={css.rn}
                data-on={row.chapter.n === showing.chapter.n || undefined}
                data-plan={row.phase === 'planning' || undefined}
                onClick={() => { props.openReaderAt(row.chapter.n) }}
              >
                {row.chapter.n}
              </button>
            ))}
          </div>
          <PhaseLamp
            t={t}
            phase={showing.phase}
            sessionId={sessionId}
            onApprove={() => {
              if (sessionId === undefined) return
              void (async () => {
                const value = await shell.run(() => props.reviewChapter(sessionId, { workId: focus.workId, n: showing.chapter.n }))
                if (value === null) return
                if (!value.ok) {
                  shell.showToast(shell.errorText(value.error))
                  return
                }
                props.refresh()
                void shell.reloadShell()
                shell.showToast(t('toast.reviewed'))
              })()
            }}
          />
          {showing.chapter.recap !== undefined && (
            <div className={css.recap}>
              <span className={css.recapLabel}>{t('reader.recap')}</span>
              {showing.chapter.recap}
            </div>
          )}
          <ChapterBody
            t={t}
            props={props}
            shell={shell}
            workId={focus.workId}
            row={showing}
            outlines={outlines}
            workspace={shell.info?.meta.workspace ?? ''}
            workTitle={focus.title}
          />
          <div className={css.readFoot}>
            <span>{t('reader.footmeta', { n: String(showing.chapter.n), seq: String(showing.chapter.seq) })}</span>
            {sessionId !== undefined && showing.phase !== 'planning' && props.editorAvailable() && (
              <button
                type="button"
                className={css.openEditor}
                onClick={() => { props.openInEditor(sessionId, shell.info?.meta.workspace ?? '', focus.title, showing.chapter.file) }}
              >
                {t('reader.openEditor')}
                <IconExternalOutlineMedium size={11} />
              </button>
            )}
          </div>
        </div>
      )}
      {shell.toast !== null && (
        <Toast key={shell.toast.seq} text={shell.toast.text} onDone={shell.dismissToast} />
      )}
    </div>
  )
}

/** The plan card: the current chapter's plan plus the ✓确认计划 gate. */
function PlanCard({ t, row, sessionId, onConfirm }: {
  t: StoryTabProps['t']
  row: ChapterRow
  sessionId: StoryTabProps['sessionId']
  onConfirm: () => void
}): ReactNode {
  const plan = row.chapter.plan
  const confirmed = row.chapter.planConfirmedAt !== undefined
  if (plan === undefined) {
    return (
      <div className={css.planCard}>
        <div className={css.planHead}>
          <b>{t('reader.planTitle', { n: String(row.chapter.n) })}</b>
        </div>
        <div className={css.planRow}>{t('reader.planNone')}</div>
      </div>
    )
  }
  return (
    <div className={css.planCard}>
      <div className={css.planHead}>
        <b>{t('reader.planTitle', { n: String(row.chapter.n) })}</b>
        {sessionId !== undefined && (
          confirmed ? (
            <span className={css.planStatus} data-ok="true">
              <IconCheckOutlineMedium size={10} /> {t('reader.planConfirmed')}
            </span>
          ) : (
            <button type="button" className={css.planStatus} onClick={onConfirm}>
              {t('reader.planConfirm')}
            </button>
          )
        )}
      </div>
      <div className={css.planRow}>
        <span className={css.planLabel}>{t('reader.pov')}</span>
        {plan.pov ?? '—'}
        <span className={css.planLabel} style={{ marginLeft: 10 }}>{t('reader.goal')}</span>
        {plan.goal}
      </div>
      {plan.foreshadowOps.length > 0 && (
        <div className={css.planRow}>
          <span className={css.planLabel}>{t('reader.ops')}</span>
          {plan.foreshadowOps.map((op, index) => (
            <span key={index} className={css.fop}>{opTextOf(op)}</span>
          ))}
        </div>
      )}
      {plan.characters.length > 0 && (
        <div className={css.planRow}>
          <span className={css.planLabel}>{t('reader.characters')}</span>
          {plan.characters.join('、')}
        </div>
      )}
      {plan.hook !== undefined && (
        <div className={css.planRow}>
          <span className={css.planLabel}>{t('reader.hook')}</span>
          {plan.hook}
        </div>
      )}
    </div>
  )
}

/** One planned op as the card reads it: `推进 #12` / `新埋 [question]`. */
function opTextOf(op: ForeshadowOp): string {
  if (op.op === '新埋' || op.id === undefined) return `${op.op} [${op.question ?? ''}]`
  const num = memoryNumberOf(op.id.startsWith('m') ? op.id : `m${op.id.replace(/^#/, '')}`)
  return `${op.op} ${foreshadowRefOf(`m${num}`)}`
}

/** The phase lamp with the ✓审过 gate (clickable only before the gate). */
function PhaseLamp({ t, phase, sessionId, onApprove }: {
  t: StoryTabProps['t']
  phase: ChapterRow['phase']
  sessionId: StoryTabProps['sessionId']
  onApprove: () => void
}): ReactNode {
  const at = PHASES.indexOf(phase)
  return (
    <div className={css.phaseLamp}>
      {PHASES.map((station, index) => (
        <span key={station} style={{ display: 'inline-flex', alignItems: 'center' }}>
          {index > 0 && <span className={css.phaseLine} />}
          <span className={css.phase} data-done={index < at || undefined} data-cur={index === at || undefined}>
            {index < at ? '✓' : '·'} {t(`reader.phase.${station}`)}
          </span>
        </span>
      ))}
      {sessionId !== undefined && (
        phase === 'reviewed' || phase === 'extracted' ? (
          <span className={css.approveButton} data-ok="true">{t('reader.approved')}</span>
        ) : (
          <button type="button" className={css.approveButton} title={t('reader.approveTitle')} onClick={onApprove}>
            {t('reader.approve')}
          </button>
        )
      )}
    </div>
  )
}

/** The chapter body: the outline draft while planning, the manuscript through the content pane after. */
function ChapterBody({ t, props, shell, workId, row, outlines, workspace, workTitle }: {
  t: StoryTabProps['t']
  props: StoryTabProps
  shell: ReturnType<typeof useWorkShell>
  workId: string
  row: ChapterRow
  outlines: readonly MemoryRecord[]
  workspace: string
  workTitle: string
}): ReactNode {
  const [body, setBody] = useState<string | undefined>(undefined)
  const rev = props.useStory(current => current.rev)
  const planning = row.phase === 'planning'

  useEffect(() => {
    if (planning) return
    setBody(undefined)
    let cancelled = false
    void (async () => {
      const value = await shell.run(() => props.readChapter({ workId, n: row.chapter.n }))
      if (!cancelled && value !== null && value.ok) setBody(value.body ?? '')
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId, row.chapter.n, planning, rev])

  if (planning) {
    return (
      <div className={css.readBody}>
        <div className={css.measure}>
          {outlines.length === 0 ? (
            <div className={css.outline}>
              <div className={css.outlineTag}>{t('reader.outlineTitle')}</div>
              {t('reader.outlineEmpty')}
            </div>
          ) : (
            outlines.map(memory => (
              <div key={memory.id} className={css.outline}>
                <div className={css.outlineTag}>{t('reader.outlineTitle')}</div>
                {memory.content}
                <div className={css.outlineFrom}>{t('reader.outlineFrom')}</div>
              </div>
            ))
          )}
          <div className={css.outline} style={{ opacity: 0.6 }}>
            <div className={css.outlineTag}>{t('reader.recap')}</div>
            {t('reader.noBody', { n: String(row.chapter.n) })}
          </div>
        </div>
      </div>
    )
  }

  const path = `${workspace}/${workTitle}/${row.chapter.file}`
  return (
    <div className={css.readBody}>
      <div className={css.measure}>
        <div className={css.bodyMeta}>
          {t('reader.bodyPath', { path })}
          {row.chapter.wordCount !== undefined && ` · ${t('reader.words', { count: String(row.chapter.wordCount) })}`}
        </div>
      </div>
      <ContentPane
        path={row.chapter.file}
        displayPath={path}
        read={body === undefined ? null : chapterPreviewRead(path, body)}
        loading={body === undefined}
        error={null}
        labels={structuredLabels(t)}
        t={previewTranslator(t)}
        embedded
      />
    </div>
  )
}
