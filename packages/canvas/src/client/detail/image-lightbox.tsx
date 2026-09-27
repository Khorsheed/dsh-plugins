/**
 * A picture on a card opens large on a click, in the host's own lightbox
 * (`ImageLightbox`), both while reading and while editing (2026-09-28 review).
 *
 * The click is caught on the container, not per image: the markdown renderer
 * owns the `<img>` elements, and the container sees every one of them with one
 * handler. A picture inside a link stays a link.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { ImageLightbox } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CanvasDetailProps } from '../contract.ts'

/** The container's click handler, and the lightbox to render (outside any key handler). */
export function useImageLightbox(t: CanvasDetailProps['t']): {
  readonly onClick: (event: ReactMouseEvent<HTMLElement>) => void
  readonly lightbox: ReactNode
} {
  const [open, setOpen] = useState<{ src: string; alt: string } | null>(null)
  const onClick = (event: ReactMouseEvent<HTMLElement>): void => {
    const target = event.target
    if (!(target instanceof HTMLImageElement) || target.closest('a') !== null) return
    const src = target.currentSrc || target.src
    if (src.length === 0) return
    event.preventDefault()
    setOpen({ src, alt: target.alt })
  }
  const lightbox = open === null ? null : (
    <ImageLightbox
      src={open.src}
      alt={open.alt}
      labels={{ dialog: t('image.dialog'), close: t('image.close') }}
      onClose={() => { setOpen(null) }}
    />
  )
  return { onClick, lightbox }
}
