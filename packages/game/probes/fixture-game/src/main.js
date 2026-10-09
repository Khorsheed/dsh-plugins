import { createWorld } from './engine.js'
const cfg = await (await fetch('data/config.json')).json()
const enemies = await (await fetch('./data/enemies.json')).json()
const hero = new Image()
hero.src = 'assets/hero.png'
await hero.decode()
const lazy = await import('./util/math.js')
const game = createWorld(cfg, enemies, 7)
const cv = document.getElementById('cv'), c = cv.getContext('2d')
function draw() {
  c.clearRect(0, 0, 160, 96)
  c.drawImage(hero, game.world.player.x - 8, game.world.player.y - 8)
  c.fillStyle = '#9fb0d8'
  for (const e of game.world.enemies) c.fillRect(e.x, e.y, 6, 6)
  document.getElementById('oil').textContent = 'oil ' + Math.round(game.world.oil)
}
addEventListener('keydown', e => game.input(e.key, true))
addEventListener('keyup', e => game.input(e.key, false))
window.dshGame = { step: dt => { game.step(dt); draw() }, input: game.input, state: game.state, ready: true, lazyClamp: lazy.clamp(5, 0, 3) }
draw()
if (!window.__GAMEDEV_TEST__) { let last = performance.now(); const loop = now => { game.step(Math.min(0.05, (now - last) / 1000)); last = now; draw(); requestAnimationFrame(loop) }; requestAnimationFrame(loop) }
parent !== window && parent.postMessage({ gamedev: 'ready' }, '*')
window.dispatchEvent(new Event('dshgame-ready'))
