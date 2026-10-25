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
        test('a highlight sent before the game exists is applied once it appears', async () => {
          const game0 = window.dshGame, seen = []
          delete window.dshGame
          window.postMessage({ gamedev: 'highlight', list: [{ id: 'jiuweihu', tone: 'added' }] }, '*')
          await new Promise(r => setTimeout(r, 50))
          window.dshGame = { ...game0, highlight: list => { seen.push(list); game0.highlight(list) } }
          await new Promise(r => setTimeout(r, 400))
          assert.equal(seen.length, 1, '游戏出现后应补上一次 highlight')
          assert.equal(seen[0][0].tone, 'added')
        })
        test('pause freezes time; step still drives tests', () => {
          game.pause(true); assert.equal(game.state().paused, true)
          const t0 = game.state().t; step(10); assert(game.state().t > t0, 'step 仍推进')
          game.highlight([{ id: 'jiuweihu', tone: 'changed' }])
        })`,
    }, { blankProbe: THREE_3D.blankProbe })
    expect(result.skipped).toBeUndefined()
    expect(result.failures).toEqual([])
    expect(result.passed).toBe(4)
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

  it('switches scenes cleanly, scatters pickable copies on the ground, and never renders inside the checks', async () => {
    const PINE = { kind: 'parts3d', base: 'pine', proportions: { height: 1.6 }, parts: [], palette: { body: '#3f5a45' }, motion: {} }
    const result = await checker.run(withKitRuntime({
      ...files,
      'game.json': text(JSON.stringify({ id: 'g', runtime: { kit: '3d-three', version: 1 }, style3d: { preset: 'ink', scenes: { 北山: { bg: '#cfd6dc', fog: [10, 30] }, 南山: { bg: '#e8efd8' } } } }), 'application/json'),
      'elements/pine.json': text(JSON.stringify({ id: 'songlin', name: '墨松', type: '山水', look: PINE }), 'application/json'),
      'src/main.js': text(`import { createWorld, build, defineBase } from 'dsh3d'
        defineBase('pine', (look, kit) => { const g = new kit.THREE.Group(), body = new kit.THREE.Group(); g.add(body)
          const h = look.proportions?.height ?? 1.5
          const cone = kit.ink(new kit.THREE.ConeGeometry(0.5, h, 7), kit.flat(kit.color('body', '#335533'))); cone.position.y = h / 2; body.add(cone); return { g, body } })
        const world = createWorld()
        let renders = 0
        const draw = world.renderer.render.bind(world.renderer)
        world.renderer.render = (a, b) => { renders++; draw(a, b) }
        const player = world.add(world.place(build('jiuweihu'), 0, 0), { id: 'jiuweihu', inst: 'player' })
        let northTicks = 0
        world.enterScene('北山', w => {
          w.terrain({ size: 30, segments: 30, height: (x, z) => 0.3 * Math.sin(x * 0.5) })
          w.scatter('songlin', 12, { seed: 7, spread: 20 })
          w.onUpdate(() => { northTicks++ })
          w.add(w.place(build('jiuweihu'), 4, 4), { id: 'jiuweihu', inst: 'north-fox' })
        })
        window.__north = { bg: '#' + world.scene.background.getHexString(), fog: world.scene.fog.far, entities: world.stats().entities }
        const pines = world.scene.getObjectByName('scene:北山').children.find(o => o.userData.scatter)
        window.__pines = pines
        window.dshGame = {
          ready: true, step: dt => world.step(dt), input() {},
          pick: (x, y) => world.pick(x, y),
          state: () => ({ renders, northTicks, scene: world.sceneName, bg: '#' + world.scene.background.getHexString(),
            entities: world.stats().entities, grounds: world.scene.children.filter(o => o.userData.ground).length,
            sceneGroups: world.scene.children.filter(o => o.name.startsWith('scene:')).length, playerKept: world.scene.children.includes(player) }),
          south: () => world.enterScene('南山', w => { w.terrain({ size: 20, height: () => 0 }) }),
        }`),
    }, THREE_3D), {
      'tests/scenes.test.js': `
        test('inside the checks step advances logic without rendering', () => {
          const before = game.state().renders
          step(30)
          assert.equal(game.state().renders, before, '检查里 step 不应渲染')
          assert(game.state().northTicks >= 30, '北山的 onUpdate 应在跑')
        })
        test('scattered copies sit on the terrain and pick back as the element', () => {
          const world = window.dsh3dWorld, c = world.canvas, pines = window.__pines.children[0]
          const m = new world.THREE.Matrix4(), p = new world.THREE.Vector3()
          pines.getMatrixAt(3, m); p.setFromMatrixPosition(m)
          // The copy's matrix carries the cone's own lift (0.8 × its random size 0.85–1.15) above the ground.
          const lift = p.y - world.heightAt(p.x, p.z)
          assert(lift > 0.8 * 0.85 - 1e-4 && lift < 0.8 * 1.15 + 1e-4, '第 4 棵应落在地面上，离地 ' + lift)
          world.follow(null); world.camera.zoom = 1
          const v = p.clone(); v.y += 0.8; world.render(); v.project(world.camera)
          const ref = game.pick((v.x + 1) / 2 * c.width, (1 - v.y) / 2 * c.height)
          assert(ref && ref.id === 'songlin', '应认出墨松：' + JSON.stringify(ref))
          assert(/^songlin#\\d+$/.test(ref.inst), '应带实例编号：' + ref.inst)
          assert.equal(ref.name, '墨松'); assert.equal(ref.scene, '北山')
        })
        test('a scene takes its style from style3d.scenes', () => {
          assert.equal(window.__north.bg, '#cfd6dc'); assert.equal(window.__north.fog, 30)
        })
        test('entering the next scene frees the last one and keeps what lives outside scenes', () => {
          const ticks = game.state().northTicks
          game.south()
          step(10)
          const s = game.state()
          assert.equal(s.scene, '南山'); assert.equal(s.bg, '#e8efd8')
          assert.equal(s.northTicks, ticks, '北山的 onUpdate 应停掉')
          assert.equal(s.entities, 1, '只剩玩家：' + s.entities)
          assert.equal(s.grounds, 1, '地面只有一块'); assert.equal(s.sceneGroups, 1)
          assert(s.playerKept, '场景外的玩家应保留')
        })`,
    }, { blankProbe: THREE_3D.blankProbe })
    expect(result.failures).toEqual([])
    expect(result.passed).toBe(4)
    expect(result.screenshot?.length).toBeGreaterThan(100)
  }, 90_000)

  it('opens the doors: three add-ons, its own camera, lights and shadows, a render hook, own materials, loading and drag', async () => {
    const result = await checker.run(withKitRuntime({
      ...files,
      'game.json': text(JSON.stringify({ id: 'g', runtime: { kit: '3d-three', version: 1 }, style3d: { preset: 'ink', shadows: true } }), 'application/json'),
      'src/main.js': text(`import * as THREE from 'three'
        import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
        import { createWorld, build, toon } from 'dsh3d'
        window.dshGame = { ready: false, loading: true }
        const world = createWorld()
        world.terrain({ size: 30, height: () => 0 })
        const merged = mergeGeometries([new THREE.BoxGeometry(1, 1, 1), new THREE.BoxGeometry(1, 1, 1).translate(0, 1, 0)])
        const tower = world.add(world.place(new THREE.Mesh(merged, toon('#8a5a3c')), 3, 0), { id: 'tower', name: '塔' })
        const fox = world.add(world.place(build('jiuweihu'), 0, 0), { id: 'jiuweihu', inst: 'fox-1' })
        const cam = new THREE.PerspectiveCamera(50, 1.6, 0.1, 200)
        let yaw = 0, hooked = 0
        world.setCamera(cam)
        world.onUpdate(() => { cam.position.set(Math.sin(yaw) * 9, 6, Math.cos(yaw) * 9); cam.lookAt(1.5, 0.5, 0) })
        world.onRender(({ renderer, scene, camera }) => { hooked++; renderer.render(scene, camera) })
        const shared = toon('#ff0000'), own = toon('#ff0000', { own: true, emissive: '#ff0000' })
        setTimeout(() => {
          Object.assign(window.dshGame, {
            ready: true, loading: false, step: dt => world.step(dt), input() {},
            look: (dx) => { yaw += dx * 0.01 },
            pick: (x, y) => world.pick(x, y),
            state: () => ({ hooked, yaw, perspective: world.camera.isPerspectiveCamera, ownApart: own !== shared && own !== toon('#ff0000'),
              shadowMap: world.renderer.shadowMap.enabled, sunCasts: world.lights.sun.castShadow,
              towerCasts: tower.castShadow, foxCasts: (() => { let c = false; fox.traverse(o => { if (o.isMesh && !o.userData.outline) c = c || o.castShadow }); return c })() }),
          })
        }, 5000)`),
    }, THREE_3D), {
      'tests/doors.test.js': `
        test('drag turns the game camera; pick follows it', () => {
          drag(40, 0, 2)
          assert(game.state().yaw > 0.3, '拖动应转动镜头')
          const world = window.dsh3dWorld, c = world.canvas
          world.render()
          const v = new world.THREE.Vector3(3, 0.6, 0).project(world.camera)
          const ref = game.pick((v.x + 1) / 2 * c.width, (1 - v.y) / 2 * c.height)
          assert(ref && ref.id === 'tower', '透视镜头下应点中塔：' + JSON.stringify(ref))
        })
        test('lights, shadows, the render hook and own materials', () => {
          const s = game.state()
          assert(s.perspective, '应在用游戏自己的透视镜头')
          assert(s.shadowMap && s.sunCasts && s.towerCasts && s.foxCasts, '投影应打开：' + JSON.stringify(s))
          assert(s.hooked > 0, 'onRender 应接管绘制')
          assert(s.ownApart, 'own 材质应是独立的一份')
        })`,
    }, { blankProbe: THREE_3D.blankProbe })
    expect(result.failures).toEqual([])
    expect(result.passed).toBe(2)
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
