// @vitest-environment jsdom
/**
 * The worktrees adaptation layer: every key the shared content pane prints must
 * resolve in THIS plugin's dictionary, and the selection's raw read inputs must
 * map onto the kernel's contract without losing the deleted / untracked cases.
 */
import { describe, expect, it } from 'vitest'
import { PREVIEW_KEYS } from '@khorsheed/dsh-client-ui-content-preview/src/client/index.ts'
import { en, zh } from '../src/client/locales.ts'
import {
  absolutePath, isDeleted, previewTranslator, structuredLabels, toPreviewRead,
} from '../src/client/preview.ts'

describe('worktrees preview dictionary', () => {
  it('resolves every key the shared pane prints, in both languages', () => {
    expect(PREVIEW_KEYS.filter(key => (zh as Record<string, string>)[key] === undefined)).toEqual([])
    expect(PREVIEW_KEYS.filter(key => (en as Record<string, string>)[key] === undefined)).toEqual([])
  })

  it('prints through the plugin dictionary, interpolating params', () => {
    const t = ((key: string, params?: Record<string, string | number>) =>
      params === undefined ? key : `${key}:${JSON.stringify(params)}`) as never
    expect(previewTranslator(t)('search.hit', { current: 2, total: 3 })).toBe('search.hit:{"current":2,"total":3}')
  })

  it('builds the structured chrome over the plugin dictionary', () => {
    const labels = structuredLabels(((key: string) => `「${key}」`) as never)
    expect(labels.markdown.footnotes).toBe('「markdown.footnotes」')
    expect(labels.json.copyPath).toBe('「json.copyPath」')
  })
})

describe('worktrees read adaptation', () => {
  const base = { path: 'src/a.ts', deleted: false, untracked: false, error: null, image: null }

  it('maps a text read and keeps the host script hint', () => {
    expect(toPreviewRead({ ...base, content: { content: '<html></html>', htmlScripted: true } }))
      .toEqual({ kind: 'text', path: 'src/a.ts', content: '<html></html>', htmlScripted: true })
  })

  it('reports a deleted file as missing/deleted even when content lingers', () => {
    expect(toPreviewRead({ ...base, deleted: true, content: { content: 'stale' } }))
      .toEqual({ kind: 'missing', path: 'src/a.ts', reason: 'deleted' })
  })

  it('prefers an inline image and reports a fetch failure as error', () => {
    expect(toPreviewRead({ ...base, image: { dataUrl: 'data:image/png;base64,AA', mime: 'image/png' } }))
      .toEqual({ kind: 'image', path: 'src/a.ts', url: 'data:image/png;base64,AA' })
    expect(toPreviewRead({ ...base, error: 'boom' })).toEqual({ kind: 'error', path: 'src/a.ts', message: 'boom' })
  })

  it('resolves null until a fetch lands, and resolves paths against the worktree root', () => {
    expect(toPreviewRead({ ...base, content: null })).toBeNull()
    expect(absolutePath('/repo', 'src/a.ts')).toBe('/repo/src/a.ts')
    expect(absolutePath('/repo/', 'src/a.ts')).toBe('/repo/src/a.ts')
    expect(absolutePath('', 'src/a.ts')).toBe('src/a.ts')
  })

  it('keeps the deleted-status helper the pane used to own', () => {
    expect(isDeleted({ path: 'a', status: 'D' } as never)).toBe(true)
    expect(isDeleted({ path: 'a', status: 'M' } as never)).toBe(false)
    expect(isDeleted(undefined)).toBe(false)
  })
})
