// Deterministic core: fixed step, seeded RNG, input map; no DOM.
import { clamp } from './util/math.js'
export function createWorld(cfg, enemies, seed) {
  let s = seed >>> 0
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
  const w = { t: 0, oil: cfg.oil, player: { x: 20, y: 48 }, keys: {}, enemies: enemies.map(e => ({ ...e, x: 60 + rand() * 90, y: rand() * 90 })) }
  return {
    input(key, down) { w.keys[key] = down },
    step(dt) {
      w.t += dt
      const v = cfg.speed * 60 * dt
      if (w.keys.ArrowRight) w.player.x += v
      if (w.keys.ArrowLeft) w.player.x -= v
      w.player.x = clamp(w.player.x, 0, 156)
      w.oil = Math.max(0, w.oil - cfg.drain * dt)
      for (const e of w.enemies) e.x += (rand() - 0.5) * e.speed
    },
    state() { return JSON.parse(JSON.stringify({ t: w.t, oil: w.oil, player: w.player, enemies: w.enemies.length })) },
    world: w,
  }
}
