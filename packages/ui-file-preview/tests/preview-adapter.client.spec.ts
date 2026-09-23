// @vitest-environment jsdom
/**
 * The ui-file-preview adaptation layer: every key the shared content pane
 * prints must resolve in THIS plugin's dictionary, and the filePreview wire
 * kind union must map onto the kernel's contract without losing a case.
 */
import { describe, expect, it } from 'vitest'
import { PREVIEW_KEYS } from '@khorsheed/dsh-client-ui-content-preview/src/client/index.ts'
import { en, zh } from '../src/client/locales.ts'
import { previewTranslator, structuredLabels, toPreviewRead } from '../src/client/preview.ts'
import type { FilePreviewRead } from '@khorsheed/dsh-file-preview/types'

describe('ui-file-preview pane dictionary', () => {
  it('resolves every key the shared pane prints, in both languages', () => {
    expect(PREVIEW_KEYS.filter(key => (zh as Record<string, string>)[key] === undefined)).toEqual([])
    expect(PREVIEW_KEYS.filter(key => (en as Record<string, string>)[key] === undefined)).toEqual([])
  })

  it('prints through the plugin dictionary, interpolating params', () => {
    const t = ((key: string, params?: Record<string, string | number>) =>
      params === undefined ? key : `${key}:${JSON.stringify(params)}`) as never
    expect(previewTranslator(t)('search.hit', { current: 1, total: 3 })).toBe('search.hit:{"current":1,"total":3}')
  })

  it('builds the structured chrome over the plugin dictionary', () => {
    const labels = structuredLabels(((key: string) => `「${key}」`) as never)
    expect(labels.markdown.footnotes).toBe('「markdown.footnotes」')
    expect(labels.json.copyPath).toBe('「json.copyPath」')
  })
})

describe('ui-file-preview read adaptation', () => {
  it('maps a text read and keeps the truncation / script hints', () => {
    const read: FilePreviewRead = {
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

  it('maps missing and error reads', () => {
    expect(toPreviewRead({ path: '/work/x.ts', kind: 'missing' })).toEqual({ kind: 'missing', path: '/work/x.ts' })
    expect(toPreviewRead({ path: '/work/x.ts', kind: 'error', message: 'boom' }))
      .toEqual({ kind: 'error', path: '/work/x.ts', message: 'boom' })
  })
})
