/**
 * Session-header title-edit entry (`conversation.session.header.actions`): a
 * pencil control immediately right of the title. Editing is IN PLACE: the
 * official current-title crumb is hidden via a `data-ste-inplace` attribute
 * (DOM layer — the official header renders the title and exposes no title
 * seat) and this entry overlays its own input at the crumb's measured rect,
 * so the title itself reads as the input. When the crumb cannot be located
 * (the official DOM changed), the entry degrades to an inline editor in the
 * actions row. Enter commits, Escape cancels, a blurred in-place input
 * cancels, and a trimmed-empty draft never commits; host rejection keeps the
 * editor open with a localized error.
 *
 * TODO(session-title-edit): deprecate the DOM-layer overlay when the official
 * header opens a title slot (or makes the crumb editable) — this entry then
 * becomes a pure slot consumer and the probe/overlay logic is removed.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Button, IconEditOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { isRenameFailure } from './slots.ts'
import type { TitleEditActionProps } from './slots.ts'
import css from './TitleEditAction.module.css'

/** One measured placement of the official title crumb (viewport coordinates). */
interface CrumbPlacement {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** Attribute hiding the official current-title crumb while editing in place. */
const IN_PLACE_ATTR = 'data-ste-inplace'

/**
 * Locate the official current-title crumb: the header's only disabled crumb
 * button (the current session's crumb is `disabled`, ancestors navigate).
 * @returns the crumb element, or null when the official DOM is unrecognizable.
 */
function locateCrumb(): HTMLButtonElement | null {
  return document.querySelector('header nav button:disabled') as HTMLButtonElement | null
}

/**
 * Render the title-edit control.
 * @param props - session kit, rename verb, and locale seat.
 * @returns the pencil button, or the in-place / inline editor while editing.
 */
export function TitleEditAction({ sessionId, useSessions, renameSession, t }: TitleEditActionProps) {
  const displayTitle = useSessions(state => state.byId[sessionId]?.displayTitle)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Placement when editing in place (over the hidden crumb); null = row editor. */
  const [placement, setPlacement] = useState<CrumbPlacement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const crumbRef = useRef<HTMLButtonElement | null>(null)

  // Select the whole current title on open so typing replaces it outright.
  useEffect(() => {
    if (!editing) return
    /* v8 ignore next -- the input is mounted while editing, so the ref is set */
    inputRef.current?.select()
  }, [editing])

  // Re-measure while editing in place so a window resize keeps the overlay on
  // the (hidden) crumb's position.
  const inPlaceActive = placement !== null
  useEffect(() => {
    if (!inPlaceActive) return
    const remeasure = (): void => {
      const crumb = crumbRef.current
      /* v8 ignore next -- closeEditor nulls the ref and the placement in the same batch, so a resize cannot fire between them */
      if (crumb === null) return
      const rect = crumb.getBoundingClientRect()
      setPlacement({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
    }
    window.addEventListener('resize', remeasure)
    return () => { window.removeEventListener('resize', remeasure) }
  }, [inPlaceActive])

  // Never leave the official crumb hidden: restore it if this entry unmounts
  // mid-edit (programmatic session switch, HMR reload, plugin disposal).
  useEffect(() => () => {
    if (crumbRef.current !== null) crumbRef.current.removeAttribute(IN_PLACE_ATTR)
  }, [])

  const closeEditor = (): void => {
    setEditing(false)
    setError(null)
    if (crumbRef.current !== null) {
      crumbRef.current.removeAttribute(IN_PLACE_ATTR)
      crumbRef.current = null
    }
    setPlacement(null)
  }

  const begin = (): void => {
    setDraft(displayTitle ?? '')
    setError(null)
    const crumb = locateCrumb()
    crumbRef.current = crumb
    if (crumb !== null) {
      // Measure FIRST: the crumb is hidden via visibility (layout box kept),
      // so its rect stays measurable both before and after hiding.
      const rect = crumb.getBoundingClientRect()
      crumb.setAttribute(IN_PLACE_ATTR, '')
      setPlacement({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
    }
    setEditing(true)
  }
  const cancel = (): void => {
    /* v8 ignore next -- the cancel button and the input are disabled while busy, so this arm is unreachable through the UI */
    if (busy) return
    closeEditor()
  }
  const commit = async (): Promise<void> => {
    /* v8 ignore next -- the save button and the input are disabled while busy, so this arm is unreachable through the UI */
    if (busy) return
    const title = draft.trim()
    if (title === '') return
    setBusy(true)
    setError(null)
    try {
      await renameSession(title)
      closeEditor()
    } catch (cause) {
      setError(isRenameFailure(cause) && cause.code === 'title-invalid'
        ? t('error.invalid')
        : t('error.rename'))
    } finally {
      setBusy(false)
    }
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') void commit()
    else if (event.key === 'Escape') cancel()
  }
  const onBlur = (): void => {
    if (busy) return
    closeEditor()
  }
  const trimmed = draft.trim()

  if (!editing) {
    return (
      <button
        type="button"
        className={css.renameButton}
        aria-label={t('action.rename')}
        title={t('action.rename')}
        onClick={begin}
      >
        <IconEditOutline16 size={14} />
      </button>
    )
  }
  if (placement !== null) {
    return (
      <>
        <input
          ref={inputRef}
          className={css.inPlaceInput}
          type="text"
          value={draft}
          aria-label={t('editor.aria')}
          placeholder={t('editor.placeholder')}
          disabled={busy}
          autoFocus
          style={{ left: placement.left, top: placement.top, width: placement.width, height: placement.height }}
          onChange={(event) => { setDraft(event.currentTarget.value) }}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
        />
        {error !== null && <span className={css.inPlaceError} role="alert">{error}</span>}
      </>
    )
  }
  return (
    <span className={css.editor} role="group" aria-label={t('editor.aria')}>
      <input
        ref={inputRef}
        className={css.editorInput}
        type="text"
        value={draft}
        aria-label={t('editor.aria')}
        placeholder={t('editor.placeholder')}
        disabled={busy}
        autoFocus
        onChange={(event) => { setDraft(event.currentTarget.value) }}
        onKeyDown={onKeyDown}
      />
      {error !== null && <span className={css.editorError} role="alert">{error}</span>}
      <Button variant="outline" disabled={busy} onClick={cancel}>{t('cancel')}</Button>
      <Button variant="primary" disabled={busy || trimmed === ''} onClick={() => { void commit() }}>
        {t('editor.save')}
      </Button>
    </span>
  )
}
