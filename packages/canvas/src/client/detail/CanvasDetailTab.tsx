/**
 * The card-detail TAB (stage ⑧, §11.2 row 7): one tab of the right-Sidebar dock
 * showing one card, or one canvas's unsaved draft.
 *
 * Its subject comes from the tab's own address, not from the board's selection —
 * which is the whole point of the stage: two cards are open at once, and
 * clicking a card twice focuses the tab already showing it (the host dedupes
 * resources by `(kind, contentId)`, and the contentId is the address). The
 * reader itself is unchanged: this component resolves the address, holds what a
 * TAB owns (the draft's text and strokes, so its own exit gesture can ask about
 * them), and hands both down.
 *
 * The chip's text rides `navigation.params` rather than the definition's
 * `title`, because the host captures a title once at open time and never
 * refreshes it, while re-opening a card re-delivers params and bumps `revision`.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CanvasTabProps } from '../contract.ts'
import { type CanvasStroke, type CardCategoryId } from '../../types.ts'
import { canvasErrorText } from '../error-text.ts'
import { CanvasDetailView } from './CanvasDetailView.tsx'
import { parseDetailAddress } from './detail-address.ts'
import type { CanvasDetailParams } from '../definition.ts'
import css from './CanvasDetailTab.module.css'

/** One card's detail, or one canvas's draft, as a tab of the dock. */
export function CanvasDetailTab(props: CanvasTabProps): ReactNode {
  const { t, sessionId, putCard, images, useImageRev, useTabInfo } = props
  const { tab } = useTabInfo()
  const target = parseDetailAddress(tab.contentId)
  // The ＋新卡 menu's category travels as params, so picking another kind on an
  // open draft re-categorizes it instead of seating a second blank one.
  const params = tab.navigation.params as CanvasDetailParams | undefined

  const [toast, setToast] = useState<{ text: string; seq: number } | null>(null)
  const toastSeq = useRef(0)
  /** The draft's content, or `null` before the first keystroke (an empty draft
   *  leaves without a question, so "untouched" has to be knowable). */
  const [draft, setDraft] = useState<{ text: string; draw: readonly CanvasStroke[] } | null>(null)
  /** The discard confirm: set by the exit gesture while the draft has content. */
  const [discardAsk, setDiscardAsk] = useState(false)

  // One image subscription per tab (§10.3): a read landing gives the renderer a
  // FRESH vocabulary object, which is what re-runs its memoized pass.
  const imageRev = useImageRev(current => current)
  const pathImages = useMemo(() => images.vocabulary(), [images, imageRev])

  const showToast = useCallback((text: string) => {
    toastSeq.current += 1
    setToast({ text, seq: toastSeq.current })
  }, [])

  /**
   * The draft's category: whatever the menu passed. The built-in five are the
   * one thing every canvas's catalog is guaranteed to carry (stage ⑤ restores
   * them on a tolerant read), so an address opened without params still has a
   * legal place to file the card.
   */
  const kind: CardCategoryId = params?.kind ?? 'fragment'

  /**
   * The first save. The tab STAYS and comes back empty: it is where cards get
   * filed, and closing it on a save would take the confirmation toast with it.
   */
  const saveDraft = useCallback(async (
    saveKind: CardCategoryId, text: string, draw: readonly CanvasStroke[],
  ): Promise<boolean> => {
    if (sessionId === undefined || target === undefined) return false
    const trimmed = text.trim()
    if (trimmed.length === 0 && draw.length === 0) return false
    const result = await putCard(sessionId, {
      canvasId: target.canvasId, kind: saveKind, text: trimmed,
      ...(draw.length === 0 ? {} : { draw }),
    })
    if (!result.ok) {
      showToast(result.error.message)
      return false
    }
    if (!result.value.ok) {
      showToast(canvasErrorText(t, result.value.error))
      return false
    }
    setDraft(null)
    showToast(t('toast.cardAdded'))
    return true
  }, [sessionId, target, putCard, showToast, t])

  /**
   * Leave the draft (§11.6 item 5), asking exactly once — and only when the
   * draft holds something, written or drawn. An untouched draft leaves without
   * a question.
   *
   * The chip's own × is a SECOND exit this page cannot gate: `ISidebarRight`
   * closes by tab id and offers no interception, so a chip closed by hand drops
   * the draft silently. Recorded in the proposal, not solved here.
   */
  const leaveDraft = useCallback(() => {
    if (draft !== null && (draft.text.trim().length > 0 || draft.draw.length > 0)) {
      setDiscardAsk(true)
      return
    }
    tab.actions.close()
  }, [draft, tab.actions])

  // The discard question names what is actually in danger: words, ink, or both.
  const draftWords = draft?.text.trim().length ?? 0
  const draftStrokes = String(draft?.draw.length ?? 0)
  const discardBody = draftWords === 0
    ? t('confirm.discardBodyInk', { strokes: draftStrokes })
    : (draft?.draw.length ?? 0) > 0
      ? t('confirm.discardBodyBoth', { count: String(draftWords), strokes: draftStrokes })
      : t('confirm.discardBody', { count: String(draftWords) })

  return (
    <div className={css.shell}>
      {target === undefined ? (
        // Not our grammar: a tab that outlived an address change. The reader's
        // own "nothing open" line, with no board read behind it.
        <CanvasDetailView {...props} sessionId={sessionId} canvasId={null} cardId={null} pathImages={pathImages} />
      ) : (
        <CanvasDetailView
          {...props}
          sessionId={sessionId}
          canvasId={target.canvasId}
          cardId={target.cardId}
          pathImages={pathImages}
          create={target.cardId === null ? {
            kind,
            text: draft?.text ?? '',
            draw: draft?.draw ?? [],
            onTextChange: text => { setDraft(current => ({ text, draw: current?.draw ?? [] })) },
            onDrawChange: draw => { setDraft(current => ({ text: current?.text ?? '', draw })) },
            onSave: saveDraft,
            onLeave: leaveDraft,
          } : undefined}
        />
      )}
      {toast !== null && (
        <Toast key={toast.seq} text={toast.text} onDone={() => { setToast(null) }} />
      )}
      <Modal
        open={discardAsk}
        onClose={() => { setDiscardAsk(false) }}
        title={t('confirm.discardTitle')}
        closeLabel={t('confirm.close')}
        description={discardBody}
        footer={
          <>
            <Button size="sm" onClick={() => { setDiscardAsk(false) }}>
              {t('confirm.keepEditing')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => { setDiscardAsk(false); tab.actions.close() }}
            >
              {t('confirm.discard')}
            </Button>
          </>
        }
      />
    </div>
  )
}
