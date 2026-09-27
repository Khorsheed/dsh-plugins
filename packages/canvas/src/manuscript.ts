/**
 * The pure half of 「保存到工作区」: what a manuscript is called on disk, and
 * how its image pointers become files beside it.
 *
 * A manuscript's body holds images as `attachment://` pointers (the card
 * rule, §10.3), which mean nothing outside this deployment. Saving therefore
 * rewrites each pointer into a relative link to `<title>.assets/<file>` and
 * lists the files the store must write there. The file name is the digest's
 * head, so one image pasted twice is written once, and saving again rewrites
 * the same names instead of piling up copies. A pointer that does not parse
 * stays exactly as it was — it never became an image, so it does not become a
 * file either.
 *
 * Runtime-agnostic: no node, no DOM.
 *
 * @module @khorsheed/dsh-canvas
 */
import { imageRefOf } from './image-token.ts'
import { sanitizeItemTitle, type CanvasImageMediaType, type CanvasImageRef } from './types.ts'

/** The base name a manuscript without a usable title saves under. */
export const FALLBACK_EXPORT_NAME = 'manuscript'

/** The extension each admitted media type is written with. */
const EXTENSION_OF: Readonly<Record<CanvasImageMediaType, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** A markdown image whose destination is one of our pointers. */
const POINTER_IMAGE = /!\[([^\]\n]*)\]\((attachment:\/\/[^)\s]+)\)/g

/**
 * The file-system name a manuscript saves under (no extension): the title,
 * with the characters no file name may carry replaced — the pad items' rule.
 * @param title - the manuscript's title.
 * @returns a name safe to join under a workspace.
 */
export function exportBaseNameOf(title: string): string {
  return sanitizeItemTitle(title) ?? FALLBACK_EXPORT_NAME
}

/** One image a save has to write beside the markdown. */
export interface ExportImage {
  readonly ref: CanvasImageRef
  /** The file name inside the assets directory. */
  readonly file: string
}

/**
 * Rewrite a body's image pointers into links to the assets directory.
 * @param body - the manuscript's markdown.
 * @param assetsDir - the assets directory's name, relative to the markdown file.
 * @param keep - which files actually made it to disk; a pointer whose file did
 * not stays as it was (the save reports it), rather than linking to nothing.
 * @returns the rewritten text and the distinct images to write.
 */
export function rewriteImagesForExport(
  body: string,
  assetsDir: string,
  keep: (file: string) => boolean = () => true,
): { readonly text: string; readonly images: readonly ExportImage[] } {
  const images = new Map<string, ExportImage>()
  const text = body.replace(POINTER_IMAGE, (whole, alt: string, src: string) => {
    const ref = imageRefOf(src)
    if (ref === undefined) return whole
    const file = `${ref.attachmentId.slice('sha256:'.length, 'sha256:'.length + 16)}.${EXTENSION_OF[ref.mediaType]}`
    if (!images.has(file)) images.set(file, { ref, file })
    if (!keep(file)) return whole
    // Angle brackets keep a title with spaces or parentheses a single destination.
    return `![${alt}](<${assetsDir}/${file}>)`
  })
  return { text, images: [...images.values()] }
}
