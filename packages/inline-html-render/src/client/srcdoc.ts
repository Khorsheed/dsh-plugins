/**
 * Sandboxed srcDoc builder for inline HTML cards.
 *
 * The parent web shell has no Content-Security-Policy of its own and an
 * iframe's `srcdoc` is not served as an HTTP response, so CSP inheritance
 * cannot be relied on — the policy must be embedded IN the document. This
 * helper guarantees exactly that for both shapes of input:
 *
 * - a bare fragment (no `<html>`/`<head>`) is wrapped into a full document
 *   whose head carries the CSP and the capability bridge;
 * - a full document keeps its own structure. Authored CSP metas are moved into
 *   its `<head …>` wherever they appeared; the strict default is added only
 *   when the card declares no policy of its own.
 *
 * The sandbox is `allow-scripts`, NEVER `allow-same-origin` — the opaque
 * origin is what keeps the frame's scripts from touching the host, and the
 * CSP is the network/capability boundary. This is deliberately stricter than
 * file-preview's Tier1 (no whitelisted CDNs): an inline card should never
 * reach the network at all.
 * @module @khorsheed/dsh-inline-html-render
 */

/** Strict sandbox CSP: no network, no navigation, scripts only inline. */
export const CARD_CSP = 'default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:; connect-src \'none\'; worker-src blob:; object-src \'none\'; base-uri \'none\'; form-action \'none\''

/** The capability bridge client, injected into the document. Exposes a tiny
 * `window.dshBridge` (openLink / copy / download) backed by postMessage; the
 * host validates every call. It reports readiness on load and content height
 * on load/resize so the parent can reveal and size the cross-origin iframe —
 * the parent cannot read `contentDocument` on an opaque-origin frame, so both
 * signals must be posted from inside. No network and no host access exist
 * outside these messages. */
const BRIDGE_SCRIPT = `<script id="dsh-inline-bridge">
(function () {
  var seq = 0
  function call (fn, args, target) {
    return new Promise(function (resolve, reject) {
      var id = 'dshb' + (++seq)
      function on (e) {
        if (e.data && e.data.id === id) {
          removeEventListener('message', on)
          if (e.data.ok) resolve(e.data.result)
          else reject(new Error(e.data.error || 'bridge call failed'))
        }
      }
      addEventListener('message', on)
      parent.postMessage({ id: id, fn: fn, args: args }, '*')
    })
  }
  window.dshBridge = {
    openLink: function (url) { return call('openLink', [url]) },
    copy: function (text) { return call('copy', [text]) },
    download: function (name, dataUrl) { return call('download', [name, dataUrl]) }
  }
  function report () {
    // documentElement.scrollHeight reflects the viewport height, so a short
    // card leaves a blank gap below. document.body.scrollHeight is the actual
    // content height the card occupies. Use it, with documentElement only as a
    // fallback for a body that holds no laid-out content of its own.
    var bodyH = document.body ? document.body.scrollHeight : 0
    var h = bodyH
    if (h <= 0 && document.documentElement) h = document.documentElement.scrollHeight || 0
    if (h > 0) parent.postMessage({ fn: 'resize', args: [h] }, '*')
  }
  function ready () {
    report()
    parent.postMessage({ fn: 'ready', args: [] }, '*')
  }
  if (document.readyState === 'complete') ready()
  else addEventListener('load', ready)
  addEventListener('resize', report)
})()
<\/script>`

/** The CSP meta tag. */
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${CARD_CSP}">`

const HEAD_OPEN = /<head[^>]*>/i
const HAS_CSP = /\bhttp-equiv\s*=\s*(?:"Content-Security-Policy"|'Content-Security-Policy'|Content-Security-Policy(?=[\s/>]))/i
const META_OR_RAW_TEXT = /<!--[\s\S]*?-->|<(script|style|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>|<meta\b[^>]*>/gi

function hoistCspMetas(source: string): { content: string; csp: string } {
  const authored: string[] = []
  const content = source.replace(META_OR_RAW_TEXT, tag => {
    if (!tag.toLowerCase().startsWith('<meta') || !HAS_CSP.test(tag)) return tag
    authored.push(tag)
    return ''
  })
  return { content, csp: authored.length === 0 ? CSP_META : authored.join('') }
}

/**
 * Wrap or annotate an untrusted HTML document so it runs inside the sandbox CSP.
 * @param content - the card HTML, as authored inside the fenced block.
 * @returns a complete document carrying the strict CSP and the bridge.
 */
export function buildCardSrcDoc(content: string): string {
  const normalized = hoistCspMetas(content)
  const headExtras = normalized.csp + BRIDGE_SCRIPT
  const head = HEAD_OPEN.exec(normalized.content)
  if (head === null) {
    // Fragment: we own the whole document.
    return `<!doctype html><html lang="zh"><head><meta charset="utf-8">${headExtras}</head><body>${normalized.content}</body></html>`
  }
  return normalized.content.slice(0, head.index + head[0].length) + headExtras + normalized.content.slice(head.index + head[0].length)
}
