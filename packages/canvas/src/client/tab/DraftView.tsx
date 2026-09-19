/**
 * The draft view (成稿): the tab's third page — the user's own manuscript
 * (`draft.md` beside `canvas.json`), edited with the v1 editor's three
 * invariants exactly: an UNCONTROLLED textarea keyed by the load token
 * (state never writes its `value` back), IME composition as a hard stop for
 * BOTH the preview and the save, and one scroll container per pane (the
 * textarea in edit, the preview div in preview, each own in split).
 * Auto-save is debounced and version-guarded; a conflict stops, never
 * silently overwrites (the v1 pad editor's contract, re-homed on draft.md).
 *
 * @module @khorsheed/dsh-canvas/client
 */
import {
  useCallback, useEffect, useMemo, useRef, useState,
  type CompositionEvent, type FormEvent, type ReactNode,
} from 'react'
import { IconCheckOutline16, MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { BoardReadDraftOutcome, BoardWriteDraftResult, BoardWriteDraftRequest } from '../../types.ts'
import type {} from '../locales.ts'
import css from './CanvasTab.module.css'

/** Auto-save debounce: long enough to not fire mid-word, short enough to feel safe. */
const SAVE_DEBOUNCE_MS = 800

/** The three ways the draft pane can present the manuscript. */
type DraftMode = 'edit' | 'preview' | 'split'

/** Which way a save last ended, as the status line reports it. */
type SaveState = 'saved' | 'saving' | 'conflict' | 'error'

/** The draft view's props (the tab wires the verbs and the session). */
export interface DraftViewProps {
  readonly t: TranslateNS<'canvas'>
  readonly sessionId: SessionId | undefined
  readonly canvasId: string
  /** Bumped on any board mutation, so the draft re-reads too. */
  readonly rev: number
  readonly readDraft: (request: { canvasId: string }) => Promise<RemoteResult<BoardReadDraftOutcome>>
  readonly writeDraft: (sessionId: SessionId, request: BoardWriteDraftRequest) => Promise<RemoteResult<BoardWriteDraftResult>>
  readonly onFatal: (message: string) => void
}

/** One loaded draft: its text, its freshness token, and the load token that remounts the editor. */
interface LoadedDraft {
  readonly saved: string
  version: string | null
  readonly token: number
}

/** The draft view. */
export function DraftView({ t, sessionId, canvasId, rev, readDraft, writeDraft, onFatal }: DraftViewProps): ReactNode {
  const [loaded, setLoaded] = useState<LoadedDraft | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mode, setMode] = useState<DraftMode>('edit')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [preview, setPreview] = useState('')

  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  const loadedRef = useRef<LoadedDraft | null>(null)
  const composingRef = useRef(false)
  const saveTimerRef = useRef<number | null>(null)
  const tokenRef = useRef(0)

  /** Mirror the loaded draft into a ref: the save timer must read it, not a stale closure. */
  const rememberLoaded = useCallback((draft: LoadedDraft | null) => {
    loadedRef.current = draft
    setLoaded(draft)
  }, [])

  /** Localized chrome the shared markdown renderer needs (code-block copy, footnotes). */
  const markdownLabels = useMemo<MarkdownLabels>(() => ({
    code: {
      copyLabel: t('markdown.copy'),
      copiedLabel: t('markdown.copied'),
    },
    footnotes: t('markdown.footnotes'),
  }), [t])

  /* ---------------------------------------------------------------- loading */

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result = await readDraft({ canvasId })
        if (cancelled) return
        if (!result.ok) {
          onFatal(result.error.message)
          return
        }
        const value = result.value
        if (!value.ok) {
          setLoadError(value.error)
          return
        }
        setLoadError(null)
        rememberLoaded({ saved: value.content, version: value.version, token: tokenRef.current++ })
        setPreview(value.content)
        setSaveState('saved')
      } catch (error) {
        if (!cancelled) onFatal(error instanceof Error ? error.message : String(error))
      }
    })()
    return () => { cancelled = true }
  }, [canvasId, rev, readDraft, rememberLoaded, onFatal])

  /* ----------------------------------------------------------------- saving */

  const flushSave = useCallback(async () => {
    const editor = editorRef.current
    const current = loadedRef.current
    if (editor === null || current === null || sessionId === undefined) return
    // An IME is mid-word: defer, never write half a candidate.
    if (composingRef.current) return
    const content = editor.value
    if (content === current.saved) {
      setSaveState('saved')
      return
    }
    setSaveState('saving')
    let value: BoardWriteDraftResult | null = null
    try {
      const result = await writeDraft(sessionId, { canvasId, content, version: current.version })
      if (!result.ok) {
        onFatal(result.error.message)
        setSaveState('error')
        return
      }
      value = result.value
    } catch (error) {
      onFatal(error instanceof Error ? error.message : String(error))
      setSaveState('error')
      return
    }
    if (!value.ok) {
      setSaveState(value.error === 'stale' ? 'conflict' : 'error')
      return
    }
    rememberLoaded({ ...current, saved: content, version: value.version })
    setSaveState('saved')
  }, [sessionId, canvasId, writeDraft, rememberLoaded, onFatal])

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => { void flushSave() }, SAVE_DEBOUNCE_MS)
  }, [flushSave])

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
  }, [])

  /* ------------------------------------------------------- editor callbacks */

  const onInput = useCallback((event: FormEvent<HTMLTextAreaElement>) => {
    // Composition is a hard stop for BOTH the preview and the save.
    if (composingRef.current) return
    setPreview(event.currentTarget.value)
    scheduleSave()
  }, [scheduleSave])

  const onCompositionStart = useCallback(() => { composingRef.current = true }, [])
  const onCompositionEnd = useCallback((event: CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false
    setPreview(event.currentTarget.value)
    scheduleSave()
  }, [scheduleSave])

  /* -------------------------------------------------------------- rendering */

  if (loadError !== null) {
    return <div className={css.notice}>{loadError}</div>
  }
  if (loaded === null) {
    return <div className={css.notice}>{t('state.loading')}</div>
  }

  return (
    <div className={css.draftRoot}>
      <div className={css.draftBar}>
        <span className={css.seg} role="group">
          {(['edit', 'preview', 'split'] as const).map(candidate => (
            <button
              key={candidate}
              type="button"
              aria-pressed={mode === candidate}
              onClick={() => { setMode(candidate) }}
            >
              {candidate === 'edit' ? t('mode.edit') : candidate === 'preview' ? t('mode.preview') : t('mode.split')}
            </button>
          ))}
        </span>
        <span className={css.spacer} />
        <span className={css.saveState} data-state={saveState}>
          {saveState === 'saved' && <IconCheckOutline16 size={11} />}
          {saveState === 'saving'
            ? t('state.saveSaving')
            : saveState === 'conflict'
              ? t('state.saveConflict')
              : saveState === 'error'
                ? t('error.io')
                : t('state.saveSaved')}
        </span>
      </div>

      <div className={css.draftBody} data-mode={mode}>
        {mode === 'edit' || mode === 'split' ? (
          <div className={css.editorPane}>
            <textarea
              ref={editorRef}
              className={css.draftEditor}
              key={loaded.token}
              defaultValue={loaded.saved}
              spellCheck={false}
              disabled={sessionId === undefined}
              onInput={onInput}
              onCompositionStart={onCompositionStart}
              onCompositionEnd={onCompositionEnd}
            />
          </div>
        ) : null}
        {mode === 'preview' || mode === 'split' ? (
          <div className={css.previewPane}>
            <div className={css.markdown}>
              <MarkdownText text={preview} labels={markdownLabels} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
