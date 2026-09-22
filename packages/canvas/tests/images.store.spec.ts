/**
 * The image arm's host half (§10.3): the store is the one place that touches
 * `ctx.attachments`, so this is where the two contracts get pinned — the
 * five fields a card must carry for the host's read-time comparison, and the
 * folding of the host's long admission vocabulary into the four codes the
 * client can act on. The store itself is a fake: the real one decodes pixels
 * and enforces gates the host owns, and this package must not re-implement
 * either (inventing a second byte cap would only disagree with the host's).
 */
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { CanvasBoardService } from '../src/store.ts'
import type { CanvasImageRef } from '../src/types.ts'

const STATE = '/state'
/** One canonical base64 of the bytes 0x00 0x01 0x02. */
const DATA = 'AAEC'
const REF: CanvasImageRef = {
  attachmentId: `sha256:${'c'.repeat(64)}`, mediaType: 'image/webp', bytes: 3, width: 4, height: 2,
}

/** One host store: what it was asked to save, and what it hands back on read. */
function attachBench(
  store: {
    saveImage?: (...args: never[]) => Promise<unknown>
    readImage?: (...args: never[]) => Promise<unknown>
  } | undefined,
): { board: CanvasBoardService; get: ReturnType<typeof vi.fn> } {
  const get = vi.fn((key: string): unknown => (key === 'attachments' ? store : undefined))
  // `fs` is what the constructor probes for a confining backend; no image verb
  // ever touches it, so an empty fake is the whole of what this arm needs.
  const ctx = { fs: {}, get } as unknown as Context
  return { board: new CanvasBoardService(ctx, { stateRoot: STATE }), get }
}

describe('CanvasBoardService.attachImage', () => {
  it('says unavailable when the deployment mounts no attachment store', async () => {
    const { board, get } = attachBench(undefined)
    await expect(board.attachImage({ data: DATA, mediaType: 'image/png' }))
      .resolves.toEqual({ ok: false, error: 'unavailable' })
    expect(get).toHaveBeenCalledWith('attachments')
  })

  it('hands the store decoded bytes and the five fields back verbatim', async () => {
    const saveImage = vi.fn(async () => REF)
    const { board } = attachBench({ saveImage })
    await expect(board.attachImage({ data: DATA, mediaType: 'image/webp', name: '截图.png' }))
      .resolves.toEqual({ ok: true, ref: REF })
    const [request] = saveImage.mock.calls[0] as [{ data: Uint8Array; mediaType: string; name: string }]
    expect([...request.data]).toEqual([0, 1, 2])
    expect(request).toMatchObject({ mediaType: 'image/webp', name: '截图.png' })
  })

  it('leaves the name out of the call rather than sending an empty one', async () => {
    const saveImage = vi.fn(async () => REF)
    const { board } = attachBench({ saveImage })
    await board.attachImage({ data: DATA, mediaType: 'image/webp' })
    expect(saveImage.mock.calls[0]![0]).not.toHaveProperty('name')
  })

  it('refuses an empty payload before it reaches the store', async () => {
    const saveImage = vi.fn(async () => REF)
    const { board } = attachBench({ saveImage })
    await expect(board.attachImage({ data: '', mediaType: 'image/png' }))
      .resolves.toEqual({ ok: false, error: 'not-image' })
    expect(saveImage).not.toHaveBeenCalled()
  })

  it('folds the host\'s admission codes into the four the client reports', async () => {
    for (const [code, error] of [
      ['IMAGE_TOO_LARGE', 'too-large'],
      ['TOO_MANY_IMAGES', 'too-large'],
      ['UNSUPPORTED_IMAGE_TYPE', 'not-image'],
      ['INVALID_IMAGE', 'not-image'],
      ['ATTACHMENT_CORRUPT', 'unreadable'],
      ['SOMETHING_NEW', 'unavailable'],
    ] as const) {
      const saveImage = vi.fn(async () => {
        throw Object.assign(new Error(code), { code })
      })
      const { board } = attachBench({ saveImage })
      await expect(board.attachImage({ data: DATA, mediaType: 'image/png' }))
        .resolves.toEqual({ ok: false, error })
    }
  })

  it('reports a store that throws with no code as unavailable', async () => {
    const saveImage = vi.fn(async (): Promise<never> => {
      throw new Error('no store behind this one')
    })
    const { board } = attachBench({ saveImage })
    await expect(board.attachImage({ data: DATA, mediaType: 'image/png' }))
      .resolves.toEqual({ ok: false, error: 'unavailable' })
  })
})

describe('CanvasBoardService.imageBytes', () => {
  it('rebuilds the reference the host compares, and returns canonical base64', async () => {
    const readImage = vi.fn(async (ref: CanvasImageRef) => ({ ref, data: new Uint8Array([0, 1, 2]) }))
    const { board } = attachBench({ readImage })
    await expect(board.imageBytes({ ref: REF })).resolves.toEqual({
      ok: true, data: DATA, mediaType: 'image/webp',
    })
    // All five fields travel: the host re-hashes and re-derives them, so a
    // card from another deployment fails its comparison instead of rendering
    // something else.
    expect(readImage.mock.calls[0]![0]).toEqual(REF)
  })

  it('folds a read failure the same way, and never leaks the host error', async () => {
    const readImage = vi.fn(async () => {
      throw Object.assign(new Error('gone'), { code: 'ATTACHMENT_NOT_FOUND' })
    })
    const { board } = attachBench({ readImage })
    await expect(board.imageBytes({ ref: REF })).resolves.toEqual({ ok: false, error: 'unreadable' })
  })

  it('says unavailable with no store, and does not read', async () => {
    const readImage = vi.fn(async () => REF)
    const { board } = attachBench(undefined)
    await expect(board.imageBytes({ ref: REF })).resolves.toEqual({ ok: false, error: 'unavailable' })
    expect(readImage).not.toHaveBeenCalled()
  })
})
