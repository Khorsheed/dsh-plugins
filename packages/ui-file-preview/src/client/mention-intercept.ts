/**
 * Prose-mention click interception: the one official file entry no slot or
 * service seam reaches. Official closing-prose mentions render as
 * `code > button[title]` whose onClick closes over the official OS opener
 * (ui-deliverables' producedFileMentions, reached through the singly-provided
 * chatFileMentions service — cordis rejects a second provider). React 17+
 * listens at the root container, so a document capture-phase listener runs
 * first: a confirmed mention hit stops propagation and opens the drawer
 * instead, and anything unrecognized passes through untouched (fail-open —
 * the worst case is the official OS open, never a swallowed click).
 *
 * TODO(official-opener-seam): delete this module once the official mention
 * open becomes replaceable (an optional opener service the chat view
 * consults, or a replaceable chatFileMentions). On each official upgrade
 * re-check the intercepted structure: mentions still render as
 * `code > button[title]` with title = absolute path and label = the path or
 * its basename.
 */
import { basename } from './turn-files.ts'

/** Absolute-path test: a POSIX root, a UNC root, or a Windows drive root. */
const ABSOLUTE_PATH = /^(?:[/\\]|[A-Za-z]:[/\\])/

/** The plugin's own surfaces, whose buttons must never be intercepted. */
const OWN_SURFACE = '[role="dialog"], [data-turn-file-row]'

/**
 * Extract the file path an official prose-mention click targets. The three
 * gates — structure, absolute-path title, and a label matching the path or
 * its basename — keep the interceptor from ever claiming a foreign button.
 * @param target - the click's event target.
 * @returns the mention's absolute path, or undefined when the target is not a confirmed official mention.
 */
export function mentionPathFrom(target: EventTarget | null): string | undefined {
  if (!(target instanceof Element)) return undefined
  const button = target.closest('code > button[title]')
  if (button === null || button.closest(OWN_SURFACE) !== null) return undefined
  /* v8 ignore next -- the [title] attribute selector guarantees a string */
  const title = button.getAttribute('title') ?? ''
  if (!ABSOLUTE_PATH.test(title)) return undefined
  const label = button.textContent
  if (label !== title && label !== basename(title)) return undefined
  return title
}

/**
 * Intercept official prose-mention clicks document-wide in the capture phase.
 * @param open - drawer opener invoked with the mention's absolute path.
 * @returns disposer removing the listener.
 */
export function interceptMentionClicks(open: (path: string) => void): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.button !== 0 || event.defaultPrevented) return
    const path = mentionPathFrom(event.target)
    if (path === undefined) return
    event.preventDefault()
    event.stopPropagation()
    open(path)
  }
  document.addEventListener('click', onClick, true)
  return () => { document.removeEventListener('click', onClick, true) }
}
