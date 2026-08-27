/**
 * Sandboxed HTML srcDoc builder for the worktrees preview: wraps an untrusted
 * HTML fragment/document so it renders inside a `sandbox=""` iframe (no
 * scripts, no forms, no popups; CSS and images render). The iframe has no
 * HTTP origin, so CSP inheritance cannot be relied on — the policy is embedded
 * in the document itself. Kept to the static (script-free) tier — the local
 * browser never runs a page's scripts, matching the file-preview trust model.
 *
 * @module @khorsheed/dsh-worktrees
 */

/** The static tier policy: no network, no navigation, no scripts, inline
 * styles only. */
const STATIC_CSP = 'default-src \'none\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:; connect-src \'none\'; worker-src blob:; object-src \'none\'; base-uri \'none\'; form-action \'none\'';

/** The CSP meta tag injected into the wrapped document. */
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${STATIC_CSP}">`

const HEAD_OPEN = /<head[^>]*>/i
const HAS_CSP = /http-equiv=["']Content-Security-Policy/i

/**
 * Build the `srcdoc` for a static sandboxed HTML render.
 * @param content - the untrusted HTML source read from disk.
 * @returns a complete document carrying the static CSP.
 */
export function buildHtmlSrcDoc(content: string): string {
  const headMatch = HEAD_OPEN.exec(content)
  if (headMatch === null) {
    // Bare fragment: we own the whole document.
    return `<!doctype html><html lang="zh"><head><meta charset="utf-8">${CSP_META}</head><body>${content}</body></html>`
  }
  // Full document: inject into its own head (no duplicated CSP when present).
  const injection = HAS_CSP.test(content) ? '' : CSP_META
  return content.slice(0, headMatch.index + headMatch[0].length)
    + injection
    + content.slice(headMatch.index + headMatch[0].length)
}
