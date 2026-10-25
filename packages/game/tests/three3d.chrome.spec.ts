import { afterAll, describe, expect, it } from 'vitest'
import { ChromeChecker, findChrome } from '../src/checks.ts'
import { withKitRuntime } from '../src/kits/index.ts'
import { THREE_3D } from '../src/kits/three3d.ts'
import { PREVIEW_HTML, PREVIEW_ID, PREVIEW_MAIN, PREVIEW_PITCH, PREVIEW_YAW } from '../src/client/preview-entry.ts'
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


/** A tiny binary glTF: a tetrahedron with red vertex colors (12 vertices, no indices), sitting on y = 0. */
function tetraGlb(): string {
  const v = [[0, 1.2, 0], [-0.6, 0, -0.4], [0.6, 0, -0.4], [0, 0, 0.7]]
  const faces = [[0, 1, 2], [0, 2, 3], [0, 3, 1], [1, 3, 2]]
  const pos = new Float32Array(faces.flatMap(f => f.flatMap(i => v[i]!)))
  const col = new Float32Array(pos.length).map((_, i) => (i % 3 === 0 ? 0.9 : 0.15))
  const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(col.buffer)])
  const json = JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, COLOR_0: 1 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0 } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.byteLength }, { buffer: 0, byteOffset: pos.byteLength, byteLength: col.byteLength }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 12, type: 'VEC3', min: [-0.6, 0, -0.4], max: [0.6, 1.2, 0.7] },
      { bufferView: 1, componentType: 5126, count: 12, type: 'VEC3' },
    ],
  })
  const pad = (b: Buffer, fill: number): Buffer => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)])
  const j = pad(Buffer.from(json), 0x20), b = pad(bin, 0)
  const head = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8)
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + 8 + b.length, 8)
  jh.writeUInt32LE(j.length, 0); jh.writeUInt32LE(0x4e4f534a, 4)
  bh.writeUInt32LE(b.length, 0); bh.writeUInt32LE(0x004e4942, 4)
  return Buffer.concat([head, jh, j, bh, b]).toString('base64')
}


/** A skinned glTF: the tetrahedron bound to one bone, with clips 'idle' and 'walk' that turn the bone a quarter around y over 1 s. */
function skinnedGlb(): string {
  const v = [[0, 1.2, 0], [-0.6, 0, -0.4], [0.6, 0, -0.4], [0, 0, 0.7]]
  const faces = [[0, 1, 2], [0, 2, 3], [0, 3, 1], [1, 3, 2]]
  const parts: Buffer[] = []
  const views: { buffer: 0; byteOffset: number; byteLength: number }[] = []
  let offset = 0
  const view = (b: Buffer): number => { parts.push(b); views.push({ buffer: 0, byteOffset: offset, byteLength: b.length }); offset += b.length; return views.length - 1 }
  const f32 = (a: number[]): Buffer => Buffer.from(new Float32Array(a).buffer)
  const pos = view(f32(faces.flatMap(f => f.flatMap(i => v[i]!))))
  const joints = view(Buffer.from(new Uint8Array(12 * 4)))
  const weights = view(f32(Array.from({ length: 12 }, () => [1, 0, 0, 0]).flat()))
  const ibm = view(f32([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]))
  const times = view(f32([0, 1]))
  const rots = view(f32([0, 0, 0, 1, 0, Math.SQRT1_2, 0, Math.SQRT1_2]))
  const smile = view(f32(faces.flatMap(f => f.flatMap(i => (i === 0 ? [0, 0.5, 0] : [0, 0, 0])))))
  const bin = Buffer.concat(parts)
  const sampler = { input: 4, output: 5, interpolation: 'LINEAR' }
  const json = JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 1] }],
    nodes: [{ name: 'body', mesh: 0, skin: 0 }, { name: 'bone' }],
    skins: [{ joints: [1], inverseBindMatrices: 3 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 }, targets: [{ POSITION: 6 }], material: 0 }], weights: [0], extras: { targetNames: ['smile'] } }],
    materials: [{ name: '袍', pbrMetallicRoughness: { baseColorFactor: [0.8, 0.3, 0.2, 1], metallicFactor: 0 } }],
    animations: [
      { name: 'idle', channels: [{ sampler: 0, target: { node: 1, path: 'rotation' } }], samplers: [sampler] },
      { name: 'walk', channels: [{ sampler: 0, target: { node: 1, path: 'rotation' } }], samplers: [sampler] },
    ],
    buffers: [{ byteLength: bin.length }], bufferViews: views,
    accessors: [
      { bufferView: pos, componentType: 5126, count: 12, type: 'VEC3', min: [-0.6, 0, -0.4], max: [0.6, 1.2, 0.7] },
      { bufferView: joints, componentType: 5121, count: 12, type: 'VEC4' },
      { bufferView: weights, componentType: 5126, count: 12, type: 'VEC4' },
      { bufferView: ibm, componentType: 5126, count: 1, type: 'MAT4' },
      { bufferView: times, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
      { bufferView: rots, componentType: 5126, count: 2, type: 'VEC4' },
      { bufferView: smile, componentType: 5126, count: 12, type: 'VEC3', min: [0, 0, 0], max: [0, 0.5, 0] },
    ],
  })
  const pad = (b: Buffer, fill: number): Buffer => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)])
  const j = pad(Buffer.from(json), 0x20), b = pad(bin, 0)
  const head = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8)
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + 8 + b.length, 8)
  jh.writeUInt32LE(j.length, 0); jh.writeUInt32LE(0x4e4f534a, 4)
  bh.writeUInt32LE(b.length, 0); bh.writeUInt32LE(0x004e4942, 4)
  return Buffer.concat([head, jh, j, bh, b]).toString('base64')
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

  it('loads a glTF look: toon over vertex colors with an outline, or its own materials; checks wait for it; pick finds it', async () => {
    const result = await checker.run(withKitRuntime({
      ...files,
      'assets/tetra.glb': { type: 'model/gltf-binary', b64: tetraGlb() },
      'elements/models.json': text(JSON.stringify([
        { id: 'tetra', name: '四面体', type: '道具', look: { kind: 'gltf', src: 'assets/tetra.glb', scale: 1.5 } },
        { id: 'plain', name: '原样', type: '道具', look: { kind: 'gltf', src: 'assets/tetra.glb', material: 'original' } },
      ]), 'application/json'),
      'src/main.js': text(`import { createWorld, build } from 'dsh3d'
        const world = createWorld()
        world.terrain({ size: 30, height: () => 0 })
        const tetra = world.add(world.place(build('tetra'), 0, 0), { id: 'tetra', name: '四面体' })
        const plain = world.add(world.place(build('plain'), 3, 0), { id: 'plain' })
        world.follow(tetra)
        const meshes = o => { const out = []; o.traverse(m => { if (m.isMesh) out.push(m) }); return out }
        // Ready at once: the checks themselves must wait for the models.
        window.dshGame = { ready: true, step: dt => world.step(dt), input() {}, pick: (x, y) => world.pick(x, y),
          state: () => {
            const t = meshes(tetra), p = meshes(plain)
            const body = t.find(m => !m.userData.outline)
            return { tMeshes: t.length, toon: body?.material?.isMeshToonMaterial === true, vertexColors: body?.material?.vertexColors === true,
              outlined: t.some(m => m.userData.outline), plainStd: p[0]?.material?.isMeshStandardMaterial === true, plainOutlined: p.some(m => m.userData.outline) }
          } }`),
    }, THREE_3D), {
      'tests/model.test.js': `
        test('the model is loaded before the test runs, toon-shaded over its vertex colors, with an outline', () => {
          const s = game.state()
          assert(s.tMeshes >= 2, '模型应已加载：' + JSON.stringify(s))
          assert(s.toon && s.vertexColors, '应是保留顶点色的卡通材质：' + JSON.stringify(s))
          assert(s.outlined, '卡通着色应带描边')
          assert(s.plainStd && !s.plainOutlined, 'original 应保留原材质、不描边：' + JSON.stringify(s))
        })
        test('pick finds the loaded model', () => {
          const world = window.dsh3dWorld, c = world.canvas
          world.render()
          const v = new world.THREE.Vector3(0, 0.5, 0).project(world.camera)
          const ref = game.pick((v.x + 1) / 2 * c.width, (1 - v.y) / 2 * c.height)
          assert(ref && ref.id === 'tetra', '应点中四面体：' + JSON.stringify(ref))
        })`,
    }, { blankProbe: THREE_3D.blankProbe })
    expect(result.failures).toEqual([])
    expect(result.passed).toBe(2)
  }, 90_000)

  it('reports a model that fails to load, and falls back instead of crashing', async () => {
    const result = await checker.run(withKitRuntime({
      ...files,
      'src/main.js': text(`import { createWorld, build } from 'dsh3d'
        const world = createWorld()
        world.terrain({ size: 30, height: () => 0 })
        world.follow(world.add(build({ kind: 'gltf', src: 'assets/missing.glb' }), { id: 'ghost' }))
        window.dshGame = { ready: true, step: dt => world.step(dt), input() {}, state: () => ({}) }`),
    }, THREE_3D), {}, { blankProbe: THREE_3D.blankProbe })
    expect(result.failures.some(f => f.message.includes('assets/missing.glb'))).toBe(true)
  }, 90_000)

  it('walks up a staircase onto a platform, never onto the roof above, and forgets walkables with their scene', async () => {
    const result = await checker.run(withKitRuntime({
      ...files,
      'src/main.js': text(`import * as THREE from 'three'
        import { createWorld, flat } from 'dsh3d'
        const world = createWorld()
        world.terrain({ size: 40, height: () => 0 })
        const box = (w, h, d, x, y, z, opts) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), flat('#8a7a66')); m.position.set(x, y, z); return world.add(m, opts) }
        world.enterScene('village', w => {
          // Three steps of 0.3 up to a 1.2 m platform; a roof floats 3 m up over the platform.
          for (let i = 0; i < 3; i++) box(1, 0.3 * (i + 1), 2, 1 + i, 0.15 * (i + 1), 0, { id: 'stair', walkable: true })
          box(4, 1.2, 4, 5.5, 0.6, 0, { id: 'platform', walkable: true })
          box(4, 0.2, 4, 6, 4.2, 0, { id: 'roof', walkable: true })
          box(1, 2, 1, -3, 1, 0, { id: 'crate' })
        })
        const player = { x: 0, y: 0 }
        window.dshGame = { ready: true, input() {}, step: dt => world.step(dt), state: () => ({ ...player }),
          walk: (dx, n) => { for (let i = 0; i < n; i++) { const nx = player.x + dx; const y = world.groundAt(nx, 0, player.y + 0.4); player.x = nx; player.y = y } },
          groundAt: (x, z, from) => world.groundAt(x, z, from),
          leave: () => world.enterScene('field', w => { w.terrain({ size: 20, height: () => 0 }) }) }`),
    }, THREE_3D), {
      'tests/walk.test.js': `
        test('climbs the stairs onto the platform', () => {
          game.walk(0.1, 70)
          assert.near(game.state().y, 1.2, 1e-3, '应站在 1.2 米的平台上，实际 ' + game.state().y)
        })
        test('the roof above does not pull the walker up; asking without a ceiling finds it', () => {
          assert.near(game.groundAt(6, 0, 1.6), 1.2, 1e-3)
          assert.near(game.groundAt(6, 0), 4.3, 1e-3)
        })
        test('an object not marked walkable is not ground', () => {
          assert.near(game.groundAt(-3, 0, 5), 0, 1e-3)
        })
        test('leaving the scene forgets its walkables', () => {
          game.leave()
          assert.near(game.groundAt(6, 0), 0, 1e-3)
        })`,
    }, { blankProbe: THREE_3D.blankProbe })
    expect(result.failures).toEqual([])
    expect(result.passed).toBe(4)
  }, 90_000)

  it('plays a glTF character\'s skeletal animation, outlines it with the bones, and picks it', async () => {
    const result = await checker.run(withKitRuntime({
      ...files,
      'assets/rig.glb': { type: 'model/gltf-binary', b64: skinnedGlb() },
      'elements/rig.json': text(JSON.stringify({ id: 'rig', name: '木偶', type: '角色', look: { kind: 'gltf', src: 'assets/rig.glb' } }), 'application/json'),
      'src/main.js': text(`import { createWorld, build } from 'dsh3d'
        const world = createWorld()
        world.terrain({ size: 30, height: () => 0 })
        const rig = world.add(world.place(build('rig'), 0, 0), { id: 'rig', name: '木偶' })
        world.follow(rig)
        const bone = () => { let b = null; rig.traverse(o => { if (o.isBone) b = o }); return b }
        window.dshGame = { ready: true, input() {}, step: dt => world.step(dt), pick: (x, y) => world.pick(x, y),
          play: name => rig.userData.play(name) !== null,
          state: () => { let skinnedHull = false; rig.traverse(o => { skinnedHull = skinnedHull || (o.isSkinnedMesh && o.userData.outline === true) })
            return { clips: rig.userData.animations, turn: bone()?.quaternion.y ?? 0, skinnedHull } } }`),
    }, THREE_3D), {
      'tests/anim.test.js': `
        test('the idle clip plays on its own and the outline rides the bones', () => {
          const before = game.state().turn
          step(30)
          const s = game.state()
          assert.equal(JSON.stringify(s.clips), JSON.stringify(['idle', 'walk']))
          assert(s.turn > before + 0.1, '骨骼应在转动：' + JSON.stringify(s))
          assert(s.skinnedHull, '描边应是跟着骨骼的蒙皮网格')
        })
        test('play switches clips; pick finds the posed character', () => {
          assert(game.play('walk'), 'play(walk) 应返回动作')
          step(10)
          const world = window.dsh3dWorld, c = world.canvas
          world.render()
          const v = new world.THREE.Vector3(0, 0.5, 0).project(world.camera)
          const ref = game.pick((v.x + 1) / 2 * c.width, (1 - v.y) / 2 * c.height)
          assert(ref && ref.id === 'rig', '应点中木偶：' + JSON.stringify(ref))
        })`,
    }, { blankProbe: THREE_3D.blankProbe })
    expect(result.failures).toEqual([])
    expect(result.passed).toBe(2)
  }, 90_000)

  it('ready-made follow camera, rim light, swaying scatter, and the bloom recipe through three/addons', async () => {
    const result = await checker.run(withKitRuntime({
      ...files,
      'game.json': text(JSON.stringify({ id: 'g', runtime: { kit: '3d-three', version: 1 }, style3d: { preset: 'ink', rim: 0.8, rimColor: '#ffeecc' } }), 'application/json'),
      'elements/grass.json': text(JSON.stringify({ id: 'grass', name: '草', type: '山水', look: { kind: 'parts3d', base: 'blade', parts: [], palette: { body: '#5a7a4a' }, motion: {} } }), 'application/json'),
      'src/main.js': text(`import * as THREE from 'three'
        import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
        import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
        import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
        import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
        import { createWorld, build, defineBase, toon } from 'dsh3d'
        defineBase('blade', (look, kit) => { const g = new kit.THREE.Group(), body = new kit.THREE.Group(); g.add(body)
          const c = kit.ink(new kit.THREE.ConeGeometry(0.08, 0.6, 4), kit.toon(kit.color('body', '#557744'))); c.position.y = 0.3; body.add(c); return { g, body } })
        const world = createWorld()
        world.terrain({ size: 30, height: () => 0 })
        const fox = world.add(world.place(build('jiuweihu'), 0, 0), { id: 'jiuweihu', inst: 'fox-1' })
        world.scatter('grass', 40, { seed: 3, spread: 10, sway: { amplitude: 0.1, period: 2 } })
        const lantern = world.add(world.place(new THREE.Mesh(new THREE.SphereGeometry(0.3), toon('#ffaa44', { own: true, emissive: '#ffaa44' })), 2, 0), { id: 'lantern' })
        const rig = world.followCamera({ target: fox, distance: 6 })
        const composer = new EffectComposer(world.renderer)
        composer.addPass(new RenderPass(world.scene, world.camera))
        composer.addPass(new UnrealBloomPass(new THREE.Vector2(640, 400), 0.6, 0.4, 0.85))
        composer.addPass(new OutputPass())
        let bloomed = 0
        world.onRender(() => { bloomed++; composer.render() })
        const grass = world.scene.children.find(o => o.userData.scatter)
        window.dshGame = { ready: true, input() {}, step: dt => world.step(dt), pick: (x, y) => world.pick(x, y), look: (dx, dy) => rig.look(dx, dy),
          state: () => ({ yaw: rig.yaw, camZ: world.camera.position.z, perspective: world.camera === rig.camera, bloomed,
            rim: fox.children.length > 0 && (() => { let r = false; fox.traverse(o => { if (o.material?.customProgramCacheKey?.() === 'dsh3d-rim') r = true }); return r })(),
            sway: grass.children.some(o => o.material?.userData?.sway?.amplitude === 0.1) }) }`),
    }, THREE_3D), {
      'tests/conv.test.js': `
        test('the follow camera sits behind the target and turns with a drag', () => {
          step(2)
          const s0 = game.state()
          assert(s0.perspective, '应在用跟随镜头')
          assert(s0.camZ > 3, '默认应在目标后方（z 为正）：' + s0.camZ)
          drag(200, 0, 2)
          assert(game.state().yaw < -0.5, '拖动应转动跟随镜头：' + game.state().yaw)
        })
        test('pick follows the follow camera', () => {
          const world = window.dsh3dWorld, c = world.canvas
          world.render()
          const v = new world.THREE.Vector3(0, 0.4, 0).project(world.camera)
          const ref = game.pick((v.x + 1) / 2 * c.width, (1 - v.y) / 2 * c.height)
          assert(ref && ref.id === 'jiuweihu', '应点中九尾狐：' + JSON.stringify(ref))
        })
        test('rim light, swaying grass and the bloom pass are in place', () => {
          window.dsh3dWorld.render()
          const s = game.state()
          assert(s.rim, '卡通材质应带轮廓光'); assert(s.sway, '草应带随风摆'); assert(s.bloomed > 0, '泛光应接管绘制')
        })`,
    }, { blankProbe: THREE_3D.blankProbe })
    expect(result.failures).toEqual([])
    expect(result.passed).toBe(3)
  }, 90_000)

  it('previews a look from the front three-quarter in perspective, honors its own angle, and turns to a side on request', async () => {
    const page = (look: unknown, mode: string): Record<string, BundleFile> => withKitRuntime({
      ...files,
      'index.html': text(PREVIEW_HTML, 'text/html'),
      '_preview/main.js': text(PREVIEW_MAIN),
      '_preview/mode.json': text(JSON.stringify({ mode }), 'application/json'),
      [`elements/${PREVIEW_ID}.json`]: text(JSON.stringify({ id: PREVIEW_ID, name: PREVIEW_ID, type: 'preview', look }), 'application/json'),
    }, THREE_3D)
    const still = await checker.run(page(FOX, 'still'), {
      'tests/view.test.js': `test('default view', () => {
        const s = game.state()
        assert.equal(s.yaw, ${PREVIEW_YAW}); assert.equal(s.pitch, ${PREVIEW_PITCH})
        assert(s.perspective, '应是透视镜头'); assert(s.radius > 0.5 && s.focusY > 0.1, JSON.stringify(s))
        const cam = window.dsh3dWorld.camera.position
        assert(cam.x > 0 && cam.y > s.focusY, '应从正面偏上方看：' + JSON.stringify(cam))
      })`,
    }, { blankProbe: THREE_3D.blankProbe })
    expect(still.failures).toEqual([])
    const own = await checker.run(page({ ...FOX, preview: { yaw: 0, pitch: 5 } }, 'spin'), {
      'tests/own.test.js': `test('own angle, then a side', async () => {
        assert.near(game.state().yaw, 0, 5, '转盘从自己的角度开始慢慢转'); assert.equal(game.state().pitch, 5)
        window.postMessage({ gamedev: 'preview-view', yaw: 180 }, '*')
        await new Promise(r => setTimeout(r, 50))
        assert.equal(game.state().yaw, 180); assert.equal(game.state().spinning, false)
      })`,
    }, { blankProbe: THREE_3D.blankProbe })
    expect(own.failures).toEqual([])
    expect(own.passed).toBe(1)
  }, 90_000)

  it('tunes a glTF look by name — tint, bone size and rotation over the animation, shape keys with the outline — and retunes live', async () => {
    const result = await checker.run(withKitRuntime({
      ...files,
      'assets/rig.glb': { type: 'model/gltf-binary', b64: skinnedGlb() },
      'elements/rig.json': text(JSON.stringify({ id: 'rig', name: '木偶', type: '角色', look: {
        kind: 'gltf', src: 'assets/rig.glb', tint: { 袍: '#00ff00' }, bones: { bone: { scale: 2, rotate: [10, 0, 0] } }, morphs: { smile: 1 },
      } }), 'application/json'),
      'src/main.js': text(`import { createWorld, build } from 'dsh3d'
        const world = createWorld()
        world.terrain({ size: 30, height: () => 0 })
        const rig = world.add(world.place(build('rig'), 0, 0), { id: 'rig' })
        const find = test => { let r = null; rig.traverse(o => { if (!r && test(o)) r = o }); return r }
        window.dshGame = { ready: true, input() {}, step: dt => world.step(dt),
          retune: look => rig.userData.retune(look),
          state: () => {
            const body = find(o => o.isSkinnedMesh && !o.userData.outline), hull = find(o => o.isSkinnedMesh && o.userData.outline), bone = find(o => o.isBone)
            return { color: '#' + body.material.color.getHexString(), scale: bone.scale.x, rotX: bone.rotation.x, smile: body.morphTargetInfluences[0],
              hullShares: hull.morphTargetInfluences === body.morphTargetInfluences, parts: rig.userData.parts() }
          } }`),
    }, THREE_3D), {
      'tests/tune.test.js': `
        test('the look tunes the model, and the animation does not wash it out', () => {
          step(45)
          const s = game.state()
          assert.equal(s.color, '#00ff00')
          assert.near(s.scale, 2, 1e-6, '骨头放大应稳定在 2 倍（不随帧累加）')
          assert.near(s.smile, 1, 1e-6); assert(s.hullShares, '描边应和模型共用形态键权重')
          assert.equal(JSON.stringify(s.parts.materials.map(m => m.name)), JSON.stringify(['袍']))
          assert.equal(JSON.stringify(s.parts.bones), JSON.stringify(['bone'])); assert.equal(JSON.stringify(s.parts.morphs), JSON.stringify(['smile']))
        })
        test('retune applies new values in place and restores what was dropped', () => {
          game.retune({ kind: 'gltf', src: 'assets/rig.glb', morphs: { smile: 0.25 } })
          step(2)
          const s = game.state()
          assert(s.color !== '#00ff00', '去掉 tint 应回到原色：' + s.color)
          assert.near(s.scale, 1, 1e-6, '去掉骨头调整应回到原大小'); assert.near(s.smile, 0.25, 1e-6)
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
