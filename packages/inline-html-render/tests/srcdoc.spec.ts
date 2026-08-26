// @vitest-environment jsdom
// srcdoc builder: wraps fresh and annotated HTML with the strict CSP and the
// capability bridge; a document that already declares a CSP is not double-wrapped.

import { describe, expect, it } from 'vitest'
import { buildCardSrcDoc, CARD_CSP } from '../src/client/srcdoc.ts'

describe('buildCardSrcDoc', () => {
  it('wraps a bare fragment into a full document carrying the CSP', () => {
    const out = buildCardSrcDoc('<div>hello</div>')
    expect(out).toContain('<!doctype html>')
    expect(out).toContain(`content="${CARD_CSP}"`)
    expect(out).toContain('window.dshBridge')
    expect(out).toContain('<div>hello</div>')
  })

  it('injects the CSP into an existing full document head', () => {
    const out = buildCardSrcDoc('<!doctype html><html><head><title>t</title></head><body>x</body></html>')
    expect(out).toContain(`content="${CARD_CSP}"`)
    // Injected right after <head ...>.
    expect(out).toMatch(/<head>[^]*content="default-src/s)
  })

  it('does not duplicate a CSP the document already declares', () => {
    const out = buildCardSrcDoc(
      `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'"></head><body>x</body></html>`,
    )
    const count = out.match(/Content-Security-Policy/g)?.length ?? 0
    expect(count).toBe(1)
  })
})
