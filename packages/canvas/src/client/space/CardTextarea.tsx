/**
 * The board family's one textarea shape, shared by the board's card editor,
 * the new-card draft, the comment box, and the detail reader's edit toggle:
 * UNCONTROLLED (nothing ever writes its value back), auto-sizing (never its
 * own scroller — the board scroll or the tab body is the one container), and
 * IME-hard-stopped submits (a candidate window is never torn down mid-word).
 * `submitOn` picks the chord: 'mod-enter' for card text (⌘⏎, plus blur),
 * 'enter' for comments (⏎).
 *
 * @module @khorsheed/dsh-canvas/client
 */
import {
  useCallback, useEffect, useRef,
  type KeyboardEvent as ReactKeyboardEvent, type ReactNode,
} from 'react'
import css from './board.module.css'

/** The shared card textarea. */
export function CardTextarea({ defaultValue, placeholder, submitOn, autoFocus, className, blurSubmits = true, onTextChange, onSubmit, onCancel }: {
  readonly defaultValue?: string
  readonly placeholder?: string
  readonly submitOn: 'mod-enter' | 'enter'
  readonly autoFocus?: boolean
  /** Overrides the board's editor class (the detail reader's own editor style). */
  readonly className?: string | undefined
  /** False keeps ⌘⏎ as the only commit gesture (the new-card draft must not be created by a click elsewhere). */
  readonly blurSubmits?: boolean
  /** Reports every keystroke: the owner's dirty flag (the discard confirm's condition) rides it. */
  readonly onTextChange?: (text: string) => void
  readonly onSubmit: (text: string) => void
  readonly onCancel?: () => void
}): ReactNode {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const composingRef = useRef(false)

  const autosize = useCallback(() => {
    const element = ref.current
    if (element === null) return
    element.style.height = '0px'
    element.style.height = `${element.scrollHeight}px`
  }, [])

  useEffect(() => { autosize() }, [autosize])

  const submit = useCallback(() => {
    const element = ref.current
    if (element === null || composingRef.current) return
    onSubmit(element.value)
  }, [onSubmit])

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel?.()
      return
    }
    if (event.key !== 'Enter' || composingRef.current) return
    const chord = submitOn === 'enter'
      ? !event.shiftKey && !event.metaKey && !event.ctrlKey
      : event.metaKey || event.ctrlKey
    if (chord) {
      event.preventDefault()
      submit()
    }
  }, [submitOn, submit, onCancel])

  return (
    <textarea
      ref={element => {
        ref.current = element
        if (element !== null) {
          element.style.height = '0px'
          element.style.height = `${element.scrollHeight}px`
        }
      }}
      className={className ?? css.cardEditor}
      defaultValue={defaultValue}
      placeholder={placeholder}
      spellCheck={false}
      autoFocus={autoFocus}
      rows={1}
      onInput={event => {
        autosize()
        onTextChange?.(event.currentTarget.value)
      }}
      onKeyDown={onKeyDown}
      onBlur={submitOn === 'mod-enter' && blurSubmits ? submit : undefined}
      onCompositionStart={() => { composingRef.current = true }}
      onCompositionEnd={() => { composingRef.current = false }}
    />
  )
}
