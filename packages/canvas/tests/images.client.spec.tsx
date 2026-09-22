// @vitest-environment jsdom
/**
 * The image read leg (§10.3) on its own, away from any component: the pointer
 * cache's one-read-per-src promise (the renderer asks for the same destination
 * on every paint), what a failed read costs, the LRU bound, and the HTML arm
 * that inlines ONLY a whitelisted pointer. The cache is exercised as the real
 * object the tab subscribes to, over a fake read leg.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  MAX_CACHED_IMAGES, CanvasImageSrcs, base64Of, imageFilesOf, rewriteImageSrcs,
} from '../src/client/images.ts'
import { imageSrcOf } from '../src/image-token.ts'
import type { BoardImageBytesOutcome, CanvasImageRef } from '../src/types.ts'

const REFS: CanvasImageRef = {
  attachmentId: `sha256:${'b'.repeat(64)}`, mediaType: 'image/jpeg', bytes: 8, width: 4, height: 2,
}
const SRC = imageSrcOf(REFS)

/** Let every awaited read land (the cache's read is a promise chain). */
async function settled(): Promise<void> {
  for (let round = 0; round < 6; round += 1) await Promise.resolve()
}

describe('CanvasImageSrcs', () => {
  it('reads once, answers nothing while the bytes are in flight, then answers', async () => {
    const read = vi.fn(async (): Promise<{ ok: true; value: BoardImageBytesOutcome }> =>
      ({ ok: true, value: { ok: true, data: '/9j/4AAQ', mediaType: 'image/jpeg' } }))
    const cache = new CanvasImageSrcs(read)
    // The renderer asks per paint; a miss never starts a second read.
    expect(cache.resolve(SRC)).toBeUndefined()
    expect(cache.resolve(SRC)).toBeUndefined()
    expect(read).toHaveBeenCalledTimes(1)
    expect(cache.source.getSnapshot()).toBe(0)
    await settled()
    expect(cache.resolve(SRC)).toBe('data:image/jpeg;base64,/9j/4AAQ')
    expect(cache.source.getSnapshot()).toBe(1)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('bumps the feed by one per landed image', async () => {
    const cache = new CanvasImageSrcs(async (): Promise<{ ok: true; value: BoardImageBytesOutcome }> =>
      ({ ok: true, value: { ok: true, data: 'AAEC', mediaType: 'image/png' } }))
    const other = imageSrcOf({ ...REFS, mediaType: 'image/png' })
    cache.resolve(SRC)
    cache.resolve(other)
    await settled()
    expect(cache.source.getSnapshot()).toBe(2)
  })

  it('asks the host once for a dead pointer and then stays silent', async () => {
    const read = vi.fn(async (): Promise<{ ok: true; value: BoardImageBytesOutcome }> =>
      ({ ok: true, value: { ok: false, error: 'unreadable' } }))
    const cache = new CanvasImageSrcs(read)
    expect(cache.resolve(SRC)).toBeUndefined()
    await settled()
    expect(cache.resolve(SRC)).toBeUndefined()
    expect(cache.source.getSnapshot()).toBe(0)
    cache.resolve(SRC)
    cache.resolve(SRC)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('treats a transport failure exactly like a missing object', async () => {
    const read = vi.fn(async (): Promise<never> => {
      throw new Error('canvas: the host half is not installed')
    })
    const cache = new CanvasImageSrcs(read as unknown as (ref: CanvasImageRef) => Promise<never>)
    cache.resolve(SRC)
    await settled()
    expect(cache.resolve(SRC)).toBeUndefined()
    expect(cache.source.getSnapshot()).toBe(0)
  })

  it('never reads for a destination that is not a pointer we trust', async () => {
    const read = vi.fn(async (): Promise<{ ok: true; value: BoardImageBytesOutcome }> =>
      ({ ok: true, value: { ok: true, data: 'AAEC', mediaType: 'image/png' } }))
    const cache = new CanvasImageSrcs(read)
    const forged = `attachment://sha256:${'0'.repeat(64)}/../../etc/passwd?mediaType=image/png&bytes=1&width=1&height=1`
    expect(cache.resolve(forged)).toBeUndefined()
    expect(cache.resolve('https://example.org/a.png')).toBeUndefined()
    await settled()
    expect(read).not.toHaveBeenCalled()
  })

  it('drops the least recently used pointer at the bound', async () => {
    const read = vi.fn(async (ref: CanvasImageRef): Promise<{ ok: true; value: BoardImageBytesOutcome }> =>
      ({ ok: true, value: { ok: true, data: ref.bytes.toString(), mediaType: 'image/png' } }))
    const cache = new CanvasImageSrcs(read)
    const srcs = Array.from({ length: MAX_CACHED_IMAGES + 1 }, (_unused, index) =>
      imageSrcOf({ ...REFS, mediaType: 'image/png', bytes: index + 1 }))
    for (const src of srcs) cache.resolve(src)
    await settled()
    expect(cache.resolve(srcs[MAX_CACHED_IMAGES])).toBeDefined()
    // The first pointer is out: the map holds at most the bound, and its reads
    // are re-asked rather than answered from a growing cache.
    expect(read.mock.calls.length).toBe(MAX_CACHED_IMAGES + 1)
    cache.resolve(srcs[0])
    await settled()
    expect(read).toHaveBeenCalledTimes(MAX_CACHED_IMAGES + 2)
  })

  it('gives a fresh vocabulary object every call (that is what repaints the memoized renderer)', () => {
    const cache = new CanvasImageSrcs(async () => {
      throw new Error('unused')
    })
    const first = cache.vocabulary()
    expect(first).not.toBe(cache.vocabulary())
    expect(first.resolve('./not-a-pointer.png')).toBeUndefined()
  })
})

describe('rewriteImageSrcs', () => {
  const resolve = (src: string): string | undefined => (src.startsWith('attachment://') ? 'data:image/png;base64,AAEC' : undefined)

  it('inlines only the pointers it trusts, in any quoting', () => {
    const bare = `<p>x</p><img src=${SRC} alt="a">`
    expect(rewriteImageSrcs(bare, resolve)).toBe(`<p>x</p><img src="data:image/png;base64,AAEC" alt="a">`)
    const single = `<img src='${SRC}'>`
    expect(rewriteImageSrcs(single, resolve)).toBe('<img src="data:image/png;base64,AAEC">')
  })

  it('accepts an escaped pointer, because an HTML author escapes the separators', () => {
    const escaped = SRC.replace(/&/g, '&amp;')
    expect(rewriteImageSrcs(`<img src="${escaped}">`, resolve)).toBe('<img src="data:image/png;base64,AAEC">')
  })

  it('leaves everything else byte-identical, and a name that merely ends in src', () => {
    const untouched = [
      '<img src="https://example.org/a.png">',
      '<img src="./local.png">',
      '<div data-src="attachment://anything">',
      '<img class="pic" src = "x">',
      '<img src="attachment://not-ours-at-all">',
    ]
    for (const html of untouched) expect(rewriteImageSrcs(html, () => undefined)).toBe(html)
  })

  it('keeps the document whole when a read has not landed yet', () => {
    const html = `<h1>t</h1><img src="${SRC}"><p>after</p>`
    let ready = false
    expect(rewriteImageSrcs(html, () => (ready ? 'data:image/png;base64,AAEC' : undefined))).toBe(html)
    ready = true
    expect(rewriteImageSrcs(html, () => 'data:image/png;base64,AAEC')).toContain('<h1>t</h1><img src="data:image/png;base64,AAEC">')
  })
})

describe('imageFilesOf / base64Of', () => {
  it('admits the four raster types and drops the rest', () => {
    const file = (name: string, type: string): File => new File(['x'], name, { type })
    const admitted = imageFilesOf([
      file('a.png', 'image/png'), file('b.gif', 'image/gif'), file('c.svg', 'image/svg+xml'),
      file('d.bin', ''), file('e.pdf', 'application/pdf'),
    ])
    expect(admitted.map(entry => [entry.file.name, entry.mediaType])).toEqual([
      ['a.png', 'image/png'], ['b.gif', 'image/gif'],
    ])
    expect(imageFilesOf(undefined)).toEqual([])
  })

  it('hands the store canonical base64, with no data-URL prefix', async () => {
    expect(await base64Of(new File([new Uint8Array([0, 1, 2])], 'x.png', { type: 'image/png' }))).toBe('AAEC')
    expect(await base64Of(new File([], 'empty.png', { type: 'image/png' }))).toBe('')
  })
})
