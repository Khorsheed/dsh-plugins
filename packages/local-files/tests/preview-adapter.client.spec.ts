// @vitest-environment jsdom
/**
 * The local-files adaptation layer: every key the shared content pane prints
 * must resolve in THIS plugin's dictionary (a missing key would surface as an
 * English key name in a Chinese UI), and the wire kind union must map onto the
 * kernel's contract without losing a case.
 */
import { describe, expect, it } from 'vitest'
import { PREVIEW_KEYS } from '@khorsheed/dsh-client-ui-content-preview/src/client/index.ts'
import { en, zh } from '../src/client/locales.ts'
import { previewTranslator, structuredLabels, toPreviewRead } from '../src/client/preview.ts'
import type { LocalFilesRead } from '../src/types.ts'

describe('local-files preview dictionary', () => {
  it('resolves every key the shared pane prints, in both languages', () => {
    const missingZh = PREVIEW_KEYS.filter(key => (zh as Record<string, string>)[key] === undefined)
    const missingEn = PREVIEW_KEYS.filter(key => (en as Record<string, string>)[key] === undefined)
    expect(missingZh).toEqual([])
    expect(missingEn).toEqual([])
  })

  it('prints through the plugin dictionary, interpolating params', () => {
    const t = ((key: string, params?: Record<string, string | number>) =>
      params === undefined ? key : `${key}:${JSON.stringify(params)}`) as never
    const translate = previewTranslator(t)
    expect(translate('local.unreadable')).toBe('local.unreadable')
    expect(translate('search.hit', { current: 1, total: 2 })).toBe('search.hit:{"current":1,"total":2}')
  })

  it('builds the structured chrome over the plugin dictionary', () => {
    const t = ((key: string) => `「${key}」`) as never
    const labels = structuredLabels(t)
    expect(labels.markdown.footnotes).toBe('「markdown.footnotes」')
    expect(labels.json.copyPath).toBe('「json.copyPath」')
    expect(labels.json.copyButtonTitle('copy')).toBe('「json.copyButtonTitle」')
  })
})

describe('local-files read adaptation', () => {
  it('maps a text read and keeps the truncation / script hints', () => {
    const read: LocalFilesRead = {
      path: '/work/a.html', kind: 'text', content: '<html></html>', truncated: true, htmlScripted: true,
    }
    expect(toPreviewRead(read)).toEqual({
      kind: 'text', path: '/work/a.html', content: '<html></html>', truncated: true, htmlScripted: true,
    })
  })

  it('maps image / binary / too-large reads with their sizes', () => {
    expect(toPreviewRead({ path: '/work/a.png', kind: 'image', url: 'data:image/png;base64,AA', size: 3 }))
      .toEqual({ kind: 'image', path: '/work/a.png', url: 'data:image/png;base64,AA', size: 3 })
    expect(toPreviewRead({ path: '/work/a.bin', kind: 'binary', size: 9 }))
      .toEqual({ kind: 'binary', path: '/work/a.bin', size: 9 })
    expect(toPreviewRead({ path: '/work/big.txt', kind: 'too-large', size: 10 }))
      .toEqual({ kind: 'too-large', path: '/work/big.txt', size: 10 })
  })

  it('turns an image read with no URL into an unreadable file, not a broken <img>', () => {
    expect(toPreviewRead({ path: '/work/a.png', kind: 'image' }))
      .toEqual({ kind: 'missing', path: '/work/a.png', reason: 'unreadable' })
  })

  it('maps missing and error reads, and passes null through', () => {
    expect(toPreviewRead({ path: '/work/x.ts', kind: 'missing' })).toEqual({ kind: 'missing', path: '/work/x.ts' })
    expect(toPreviewRead({ path: '/work/x.ts', kind: 'error', message: 'boom' }))
      .toEqual({ kind: 'error', path: '/work/x.ts', message: 'boom' })
    expect(toPreviewRead(null)).toBeNull()
  })
})
