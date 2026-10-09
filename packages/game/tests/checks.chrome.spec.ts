import { afterAll, describe, expect, it } from 'vitest'
import { ChromeChecker, findChrome } from '../src/checks.ts'
import type { BundleFile } from '../src/types.ts'

/** Real headless runs: skipped on a machine without Chrome. */
const chrome = findChrome()
const checker = new ChromeChecker()
afterAll(async () => { await checker.dispose() })

const text = (t: string): BundleFile => ({ type: t.startsWith('<') ? 'text/html' : 'text/javascript', text: t })
const GAME = `
import { SPEED } from './rules.js'
const s = { x: 0, right: false }
const c = document.querySelector('canvas'), g = c.getContext('2d')
window.dshGame = {
  ready: true,
  step(dt) { if (s.right) s.x += SPEED * dt; g.fillStyle = '#222'; g.fillRect(0, 0, 320, 200); g.fillStyle = '#fc0'; g.fillRect(s.x % 300, 90, 20, 20) },
  input(key, down) { if (key === 'ArrowRight') s.right = down },
  state() { return { x: s.x } },
}`
const files: Record<string, BundleFile> = {
  'index.html': text('<canvas width="320" height="200"></canvas><script type="module" src="src/main.js"></script>'),
  'src/main.js': text(GAME),
  'src/rules.js': text('export const SPEED = 60'),
}

describe.skipIf(chrome === undefined)('headless checks', () => {
  it('gives the game its params, elements and the sprite helper', async () => {
    const result = await checker.run({
      ...files,
      'game.json': { type: 'application/json', text: JSON.stringify({ id: 'g', params: [{ key: 'speed', min: 0, max: 200, value: 120 }] }) },
      'elements/a.json': { type: 'application/json', text: JSON.stringify({ id: 'fog', name: '雾', type: '敌人', look: { palette: ['#ff0000'], states: { idle: ['00', '00'] } } }) },
    }, {
      'tests/runtime.test.js': `test('runtime', () => {
        assert.equal(window.dshParams.speed, 120)
        assert.equal(window.dshElements.fog.name, '雾')
        assert.equal(dshLookSize('fog').w, 2)
        const c = document.createElement('canvas'); c.width = 4; c.height = 4
        assert(dshDraw(c.getContext('2d'), 'fog', 'idle', 0, 0, 2), 'draws')
        assert.equal(c.getContext('2d').getImageData(1, 1, 1, 1).data[0], 255)
      })`,
    })
    expect(result.failures).toEqual([])
    expect(result.passed).toBe(1)
  }, 60_000)

  it('passes a working build and runs its tests', async () => {
    const result = await checker.run(files, {
      'tests/move.test.js': `test('按右 3 秒走 180', () => { game.input('ArrowRight', true); step(180); assert.near(game.state().x, 180, 1) })`,
    })
    expect(result.failures).toEqual([])
    expect(result.passed).toBe(1)
    expect(result.screenshot?.length).toBeGreaterThan(100)
  }, 60_000)

  it('reports failing cases, runtime errors and a game that never gets ready', async () => {
    const failingTest = await checker.run(files, {
      'tests/move.test.js': `test('走得更远', () => { press('ArrowRight', 60); assert(game.state().x > 500, '应超过 500') })`,
    })
    expect(failingTest.failures).toEqual([{ where: 'tests/move.test.js › 走得更远', message: '应超过 500' }])

    const broken = await checker.run({ ...files, 'src/main.js': text(GAME.replace('ready: true', 'ready: true, boom: undefinedFn()')) }, {})
    expect(broken.failures.some(f => f.where === 'smoke' && f.message.includes('就绪'))).toBe(true)
    expect(broken.failures.some(f => f.message.includes('undefinedFn'))).toBe(true)
  }, 60_000)
})
