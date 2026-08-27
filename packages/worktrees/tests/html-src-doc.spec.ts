/**
 * Unit tests for the sandboxed HTML srcDoc builder: a bare fragment is wrapped
 * into a full document carrying the static CSP, and a full document keeps its
 * own structure with the CSP injected (skipped when it already declares one).
 */
import { describe, expect, it } from 'vitest'
import { buildHtmlSrcDoc } from '../src/client/html-src-doc.ts'

describe('buildHtmlSrcDoc', () => {
  it('wraps a bare HTML fragment into a full document with the CSP', () => {
    const out = buildHtmlSrcDoc('<div class="a">hi</div>')
    expect(out.startsWith('<!doctype html>')).toBe(true)
    expect(out).toContain('Content-Security-Policy')
    expect(out).toContain('<body><div class="a">hi</div></body>')
  })

  it('injects the CSP into a full document head (no duplicated CSP)', () => {
    const out = buildHtmlSrcDoc('<!doctype html><html><head><title>t</title></head><body><p>x</p></body></html>')
    expect(out).toContain('<head><meta http-equiv="Content-Security-Policy"')
    expect(out).toContain('<title>t</title>')
    const cspCount = (out.match(/Content-Security-Policy/g) ?? []).length
    expect(cspCount).toBe(1)
  })

  it('skips the CSP when the document already declares one', () => {
    const out = buildHtmlSrcDoc(`<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'"></head><body></body></html>`)
    const cspCount = (out.match(/Content-Security-Policy/g) ?? []).length
    expect(cspCount).toBe(1)
  })
})
