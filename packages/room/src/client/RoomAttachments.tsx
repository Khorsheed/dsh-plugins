/**
 * The room composer's draft-attachment rail: image thumbnails (click opens
 * the original in the primitives' lightbox) and file cards with their upload
 * state (uploading / failed → click to retry), each with a hover ✕ — the
 * official composer's rail (ui-attachment's ComposerAttachments + FileCard)
 * redrawn on the same tokens, because that package exposes no client
 * component a plugin bundle can import. The drafts themselves are the
 * official conversation service's (RoomAttachmentsFace).
 */
import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { FileTypeIcon, ImageLightbox, fileSizeText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RoomAttachmentsFace, RoomComposerProps, RoomDraftAttachment } from './slots.ts'
import css from './RoomAttachments.module.css'

/** The rail over the textarea; renders nothing without drafts. */
export function RoomAttachments({ attachments, face, onRemove, onRetry, t }: {
  readonly attachments: readonly RoomDraftAttachment[]
  readonly face: RoomAttachmentsFace
  readonly onRemove: (id: string) => void
  readonly onRetry: (id: string) => void
  readonly t: RoomComposerProps['t']
}): ReactNode {
  const uploads = useSyncExternalStore(face.uploads.subscribe, face.uploads.getSnapshot)
  const [preview, setPreview] = useState<Extract<RoomDraftAttachment, { kind: 'image' }> | undefined>(undefined)
  if (attachments.length === 0) return null
  return (
    <div className={css.rail}>
      {attachments.map((attachment) => {
        const name = attachment.file.name
        const remove = (
          <button type="button" className={css.remove} aria-label={t('attach.remove', { name })} onMouseDown={(event) => { event.preventDefault() }} onClick={() => { onRemove(attachment.id) }}>
            <svg viewBox="0 0 12 12" width="8" height="8" aria-hidden><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        )
        if (attachment.kind === 'image') {
          return (
            <div key={attachment.id} className={css.imageItem}>
              <button type="button" className={css.thumbnail} aria-label={t('attach.open', { name })} onClick={() => { setPreview(attachment) }}>
                <img src={attachment.previewUrl} alt={name} />
              </button>
              {remove}
            </div>
          )
        }
        const upload = uploads[attachment.id]
        const state = upload?.status ?? 'uploading'
        const meta = state === 'uploading' ? t('attach.uploading')
          : state === 'error' ? t('attach.failed')
            : typeof fileSizeText === 'function' ? fileSizeText(attachment.file.size) : ''
        const body = (
          <>
            <span className={css.name}>{name}</span>
            <span className={state === 'error' ? `${css.meta} ${css.metaFailed}` : css.meta}>{meta}</span>
          </>
        )
        return (
          <div key={attachment.id} className={state === 'error' ? `${css.card} ${css.failed}` : css.card} title={name}>
            <span className={css.icon} aria-hidden>
              {state === 'uploading' || typeof FileTypeIcon !== 'function' ? <span className={css.spinner} data-idle={state === 'uploading' ? undefined : ''} /> : <FileTypeIcon path={name} />}
            </span>
            {state === 'error'
              ? <button type="button" className={`${css.body} ${css.retry}`} aria-label={t('attach.retry', { name })} onClick={() => { onRetry(attachment.id) }}>{body}</button>
              : <span className={css.body}>{body}</span>}
            {remove}
          </div>
        )
      })}
      {preview !== undefined && typeof ImageLightbox === 'function' && (
        <ImageLightbox
          src={preview.previewUrl}
          alt={preview.file.name}
          labels={{ dialog: t('attach.preview'), close: t('attach.closePreview') }}
          onClose={() => { setPreview(undefined) }}
        />
      )}
    </div>
  )
}
