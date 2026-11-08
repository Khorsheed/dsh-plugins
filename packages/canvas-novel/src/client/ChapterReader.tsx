/**
 * The chapter reader: one chapter as a page of the book — a head (number,
 * title, and the progress block: 规划 → 写作 → 已对账 with the one next step
 * spelled out), the plan block, any pending items left from before 对账
 * stopped asking, the text as a reading column, then a glimpse of the next
 * chapter and a pager that stays in reach. A reconciled chapter is done:
 * there is no 审过 (2026-10-09) — the person corrects a card that is wrong.
 *
 * It lives in the 章节 face's book (behind the table of contents); every
 * outside way to a chapter lands there too.
 *
 * @module @khorsheed/dsh-canvas-novel/client
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { Button, IconChevronLeftOutlineMedium, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EffectiveChapterPhase, NovelChapterResult } from '../types.ts'
import type { NovelSurfaceProps } from './contract.ts'
import { PendingList } from './PendingList.tsx'
import { PlanBlock } from './PlanBlock.tsx'
import { errorKey, useNovelRead } from './use-novel.ts'
import { ChapterFeedback, type ChapterFeedbackMark } from './ChapterFeedback.tsx'
import { ChapterMarkdown } from './ChapterMarkdown.tsx'
import css from './novel.module.css'

/** The plan fields an edit receipt may name (text-forms.ts's PLAN_FIELDS, host-side). */
const PLAN_FIELD_KEYS = ['summary', 'words', 'beats', 'conflict', 'highlight', 'foreshadowOps', 'cast', 'pov', 'infoGaps', 'advances', 'uses', 'hook'] as const
type PlanField = typeof PLAN_FIELD_KEYS[number]

const LAMP = ['lamp.plan', 'lamp.write', 'lamp.extract'] as const

/** How far along the lamp a phase is (the lit step; past the last: all done). */
const LAMP_STEP: Readonly<Record<EffectiveChapterPhase, number>> = {
  planning: 0, writing: 1, fileMissing: 1, stale: 2, extracted: 3, reviewed: 3,
}

/**
 * The plan block's key suffix when the reader was asked to open on the plan (a
 * plan card's door): the block opens and scrolls into view whatever the phase —
 * folded under a written chapter's text, it read as a page that did not open
 * the plan (2026-10-10).
 */
const PLAN_FOCUS = ':plan'

/** A chapter title without the number it often carries (`第1章 门与假门` → `门与假门`). */
export function bareTitle(n: number, title: string): string {
  return title.replace(new RegExp(`^第\\s*${n}\\s*章[\\s·:：]*`), '').trim()
}

/** One chapter, with its way to the neighbours and back to the contents. */
export function ChapterReader(props: NovelSurfaceProps & {
  readonly n: number
  readonly onGo: (n: number) => void
  readonly onToc: () => void
  /** Open on the plan (the page was opened from a plan card). */
  readonly focusPlan?: boolean
  /** Show the edit box rather than the reading preview. */
  readonly editing?: boolean
  readonly onEditingChange: (editing: boolean) => void
}): ReactNode {
  const { canvasId, board, rev, n, onGo, onToc, navigate, sessionId, remote, t } = props
  const api = remote()
  const read = useNovelRead(api, r => r.chapter({ canvasId, n }), `chapter:${canvasId}:${n}`, rev)
  const next = useNovelRead(api, r => r.chapter({ canvasId, n: n + 1 }), `chapter:${canvasId}:${n + 1}`, rev)
  const chapters = useNovelRead(api, r => r.chapters({ canvasId }), `chapters:${canvasId}`, rev)
  const pending = useNovelRead(api, r => r.pending({ canvasId }), `pending:${canvasId}`, rev)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackCount, setFeedbackCount] = useState(0)
  const [feedbackAnchor, setFeedbackAnchor] = useState<HTMLDivElement | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // A new chapter starts at its top, whichever pane scrolls.
    const node = scroller.current
    if (node !== null) node.scrollTop = 0
    node?.scrollIntoView?.({ block: 'start' })
  }, [n])
  useEffect(() => { setFeedbackOpen(false) }, [canvasId, n])
  if (api === undefined) return null
  const total = chapters.state === 'ready' ? chapters.value.chapters.length : 0
  const items = pending.state === 'ready' ? pending.value.items.filter(item => item.chapter === n) : []
  const canEdit = sessionId !== undefined && read.state === 'ready' && read.value.ok && read.value.chapter !== undefined
  const mode: 'preview' | 'edit' = canEdit && props.editing === true ? 'edit' : 'preview'
  const modeId = `chapter-body-${canvasId}-${n}`
  const feedbackId = `chapter-feedback-${canvasId}-${n}`
  const canViewFeedback = mode === 'preview' && read.state === 'ready' && read.value.ok && read.value.chapter !== undefined
  const toggleFeedback = (open: boolean): void => { setFeedbackOpen(open && mode === 'preview') }

  const gesture = async (call: 'confirmPlan'): Promise<void> => {
    if (sessionId === undefined) return
    setBusy(true)
    setFailure(null)
    try {
      const result = await api[call](sessionId, { canvasId, n })
      if (!result.ok) setFailure(t('error.generic', { message: result.error.message }))
      else if (!result.value.ok) setFailure(t(errorKey(result.value.error)))
      // 按计划开写 (2026-11-01): the confirmation is also the go-ahead — the
      // line goes out as the person's message so the agent starts writing.
      else props.sendToConversation?.(sessionId, t('plan.startWriting', { n }))
      navigate.refresh()
    } finally {
      setBusy(false)
    }
  }

  /**
   * The person's own edit: saved and confirmed at once, then one line in the
   * conversation input (never sent) tells the model the plan moved and which
   * parts — the model reads the stored plan when it writes.
   */
  const savePlan = async (chapterN: number, text: string): Promise<string | null> => {
    if (sessionId === undefined) return t('chapter.gate.readOnly')
    setBusy(true)
    try {
      const result = await api.editPlan(sessionId, { canvasId, n: chapterN, text })
      if (!result.ok) return t('error.generic', { message: result.error.message })
      const value = result.value
      if (!value.ok) {
        return value.unknown !== undefined && value.unknown.length > 0
          ? t('plan.unknown', { list: value.unknown.join('、') })
          : t(errorKey(value.error))
      }
      const fields = (value.changed ?? []).filter((field): field is PlanField => (PLAN_FIELD_KEYS as readonly string[]).includes(field))
      props.draftToConversation?.(sessionId, fields.length === 0
        ? t('plan.draftSame', { n: chapterN })
        : t('plan.draft', { n: chapterN, fields: fields.map(field => t(`plan.field.${field}`)).join('、') }))
      navigate.refresh()
      return null
    } finally {
      setBusy(false)
    }
  }

  let body: ReactNode
  if (read.state === 'loading') body = <div className={css.muted}>{t('state.loading')}</div>
  else if (read.state === 'error') body = <div className={css.warn}>{t('error.generic', { message: read.message })}</div>
  else if (!read.value.ok || read.value.chapter === undefined) body = <div className={css.warn}>{t(errorKey(read.value.error))}</div>
  else {
    const view = read.value
    const chapter = view.chapter!
    const phase = view.phase ?? 'planning'
    body = (
      <>
        <div className={css.chap}>
          <header className={css.chapHead}>
            <div className={css.chapMeta}>
              <span>{t('reader.kicker', { n })}</span>
              {chapter.byUser === true && <span title={t('chapter.byUserTitle')}>{t('chapter.byUser')}</span>}
              {chapter.wordCount !== undefined && <span>{t('chapter.words', { count: chapter.wordCount })}</span>}
            </div>
            <h2 className={css.chapTitle}>{bareTitle(n, chapter.title) || t('strip.chapter', { n })}</h2>
          </header>
          <Progress n={n} phase={phase} pending={items.length} writable={sessionId !== undefined} t={t} />
          <PlanBlock
            key={`${n}${props.focusPlan === true ? PLAN_FOCUS : ''}`}
            focus={props.focusPlan === true}
            chapter={chapter}
            phase={phase}
            names={view.names}
            {...(view.targetWords === undefined ? {} : { words: view.targetWords })}
            canConfirm={sessionId !== undefined && chapter.byUser !== true}
            busy={busy}
            onConfirm={() => { void gesture('confirmPlan') }}
            {...(view.planText === undefined ? {} : { planText: view.planText, onSave: (text: string) => savePlan(chapter.n, text) })}
            t={t}
          />
          {items.length > 0 && (
            <section className={css.section}>
              <h3 className={css.sectionHeading}>{t('chapter.pendingHeading')}</h3>
              <PendingList canvasId={canvasId} items={items} navigate={navigate} sessionId={sessionId} remote={api} t={t} />
            </section>
          )}
          <BodyEditor
            key={`body:${n}`}
            id={modeId}
            view={view}
            open={mode === 'edit'}
            tabbed={canEdit}
            onOpenChange={props.onEditingChange}
            onSave={async text => {
              if (sessionId === undefined) return { error: t('chapter.gate.readOnly') }
              const result = await api.editChapterBody(sessionId, { canvasId, n, text, ...(view.bodyHash === undefined ? {} : { baseHash: view.bodyHash }) })
              navigate.refresh()
              if (!result.ok) return { error: t('error.generic', { message: result.error.message }) }
              if (!result.value.ok) return { error: result.value.error === 'stale' ? t('edit.stale') : t(errorKey(result.value.error)) }
              return { changed: result.value.changed ?? 0, kept: result.value.kept === true }
            }}
            onIdea={async text => {
              if (sessionId === undefined) return false
              const result = await api.changeIdea(sessionId, { canvasId, add: text })
              return result.ok && result.value.ok
            }}
            onContinue={() => { if (sessionId !== undefined) props.sendToConversation?.(sessionId, t('edit.continueAsk', { n })) }}
            t={t}
          >
            {text => (
              <ChapterFeedback {...props} n={n} chapterTitle={bareTitle(n, chapter.title)} body={text} bodyHash={view.bodyHash} enabled={mode === 'preview'} open={feedbackOpen && mode === 'preview'} onOpenChange={toggleFeedback} onCountChange={setFeedbackCount} panelAnchor={feedbackAnchor}>
                {ideas => <Prose view={{ ...view, body: text }} phase={phase} t={t} ideas={ideas} source={`${board.title ?? ''} · ${t('reader.kicker', { n })}`} reference={`novel:${canvasId}:${n}`} />}
              </ChapterFeedback>
            )}
          </BodyEditor>
          <div className={css.end}>
            <span className={css.orn}>{t('reader.end')}</span>
            {failure !== null && <span className={css.warn}>{failure}</span>}
            {view.file !== undefined && <span className={css.path}>{view.file}</span>}
          </div>
        </div>
        <NextChapter n={n} next={next.state === 'ready' ? next.value : undefined} onGo={onGo} t={t} />
      </>
    )
  }

  return (
    <div className={css.reader} ref={scroller} data-canvas-scroll="novel-reader">
      <div className={css.readerTop}>
        <Button size="sm" variant="ghost" icon={<IconChevronLeftOutlineMedium size={16} />} aria-label={t('reader.back')} onClick={onToc}>
          {t('reader.toc')}
        </Button>
        <span className={css.readerWork}>{board.title ?? ''}</span>
        {canViewFeedback && (
          <div className={css.feedbackControl} ref={setFeedbackAnchor}>
            <Button size="sm" variant="ghost" className={css.feedbackToggle} aria-label={t('feedback.show')} title={t('feedback.title')} aria-expanded={feedbackOpen} aria-controls={feedbackId} onClick={() => { setFeedbackOpen(value => !value) }}>
              {t('feedback.show')}{feedbackCount > 0 && <span className={css.feedbackToggleCount}>{feedbackCount}</span>}
            </Button>
          </div>
        )}
        {canEdit && (
          <SegmentedControl
            id={modeId}
            className={css.readerMode}
            label={t('edit.modeLabel')}
            value={mode}
            options={[{ value: 'preview', label: t('edit.preview') }, { value: 'edit', label: t('edit.mode') }]}
            onChange={next => { toggleFeedback(false); props.onEditingChange(next === 'edit') }}
          />
        )}
        {total > 0 && <span className={css.readerWhere}>{n} / {total}</span>}
      </div>
      {body}
      <nav className={css.pager}>
        <button type="button" disabled={n <= 1} onClick={() => { onGo(n - 1) }}>{t('reader.prev')}</button>
        <button type="button" className={css.pagerMid} onClick={onToc}>{t('reader.contents')}</button>
        <button type="button" disabled={total === 0 || n >= total} onClick={() => { onGo(n + 1) }}>{t('reader.next')}</button>
      </nav>
    </div>
  )
}

/** A local draft survives a dropped connection or a closed page until it is saved. */
function draftKey(view: NovelChapterResult): string {
  return `novel-draft:${view.file ?? ''}:${view.chapter?.id ?? `ch:${view.chapter?.n ?? 0}`}`
}

/**
 * Preview or edit the chapter text. Previewing keeps an unsaved draft; cancel
 * discards it. Saving reports whether the chapter stayed 已对账. A selection
 * can be kept as an idea; 让 Agent 接着写 asks in the conversation.
 */
function BodyEditor({ id, view, open, tabbed, onOpenChange, onSave, onIdea, onContinue, t, children }: {
  readonly id: string
  readonly view: NovelChapterResult
  readonly open: boolean
  readonly tabbed: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSave: (text: string) => Promise<{ readonly error?: string; readonly changed?: number; readonly kept?: boolean }>
  readonly onIdea: (text: string) => Promise<boolean>
  readonly onContinue: () => void
  readonly t: TranslateNS<'novel'>
  readonly children: (text: string) => ReactNode
}): ReactNode {
  const stored = (): string | null => { try { return window.localStorage.getItem(draftKey(view)) } catch { return null } }
  const [draft, setDraft] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const text = draft ?? stored() ?? view.body ?? ''
  useEffect(() => { if (open) setNote(null) }, [open])
  const keep = (value: string | null): void => {
    try { if (value === null) window.localStorage.removeItem(draftKey(view)); else window.localStorage.setItem(draftKey(view), value) } catch { /* a private window keeps nothing; the edit still works */ }
  }
  if (!open) {
    return (
      <div role={tabbed ? 'tabpanel' : undefined} id={tabbed ? `${id}-preview-panel` : undefined} aria-labelledby={tabbed ? `${id}-preview` : undefined}>
        {note !== null && <p className={css.editNote}>{note}</p>}
        {children(text)}
      </div>
    )
  }
  const count = text.replace(/\s+/g, '').length
  return (
    <section className={css.editor} role="tabpanel" id={`${id}-edit-panel`} aria-labelledby={`${id}-edit`}>
      <div className={css.editTop}>
        <button type="button" className={css.planEditBtn} disabled={busy} onClick={() => { keep(null); setDraft(null); onOpenChange(false) }}>{t('edit.cancel')}</button>
        <span className={css.muted}>{t('edit.count', { count })}</span>
        <button
          type="button"
          className={css.confirm}
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void onSave(text).then(outcome => {
              setBusy(false)
              if (outcome.error !== undefined) { setNote(outcome.error); return }
              keep(null)
              setDraft(null)
              onOpenChange(false)
              setNote(outcome.changed === 0 ? t('edit.same') : outcome.kept === true ? t('edit.kept', { count: outcome.changed ?? 0 }) : t('edit.stale2', { count: outcome.changed ?? 0 }))
            })
          }}
        >
          {t('edit.save')}
        </button>
      </div>
      <textarea
        ref={box}
        className={css.editBox}
        aria-label={t('edit.open')}
        value={text}
        onChange={event => { setDraft(event.target.value); keep(event.target.value) }}
      />
      <div className={css.editBar}>
        <button
          type="button"
          className={css.planEditBtn}
          disabled={busy}
          onClick={() => {
            const node = box.current
            const picked = node === null ? '' : text.slice(node.selectionStart, node.selectionEnd).trim()
            if (picked === '') { setNote(t('edit.selectFirst')); return }
            void onIdea(picked).then(ok => { setNote(ok ? t('edit.ideaSaved') : t('edit.ideaFailed')) })
          }}
        >
          {t('edit.toIdea')}
        </button>
        <button type="button" className={css.planEditBtn} disabled={busy} onClick={onContinue}>{t('edit.continue')}</button>
        <span className={css.muted}>{note ?? t('edit.hint')}</span>
      </div>
    </section>
  )
}

/** The next chapter's title and first lines, fading out; or the end of the book. */
function NextChapter({ n, next, onGo, t }: {
  readonly n: number
  readonly next: NovelChapterResult | undefined
  readonly onGo: (n: number) => void
  readonly t: TranslateNS<'novel'>
}): ReactNode {
  if (next === undefined) return null
  if (!next.ok || next.chapter === undefined) {
    return <div className={css.next}><div className={css.nextEmpty}>{t('reader.last')}</div></div>
  }
  const opening = (next.body ?? '').split('\n').map(line => line.trim()).filter(line => line !== '' && !line.startsWith('#')).slice(0, 3)
  return (
    <div className={css.next}>
      <div className={css.nextKicker}>{t('reader.nextKicker', { n: n + 1 })}</div>
      <h2 className={css.nextTitle}>{bareTitle(n + 1, next.chapter.title) || t('strip.chapter', { n: n + 1 })}</h2>
      {opening.length === 0
        ? <div className={css.nextEmpty}>{t('reader.nextUnwritten')}</div>
        : <div className={css.fade}>{opening.join('')}</div>}
      <button type="button" className={css.nextGo} onClick={() => { onGo(n + 1) }}>{t('reader.read', { n: n + 1 })}</button>
    </div>
  )
}

/** The one next step, or that the chapter's memory is caught up. */
function nextStep(n: number, phase: EffectiveChapterPhase, pending: number, writable: boolean, t: TranslateNS<'novel'>): string {
  if (!writable) return t('chapter.gate.readOnly')
  if (phase === 'planning') return t('chapter.gate.planning')
  if (phase === 'writing') return t('chapter.gate.writing', { n })
  if (phase === 'stale') return t('chapter.gate.stale', { n })
  if (phase === 'fileMissing') return t('chapter.gate.fileMissing')
  if (pending > 0) return t('chapter.gate.pending', { count: pending })
  return t('chapter.gate.ready')
}

/**
 * Where the chapter stands: four segments (done, the current one, to come)
 * and one line naming the state and the next step — the reader's only
 * statement of it, so the top and the end of the page never disagree.
 */
function Progress({ n, phase, pending, writable, t }: {
  readonly n: number
  readonly phase: EffectiveChapterPhase
  /** Pending items left from before 对账 stopped asking. */
  readonly pending: number
  readonly writable: boolean
  readonly t: TranslateNS<'novel'>
}): ReactNode {
  const step = LAMP_STEP[phase]
  const warn = phase === 'fileMissing' || phase === 'stale'
  const tone = warn ? 'warn' : step >= LAMP.length ? 'done' : undefined
  return (
    <section className={css.progress} data-tone={tone}>
      <ol className={css.track} aria-label={t(`phase.${phase}`)}>
        {LAMP.map((key, index) => (
          <li key={key} className={css.trackStep} data-state={index < step ? 'done' : index === step ? 'current' : 'todo'} data-warn={warn && index === step ? 'true' : undefined}>
            {t(key)}
          </li>
        ))}
      </ol>
      <p className={css.progressLine}>
        <strong>{t(`phase.${phase}`)}</strong>
        <span>{nextStep(n, phase, pending, writable, t)}</span>
      </p>
    </section>
  )
}

/** The text as a reading column; Markdown rendering keeps raw offsets for selection and feedback. */
function Prose({ view, phase, t, ideas, source, reference }: {
  readonly view: NovelChapterResult
  readonly phase: EffectiveChapterPhase
  readonly t: TranslateNS<'novel'>
  readonly ideas: readonly ChapterFeedbackMark[]
  readonly source: string
  readonly reference: string
}): ReactNode {
  const body = view.body ?? ''
  if (body.trim() === '') {
    return phase === 'fileMissing'
      ? <div className={css.warn}>{t('chapter.fileMissing', { file: view.file ?? '' })}</div>
      : <div className={css.noBody}>{t(view.chapter?.planConfirmedAt === undefined && view.chapter?.plan !== undefined ? 'chapter.noBodyConfirm' : 'chapter.noBody')}</div>
  }
  return (
    <article className={css.prose} data-novel-prose="" data-quote-source={source} data-quote-ref={reference}>
      <ChapterMarkdown body={body} ideas={ideas} />
    </article>
  )
}
