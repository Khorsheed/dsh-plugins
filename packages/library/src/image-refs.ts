/**
 * The image references a session's messages carried, remembered as they are
 * committed — so recording a photographed page never depends on the model
 * copying a reference it only partly sees.
 *
 * Live trial (2026-10-06, deepseek-flash): the model sees an image block's id
 * without its `sha256:` prefix and without `bytes`, and guessed the rest four
 * times over. The full reference is on the committed `user/message` event,
 * so the tool row watches `session/event` and keeps the last few per session
 * (the synchronous history readers are deprecated; this is the delivered
 * current event). A restarted host starts empty: a page then needs the full
 * reference, or a photo sent after the restart.
 *
 * @module @khorsheed/dsh-library/image-refs
 */
import type { LibraryAttachmentRef } from './types.ts'

/** How many images per session are remembered. */
const PER_SESSION = 20
/** How many sessions are remembered. */
const SESSIONS = 200

/** The id without its digest prefix, for matching what the model wrote. */
function bareId(id: string): string {
  return id.replace(/^sha256:/, '')
}

/** A whole reference, when a value carries every field. */
export function asAttachmentRef(value: unknown): LibraryAttachmentRef | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const ref = value as Record<string, unknown>
  if (typeof ref.attachmentId !== 'string' || typeof ref.mediaType !== 'string') return undefined
  if (typeof ref.bytes !== 'number' || ref.bytes <= 0) return undefined
  if (typeof ref.width !== 'number' || typeof ref.height !== 'number') return undefined
  return { attachmentId: ref.attachmentId, mediaType: ref.mediaType, bytes: ref.bytes, width: ref.width, height: ref.height }
}

/** The image references each session's user messages carried, newest last. */
export class ImageRefCache {
  private readonly bySession = new Map<string, LibraryAttachmentRef[]>()

  /** Remember the images one committed event carries (non-image events are ignored). */
  observe(sessionId: string, event: { type?: unknown; data?: unknown }): void {
    if (event.type !== 'user/message') return
    const content = (event.data as { content?: unknown } | undefined)?.content
    if (!Array.isArray(content)) return
    for (const block of content as { type?: unknown; attachment?: unknown }[]) {
      if (block?.type !== 'image') continue
      const ref = asAttachmentRef(block.attachment)
      if (ref !== undefined) this.remember(sessionId, ref)
    }
  }

  remember(sessionId: string, ref: LibraryAttachmentRef): void {
    const list = this.bySession.get(sessionId) ?? []
    const kept = list.filter(entry => entry.attachmentId !== ref.attachmentId)
    kept.push(ref)
    this.bySession.delete(sessionId)
    this.bySession.set(sessionId, kept.slice(-PER_SESSION))
    while (this.bySession.size > SESSIONS) this.bySession.delete(this.bySession.keys().next().value!)
  }

  /**
   * The whole reference for what the model wrote: a complete reference
   * passes through; an id (with or without its prefix) is looked up; nothing
   * at all means the session's latest photo.
   */
  resolve(sessionId: string | undefined, written: unknown): LibraryAttachmentRef | undefined {
    const whole = asAttachmentRef(written)
    const known = sessionId === undefined ? [] : this.bySession.get(sessionId) ?? []
    const id = typeof written === 'string'
      ? written
      : typeof (written as { attachmentId?: unknown } | undefined)?.attachmentId === 'string'
        ? (written as { attachmentId: string }).attachmentId
        : undefined
    if (id !== undefined) {
      const match = known.find(ref => bareId(ref.attachmentId) === bareId(id))
      if (match !== undefined) return match
    }
    if (whole !== undefined) return whole
    return id === undefined ? known.at(-1) : undefined
  }
}
