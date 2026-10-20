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
import type { ReaderDiscussion, ReaderEntryNotes, ReaderNote } from '../notes-types.ts'
import type { ReaderPaneProps } from './contract.ts'
import type { ReaderEntry } from './parse-rss.ts'
import type { BuiltArticle, TranslationView } from './translate.ts'
import { translationHash } from './translate.ts'
import { mergedDraft } from './quote.ts'
import {
  discussionCardText, lastCanvas, noteCardText, rememberCanvas, sourceOf,
  type SyncCanvas, type SyncKind, type SyncWords,
} from './canvas-sync.ts'
import {
  blockElements, captureSelection, formatNotesDraft, NOTE_FLASH_HIGHLIGHT, NOTE_HIGHLIGHT, noteRanges, paintHighlight,
  paragraphsOf, registerNoteTarget, type NoteSelection,
} from './notes.ts'

/** Which face of the detail view is showing. */
export type DetailTab = 'article' | 'notes'

/** How long a jumped-to excerpt stays lit. */
const FLASH_MS = 1400

/** How long the "select a passage first" hint stays up. */
const HINT_MS = 2600

/**
 * How often the notes face re-reads the host while it shows: the model writes
 * conclusions from the conversation, and they should appear without a reload
 * (the canvas board's 4-second precedent).
 */
const NOTES_POLL_MS = 5000

/** What is being synced to a canvas: some notes, or one discussion note. */
export type SyncTarget =
  | { readonly kind: 'notes'; readonly ids: readonly string[] }
  | { readonly kind: 'discussion'; readonly id: string }

/** The 「同步到画布」 sheet's state and gestures. */
export interface SyncFace {
  /** Whether the canvas inbox is there at all (the gesture hides without it). */
  readonly available: boolean
  readonly target: SyncTarget | null
  /** The canvases to pick from; null while loading. */
  readonly canvases: readonly SyncCanvas[] | null
  readonly pick: string | null
  readonly last: string | null
  readonly withReplies: boolean
  /** Set when the picked canvas retired 灵感: the categories it takes. */
  readonly kinds: readonly SyncKind[] | null
  readonly kind: string | null
  readonly busy: boolean
  readonly error: string | null
  /** The last sync's landing place, shown for a moment with an 打开. */
  readonly done: { readonly canvasId: string; readonly cardId: string; readonly title: string } | null
  readonly open: (target: SyncTarget) => void
  readonly setPick: (canvasId: string) => void
  readonly setWithReplies: (on: boolean) => void
  readonly setKind: (kind: string) => void
  readonly run: () => void
  readonly cancel: () => void
  readonly openDone: () => void
}

/** How long the 「已同步」 line stays. */
const SYNC_DONE_MS = 5000

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
  /** A transcript speaker's display name (with the names that make it, so a rename re-snapshots). */
  readonly speakerLabel?: (speaker: number) => string
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
  readonly addReply: (note: ReaderNote, text: string) => Promise<boolean>
  readonly editReply: (note: ReaderNote, index: number, text: string) => Promise<boolean>
  readonly deleteDiscussion: (discussion: ReaderDiscussion) => void
  readonly jumpPara: (para: number) => void
  readonly check: () => void
  readonly sync: SyncFace
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
  const { props, entry, sourceLabel, articleHtml, articleRef, builtRef, detailRef, paintKey, translateView, speakerLabel } = input
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
    const paragraphs = paragraphsOf(articleHtml, speakerLabel)
    const key = `${identity.entryId}\n${translationHash(paragraphs.join('\n'))}`
    if (snapshotted.current.has(key)) return
    snapshotted.current.add(key)
    if (paragraphs.length === 0) return
    void props.snapshotEntry({ ...identity, paragraphs })
  }, [identity, articleHtml, props, speakerLabel])

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

  // While the notes face shows, follow what the conversation writes into it.
  useEffect(() => {
    if (tab !== 'notes' || entryId === undefined) return
    void reload(entryId)
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void reload(entryId)
    }, NOTES_POLL_MS)
    return () => { clearInterval(timer) }
  }, [tab, entryId, reload])

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
      ...(sheet.time === undefined ? {} : { time: sheet.time }),
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

  /** The conversation this pane belongs to, remembered on the article. */
  const remember = useCallback(() => {
    if (identity === undefined) return
    const sessionTitle = sessions[sessionId]?.displayTitle
    void props.recordDiscussion({
      ...identity,
      sessionId: String(sessionId),
      ...(sessionTitle === undefined ? {} : { sessionTitle }),
    }).then(() => reload(identity.entryId))
  }, [identity, sessions, sessionId, props, reload])

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
    remember()
  }, [identity, notes, props, t, remember])

  const addReply = useCallback(async (note: ReaderNote, text: string): Promise<boolean> => {
    if (entryId === undefined) return false
    const result = await props.addReply({ entryId, noteId: note.id, text })
    if (!result.ok || result.value !== 'ok') return false
    await reload(entryId)
    return true
  }, [entryId, props, reload])

  const editReply = useCallback(async (note: ReaderNote, index: number, text: string): Promise<boolean> => {
    if (entryId === undefined) return false
    const result = await props.editReply({ entryId, noteId: note.id, index, text })
    if (!result.ok || result.value !== 'ok') return false
    await reload(entryId)
    return true
  }, [entryId, props, reload])

  const deleteDiscussion = useCallback((discussion: ReaderDiscussion) => {
    if (entryId === undefined) return
    void props.deleteDiscussion({ entryId, discussionId: discussion.id }).then(() => reload(entryId))
  }, [entryId, props, reload])

  const jumpPara = useCallback((para: number) => {
    setTab('article')
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const article = articleRef.current
      const block = article === null ? undefined : blockElements(article)[para - 1]
      if (block === undefined) return
      block.scrollIntoView({ block: 'center' })
      const range = block.ownerDocument.createRange()
      range.selectNodeContents(block)
      paintHighlight(NOTE_FLASH_HIGHLIGHT, [range])
      setTimeout(() => { paintHighlight(NOTE_FLASH_HIGHLIGHT, []) }, FLASH_MS)
    }))
  }, [articleRef])

  /* ------------------------------------------------------- 同步到画布 */

  const [syncTarget, setSyncTarget] = useState<SyncTarget | null>(null)
  const [canvases, setCanvases] = useState<readonly SyncCanvas[] | null>(null)
  const [pick, setPick] = useState<string | null>(null)
  const [withReplies, setWithReplies] = useState(true)
  const [kinds, setKinds] = useState<readonly SyncKind[] | null>(null)
  const [kind, setKind] = useState<string | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncDone, setSyncDone] = useState<SyncFace['done']>(null)
  const inbox = props.canvasInbox()

  const openSync = useCallback((target: SyncTarget) => {
    const current = props.canvasInbox()
    if (current === undefined) return
    setSyncTarget(target)
    setCanvases(null)
    setKinds(null)
    setKind(null)
    setSyncError(null)
    void current.listCanvases().then(list => {
      setCanvases(list)
      const remembered = lastCanvas()
      const showing = current.current()
      const preferred = [remembered, showing].find(id => id !== null && list.some(item => item.id === id))
      setPick(preferred ?? list[0]?.id ?? null)
    }, () => { setCanvases([]) })
  }, [props])

  const runSync = useCallback(() => {
    const current = props.canvasInbox()
    if (current === undefined || syncTarget === null || pick === null || identity === undefined || notes === undefined) return
    const canvas = canvases?.find(item => item.id === pick)
    const words: SyncWords = {
      conclusion: t('notes.syncConclusion'),
      original: t('notes.syncOriginal'),
      kindCheck: t('notes.kindCheck'),
      kindDiscussion: t('notes.kindDiscussion'),
    }
    const article = { title: identity.title, ...(identity.url === undefined ? {} : { url: identity.url }) }
    const items: { text: string; mark: { noteId?: string; discussionId?: string } }[] = syncTarget.kind === 'notes'
      ? notes.notes.filter(note => syncTarget.ids.includes(note.id))
        .map(note => ({ text: noteCardText(note, article, words, withReplies), mark: { noteId: note.id } }))
      : (notes.discussions ?? []).filter(item => item.id === syncTarget.id)
        .map(item => ({ text: discussionCardText(item, article, words), mark: { discussionId: item.id } }))
    setSyncBusy(true)
    setSyncError(null)
    void (async () => {
      let landed: { cardId: string } | undefined
      for (const item of items) {
        const outcome = await current.addCard(String(sessionId), {
          canvasId: pick,
          text: item.text,
          ...(kind === null ? {} : { kind }),
          source: sourceOf(article),
        })
        if (!outcome.ok) {
          if (outcome.error === 'needs-kind' && 'kinds' in outcome) {
            setKinds(outcome.kinds)
            setKind(outcome.kinds[0]?.id ?? null)
          } else {
            setSyncError(outcome.error)
          }
          setSyncBusy(false)
          await reload(identity.entryId)
          return
        }
        landed = { cardId: outcome.cardId }
        await props.markSynced({ entryId: identity.entryId, ...item.mark, canvasId: pick, cardId: outcome.cardId, canvasTitle: canvas?.title ?? pick })
      }
      rememberCanvas(pick)
      setSyncBusy(false)
      setSyncTarget(null)
      await reload(identity.entryId)
      if (landed !== undefined) {
        setSyncDone({ canvasId: pick, cardId: landed.cardId, title: canvas?.title ?? pick })
        setTimeout(() => { setSyncDone(null) }, SYNC_DONE_MS)
      }
    })()
  }, [props, syncTarget, pick, identity, notes, canvases, t, withReplies, kind, sessionId, reload])

  const sync: SyncFace = {
    available: inbox !== undefined,
    target: syncTarget,
    canvases,
    pick,
    last: lastCanvas(),
    withReplies,
    kinds,
    kind,
    busy: syncBusy,
    error: syncError,
    done: syncDone,
    open: openSync,
    setPick: id => { setPick(id); setKinds(null); setKind(null) },
    setWithReplies,
    setKind,
    run: runSync,
    cancel: () => { setSyncTarget(null) },
    openDone: () => { if (syncDone !== null) props.canvasInbox()?.openCard(syncDone.canvasId, syncDone.cardId) },
  }

  // 「让Agent考考我」: the request (with the round's contract, so it works even
  // where the skill is not loaded) goes into the draft; the reader sends it.
  const check = useCallback(() => {
    if (identity === undefined) return
    const count = notes?.notes.length ?? 0
    const request = [
      t('notes.checkDraft', { title: identity.title, id: identity.entryId }),
      ...(count > 0 ? [t('notes.checkDraftNotes', { count })] : []),
    ].join('\n')
    props.setDraft(mergedDraft(props.readDraft(), request))
    remember()
  }, [identity, notes, t, props, remember])

  return {
    sync,
    addReply,
    editReply,
    deleteDiscussion,
    jumpPara,
    check,
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
