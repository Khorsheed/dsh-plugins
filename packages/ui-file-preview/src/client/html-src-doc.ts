/**
 * Sandboxed HTML srcDoc builder: wraps or annotates an untrusted HTML
 * document so it runs inside the Tier1 CSP, plus the Tier1 runtime extras.
 *
 * The parent web shell has no Content-Security-Policy of its own and an
 * iframe's `srcdoc` is not served as an HTTP response, so CSP inheritance
 * cannot be relied on — the policy must be embedded IN the document. This
 * helper guarantees exactly that for both shapes of input:
 *
 * - a bare fragment (no `<html>`/`<head>`) is wrapped into a full document
 *   whose head carries the CSP (and, in Tier1, the content-visibility style
 *   and the sandbox bridge script);
 * - a full document keeps its own structure and gets the CSP meta injected
 *   right after its `<head …>` tag (skipped when it already declares one,
 *   e.g. a 3d-artifact skill output), plus the Tier1 extras.
 *
 * Tier0 (`tier: 0`) — the static sandbox (`sandbox=""`): the CSP is defense
 * in depth on top of the empty sandbox. Tier1 (`tier: 1`) — scripts allowed
 * (`sandbox="allow-scripts"`, never `allow-same-origin`): the CSP is the
 * network/capability boundary and the bridge is the only way in or out.
 * @module @khorsheed/dsh-client-ui-file-preview
 */

/** The Tier1 sandbox policy: no network, no navigation, scripts only from
 * inline (the page's own code) and the whitelisted CDNs, worker from blob:.
 * `allow-same-origin` is NEVER combined with `allow-scripts` — the opaque
 * origin is what keeps the frame's scripts from touching the host. */
export const TIER1_CSP = 'default-src \'none\'; script-src \'unsafe-inline\' https://cdn.jsdelivr.net; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:; connect-src \'none\'; worker-src blob:; object-src \'none\'; base-uri \'none\'; form-action \'none\'; upgrade-insecure-requests; block-all-mixed-content'

/** Tier1 large-document deferral: top-level children render on scroll, with a
 * placeholder size so the scrollbar does not jump (the Chrome guidance's
 * `contain-intrinsic-size` pairing). Applied by CSS so it needs no script. */
const CV_STYLE = '<style id="dsh-content-visibility">body > *{content-visibility:auto;contain-intrinsic-size:auto 240px}</style>'

/** The capability bridge client, injected into Tier1 documents. Exposes a
 * tiny `window.dshBridge` (openLink / copy / download) backed by postMessage;
 * the host validates every call (whitelist + arg shape + message source).
 * No network and no host access exist outside these three functions. */
const BRIDGE_SCRIPT = `<script id="dsh-bridge">
(function () {
  var seq = 0
  function call (fn, args) {
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
})()
<\/script>`

/** The CSP meta tag, reused for both tiers (Tier0 = defense in depth). */
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${TIER1_CSP}">`

const HEAD_OPEN = /<head[^>]*>/i
const HAS_CSP = /http-equiv=["']Content-Security-Policy/i

/** Build the `srcdoc` for the sandboxed render iframe.
 * @param content - the untrusted HTML source read from disk.
 * @param opts - `tier`: 0 = static (`sandbox=""`), 1 = scripts allowed.
 * @returns a complete document carrying the Tier1 CSP.
 */
export function buildSrcDoc(content: string, opts: { tier: 0 | 1 }): string {
  const extras = opts.tier === 1 ? CV_STYLE + BRIDGE_SCRIPT : ''
  const headMatch = HEAD_OPEN.exec(content)
  if (headMatch === null) {
    // Fragment: we own the whole document.
    return `<!doctype html><html lang="zh"><head><meta charset="utf-8">${CSP_META}${extras}</head><body>${content}</body></html>`
  }
  // Full document: inject into its own head (no duplicated CSP when it
  // already declares one — skill-compliant outputs embed the same policy).
  const injection = (HAS_CSP.test(content) ? '' : CSP_META) + extras
  const at = headMatch.index + headMatch[0].length
  return content.slice(0, at) + injection + content.slice(at)
}
