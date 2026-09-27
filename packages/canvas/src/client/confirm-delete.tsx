/**
 * The delete confirmation, shared by the canvas and the card gestures. A plain
 * two-button question — deleting is rare and the words say what goes, so
 * typing the canvas's name back would be ceremony, not safety. Archive stays
 * the everyday gesture (with its undo); this is the one door with no way back.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from './locales.ts'
import css from './confirm-delete.module.css'

/** What is about to be deleted, in the words the question shows. */
export type DeleteAsk =
  | { readonly kind: 'canvas'; readonly canvasId: string; readonly title: string }
  | { readonly kind: 'card'; readonly canvasId: string; readonly cardId: string }

/**
 * The confirmation dialog; closed while `ask` is null.
 * @param props.t - the canvas namespace.
 * @param props.ask - the pending delete, or null.
 * @param props.onCancel - keep it.
 * @param props.onConfirm - delete it (the caller closes the dialog).
 */
export function ConfirmDelete({ t, ask, onCancel, onConfirm }: {
  readonly t: TranslateNS<'canvas'>
  readonly ask: DeleteAsk | null
  readonly onCancel: () => void
  readonly onConfirm: (ask: DeleteAsk) => void
}): ReactNode {
  return (
    <Modal
      open={ask !== null}
      onClose={onCancel}
      title={ask?.kind === 'canvas'
        ? t('confirm.deleteCanvasTitle', { title: ask.title })
        : t('confirm.deleteCardTitle')}
      closeLabel={t('confirm.close')}
      description={ask?.kind === 'canvas' ? t('confirm.deleteCanvasBody') : t('confirm.deleteCardBody')}
      footer={(
        <>
          <Button size="sm" onClick={onCancel}>{t('confirm.cancel')}</Button>
          <Button
            size="sm"
            variant="primary"
            className={css.danger}
            onClick={() => { if (ask !== null) onConfirm(ask) }}
          >
            {t('confirm.delete')}
          </Button>
        </>
      )}
    />
  )
}
