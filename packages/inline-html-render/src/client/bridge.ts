/**
 * Host-side capability bridge for an inline card iframe: validates EVERY
 * message — the `message.source` must be the controlled iframe's window, `fn`
 * must be in the whitelist, and args are shape-checked per function — then
 * executes and replies `{ id, ok, result }` back. Unknown or malformed calls
 * get an error reply, never an exception in the host.
 * @module @khorsheed/dsh-inline-html-render
 */

interface BridgeRequest {
  readonly id?: unknown
  readonly fn?: unknown
  readonly args?: unknown
}

/** Each handler runs with validated args and may throw; errors become an error reply. */
const HANDLERS: Record<string, (args: readonly unknown[]) => void | Promise<void>> = {
  // Default: https only, noopener. `javascript:`/`file:`/`data:` are refused.
  openLink: (args) => {
    const url = String(args[0] ?? '')
    if (!/^https:/i.test(url)) throw new Error(`openLink: only https: targets are allowed (got ${url.slice(0, 40)})`)
    window.open(url, '_blank', 'noopener,noreferrer')
  },
  copy: async (args) => {
    const text = String(args[0] ?? '')
    if (text.length > 1_000_000) throw new Error('copy: text too large')
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      fallbackCopy(text)
    }
  },
  download: (args) => {
    const name = String(args[0] ?? 'download')
    const dataUrl = String(args[1] ?? '')
    if (!/^data:/i.test(dataUrl)) throw new Error('download: only data: URLs are allowed')
    const anchor = document.createElement('a')
    anchor.href = dataUrl
    anchor.download = name
    anchor.click()
  },
}

/** execCommand copy fallback for contexts without the async clipboard API. */
function fallbackCopy(text: string): void {
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  try {
    document.execCommand('copy')
  } finally {
    area.remove()
  }
}

function reply(frame: HTMLIFrameElement, message: { id: string; ok: boolean; result?: unknown; error?: string }): void {
  frame.contentWindow?.postMessage(message, '*')
}

/** Cap on the reported height, guarding against a runaway or adversarial card. */
const MAX_FRAME_HEIGHT = 20_000

/**
 * Listen for bridge/height messages from one controlled iframe.
 * @param frame - the card iframe; only its window's messages are honored.
 * @returns a disposer removing the listener.
 */
export function attachBridge(frame: HTMLIFrameElement): () => void {
  const onMessage = (event: MessageEvent): void => {
    if (event.source !== frame.contentWindow) return
    const data = event.data as BridgeRequest | null
    if (data === null || typeof data !== 'object') return
    const id = data.id
    const fn = data.fn
    // The height report is a message without an `id`; it is not a call and gets
    // no reply, only the frame resize.
    if (fn === 'resize') {
      const args = Array.isArray(data.args) ? data.args : []
      const height = Number(args[0] ?? 0)
      if (Number.isFinite(height) && height > 0) {
        frame.style.height = `${Math.min(Math.ceil(height) + 1, MAX_FRAME_HEIGHT)}px`
      }
      return
    }
    if (typeof id !== 'string' || typeof fn !== 'string') return
    const handler = HANDLERS[fn]
    if (handler === undefined) {
      reply(frame, { id, ok: false, error: `unknown bridge function: ${fn}` })
      return
    }
    const args = Array.isArray(data.args) ? data.args : []
    Promise.resolve()
      .then(() => handler(args))
      .then(
        () => reply(frame, { id, ok: true, result: undefined }),
        (error: unknown) => reply(frame, { id, ok: false, error: error instanceof Error ? error.message : String(error) }),
      )
  }
  addEventListener('message', onMessage)
  return () => removeEventListener('message', onMessage)
}
