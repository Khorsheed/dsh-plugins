// Writes two tiny PNG fixtures (no deps): a 16×16 hero sprite and a 2×2 tile.
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
const T = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc = b => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }
function png(w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b, a] = px(x, y); raw.set([r, g, b, a], y * (w * 4 + 1) + 1 + x * 4) }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
writeFileSync('fixture-game/assets/hero.png', png(16, 16, (x, y) => (x > 3 && x < 12 && y > 2 && y < 14) ? [246, 231, 161, 255] : [0, 0, 0, 0]))
writeFileSync('fixture-game/assets/tile.png', png(2, 2, (x, y) => (x + y) % 2 ? [29, 43, 34, 255] : [34, 52, 42, 255]))
