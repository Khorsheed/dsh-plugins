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

  it('moves a fragment CSP meta into the head without dropping the card', () => {
    const meta = `<meta http-equiv="Content-Security-Policy" content="${CARD_CSP}">`
    const out = buildCardSrcDoc(`${meta}\n<style>.card{color:red}</style>\n<div class="card">关系图</div>\n<script>window.cardReady = true<\/script>`)
    const head = out.slice(0, out.indexOf('</head>'))
    const body = out.slice(out.indexOf('</head>'))
    expect(head).toContain(meta)
    expect(body).not.toContain('http-equiv="Content-Security-Policy"')
    expect(body).toContain('<style>.card{color:red}</style>')
    expect(body).toContain('<div class="card">关系图</div>')
    expect(body).toContain('<script>window.cardReady = true</script>')
    expect(out.match(/Content-Security-Policy/g)).toHaveLength(1)
  })

  it('moves CSP metas from outside a full document head into it', () => {
    const first = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'">'
    const second = '<meta content="script-src \'unsafe-inline\'" http-equiv="Content-Security-Policy">'
    const out = buildCardSrcDoc(`<!doctype html><html><head><title>t</title></head><body>x${first}${second}</body></html>`)
    const head = out.slice(0, out.indexOf('</head>'))
    const body = out.slice(out.indexOf('</head>'))
    expect(head).toContain(first + second)
    expect(body).toBe('</head><body>x</body></html>')
    expect(out.match(/Content-Security-Policy/g)).toHaveLength(2)
  })

  it('does not mistake CSP-shaped raw text for a declared policy', () => {
    const script = '<script>const example = \'<meta http-equiv="Content-Security-Policy" content="default-src \'none\'">\'<\/script>'
    const out = buildCardSrcDoc(script)
    expect(out).toContain(script)
    expect(out.slice(0, out.indexOf('</head>'))).toContain(`content="${CARD_CSP}"`)
  })
})
