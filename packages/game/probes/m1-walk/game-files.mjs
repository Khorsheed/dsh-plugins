// The demo game the scripted model "writes": 《灯塔守夜人》 — keep the lamp lit,
// walk the gallery with ←/→, catch oil drops; when the lamp dims, fog
// wraiths drift in. Written against the workbench contracts: tunables in
// game.json params (read from window.dshParams every frame), elements with
// pixel looks (window.dshElements + dshDraw), and dshGame.pick for 点选.
const row = s => s.replace(/ /g, '.')

const KEEPER = {
  palette: ['#1a1c2c', '#f4f4f4', '#ffcd75', '#3b5dc9', '#29366f', '#ef7d57'],
  states: {
    idle: ['....000000....', '...02222220...', '...02122120...', '...02222220...', '....000000....', '...03333330...', '..0333333330..', '..0333333330..', '..0334444330..', '...00000000...', '....04..40....', '....00..00....'].map(row),
    move: ['....000000....', '...02222220...', '...02122120...', '...02222220...', '....000000....', '...03333330...', '..0333333330..', '..0333333330..', '..0334444330..', '...00000000...', '...04....40...', '...00....00...'].map(row),
  },
}
const OIL = {
  palette: ['#1a1c2c', '#ffcd75', '#ef7d57'],
  states: { idle: ['..0..', '.010.', '01110', '01210', '.000.'].map(row) },
}
const FOG = {
  palette: ['#94b0c2', '#f4f4f4', '#1a1c2c', '#566c86'],
  states: {
    idle: ['...0000...', '..000000..', '.00100100.', '.00200200.', '0000000000', '0000330000', '.00000000.', '.0.00.00.0'].map(row),
  },
}

export const ELEMENTS = JSON.stringify([
  { id: 'keeper', name: '守夜人', type: '角色', speed: 60, carry: 1, look: KEEPER },
  { id: 'oil', name: '灯油滴', type: '道具', refill: 2.5, fall: 40, look: OIL },
  { id: 'fog', name: '雾灵', type: '敌人', speed: 14, drain: 1.5, look: FOG },
], null, 2)

export function manifest(id, speed) {
  return JSON.stringify({
    schema: 1, id, title: '灯塔守夜人',
    pitch: '你是孤岛上的守夜人，在雾夜里接住灯油、让灯一直亮着，撑到天亮。',
    elementTypes: ['角色', '道具', '敌人'], artStyle: 'pixel',
    pillars: ['一个人守夜的紧张感', '简单操作，越往后越手忙脚乱', '灯就是生命'],
    autoConfirm: true,
    params: [
      { key: 'speed', label: '移动速度', min: 20, max: 120, step: 1, value: speed, unit: 'px/s' },
      { key: 'burn', label: '耗油/秒', min: 0.2, max: 2, step: 0.1, value: 0.9 },
      { key: 'dropRate', label: '掉油频率', min: 0.2, max: 2, step: 0.1, value: 0.8, unit: '次/s' },
      { key: 'fogSpeed', label: '雾灵速度', min: 4, max: 40, step: 1, value: 14, unit: 'px/s' },
    ],
    palette: ['#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179', '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57'],
    createdAt: new Date().toISOString(),
  }, null, 2)
}

export const INDEX = `<!doctype html>
<meta charset="utf-8">
<title>灯塔守夜人</title>
<style>
  html,body{margin:0;height:100%;background:#0b1020;display:grid;place-items:center;font:13px system-ui;color:#cfd8ff;overflow:hidden}
  canvas{image-rendering:pixelated;width:min(100vw,160vh);height:auto;background:#0b1020}
  #hud{position:fixed;left:10px;top:8px;letter-spacing:.04em;text-shadow:0 1px 0 #000}
</style>
<div id="hud"></div>
<canvas width="320" height="200"></canvas>
<script type="module" src="src/main.js"></script>`

export const MAIN = `const c = document.querySelector('canvas'), g = c.getContext('2d'), hud = document.getElementById('hud')
const W = 320, H = 200, FLOOR = 156
const P = () => window.dshParams
const E = id => window.dshElements[id]
const s = { t: 0, x: 40, dir: 0, oil: 10, caught: 0, drops: [], fog: [], seed: 7, over: false, walk: 0 }
const rnd = () => (s.seed = (s.seed * 16807) % 2147483647) / 2147483647
const best = Number(localStorage.getItem('best') || 0)
function step(dt) {
  if (s.over) return
  s.t += dt; s.walk += dt
  s.x = Math.max(4, Math.min(W - 18, s.x + s.dir * P().speed * dt))
  s.oil = Math.max(0, s.oil - P().burn * dt)
  if (rnd() < dt * P().dropRate) s.drops.push({ x: 12 + rnd() * (W - 24), y: 40 })
  for (const d of s.drops) d.y += (E('oil').fall || 40) * dt
  s.drops = s.drops.filter(d => {
    if (d.y > FLOOR - 16 && d.y < FLOOR && Math.abs(d.x - s.x - 6) < 10) { s.oil = Math.min(10, s.oil + (E('oil').refill || 2.5)); s.caught++; return false }
    return d.y < FLOOR + 4
  })
  if (s.oil < 4 && s.fog.length < 4 && rnd() < dt * 0.6) s.fog.push({ x: rnd() < 0.5 ? -12 : W + 2, y: FLOOR - 26 - rnd() * 40 })
  for (const f of s.fog) { f.x += Math.sign(s.x - f.x) * P().fogSpeed * dt; if (Math.abs(f.x - s.x) < 10) s.oil = Math.max(0, s.oil - (E('fog').drain || 1.5) * dt) }
  if (s.oil > 6) s.fog = s.fog.filter(f => f.x > -20 && f.x < W + 20 && rnd() > dt)
  if (s.oil <= 0) { s.over = true; if (s.t > best) localStorage.setItem('best', String(Math.floor(s.t))) }
  draw()
}
function px(x, y, w, h, col) { g.fillStyle = col; g.fillRect(Math.round(x), Math.round(y), w, h) }
function draw() {
  px(0, 0, W, H, '#0b1020')
  for (let i = 0; i < 28; i++) px((i * 53) % W, (i * 29) % 90, 1, 1, '#4a5a9a')
  px(0, FLOOR + 14, W, 40, '#12305a')
  for (let i = 0; i < W; i += 8) px(i + (s.t * 10 % 8), FLOOR + 16 + (i % 16 ? 0 : 2), 4, 1, '#2a5c9a')
  px(146, 40, 28, FLOOR - 26, '#c9c2b4'); px(146, 70, 28, 8, '#b33a3a'); px(146, 110, 28, 8, '#b33a3a')
  const lamp = s.oil / 10
  g.fillStyle = 'rgba(255,214,102,' + (0.12 + 0.35 * lamp) + ')'
  g.beginPath(); g.moveTo(160, 34); g.lineTo(0, 10 + 30 * (1 - lamp)); g.lineTo(0, 64); g.closePath(); g.fill()
  px(150, 26, 20, 14, lamp > 0.3 ? '#ffd666' : '#7a6a3a')
  px(0, FLOOR, W, 4, '#6b5b4a')
  for (const d of s.drops) dshDraw(g, 'oil', 'idle', d.x, d.y, 1)
  for (const f of s.fog) { g.globalAlpha = 0.85; dshDraw(g, 'fog', 'idle', f.x, f.y + Math.sin(s.t * 3 + f.x) * 2, 1.4); g.globalAlpha = 1 }
  dshDraw(g, 'keeper', s.dir !== 0 && Math.floor(s.walk * 6) % 2 ? 'move' : 'idle', s.x, FLOOR - 12, 1)
  g.fillStyle = 'rgba(180,190,220,' + Math.max(0, 0.6 - lamp) * 0.8 + ')'; g.fillRect(0, 0, W, H)
  hud.textContent = (s.over ? '雾吞没了灯塔 · ' : '') + '灯油 ' + s.oil.toFixed(1) + ' · 接住 ' + s.caught + ' · ' + Math.floor(s.t) + ' 秒' + (best ? ' · 最长 ' + best + ' 秒' : '')
}
function pick(x, y) {
  const hit = (ex, ey, w, h) => x >= ex - 2 && x <= ex + w + 2 && y >= ey - 2 && y <= ey + h + 2
  if (hit(s.x, FLOOR - 12, 14, 12)) return 'keeper'
  for (const f of s.fog) if (hit(f.x, f.y, 14, 12)) return 'fog'
  for (const d of s.drops) if (hit(d.x, d.y, 5, 5)) return 'oil'
  return null
}
const keys = {}
function input(key, down) { keys[key] = down; s.dir = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0) }
addEventListener('keydown', e => input(e.key, true))
addEventListener('keyup', e => input(e.key, false))
let last = performance.now()
function frame(now) { if (!window.__GAMEDEV_TEST__) step(Math.min(0.05, (now - last) / 1000)); else draw(); last = now; requestAnimationFrame(frame) }
s.drops.push({ x: 90, y: 70 }, { x: 230, y: 100 }); s.fog.push({ x: 270, y: 110 })
requestAnimationFrame(frame)
draw()
window.dshGame = { ready: true, step, input, pick, state: () => ({ x: s.x, oil: s.oil, caught: s.caught, over: s.over, t: s.t, fog: s.fog.length }) }
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
test('点选能认出守夜人', () => {
  const st = game.state()
  assert.equal(game.pick(st.x + 6, 150), 'keeper')
})
`

export const CORE_LOOP = `# 核心循环

- 每 10 秒：左右走动，接住从灯室滴下的灯油，让灯一直亮着。
- 每 1 分钟：灯油越烧越快；灯暗下去时，雾灵从两边逼近、吸走灯油。
- 每局：撑到灯灭为止，比谁守得更久。

状态：定稿
`

export const MECHANICS = `# 机制与规则

- 操作：← / → 走动，碰到灯油滴自动接住。
- 灯油上限 10，每秒按「耗油/秒」减少；接住一滴补 2.5。
- 灯油低于 4 时雾灵出现，贴近守夜人时每秒吸走 1.5 灯油；灯油回到 6 以上，雾灵慢慢散去。
- 灯油归零游戏结束，记录最长坚持秒数（存档）。

| 数值 | 默认 | 说明 |
| --- | --- | --- |
| 移动速度 | 60 px/s | 太慢接不到，太快没紧张感 |
| 耗油/秒 | 0.9 | 决定节奏 |
| 雾灵速度 | 14 px/s | 灯暗后的压力 |
`
