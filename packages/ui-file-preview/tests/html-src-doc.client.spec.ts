// @vitest-environment jsdom
/**
 * buildSrcDoc: the Tier1 srcDoc wrapper — CSP embedded for both tiers,
 * fragment wrapping vs. full-document head injection, no CSP duplication,
 * and the Tier1-only content-visibility style + bridge client.
 */
import { describe, expect, it } from 'vitest'
import { TIER1_CSP, buildSrcDoc } from '../src/client/html-src-doc.ts'

describe('buildSrcDoc', () => {
  it('wraps a fragment into a full document carrying the Tier1 CSP', () => {
    const doc = buildSrcDoc('<h1>Hello</h1>', { tier: 0 })
    expect(doc).toContain('<!doctype html>')
    expect(doc).toContain('<h1>Hello</h1>')
    expect(doc).toContain(`http-equiv="Content-Security-Policy" content="${TIER1_CSP}"`)
    expect(doc).toContain('connect-src')
  })

  it('injects the CSP into a full document head without duplicating an existing one', () => {
    const authored = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'"></head><body><p>x</p></body></html>`
    const doc = buildSrcDoc(authored, { tier: 0 })
    expect(doc).toContain(`content="default-src 'none'"`)
    // The author's own policy is respected; ours is not injected twice.
    expect(doc.split('http-equiv="Content-Security-Policy"').length).toBe(2)
    expect(doc).toContain('<p>x</p>')
  })

  it('adds the Tier1 extras only for tier 1', () => {
    const t0 = buildSrcDoc('<p>x</p>', { tier: 0 })
    expect(t0).not.toContain('dsh-bridge')
    expect(t0).not.toContain('content-visibility')
    const t1 = buildSrcDoc('<p>x</p>', { tier: 1 })
    expect(t1).toContain('dsh-bridge')
    expect(t1).toContain('content-visibility')
    expect(t1).toContain('parent.postMessage')
  })

  it('injects a static hint at the start of the body for tier 0 only', () => {
    const doc = buildSrcDoc('<p>x</p>', { tier: 0, hint: '静态预览提示' })
    expect(doc).toContain('静态预览提示')
    expect(doc.indexOf('静态预览提示')).toBeGreaterThan(doc.indexOf('<body>'))
    expect(doc).toContain('position:fixed')
    const t1 = buildSrcDoc('<p>x</p>', { tier: 1, hint: '静态预览提示' })
    expect(t1).not.toContain('position:fixed')
  })

  it('injects a static hint into a full document body', () => {
    const authored = '<!doctype html><html><head><title>t</title></head><body><p>x</p></body></html>'
    const doc = buildSrcDoc(authored, { tier: 0, hint: 'hint-here' })
    expect(doc.indexOf('hint-here')).toBeGreaterThan(doc.indexOf('<body>'))
    expect(doc).toContain('<p>x</p>')
  })

  it('injects the Tier1 extras into a full document', () => {
    const authored = '<!doctype html><html><head><title>t</title></head><body></body></html>'
    const doc = buildSrcDoc(authored, { tier: 1 })
    expect(doc.indexOf('dsh-bridge')).toBeGreaterThan(doc.indexOf('<head>'))
    expect(doc).toContain('<title>t</title>')
  })
})
