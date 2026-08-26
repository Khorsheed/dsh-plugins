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
 * - a full document keeps its own structure and gets the CSP meta injected
 *   right after its `<head …>` tag (skipped when it already declares one,
 *   e.g. a skill-compliant output that embeds the same policy).
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
 * host validates every call. It also reports the document's content height on
 * load (and on resize) so the parent can size the cross-origin iframe — the
 * parent cannot read `contentDocument` on an opaque-origin frame, so the height
 * must be posted from inside. No network and no host access exist outside
 * these messages. */
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
  if (document.readyState === 'complete') report()
  else addEventListener('load', report)
  addEventListener('resize', report)
})()
<\/script>`

/** The CSP meta tag. */
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${CARD_CSP}">`

const HEAD_OPEN = /<head[^>]*>/i
const HAS_CSP = /http-equiv=["']Content-Security-Policy/i

/**
 * Wrap or annotate an untrusted HTML document so it runs inside the sandbox CSP.
 * @param content - the card HTML, as authored inside the fenced block.
 * @returns a complete document carrying the strict CSP and the bridge.
 */
export function buildCardSrcDoc(content: string): string {
  const headExtras = BRIDGE_SCRIPT
  const head = HEAD_OPEN.exec(content)
  if (head === null) {
    // Fragment: we own the whole document.
    return `<!doctype html><html lang="zh"><head><meta charset="utf-8">${CSP_META}${headExtras}</head><body>${content}</body></html>`
  }
  // Full document: inject into its own head (no duplicated CSP when it
  // already declares one — skill-compliant outputs embed the same policy).
  const headInjection = (HAS_CSP.test(content) ? '' : CSP_META) + headExtras
  return content.slice(0, head.index + head[0].length) + headInjection + content.slice(head.index + head[0].length)
}
