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
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Button, IconEditOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { isRenameFailure } from './slots.ts'
import type { TitleEditActionProps } from './slots.ts'
import { MAX_TITLE_BYTES, normalizedTitleByteLength } from './title-length.ts'
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

/** Horizontal padding of the in-place input (`padding: 4px 8px`). */
const INPUT_H_PADDING = 8
/** Border width of the in-place input (`1px solid transparent`). */
const INPUT_BORDER = 1
/** Extra room so the caret and a trailing glyph are never clipped. */
const INPUT_CARET_BUFFER = 4
/** Outer width cap of the fitted input, matching the official crumb's `max-width: 220px`. */
const MAX_INPUT_WIDTH = 220

/**
 * Fit the in-place input to its text between the original crumb width (the
 * floor, so the box never collapses while deleting) and the official 220px
 * crumb cap (the ceiling, so a long draft clips exactly where the crumb's
 * ellipsis would).
 * @param textWidth - measured rendered width of the draft text.
 * @param minWidth - the crumb's measured width at open.
 * @returns the outer input width in px.
 */
function fitInputWidth(textWidth: number, minWidth: number): number {
  const target = textWidth + (INPUT_H_PADDING + INPUT_BORDER) * 2 + INPUT_CARET_BUFFER
  return Math.round(Math.min(Math.max(target, minWidth), MAX_INPUT_WIDTH))
}

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
  /** Outer width the in-place input is fitted to (draft text vs the crumb floor and 220px cap). */
  const [inputWidth, setInputWidth] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const crumbRef = useRef<HTMLButtonElement | null>(null)
  /** Hidden mirror of the draft, measured to fit the input to its text. */
  const measureRef = useRef<HTMLSpanElement | null>(null)

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

  // Fit the in-place input to its text: measure the mirror span (which carries
  // the exact draft at the input's font) after every draft or placement
  // change, then clamp between the crumb's original width and the 220px cap.
  useLayoutEffect(() => {
    if (!inPlaceActive) return
    const textWidth = measureRef.current?.offsetWidth ?? 0
    setInputWidth(fitInputWidth(textWidth, placement.width))
  }, [draft, placement, inPlaceActive])

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
      // Floor the fitted width at the crumb's original width so the open box
      // matches today's look; the fit effect widens it as the draft grows.
      setInputWidth(rect.width)
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
    // Never hand the host a draft it would silently truncate: block over-limit
    // commits and surface the localized hint instead (Enter path; the row
    // editor additionally disables save).
    if (title === '' || overLimit) return
    setBusy(true)
    setError(null)
    try {
      await renameSession(title)
      closeEditor()
    } catch (cause) {
      setError(isRenameFailure(cause) && (cause.code === 'session/title-invalid' || cause.code === 'title-invalid')
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
  // Gate on the host-faithful cleaned byte length: the editor fires exactly
  // when the host would truncate (see title-length.ts), never on whitespace.
  const draftBytes = normalizedTitleByteLength(draft)
  const overLimit = draftBytes > MAX_TITLE_BYTES
  const overLimitHint = t('hint.tooLong', {
    max: MAX_TITLE_BYTES,
    chars: Math.floor(MAX_TITLE_BYTES / 3),
    bytes: draftBytes,
  })

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
        {/* Width-measuring mirror of the draft: hidden, same font as the input. */}
        <span ref={measureRef} className={css.inPlaceMirror} aria-hidden="true">{draft === '' ? ' ' : draft}</span>
        <input
          ref={inputRef}
          className={css.inPlaceInput}
          type="text"
          value={draft}
          aria-label={t('editor.aria')}
          placeholder={t('editor.placeholder')}
          disabled={busy}
          autoFocus
          style={{ left: placement.left, top: placement.top, width: inputWidth, height: placement.height }}
          onChange={(event) => { setDraft(event.currentTarget.value) }}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
        />
        {error !== null
          ? <span className={css.inPlaceError} role="alert">{error}</span>
          : overLimit && <span className={css.inPlaceHint} role="alert">{overLimitHint}</span>}
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
      {error !== null
        ? <span className={css.editorError} role="alert">{error}</span>
        : overLimit && <span className={css.editorHint} role="alert">{overLimitHint}</span>}
      <Button variant="outline" disabled={busy} onClick={cancel}>{t('cancel')}</Button>
      <Button variant="primary" disabled={busy || trimmed === '' || overLimit} onClick={() => { void commit() }}>
        {t('editor.save')}
      </Button>
    </span>
  )
}
