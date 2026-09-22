/**
 * The card-held image pointer (§10.3): one line carries the five fields the
 * host re-derives when it reads the object back, so THIS parser is the read
 * side's whole safety boundary — everything it refuses stays inert alt text
 * and never becomes a request (risk ⑬: the attachment scheme is the only
 * destination a card may ever reach).
 */
import { describe, expect, it } from 'vitest'
import { imageHtmlOf, imageMarkdownOf, imageRefOf, imageSrcOf, isImageSrc } from '../src/image-token.ts'
import type { CanvasImageRef } from '../src/types.ts'

const REF: CanvasImageRef = {
  attachmentId: `sha256:${'a'.repeat(64)}`,
  mediaType: 'image/webp',
  bytes: 1234,
  width: 40,
  height: 30,
}
const SRC = imageSrcOf(REF)

describe('imageSrcOf / imageRefOf', () => {
  it('spells a pointer that reads back as the same reference', () => {
    expect(SRC).toBe(`attachment://sha256:${'a'.repeat(64)}?mediaType=image/webp&bytes=1234&width=40&height=30`)
    expect(imageRefOf(SRC)).toEqual(REF)
  })

  it('takes the four fields in any order', () => {
    const reordered = SRC.replace('?mediaType=image/webp&bytes=1234&width=40&height=30', '?height=30&width=40&mediaType=image/webp&bytes=1234')
    expect(imageRefOf(reordered)).toEqual(REF)
  })

  it('refuses every destination that is not our own scheme', () => {
    for (const src of [
      'https://example.org/a.png',
      'attachment:/sha256:missing-slash',
      './local.png',
      '/home/user/a.png',
      'data:image/png;base64,AAEC',
      '',
    ]) {
      expect(isImageSrc(src)).toBe(false)
      expect(imageRefOf(src)).toBeUndefined()
    }
  })

  it('refuses a pointer it cannot fully account for', () => {
    const id = `sha256:${'a'.repeat(64)}`
    for (const src of [
      // A digest of the wrong shape (the host's own id pattern).
      'attachment://sha256:beef?mediaType=image/png&bytes=1&width=1&height=1',
      // Missing, duplicated, or extra fields: the read compares all four.
      `attachment://${id}?mediaType=image/png&bytes=1&width=1`,
      `attachment://${id}?mediaType=image/png&bytes=1&bytes=2&width=1&height=1`,
      `attachment://${id}?mediaType=image/png&bytes=1&width=1&height=1&evil=1`,
      // A query or fragment past the one the parser owns.
      `attachment://${id}?mediaType=image/png&bytes=1&width=1&height=1#x`,
      `attachment://${id}?mediaType=image/png?bytes=1&width=1&height=1`,
      // A media type outside the four the arm stores.
      `attachment://${id}?mediaType=image/svg%2Bxml&bytes=1&width=1&height=1`,
      // Sizes the host could never have written: zero, signed, decimal, huge.
      `attachment://${id}?mediaType=image/png&bytes=0&width=1&height=1`,
      `attachment://${id}?mediaType=image/png&bytes=-1&width=1&height=1`,
      `attachment://${id}?mediaType=image/png&bytes=1.5&width=1&height=1`,
      `attachment://${id}?mediaType=image/png&bytes=999999999999999999999&width=1&height=1`,
      // A wall of digits is refused before it is parsed.
      `attachment://${id}?mediaType=image/png&bytes=${'9'.repeat(600)}&width=1&height=1`,
    ]) {
      expect(imageRefOf(src)).toBeUndefined()
    }
  })
})

describe('imageMarkdownOf / imageHtmlOf', () => {
  it('writes the markdown line, with the display name as cleaned alt text', () => {
    expect(imageMarkdownOf(REF, '截图 [v1]\n最终')).toBe(`![截图  v1  最终](${SRC})`)
    expect(imageMarkdownOf(REF, '').length).toBe(`![](${SRC})`.length)
  })

  it('caps a long display name instead of trusting it', () => {
    expect(imageMarkdownOf(REF, 'x'.repeat(500))).toContain(`${'x'.repeat(120)}](`)
  })

  it('writes the tag form an HTML card understands, and it reads back the same pointer', () => {
    const line = imageHtmlOf(REF, 'a"b<script>')
    expect(line).toBe(`<img src="${SRC}" alt="a b script">`)
    // The attribute's raw separators are what the parser accepts again.
    expect(imageRefOf(line.slice(`<img src="`.length, line.length - `" alt="a b script">`.length))).toEqual(REF)
  })
})
