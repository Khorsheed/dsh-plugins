/**
 * The detail view's notes, as one hook: loading an article's notes, handing
 * the host its text, painting the highlights, the note sheet, and the
 * gestures on notes.
 *
 * Kept out of `ReaderPane.tsx` on purpose: the pane already owns the reading
 * position, the translation and the fetch lifecycle, and the notes only READ
 * those (the article element, the segmentation, the view) — they never drive
 * them.
 *
 * @module @khorsheed/dsh-reader/client/useNotes
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import type { ReaderEntryNotes, ReaderNote } from '../notes-types.ts'
import type { ReaderPaneProps } from './contract.ts'
import type { ReaderEntry } from './parse-rss.ts'
import type { BuiltArticle, TranslationView } from './translate.ts'
import { translationHash } from './translate.ts'
import { mergedDraft } from './quote.ts'
import {
  captureSelection, formatNotesDraft, NOTE_FLASH_HIGHLIGHT, NOTE_HIGHLIGHT, noteRanges, paintHighlight,
  paragraphsOf, registerNoteTarget, type NoteSelection,
} from './notes.ts'

/** Which face of the detail view is showing. */
export type DetailTab = 'article' | 'notes'

/** How long a jumped-to excerpt stays lit. */
const FLASH_MS = 1400

/** How long the "select a passage first" hint stays up. */
const HINT_MS = 2600

/** What the hook reads from the pane. */
export interface UseNotesInput {
  readonly props: ReaderPaneProps
  readonly entry: ReaderEntry | undefined
  readonly sourceLabel: string
  readonly articleHtml: string | null
  readonly articleRef: MutableRefObject<HTMLDivElement | null>
  readonly builtRef: MutableRefObject<BuiltArticle | null>
  readonly detailRef: MutableRefObject<HTMLDivElement | null>
  /** Anything whose change means the article's text nodes changed under us. */
  readonly paintKey: unknown
  readonly translateView: TranslationView
}

/** What the pane renders from. */
export interface NotesFace {
  readonly tab: DetailTab
  readonly setTab: (tab: DetailTab) => void
  readonly entry: ReaderEntryNotes | undefined
  readonly count: number
  readonly missing: ReadonlySet<string>
  readonly sheet: NoteSelection | null
  readonly saving: boolean
  readonly failed: boolean
  readonly hint: boolean
  readonly startNote: () => void
  readonly saveNote: (comment: string) => void
  readonly cancelSheet: () => void
  readonly jump: (note: ReaderNote) => void
  readonly edit: (note: ReaderNote, comment: string) => Promise<boolean>
  readonly remove: (note: ReaderNote) => void
  readonly discuss: (noteIds: readonly string[]) => void
  readonly canOpenSession: boolean
  readonly openSession: (sessionId: string) => void
  readonly sessionTitle: (sessionId: string) => string | undefined
}

/** True when two sets hold the same ids. */
function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false
  for (const id of left) if (!right.has(id)) return false
  return true
}

/**
 * The notes of the open article, and every gesture on them.
 *
 * @param input - what the pane already holds.
 */
export function useNotes(input: UseNotesInput): NotesFace {
  const { props, entry, sourceLabel, articleHtml, articleRef, builtRef, detailRef, paintKey, translateView } = input
  const { t, sessionId } = props
  const entryId = entry?.id
  const [tab, setTab] = useState<DetailTab>('article')
  const [notes, setNotes] = useState<ReaderEntryNotes | undefined>(undefined)
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set())
  const [sheet, setSheet] = useState<NoteSelection | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const [hint, setHint] = useState(false)
  const snapshotted = useRef(new Set<string>())
  const articleScroll = useRef(0)
  const sessions = props.useSessions(state => state.byId)

  const identity = useMemo(() => entry === undefined ? undefined : {
    entryId: entry.id,
    title: entry.title,
    ...(entry.link === undefined ? {} : { url: entry.link }),
    ...(sourceLabel === '' ? {} : { source: sourceLabel }),
  }, [entry, sourceLabel])

  const reload = useCallback(async (id: string) => {
    const loaded = await props.entryNotes(id)
    if (loaded.ok) setNotes(loaded.value.entry)
  }, [props])

  // A different article: back to its text, and its own notes.
  useEffect(() => {
    setTab('article')
    setSheet(null)
    setNotes(undefined)
    setMissing(new Set())
    if (entryId !== undefined) void reload(entryId)
  }, [entryId, reload])

  // Hand the host the article's ORIGINAL text, once per body: the model reads
  // it from there (the host never parses an article itself).
  useEffect(() => {
    if (identity === undefined || articleHtml === null || articleHtml.length === 0) return
    const key = `${identity.entryId}\n${translationHash(articleHtml)}`
    if (snapshotted.current.has(key)) return
    snapshotted.current.add(key)
    const paragraphs = paragraphsOf(articleHtml)
    if (paragraphs.length === 0) return
    void props.snapshotEntry({ ...identity, paragraphs })
  }, [identity, articleHtml, props])

  // Paint the excerpts on whatever text is on screen now. Recomputed after
  // every rebuild: a translation replaces the text nodes a range points into.
  useEffect(() => {
    const article = articleRef.current
    if (article === null || tab !== 'article') {
      paintHighlight(NOTE_HIGHLIGHT, [])
      return
    }
    const found = noteRanges(article, builtRef.current, notes?.notes ?? [])
    paintHighlight(NOTE_HIGHLIGHT, [...found.values()].flat())
    const lost = new Set([...found].filter(([, ranges]) => ranges.length === 0).map(([id]) => id))
    setMissing(current => sameSet(current, lost) ? current : lost)
  }, [notes, articleHtml, paintKey, translateView, tab, articleRef, builtRef])

  // Nothing stays painted once the pane is gone.
  useEffect(() => () => {
    paintHighlight(NOTE_HIGHLIGHT, [])
    paintHighlight(NOTE_FLASH_HIGHLIGHT, [])
  }, [])

  const startNote = useCallback(() => {
    const article = articleRef.current
    const selection = article === null ? null : captureSelection(article, builtRef.current)
    if (selection === null) {
      setHint(true)
      setTimeout(() => { setHint(false) }, HINT_MS)
      return
    }
    setFailed(false)
    setSheet(selection)
  }, [articleRef, builtRef])

  // The quote menu's「记笔记」finds this pane through the target registry.
  useEffect(() => registerNoteTarget({
    owns: node => articleRef.current?.contains(node) === true,
    start: startNote,
  }), [articleRef, startNote])

  const saveNote = useCallback((comment: string) => {
    if (identity === undefined || sheet === null) return
    setSaving(true)
    void props.addNote({
      ...identity,
      block: sheet.block,
      ...(sheet.start === undefined ? {} : { start: sheet.start }),
      quote: sheet.quote,
      ...(sheet.translated === undefined ? {} : { translated: sheet.translated }),
      ...(comment.trim() === '' ? {} : { comment }),
    }).then(async result => {
      setSaving(false)
      if (!result.ok || typeof result.value === 'string') {
        setFailed(true)
        return
      }
      setSheet(null)
      window.getSelection()?.removeAllRanges()
      await reload(identity.entryId)
    })
  }, [identity, sheet, props, reload])

  const switchTab = useCallback((next: DetailTab) => {
    const scroller = detailRef.current
    if (next === 'notes' && scroller !== null) articleScroll.current = scroller.scrollTop
    setTab(next)
    if (next === 'article') {
      requestAnimationFrame(() => {
        if (detailRef.current !== null) detailRef.current.scrollTop = articleScroll.current
      })
    }
  }, [detailRef])

  const jump = useCallback((note: ReaderNote) => {
    setTab('article')
    // Two frames: one for the article face to come back, one for its layout.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const article = articleRef.current
      if (article === null) return
      const ranges = noteRanges(article, builtRef.current, [note]).get(note.id) ?? []
      const first = ranges[0]
      if (first === undefined) return
      const target = first.startContainer instanceof Element ? first.startContainer : first.startContainer.parentElement
      target?.scrollIntoView({ block: 'center' })
      paintHighlight(NOTE_FLASH_HIGHLIGHT, ranges)
      setTimeout(() => { paintHighlight(NOTE_FLASH_HIGHLIGHT, []) }, FLASH_MS)
    }))
  }, [articleRef, builtRef])

  const edit = useCallback(async (note: ReaderNote, comment: string): Promise<boolean> => {
    if (entryId === undefined) return false
    const result = await props.updateNote({ entryId, noteId: note.id, comment })
    if (!result.ok || result.value !== 'ok') return false
    await reload(entryId)
    return true
  }, [entryId, props, reload])

  const remove = useCallback((note: ReaderNote) => {
    if (entryId === undefined) return
    void props.deleteNote({ entryId, noteId: note.id }).then(() => reload(entryId))
  }, [entryId, props, reload])

  const discuss = useCallback((noteIds: readonly string[]) => {
    if (identity === undefined || notes === undefined) return
    const chosen = noteIds.length === 0 ? notes.notes : notes.notes.filter(note => noteIds.includes(note.id))
    if (chosen.length === 0) return
    const block = formatNotesDraft({
      entryId: identity.entryId,
      title: identity.title,
      source: identity.source ?? '',
      ...(identity.url === undefined ? {} : { link: identity.url }),
    }, chosen, {
      heading: count => t('notes.draftHeading', { count }),
      comment: t('notes.draftComment'),
      hint: id => t('notes.draftHint', { id }),
    })
    props.setDraft(mergedDraft(props.readDraft(), block))
    const sessionTitle = sessions[sessionId]?.displayTitle
    void props.recordDiscussion({
      ...identity,
      sessionId: String(sessionId),
      ...(sessionTitle === undefined ? {} : { sessionTitle }),
    }).then(() => reload(identity.entryId))
  }, [identity, notes, props, t, sessions, sessionId, reload])

  return {
    tab,
    setTab: switchTab,
    entry: notes,
    count: notes?.notes.length ?? 0,
    missing,
    sheet,
    saving,
    failed,
    hint,
    startNote,
    saveNote,
    cancelSheet: () => { setSheet(null) },
    jump,
    edit,
    remove,
    discuss,
    canOpenSession: props.canOpenSession(),
    openSession: id => { props.openSession(id) },
    sessionTitle: id => (sessions as Record<string, { displayTitle?: string } | undefined>)[id]?.displayTitle,
  }
}
