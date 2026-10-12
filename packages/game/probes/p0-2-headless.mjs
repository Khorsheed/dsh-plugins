// P0-2: run the same VFS shell top-level (a data: document is an opaque origin
// too) through capture's exported CaptureBrowserManager; drive a scripted
// playtest with fixed steps; check determinism, error capture, screenshot.
import { shellHtml, readProject } from './vfs-boot.js'
const { CaptureBrowserManager } = await import(process.env.CAPTURE_LIB)
const { mkdtemp } = await import('node:fs/promises')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')

const files = await readProject(new URL('./fixture-game/', import.meta.url).pathname)
const docFor = f => 'data:text/html;base64,' + Buffer.from(
  shellHtml('<script>window.__GAMEDEV_TEST__=true;window.__VFS_FILES__=' + JSON.stringify(f).replace(/</g, '\\u003c') + '</script>')).toString('base64')

const mgr = new CaptureBrowserManager({ stateRoot: await mkdtemp(join(tmpdir(), 'gd-probe-')), executablePath: process.env.CHROME })
async function run(f, script) {
  return mgr.withPage(async page => {
    const t0 = Date.now()
    await page.setViewport({ width: 320, height: 200 })
    await page.goto(docFor(f), { waitUntil: 'load', timeout: 10000 })
    const ready = await page.evaluate(async () => {
      for (let i = 0; i < 50; i++) { if (window.dshGame && window.dshGame.ready) return true; await new Promise(r => setTimeout(r, 40)) }
      return false
    }, null)
    let result = null
    if (ready) { try { result = await page.evaluate(script, null) } catch (e) { result = { thrown: String(e.message).split('\n')[0] } } }
    const errors = await page.evaluate(() => window.__gamedevErrors || [], null)
    const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 320, height: 200 }, type: 'webp', quality: 80, captureBeyondViewport: false, encoding: 'base64' })
    return { ready, result, errors, shotBytes: Buffer.from(shot, 'base64').length, ms: Date.now() - t0 }
  })
}
// Scripted playtest: hold right for 3 s of game time, then read state.
const holdRight = () => { const g = window.dshGame; g.input('ArrowRight', true); for (let i = 0; i < 180; i++) g.step(1 / 60); return g.state() }
const a = await run(files, holdRight)
const b = await run(files, holdRight)
const broken = await run({ ...files, 'src/engine.js': { type: 'text/javascript', text: files['src/engine.js'].text.replace('w.t += dt', 'w.t += dt; if (w.t > 1) undefinedFn()') } }, holdRight)
console.log(JSON.stringify({
  runA: { ready: a.ready, state: a.result, errors: a.errors.length, shotBytes: a.shotBytes, ms: a.ms },
  deterministic: JSON.stringify(a.result) === JSON.stringify(b.result),
  assertion_x_reached_150: a.result && a.result.player.x >= 150,
  broken: { ready: broken.ready, result: broken.result, errors: broken.errors },
}, null, 1))
await mgr.dispose?.()
process.exit(0)
