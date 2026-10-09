// The demo game the scripted model "writes": 《灯塔守夜人》 — keep the lamp lit,
// walk the gallery with ←/→, catch oil drops, fog creeps in when the lamp dims.
export const INDEX = `<!doctype html>
<meta charset="utf-8">
<title>灯塔守夜人</title>
<style>
  html,body{margin:0;height:100%;background:#0b1020;display:grid;place-items:center;font:13px system-ui;color:#cfd8ff}
  canvas{image-rendering:pixelated;width:min(100vw,160vh);height:auto;background:#0b1020}
  #hud{position:fixed;left:10px;top:8px;letter-spacing:.04em}
</style>
<div id="hud"></div>
<canvas width="320" height="200"></canvas>
<script type="module" src="src/main.js"></script>`

export const RULES_BUGGY = `// Tunable numbers live in elements/; these are the engine's fallbacks.
export const KEEPER_SPEED = 40   // px per second
export const OIL_PER_SECOND = 0.9
export const FOG_SPEED = 6
`
export const RULES_FIXED = RULES_BUGGY.replace('KEEPER_SPEED = 40', 'KEEPER_SPEED = 60')

export const MAIN = `import { KEEPER_SPEED, OIL_PER_SECOND, FOG_SPEED } from './rules.js'
const c = document.querySelector('canvas'), g = c.getContext('2d'), hud = document.getElementById('hud')
const W = 320, H = 200
const s = { t: 0, x: 40, dir: 0, oil: 10, fog: 0, caught: 0, drops: [], seed: 7, over: false }
const rnd = () => (s.seed = (s.seed * 16807) % 2147483647) / 2147483647
const best = Number(localStorage.getItem('best') || 0)
function step(dt) {
  if (s.over) return
  s.t += dt
  s.x = Math.max(8, Math.min(W - 16, s.x + s.dir * KEEPER_SPEED * dt))
  s.oil = Math.max(0, s.oil - OIL_PER_SECOND * dt)
  s.fog = Math.min(1, s.fog + (s.oil < 3 ? FOG_SPEED : -FOG_SPEED) * dt / 60)
  if (rnd() < dt * 0.8) s.drops.push({ x: 12 + rnd() * (W - 24), y: 40 })
  for (const d of s.drops) d.y += 40 * dt
  s.drops = s.drops.filter(d => {
    if (d.y > 150 && d.y < 166 && Math.abs(d.x - s.x - 4) < 10) { s.oil = Math.min(10, s.oil + 2.5); s.caught++; return false }
    return d.y < 170
  })
  if (s.fog >= 1) { s.over = true; if (s.t > best) localStorage.setItem('best', String(Math.floor(s.t))) }
  draw()
}
function px(x, y, w, h, col) { g.fillStyle = col; g.fillRect(Math.round(x), Math.round(y), w, h) }
function draw() {
  px(0, 0, W, H, '#0b1020')
  for (let i = 0; i < 24; i++) px((i * 53) % W, (i * 29) % 90, 1, 1, '#4a5a9a')
  px(0, 170, W, 30, '#12305a')
  for (let i = 0; i < W; i += 8) px(i + (s.t * 10 % 8), 172 + (i % 16 ? 0 : 2), 4, 1, '#2a5c9a')
  px(146, 40, 28, 130, '#c9c2b4'); px(146, 70, 28, 8, '#b33a3a'); px(146, 110, 28, 8, '#b33a3a')
  const lamp = s.oil / 10
  g.fillStyle = 'rgba(255,214,102,' + (0.15 + 0.35 * lamp) + ')'
  g.beginPath(); g.moveTo(160, 34); g.lineTo(0, 10 + 30 * (1 - lamp)); g.lineTo(0, 60); g.closePath(); g.fill()
  px(150, 26, 20, 14, lamp > 0.3 ? '#ffd666' : '#7a6a3a')
  px(0, 160, W, 4, '#6b5b4a')
  for (const d of s.drops) px(d.x, d.y, 4, 5, '#ffb347')
  px(s.x, 146, 8, 10, '#e8e1d0'); px(s.x + 2, 142, 4, 4, '#f2c79b'); px(s.x + (s.dir < 0 ? 0 : 6), 150, 2, 3, '#ffd666')
  g.fillStyle = 'rgba(180,190,220,' + (s.fog * 0.85) + ')'; g.fillRect(0, 0, W, H)
  hud.textContent = (s.over ? '雾吞没了灯塔 · ' : '') + '灯油 ' + s.oil.toFixed(1) + ' · 接住 ' + s.caught + ' · ' + Math.floor(s.t) + ' 秒' + (best ? ' · 最长 ' + best + ' 秒' : '')
}
const keys = {}
function input(key, down) {
  keys[key] = down
  s.dir = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0)
}
addEventListener('keydown', e => input(e.key, true))
addEventListener('keyup', e => input(e.key, false))
let last = performance.now()
function frame(now) { if (!window.__GAMEDEV_TEST__) step(Math.min(0.05, (now - last) / 1000)); last = now; requestAnimationFrame(frame) }
requestAnimationFrame(frame)
draw()
window.dshGame = { ready: true, step, input, state: () => ({ x: s.x, oil: s.oil, fog: s.fog, caught: s.caught, over: s.over, t: s.t }) }
`

export const TEST = `test('按住右键 3 秒，守夜人能走出起点 150px', () => {
  const x0 = game.state().x
  game.input('ArrowRight', true); step(180); game.input('ArrowRight', false)
  assert(game.state().x - x0 >= 150, '3 秒应至少走 150px，实际走了 ' + Math.round(game.state().x - x0))
})
test('灯油会随时间减少', () => {
  const before = game.state().oil
  step(60)
  assert(game.state().oil < before, '1 秒后灯油应变少')
})
`

export const ELEMENTS = JSON.stringify([
  { id: 'keeper', name: '守夜人', type: '角色', speed: 60, carry: 1 },
  { id: 'oil', name: '灯油滴', type: '道具', refill: 2.5, fall: 40 },
  { id: 'fog', name: '雾潮', type: '敌人', speed: 6, from: '灯油 < 3' },
], null, 2)

export const CORE_LOOP = `# 核心循环

- 每 10 秒：左右走动，接住从灯室滴下的灯油，让灯一直亮着。
- 每 1 分钟：灯油越烧越快，雾潮在灯暗下去时逼近。
- 每局：撑到雾吞没灯塔为止，比谁守得更久。

状态：草稿
`
