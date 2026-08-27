/**
 * Inline image preview for the worktrees surfaces: a base64 data URL from the
 * host's readRepoImage/readLocalImage data plane rendered as a plain <img>
 * with a lightbox-style click-to-open. Deliberately a local <img> rather than
 * the attachment-backed MessageImage — the browsed files live on the user's
 * own machine (file-preview trust model) and have no session-authorized
 * attachment URL, so a raw data URL is the correct, dependency-free channel.
 */
import { useState, type ReactNode } from 'react'
import css from './ImagePreview.module.css'

/** Image extensions this plugin previews inline (mirrors the host data plane's
 * imageMimeOf; kept client-side so no node:fs code enters the bundle). */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'])

/** Props of the inline image preview. */
export interface ImagePreviewProps {
  /** The selected file path (image extension). */
  path: string
  /** The base64 data URL to render. */
  src: string
}

/** Whether a path is an image this plugin previews inline. */
export function isImageFile(path: string): boolean {
  const dot = path.lastIndexOf('.')
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : ''
  return IMAGE_EXTENSIONS.has(ext)
}

/** The inline image preview. */
export function ImagePreview({ path, src }: ImagePreviewProps): ReactNode {
  const [zoom, setZoom] = useState(false)
  const label = path.slice(path.lastIndexOf('/') + 1) || path
  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
      <img className={css.img} src={src} alt={label} onClick={() => { setZoom(true) }} />
      {zoom && (
        <div className={css.backdrop} onClick={() => { setZoom(false) }}>
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
          <img className={css.zoomImg} src={src} alt={label} onClick={event => { event.stopPropagation() }} />
        </div>
      )}
    </>
  )
}
