/**
 * A drawing as pixels, host-side (card types, P1a): the agent reads a type's
 * brief through `canvas_read_type`, and a model sees an image, not a stroke
 * list. A drawing is stored as strokes (`CanvasStroke[]`), so the tool paints
 * it here — dark ink on white, the drawing's own logical box — and encodes a
 * grayscale PNG the host's attachment store admits like any pasted image.
 *
 * Painting on the host rather than the client keeps the picture in step with
 * the strokes by construction: nothing to upload on save, nothing stale when
 * the brief changes. The shapes are capsules (a round pen along each segment)
 * with a one-pixel soft edge — enough for a model to read a sketch; the
 * on-screen renderer's smoothing is not reproduced.
 *
 * @module @khorsheed/dsh-canvas
 */
import { deflateSync } from 'node:zlib'
import { DRAW_BOX, type CanvasStroke, type CanvasStrokeSize } from './types.ts'

/** Pen radius in box units per stored width (the on-screen pens, roughly). */
const RADIUS: Readonly<Record<CanvasStrokeSize, number>> = { thin: 1.4, medium: 2.4, bold: 4.2 }

/** Ink darkness per colour token: 0 is white, 255 full ink. */
const INK: Readonly<Record<CanvasStroke['color'], number>> = { ink: 235, faint: 130 }

/** One CRC-32 table (PNG chunks carry the IEEE polynomial). */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/**
 * Encode 8-bit grayscale pixels as a PNG.
 * @param gray - `width * height` bytes, row-major, 255 white.
 * @returns the PNG file bytes.
 */
export function encodeGrayPng(gray: Uint8Array, width: number, height: number): Uint8Array {
  const raw = new Uint8Array((width + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0
    raw.set(gray.subarray(y * width, (y + 1) * width), y * (width + 1) + 1)
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header[8] = 8 // bit depth
  header[9] = 0 // grayscale
  const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const parts = [signature, chunk('IHDR', header), chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array(0))]
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** Darken the pixels within `radius` of segment a→b (a round pen, soft edge). */
function paintSegment(
  ink: Uint8Array, width: number, height: number,
  ax: number, ay: number, bx: number, by: number, radius: number, darkness: number,
): void {
  const minX = Math.max(0, Math.floor(Math.min(ax, bx) - radius - 1))
  const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx) + radius + 1))
  const minY = Math.max(0, Math.floor(Math.min(ay, by) - radius - 1))
  const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by) + radius + 1))
  const dx = bx - ax
  const dy = by - ay
  const length2 = dx * dx + dy * dy
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const px = x + 0.5
      const py = y + 0.5
      const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2))
      const distance = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
      const coverage = Math.max(0, Math.min(1, radius + 0.5 - distance))
      if (coverage === 0) continue
      const value = Math.round(darkness * coverage)
      const index = y * width + x
      if (value > ink[index]!) ink[index] = value
    }
  }
}

/**
 * Paint one drawing into a PNG the size of its logical box.
 * @param strokes - the drawing's strokes (box units).
 * @returns the PNG bytes.
 */
export function rasterizeDrawing(strokes: readonly CanvasStroke[]): Uint8Array {
  const { width, height } = DRAW_BOX
  const ink = new Uint8Array(width * height)
  for (const stroke of strokes) {
    const radius = RADIUS[stroke.size ?? 'medium']
    const darkness = INK[stroke.color]
    for (let index = 1; index < stroke.pts.length; index += 1) {
      const a = stroke.pts[index - 1]!
      const b = stroke.pts[index]!
      paintSegment(ink, width, height, a.x, a.y, b.x, b.y, radius, darkness)
    }
  }
  const gray = new Uint8Array(width * height)
  for (let index = 0; index < gray.length; index += 1) gray[index] = 255 - ink[index]!
  return encodeGrayPng(gray, width, height)
}
