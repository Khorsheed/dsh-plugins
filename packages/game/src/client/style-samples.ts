/**
 * The art-style gallery's samples: one small scene (a keeper, a lamp post, a
 * blob creature, the ground) drawn in each built-in style from that style's
 * own palette, so the user compares looks on the same subject. Pure canvas
 * drawing; colors are the style's content, not theme tokens.
 */
import { ART_STYLES } from '../types.ts'

type G = CanvasRenderingContext2D

/** Deterministic jitter for the hand-drawn style. */
function jitter(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return (x - Math.floor(x)) - 0.5
}

/** A pixel sprite from rows, drawn with `cell`-px blocks. */
function sprite(g: G, rows: readonly string[], colors: Readonly<Record<string, string>>, x: number, y: number, cell: number): void {
  rows.forEach((row, ry) => [...row].forEach((ch, rx) => {
    const c = colors[ch]
    if (c === undefined) return
    g.fillStyle = c
    g.fillRect(x + rx * cell, y + ry * cell, cell, cell)
  }))
}

const KEEPER = ['..hh..', '.hhhh.', '..ff..', '.cccc.', 'cccccc', '.cccc.', '.c..c.', '.b..b.']
const BLOB = ['..eeee..', '.eeeeee.', 'eeyeeyee', 'eeeeeeee', 'eeemmeee', '.eeeeee.', 'e.e..e.e']

/** Draw the sample scene for one style into a W×H canvas. */
export function drawStyleSample(g: G, styleId: string, w: number, h: number): void {
  const p = (ART_STYLES.find(s => s.id === styleId) ?? ART_STYLES[0]!).palette
  const ground = h * 0.74
  g.save()
  g.clearRect(0, 0, w, h)
  switch (styleId) {
    case 'pixel': {
      g.fillStyle = p[15]!; g.fillRect(0, 0, w, h)
      for (let i = 0; i < 14; i++) { g.fillStyle = p[13]!; g.fillRect((i * 37) % w, (i * 23) % (ground * 0.6), 2, 2) }
      g.fillStyle = p[7]!; g.fillRect(0, ground, w, h - ground)
      for (let x = 0; x < w; x += 8) { g.fillStyle = p[6]!; g.fillRect(x, ground, 4, 4) }
      g.fillStyle = p[14]!; g.fillRect(w * 0.72, ground - 52, 6, 52)
      g.fillStyle = p[4]!; g.fillRect(w * 0.72 - 4, ground - 60, 14, 10)
      sprite(g, KEEPER, { h: p[2]!, f: p[4]!, c: p[9]!, b: p[0]! }, w * 0.22, ground - 32, 4)
      sprite(g, BLOB, { e: p[13]!, y: p[4]!, m: p[0]! }, w * 0.46, ground - 28, 4)
      break
    }
    case 'flat': {
      g.fillStyle = p[6]!; g.fillRect(0, 0, w, h)
      g.fillStyle = p[3]!; g.beginPath(); g.arc(w * 0.82, h * 0.22, 14, 0, Math.PI * 2); g.fill()
      g.fillStyle = p[1]!; g.beginPath(); g.roundRect(0, ground, w, h - ground, 0); g.fill()
      g.fillStyle = p[0]!; g.beginPath(); g.roundRect(w * 0.7, ground - 54, 8, 54, 4); g.fill()
      g.fillStyle = p[3]!; g.beginPath(); g.arc(w * 0.7 + 4, ground - 58, 9, 0, Math.PI * 2); g.fill()
      g.fillStyle = p[5]!; g.beginPath(); g.roundRect(w * 0.2, ground - 30, 22, 30, 8); g.fill()
      g.fillStyle = p[4]!; g.beginPath(); g.arc(w * 0.2 + 11, ground - 38, 9, 0, Math.PI * 2); g.fill()
      g.fillStyle = p[7]!; g.beginPath(); g.ellipse(w * 0.5, ground - 14, 18, 14, 0, 0, Math.PI * 2); g.fill()
      g.fillStyle = p[6]!; g.beginPath(); g.arc(w * 0.5 - 6, ground - 17, 3, 0, Math.PI * 2); g.arc(w * 0.5 + 6, ground - 17, 3, 0, Math.PI * 2); g.fill()
      break
    }
    case 'line': {
      g.fillStyle = p[1]!; g.fillRect(0, 0, w, h)
      g.strokeStyle = p[0]!; g.lineWidth = 1.6; g.lineCap = 'round'
      const wobble = (pts: [number, number][], fill?: string) => {
        g.beginPath()
        pts.forEach(([x, y], i) => { const jx = x + jitter(i + x) * 1.6, jy = y + jitter(i + y) * 1.6; if (i === 0) g.moveTo(jx, jy); else g.lineTo(jx, jy) })
        if (fill) { g.fillStyle = fill; g.fill() }
        g.stroke()
      }
      wobble([[0, ground], [w, ground + 2]])
      wobble([[w * 0.7, ground], [w * 0.7, ground - 54], [w * 0.7 + 8, ground - 54], [w * 0.7 + 8, ground]], p[5])
      wobble([[w * 0.2, ground], [w * 0.2, ground - 28], [w * 0.2 + 20, ground - 28], [w * 0.2 + 20, ground]], p[4])
      g.beginPath(); g.arc(w * 0.2 + 10, ground - 37, 9, 0, Math.PI * 2); g.fillStyle = p[2]!; g.fill(); g.stroke()
      g.beginPath(); g.ellipse(w * 0.5, ground - 13, 17, 13, 0, 0, Math.PI * 2); g.fillStyle = p[6]!; g.fill(); g.stroke()
      g.fillStyle = p[0]!; g.fillRect(w * 0.5 - 7, ground - 16, 3, 3); g.fillRect(w * 0.5 + 4, ground - 16, 3, 3)
      break
    }
    case 'neon': {
      g.fillStyle = p[0]!; g.fillRect(0, 0, w, h)
      g.strokeStyle = p[1]!; g.lineWidth = 1
      for (let x = 0; x < w; x += 16) { g.beginPath(); g.moveTo(x, ground); g.lineTo(w / 2 + (x - w / 2) * 2, h); g.stroke() }
      const glow = (color: string, draw: () => void) => { g.shadowColor = color; g.shadowBlur = 10; g.strokeStyle = color; g.lineWidth = 2; draw(); g.shadowBlur = 0 }
      glow(p[3]!, () => { g.beginPath(); g.moveTo(0, ground); g.lineTo(w, ground); g.stroke() })
      glow(p[5]!, () => { g.strokeRect(w * 0.7, ground - 54, 8, 54); g.beginPath(); g.arc(w * 0.7 + 4, ground - 60, 6, 0, Math.PI * 2); g.stroke() })
      glow(p[2]!, () => { g.strokeRect(w * 0.2, ground - 28, 20, 28); g.beginPath(); g.arc(w * 0.2 + 10, ground - 36, 7, 0, Math.PI * 2); g.stroke() })
      glow(p[4]!, () => { g.beginPath(); g.ellipse(w * 0.5, ground - 13, 16, 12, 0, 0, Math.PI * 2); g.stroke() })
      break
    }
    case 'paper': {
      g.fillStyle = p[0]!; g.fillRect(0, 0, w, h)
      for (let i = 0; i < 60; i++) { g.fillStyle = p[1]!; g.globalAlpha = 0.25; g.fillRect((i * 53) % w, (i * 29) % h, 3, 1) }
      g.globalAlpha = 1
      const cut = (color: string, draw: () => void, angle = 0) => {
        g.save(); g.rotate(angle); g.shadowColor = 'rgba(60,40,20,0.35)' /* the paper style's own cast shadow */; g.shadowBlur = 4; g.shadowOffsetY = 2
        g.fillStyle = color; draw(); g.restore()
      }
      cut(p[4]!, () => { g.fillRect(0, ground, w, h - ground) })
      cut(p[5]!, () => { g.beginPath(); g.ellipse(w * 0.3, ground + 4, 60, 14, 0, 0, Math.PI * 2); g.fill() })
      cut(p[7]!, () => { g.fillRect(w * 0.7, ground - 54, 8, 54) }, 0.01)
      cut(p[2]!, () => { g.beginPath(); g.arc(w * 0.7 + 4, ground - 58, 9, 0, Math.PI * 2); g.fill() })
      cut(p[6]!, () => { g.fillRect(w * 0.2, ground - 28, 20, 28) }, -0.02)
      cut(p[2]!, () => { g.beginPath(); g.arc(w * 0.2 + 10, ground - 36, 8, 0, Math.PI * 2); g.fill() })
      cut(p[3]!, () => { g.beginPath(); g.ellipse(w * 0.5, ground - 12, 16, 12, 0, 0, Math.PI * 2); g.fill() })
      break
    }
    default: {
      g.fillStyle = p[1]!; g.fillRect(0, 0, w, h)
      g.fillStyle = p[0]!; g.fillRect(0, ground, w, 3)
      g.fillRect(w * 0.7, ground - 54, 6, 54)
      g.fillStyle = p[2]!; g.beginPath(); g.arc(w * 0.7 + 3, ground - 58, 7, 0, Math.PI * 2); g.fill()
      g.fillStyle = p[0]!; g.fillRect(w * 0.2, ground - 28, 16, 28); g.beginPath(); g.arc(w * 0.2 + 8, ground - 35, 7, 0, Math.PI * 2); g.fill()
      g.strokeStyle = p[0]!; g.lineWidth = 2; g.beginPath(); g.ellipse(w * 0.5, ground - 12, 15, 11, 0, 0, Math.PI * 2); g.stroke()
    }
  }
  g.restore()
}
