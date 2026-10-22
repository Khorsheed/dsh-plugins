import { afterAll, describe, expect, it } from 'vitest'
import { ChromeChecker, findChrome } from '../src/checks.ts'
import { withKitRuntime } from '../src/kits/index.ts'
import { THREE_3D } from '../src/kits/three3d.ts'
import type { BundleFile } from '../src/types.ts'

/** A real 3D game through the real check pipeline: skipped on a machine without Chrome. */
const chrome = findChrome()
const checker = new ChromeChecker()
afterAll(async () => { await checker.dispose() })

const text = (t: string, type = 'text/javascript'): BundleFile => ({ type, text: t })
const FOX = {
  kind: 'parts3d', base: 'quadruped',
  proportions: { bodyLength: 1, bodyHeight: 0.45, legLength: 0.35, headSize: 0.32, snout: 0.18 },
  parts: [{ type: 'ear', count: 2 }, { type: 'tail', count: 9, length: 0.95, fan: 140, thickness: 0.09, color: 'accent' }],
  palette: { body: '#e9dfcc', accent: '#b8442f', eye: '#1d1d1f' },
  motion: { tailSway: { amplitude: 18, period: 1.6 }, breath: { amplitude: 0.02, period: 2.4 } },
}
const MAIN = `
import * as THREE from 'three'
import { createWorld, build, ink, flat } from 'dsh3d'
const world = createWorld({ style: 'ink', region: (x, z) => (z > 0 ? '阳坡' : '阴坡') })
world.terrain({ size: 30, segments: 30, height: (x, z) => 0.1 * Math.sin(x * 0.4) })
const fox = world.place(build('jiuweihu'), 0, -2)
world.add(fox, { id: 'jiuweihu', inst: 'fox-1', name: '九尾狐', state: () => '摆尾中' })
const rock = ink(new THREE.DodecahedronGeometry(0.5), flat('#46698a'))
world.add(world.place(rock, 3, -2), { id: 'qinghuo', inst: 'qinghuo-0', name: '青雘' })
world.follow(fox)
window.__fox = fox
window.dshGame = {
  ready: true,
  step: dt => world.step(dt),
  input() {},
  state: () => ({ t: world.time, paused: world.paused, tris: world.stats().triangles }),
  pick: (x, y) => world.pick(x, y),
  pause: on => world.pause(on),
  highlight: list => world.highlight(list),
}
`
const files: Record<string, BundleFile> = {
  'index.html': text('<style>html,body{margin:0}canvas{width:480px;height:320px;display:block}</style><canvas></canvas><script type="module" src="src/main.js"></script>', 'text/html'),
  'src/main.js': text(MAIN),
  'game.json': text(JSON.stringify({ id: 'g', runtime: { kit: '3d-three', version: 1 } }), 'application/json'),
  'elements/fox.json': text(JSON.stringify({ id: 'jiuweihu', name: '九尾狐', type: '异兽', look: FOX }), 'application/json'),
}

describe.skipIf(chrome === undefined)('3d-three kit in headless Chrome', () => {
  it('renders a parts-recipe creature, picks it with a structured reference, and pauses', async () => {
    const result = await checker.run(withKitRuntime(files, THREE_3D), {
      'tests/world.test.js': `
        test('the fox is on screen and picks back as an entity', () => {
          step(30)
          const world = window.dsh3dWorld, c = world.canvas
          const v = window.__fox.position.clone(); v.y += 0.6; v.project(world.camera)
          const ref = game.pick((v.x + 1) / 2 * c.width, (1 - v.y) / 2 * c.height)
          assert.equal(ref && ref.id, 'jiuweihu', 'pick 应认出九尾狐')
          assert.equal(ref.inst, 'fox-1'); assert.equal(ref.state, '摆尾中'); assert.equal(ref.region, '阴坡')
          const ground = game.pick(2, 2)
          assert(ground && ground.ground === true, '角落应是地面')
        })
        test('a creature stays inside the triangle budget', () => {
          assert(game.state().tris < 150000, '场景面数 ' + game.state().tris)
        })
        test('pause freezes time; step still drives tests', () => {
          game.pause(true); assert.equal(game.state().paused, true)
          const t0 = game.state().t; step(10); assert(game.state().t > t0, 'step 仍推进')
          game.highlight([{ id: 'jiuweihu', tone: 'changed' }])
        })`,
    }, { blankProbe: THREE_3D.blankProbe })
    expect(result.skipped).toBeUndefined()
    expect(result.failures).toEqual([])
    expect(result.passed).toBe(3)
    expect(result.screenshot?.length).toBeGreaterThan(100)
  }, 90_000)

  it('takes its style from game.json and builds project-defined bodies and parts', async () => {
    const result = await checker.run(withKitRuntime({
      ...files,
      'game.json': text(JSON.stringify({ id: 'g', runtime: { kit: '3d-three', version: 1 }, artStyle: 'custom:霓虹', style3d: { preset: 'ink', bg: '#0b0b1a', outlineWidth: 0, shades: 2 } }), 'application/json'),
      'elements/fox.json': text(JSON.stringify({ id: 'bot', name: '机器人', type: '角色', look: { kind: 'parts3d', base: 'robot', parts: [{ type: 'antenna', length: 0.5 }], palette: { body: '#22d3ee' }, motion: {} } }), 'application/json'),
      'src/main.js': text(`import { createWorld, build, defineBase, definePart } from 'dsh3d'
        defineBase('robot', (look, kit) => { const g = new kit.THREE.Group(), body = new kit.THREE.Group(); g.add(body)
          const box = kit.ink(new kit.THREE.BoxGeometry(0.8, 0.8, 0.6), kit.toon(kit.color('body', '#888888'))); box.position.y = 0.4; body.add(box); return { g, body } })
        let wiggles = 0
        definePart('antenna', ({ spec, anchors, kit }) => { const a = kit.ink(new kit.THREE.CylinderGeometry(0.03, 0.03, spec.length), kit.toon('#ff00aa')); a.position.y = 1; anchors.body.add(a); return { update: () => { wiggles++ } } })
        const world = createWorld()
        const bot = world.add(world.place(build('bot'), 0, 0), { id: 'bot' })
        world.follow(bot)
        let missing = null
        try { build({ kind: 'parts3d', base: 'ufo', parts: [], palette: {}, motion: {} }) } catch (e) { missing = e.message }
        window.dshGame = { ready: true, step: dt => world.step(dt), input() {}, state: () => ({ bg: '#' + world.scene.background.getHexString(), outline: world.style.outlineWidth, wiggles, missing }) }`),
    }, THREE_3D), {
      'tests/style.test.js': `test('style3d and custom parts', () => {
        step(5)
        const s = game.state()
        assert.equal(s.bg, '#0b0b1a', '背景应来自 style3d')
        assert.equal(s.outline, 0, 'outlineWidth 0 关掉描边')
        assert(s.wiggles >= 5, '自定义部件的动效应每帧运行')
        assert(s.missing && s.missing.includes('defineBase'), '未注册的身体应给出能看懂的错误：' + s.missing)
      })`,
    }, { blankProbe: THREE_3D.blankProbe })
    expect(result.failures).toEqual([])
    expect(result.passed).toBe(1)
  }, 90_000)

  it('flags a 3D game that never draws', async () => {
    const result = await checker.run(withKitRuntime({
      ...files,
      'src/main.js': text(`import { createWorld } from 'dsh3d'
        const world = createWorld({ style: 'ink' })
        window.dshGame = { ready: true, step() {}, input() {}, state: () => ({}) }`),
    }, THREE_3D), {}, { blankProbe: THREE_3D.blankProbe })
    expect(result.failures.some(f => f.message.includes('同一种颜色'))).toBe(true)
  }, 90_000)
})
