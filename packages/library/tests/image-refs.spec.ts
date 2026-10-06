/**
 * Photo references: the tool row remembers what each session's messages
 * carried, and a page resolves from that — never from the model's partial
 * copy (live trial: the id without its prefix, no byte count).
 */
import { describe, expect, it } from 'vitest'
import { ImageRefCache } from '../src/image-refs.ts'

const ref = { attachmentId: 'sha256:5731abc', mediaType: 'image/jpeg', width: 1200, height: 1600, bytes: 368127 }
const message = { type: 'user/message', data: { content: [{ type: 'text', text: '第 16 页' }, { type: 'image', attachment: ref }] } }

describe('ImageRefCache', () => {
  it('resolves a bare or prefixed id, or nothing, to the whole reference', () => {
    const cache = new ImageRefCache()
    cache.observe('s1', message)
    expect(cache.resolve('s1', { attachmentId: '5731abc', mediaType: 'image/jpeg', width: 1134, height: 1512 })).toEqual(ref)
    expect(cache.resolve('s1', 'sha256:5731abc')).toEqual(ref)
    expect(cache.resolve('s1', undefined)).toEqual(ref)
  })

  it('keeps sessions apart and ignores other events', () => {
    const cache = new ImageRefCache()
    cache.observe('s1', message)
    cache.observe('s2', { type: 'assistant/message', data: message.data })
    expect(cache.resolve('s2', undefined)).toBeUndefined()
    expect(cache.resolve('s1', 'other')).toBeUndefined()
  })

  it('passes a complete reference through when it knows nothing better', () => {
    expect(new ImageRefCache().resolve('s1', ref)).toEqual(ref)
    expect(new ImageRefCache().resolve('s1', { ...ref, bytes: 0 })).toBeUndefined()
  })
})
