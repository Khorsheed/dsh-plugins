/**
 * The chapter reader: one chapter as a page of the book — a head (number,
 * title, and the progress block: 规划 → 写作 → 已对账 with the one next step
 * spelled out), the plan block, any pending items left from before 对账
 * stopped asking, the text as a reading column, then a glimpse of the next
 * chapter and a pager that stays in reach. A reconciled chapter is done:
 * there is no 审过 (2026-10-09) — the person corrects a card that is wrong.
 *
 * It serves two hosts: the 成稿 face's book (behind the table of contents)
 * and the `novel:chapter` page a chat card or the strip opens.
 *
 * @module @khorsheed/dsh-canvas-novel/client
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { NOVEL_GENRE_ID, type EffectiveChapterPhase, type NovelChapterResult } from '../types.ts'
import type { NovelPageOwnerProps, NovelSurfaceProps } from './contract.ts'
import { PendingList } from './PendingList.tsx'
import { PlanBlock } from './PlanBlock.tsx'
import { errorKey, useNovelRead } from './use-novel.ts'
import css from './novel.module.css'

/** The plan fields an edit receipt may name (text-forms.ts's PLAN_FIELDS, host-side). */
const PLAN_FIELD_KEYS = ['summary', 'words', 'beats', 'conflict', 'highlight', 'foreshadowOps', 'cast', 'pov', 'infoGaps', 'hook'] as const
type PlanField = typeof PLAN_FIELD_KEYS[number]

const LAMP = ['lamp.plan', 'lamp.write', 'lamp.extract'] as const

/** How far along the lamp a phase is (the lit step; past the last: all done). */
const LAMP_STEP: Readonly<Record<EffectiveChapterPhase, number>> = {
  planning: 0, writing: 1, fileMissing: 1, stale: 2, extracted: 3, reviewed: 3,
}

/** The `novel:chapter` page entry (param: the chapter number to start at). */
export function ChapterPage(props: NovelSurfaceProps<NovelPageOwnerProps>): ReactNode {
  const [n, setN] = useState(Number(props.param))
  if (props.board.genre?.id !== NOVEL_GENRE_ID) return null
  return <ChapterReader {...props} n={n} host="page" onGo={setN} onToc={props.navigate.openManuscripts} />
}

/** A chapter title without the number it often carries (`第1章 门与假门` → `门与假门`). */
export function bareTitle(n: number, title: string): string {
  return title.replace(new RegExp(`^第\\s*${n}\\s*章[\\s·:：]*`), '').trim()
}

/** One chapter, with its way to the neighbours and back to the contents. */
export function ChapterReader(props: NovelSurfaceProps & {
  readonly n: number
  /** `book`: inside the 成稿 face (the reader scrolls itself); `page`: inside a canvas page. */
  readonly host: 'book' | 'page'
  readonly onGo: (n: number) => void
  readonly onToc: () => void
}): ReactNode {
  const { canvasId, board, rev, n, host, onGo, onToc, navigate, sessionId, remote, t } = props
  const api = remote()
  const read = useNovelRead(api, r => r.chapter({ canvasId, n }), `chapter:${canvasId}:${n}`, rev)
  const next = useNovelRead(api, r => r.chapter({ canvasId, n: n + 1 }), `chapter:${canvasId}:${n + 1}`, rev)
  const chapters = useNovelRead(api, r => r.chapters({ canvasId }), `chapters:${canvasId}`, rev)
  const pending = useNovelRead(api, r => r.pending({ canvasId }), `pending:${canvasId}`, rev)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // A new chapter starts at its top, whichever pane scrolls.
    const node = scroller.current
    if (node !== null) node.scrollTop = 0
    node?.scrollIntoView?.({ block: 'start' })
  }, [n])
  if (api === undefined) return null
  const total = chapters.state === 'ready' ? chapters.value.chapters.length : 0
  const items = pending.state === 'ready' ? pending.value.items.filter(item => item.chapter === n) : []

  const gesture = async (call: 'confirmPlan'): Promise<void> => {
    if (sessionId === undefined) return
    setBusy(true)
    setFailure(null)
    try {
      const result = await api[call](sessionId, { canvasId, n })
      if (!result.ok) setFailure(t('error.generic', { message: result.error.message }))
      else if (!result.value.ok) setFailure(t(errorKey(result.value.error)))
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
            key={n}
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
          <Prose view={view} phase={phase} t={t} />
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
    <div className={css.reader} data-host={host} ref={scroller} {...(host === 'book' ? { 'data-canvas-scroll': 'novel-reader' } : {})}>
      <div className={css.readerTop}>
        <button type="button" className={css.readerLink} onClick={onToc}>{t('reader.toc')}</button>
        <span className={css.readerWork}>{board.title ?? ''}</span>
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

/** The text as a reading column; markdown headings stay headings, the rest are paragraphs. */
function Prose({ view, phase, t }: { readonly view: NovelChapterResult; readonly phase: EffectiveChapterPhase; readonly t: TranslateNS<'novel'> }): ReactNode {
  const body = view.body ?? ''
  if (body.trim() === '') {
    return phase === 'fileMissing'
      ? <div className={css.warn}>{t('chapter.fileMissing', { file: view.file ?? '' })}</div>
      : <div className={css.noBody}>{t(view.chapter?.planConfirmedAt === undefined && view.chapter?.plan !== undefined ? 'chapter.noBodyConfirm' : 'chapter.noBody')}</div>
  }
  const lines = body.split('\n').map(line => line.trim()).filter(line => line !== '')
  // The first heading usually repeats the chapter title the page already shows.
  const shown = lines[0]?.startsWith('#') ? lines.slice(1) : lines
  return (
    <article className={css.prose}>
      {shown.map((line, index) => line.startsWith('#')
        ? <h4 key={index} className={css.proseHeading}>{line.replace(/^#+\s*/, '')}</h4>
        : <p key={index}>{line}</p>)}
    </article>
  )
}
