/**
 * dsh3d — the 3d-three kit's thin runtime (proposal 2026-10-21-game-3d §4.2).
 *
 * Served into the game sandbox as `_dsh/dsh3d.js`; games import createWorld,
 * build and friends from the bare name dsh3d (the loader maps it). It sits on
 * three.js and gives a game four things:
 *
 * - `build(look)`: a `parts3d` recipe → a model with procedural motion.
 * - Styles as data: toon shading bands, an inverted-hull outline, background,
 *   ground and fog colors. `ink` and `qinglv` are starting presets; a game's
 *   own `game.json` `style3d` (written from the user's description) overrides
 *   any key. A restyle swaps only this.
 * - Open vocabulary: `defineBase(name, fn)` / `definePart(type, fn)` let a
 *   project add bodies and parts the built-ins do not cover.
 * - `createWorld()`: the 45° orthographic camera, the loop (`step(dt)` for
 *   tests, `start()` for play), terrain, entity registry, scenes
 *   (`enterScene`: terrain, the scene's own style overrides and everything
 *   registered inside, released together on the next switch) and `scatter`
 *   (one element instanced across the ground, still pickable).
 * - The workbench hooks: `pick(x, y)` returns a structured reference for the
 *   panel's 「指一下」, `pause(on)` freezes time, `highlight(list)` rings the
 *   entities a candidate version changed.
 *
 * Inside the workbench's checks (`window.__GAMEDEV_TEST__`) `step` advances
 * logic and the camera but never draws; `render()` draws on demand (the smoke probe
 * calls it), so a long test stays cheap.
 *
 * Plain ES module, no build step: what is here is what runs. Never spell an
 * import statement in a comment here: the sandbox loader rewrites import
 * specifiers textually, so a quoted example would be rewritten too.
 */
import * as THREE from 'three'

export { THREE }

/* ------------------------------------------------------------------ styles */

/** The preset 3D styles (starting points, not the full set). Colors are sRGB hex. */
export const STYLES = {
  ink: {
    label: '水墨', bg: '#efe7d6', fog: [26, 62], ground: '#e5dbc5', ground2: '#d6c9ac', water: '#a7bab4',
    outline: '#2a2622', outlineWidth: 0.032, hemi: ['#fffaf0', '#c9bda4', 1.4], sun: 1.1,
  },
  qinglv: {
    label: '青绿山水', bg: '#f1e8cf', fog: [28, 66], ground: '#d9d9b0', ground2: '#c3cc96', water: '#77a9bb',
    outline: '#4f3b28', outlineWidth: 0.022, hemi: ['#fff8e6', '#b8c49a', 1.4], sun: 1.2,
  },
}

let style = STYLES.ink
const materials = new Map()
let outlineMaterial = null

const gradients = new Map()
/** A toon ramp with `shades` bands (2 = hard cel … 5 = soft). */
function gradientFor(shades) {
  const n = Math.min(5, Math.max(2, Math.round(shades || 3)))
  if (!gradients.has(n)) {
    const data = new Uint8Array(n * 4)
    for (let i = 0; i < n; i++) { const v = Math.round(105 + 150 * i / (n - 1)); data.set([v, v, v, 255], i * 4) }
    const t = new THREE.DataTexture(data, n, 1)
    t.minFilter = t.magFilter = THREE.NearestFilter
    t.needsUpdate = true
    gradients.set(n, t)
  }
  return gradients.get(n)
}

/**
 * Resolve a style: a preset name, or an object of overrides on a preset
 * (`{ preset: 'ink', bg: '#…', outline: '#…', outlineWidth, shades, fog: [near, far], light }`).
 */
export function resolveStyle(input) {
  const spec = typeof input === 'string' ? { preset: input } : (input ?? {})
  const base = STYLES[spec.preset] ?? STYLES.ink
  const out = { ...base }
  for (const key of ['bg', 'ground', 'ground2', 'water', 'outline', 'outlineWidth', 'shades', 'shadows', 'rim', 'rimColor']) if (spec[key] !== undefined) out[key] = spec[key]
  if (Array.isArray(spec.fog) && spec.fog.length === 2) out.fog = spec.fog
  if (typeof spec.light === 'number') out.sun = spec.light
  return out
}

/** Switch the active style (call before building; `createWorld` does it for you). */
export function useStyle(input) {
  style = resolveStyle(input)
  materials.clear()
  outlineMaterial?.dispose()
  outlineMaterial = null
  return style
}

/** The style a game asked for in game.json: its `style3d`, else a preset named by `artStyle`, else ink. */
function manifestStyle() {
  const m = window.dshManifest ?? {}
  if (m.style3d && typeof m.style3d === 'object') return m.style3d
  return typeof m.artStyle === 'string' && STYLES[m.artStyle] ? m.artStyle : 'ink'
}

/** The active style. */
export function currentStyle() { return style }

/**
 * The style's rim light (style3d `rim`, `rimColor`) on a toon material: a
 * bright edge where the surface turns away from the camera, which lifts a
 * character off the ground. No rim in the style leaves the material as it is.
 */
function rimmed(material) {
  const strength = num(style.rim, 0)
  if (strength <= 0) return material
  const color = new THREE.Color(style.rimColor ?? '#ffffff')
  material.onBeforeCompile = shader => {
    shader.uniforms.rimStrength = { value: strength }
    shader.uniforms.rimColor = { value: color }
    shader.fragmentShader = 'uniform float rimStrength; uniform vec3 rimColor;\n' + shader.fragmentShader.replace('#include <dithering_fragment>',
      'float rimF = 1.0 - max(dot(normalize(normal), normalize(vViewPosition)), 0.0);\ngl_FragColor.rgb += rimColor * rimStrength * pow(rimF, 3.0);\n#include <dithering_fragment>')
  }
  material.customProgramCacheKey = () => 'dsh3d-rim'
  return material
}

/**
 * Toon-shaded material for a color (cached: every caller with the same color
 * and extras shares one). `{ own: true }` gives a private copy instead — for
 * one object to glow, flash or fade without touching the rest.
 */
export function toon(color, extra) {
  if (extra?.own) { const { own, ...rest } = extra; return rimmed(new THREE.MeshToonMaterial({ color, gradientMap: gradientFor(style.shades), ...rest })) }
  const key = `t${color}${extra ? JSON.stringify(extra) : ''}`
  if (!materials.has(key)) materials.set(key, rimmed(new THREE.MeshToonMaterial({ color, gradientMap: gradientFor(style.shades), ...extra })))
  return materials.get(key)
}

/** Flat-shaded material for terrain, rocks and trees (cached; `{ own: true }` gives a private copy). */
export function flat(color, extra) {
  if (extra?.own) { const { own, ...rest } = extra; return new THREE.MeshLambertMaterial({ color, flatShading: true, ...rest }) }
  const key = `f${color}${extra ? JSON.stringify(extra) : ''}`
  if (!materials.has(key)) materials.set(key, new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra }))
  return materials.get(key)
}

function outline() {
  outlineMaterial ??= new THREE.ShaderMaterial({
    uniforms: { c: { value: new THREE.Color(style.outline) }, w: { value: style.outlineWidth } },
    // One hull for every case: USE_INSTANCING (scatter's copies), USE_SKINNING (a glTF
    // character's bones) and USE_MORPHTARGETS (its shape keys) come from three's own chunks,
    // which compile to nothing otherwise.
    vertexShader: [
      '#include <common>', '#include <morphtarget_pars_vertex>', '#include <skinning_pars_vertex>', 'uniform float w;', 'void main(){',
      '#include <morphinstance_vertex>', '#include <beginnormal_vertex>', '#include <morphnormal_vertex>', '#include <skinbase_vertex>', '#include <skinnormal_vertex>',
      '#include <begin_vertex>', '#include <morphtarget_vertex>', '#include <skinning_vertex>',
      'vec4 p = vec4(transformed, 1.0); vec3 nn = objectNormal;',
      '#ifdef USE_INSTANCING', 'p = instanceMatrix * p; nn = mat3(instanceMatrix) * nn;', '#endif',
      'vec4 mv = modelViewMatrix * p; vec3 n = normalize(normalMatrix * nn); mv.xyz += n * w; gl_Position = projectionMatrix * mv; }',
    ].join('\n'),
    fragmentShader: 'uniform vec3 c; void main(){ gl_FragColor = vec4(c,1.0); }',
    side: THREE.BackSide,
  })
  return outlineMaterial
}

/**
 * A mesh with the style's ink outline (an inverted hull: plain geometry, so
 * it also survives a glTF export unchanged).
 */
export function ink(geometry, material, withOutline = true) {
  const mesh = new THREE.Mesh(geometry, material)
  if (withOutline && style.outlineWidth > 0) {
    const hull = new THREE.Mesh(geometry, outline())
    hull.raycast = () => {}
    hull.userData.outline = true
    mesh.add(hull)
  }
  return mesh
}

/* ---------------------------------------------------------------- builders */

const deg = THREE.MathUtils.degToRad
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** A palette key or `#hex` → color, with a fallback. */
function colorOf(look, key, fallback) {
  if (typeof key === 'string' && key.startsWith('#')) return key
  return look.palette?.[key] ?? fallback
}

function partsOf(look, type) { return (look.parts ?? []).filter(p => p.type === type) }

function sphere(r, seg = 14) { return new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.6))) }

/**
 * A tail chain (three bendable segments) per tail, fanned around the body
 * axis. Returns the segment groups for the sway animation.
 */
function addTails(anchor, look, spec, bodyColor) {
  const n = num(spec.count, 1), fan = deg(num(spec.fan, n > 1 ? 120 : 0)), L = num(spec.length, 0.9) / 3
  const thick = num(spec.thickness, 0.09)
  const tipColor = colorOf(look, spec.color ?? 'accent', bodyColor)
  const chains = []
  for (let i = 0; i < n; i++) {
    const fanG = new THREE.Group()
    fanG.rotation.x = n > 1 ? -fan / 2 + fan * i / (n - 1) : 0
    anchor.add(fanG)
    const tilt = new THREE.Group()
    tilt.rotation.z = 0.95
    fanG.add(tilt)
    let parent = tilt
    const segs = []
    for (let k = 0; k < 3; k++) {
      const seg = new THREE.Group()
      seg.position.y = k === 0 ? 0 : L
      if (k > 0) seg.rotation.z = -0.32
      parent.add(seg)
      const rb = thick * [0.7, 1.2, 1.0][k], rt = thick * [1.2, 1.0, 0.25][k]
      const mat = toon(k === 2 ? tipColor : bodyColor)
      const m = ink(new THREE.CylinderGeometry(rt, rb, L, 9, 1, true), mat)
      m.position.y = L / 2
      seg.add(m, ink(sphere(rb, 9), mat))
      segs.push(seg)
      parent = seg
    }
    chains.push(segs)
  }
  return chains
}

/** A pair (or more) of flat wings on a pivot, for the flap animation. */
function addWings(anchor, look, spec, bodyColor, span = 0.55) {
  const n = Math.max(2, num(spec.count, 2)), size = num(spec.size, 1)
  const mat = toon(colorOf(look, spec.color ?? 'accent', bodyColor))
  const wings = []
  for (let i = 0; i < n; i++) {
    const side = i % 2 === 0 ? 1 : -1, row = Math.floor(i / 2)
    const pivot = new THREE.Group()
    pivot.position.set(-row * 0.18, 0, side * 0.12)
    anchor.add(pivot)
    const w = ink(new THREE.BoxGeometry(0.34 * size, 0.025, span * size), mat)
    w.position.z = side * span * size / 2
    pivot.add(w)
    wings.push({ pivot, side })
  }
  return wings
}

/** Eyes across the front of a head (one, two, three or more). */
function addEyes(head, look, r, count) {
  const mat = toon(colorOf(look, 'eye', '#1d1d1f'))
  const n = Math.max(1, count)
  for (let i = 0; i < n; i++) {
    const z = n === 1 ? 0 : (i / (n - 1) - 0.5) * r * 1.2
    const e = new THREE.Mesh(sphere(r * 0.16, 8), mat)
    e.position.set(r * 0.74, r * (n === 3 && i === 1 ? 0.5 : 0.28), z)
    head.add(e)
  }
}

/** A human face: a pale disc with eyes and a mouth on the front of a head. */
function addHumanFace(head, look, r) {
  const skin = toon(colorOf(look, 'face', '#f0d6bd')), dark = toon(colorOf(look, 'eye', '#1d1d1f'))
  const face = ink(sphere(r * 0.62, 12), skin)
  face.scale.set(0.45, 1, 1)
  face.position.set(r * 0.82, 0, 0)
  head.add(face)
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(sphere(r * 0.09, 6), dark)
    e.position.set(r * 1.08, r * 0.2, s * r * 0.24)
    head.add(e)
  }
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.01, r * 0.05, r * 0.28), dark)
  mouth.position.set(r * 1.1, -r * 0.25, 0)
  head.add(mouth)
}

/** Horns and ears on a head. */
function addHeadParts(head, look, r, bodyColor) {
  for (const spec of partsOf(look, 'ear')) {
    const n = num(spec.count, 2), size = num(spec.size, r * 0.75)
    const mat = toon(colorOf(look, spec.color ?? 'accent', bodyColor))
    for (let i = 0; i < n; i++) {
      const side = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2
      const ear = ink(new THREE.ConeGeometry(size * 0.36, size, 8), mat)
      ear.position.set(-r * 0.15, r * 1.02, side * r * 0.55)
      ear.rotation.x = side * 0.28
      head.add(ear)
    }
  }
  for (const spec of partsOf(look, 'horn')) {
    const n = num(spec.count, 2), len = num(spec.length, r * 1.4)
    const mat = toon(colorOf(look, spec.color ?? 'horn', '#d8c9a3'))
    for (let i = 0; i < n; i++) {
      const side = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2
      const horn = ink(new THREE.ConeGeometry(r * 0.16, len, 8), mat)
      horn.position.set(r * 0.1, r * 0.9 + len * 0.35, side * r * 0.4)
      horn.rotation.set(side * 0.35, 0, -0.35)
      head.add(horn)
    }
  }
  const eyes = partsOf(look, 'eye')[0]
  if (partsOf(look, 'face').some(f => f.style === 'human')) addHumanFace(head, look, r)
  else addEyes(head, look, r, eyes === undefined ? 2 : num(eyes.count, 2))
}

/** Heads, spread sideways when there are several (多首). */
function addHeads(parent, look, at, r, bodyColor, snout) {
  const n = Math.round(num(look.proportions?.heads, 1)), heads = []
  for (let i = 0; i < n; i++) {
    const head = new THREE.Group()
    const z = n === 1 ? 0 : (i / (n - 1) - 0.5) * r * 2.4 * Math.min(n, 4) / 2
    head.position.set(at.x, at.y, at.z + z)
    parent.add(head)
    head.add(ink(sphere(r, 14), toon(bodyColor)))
    if (snout > 0) {
      const s = ink(new THREE.ConeGeometry(r * 0.45, snout * 1.5, 12), toon(bodyColor))
      s.rotation.z = -Math.PI / 2
      s.position.set(r * 1.1, -r * 0.24, 0)
      head.add(s)
    }
    addHeadParts(head, look, r, bodyColor)
    heads.push(head)
  }
  return heads
}

function quadruped(look) {
  const p = look.proportions ?? {}
  const L = num(p.bodyLength, 1), H = num(p.bodyHeight, 0.45), legLen = num(p.legLength, 0.35) * 1.6
  const rx = 0.62 * L, ry = H * 0.66, bodyY = legLen + 0.08
  const bodyColor = colorOf(look, 'body', '#e9dfcc')
  const g = new THREE.Group(), body = new THREE.Group()
  g.add(body)
  const torso = ink(sphere(1, 18), toon(bodyColor))
  torso.scale.set(rx, ry, ry)
  torso.position.y = bodyY
  body.add(torso)
  const headR = num(p.headSize, 0.32) * 0.6
  const neck = ink(sphere(1, 12), toon(bodyColor))
  neck.scale.set(headR * 0.9, headR * 1.25, headR * 0.85)
  neck.position.set(rx * 0.76, bodyY + ry * 0.6, 0)
  neck.rotation.z = -0.6
  body.add(neck)
  const heads = addHeads(body, look, new THREE.Vector3(rx * 1.03, bodyY + ry * 1.2, 0), headR, bodyColor, num(p.snout, 0.18))
  const legs = Math.round(num(p.legs, 4)), pawColor = colorOf(look, 'accent', bodyColor)
  for (let i = 0; i < legs; i++) {
    const row = Math.floor(i / 2), rows = Math.ceil(legs / 2)
    const x = rows === 1 ? 0 : rx * 0.62 - (rx * 1.24) * row / (rows - 1), z = (i % 2 === 0 ? 1 : -1) * ry * 0.45
    const leg = new THREE.Group()
    leg.position.set(x, legLen, z)
    const l = ink(new THREE.CapsuleGeometry(0.055, legLen * 0.75, 4, 8), toon(bodyColor))
    l.position.y = -legLen * 0.48
    const paw = ink(sphere(0.07, 8), toon(pawColor))
    paw.scale.set(1.3, 0.55, 1)
    paw.position.set(0.03, -legLen + 0.03, 0)
    leg.add(l, paw)
    g.add(leg)
  }
  const tailRoot = new THREE.Group()
  tailRoot.position.set(-rx * 0.9, bodyY + ry * 0.33, 0)
  body.add(tailRoot)
  const tails = partsOf(look, 'tail').flatMap(spec => addTails(tailRoot, look, spec, bodyColor))
  const back = new THREE.Group()
  back.position.set(0, bodyY + ry * 0.8, 0)
  body.add(back)
  const wings = partsOf(look, 'wing').flatMap(spec => addWings(back, look, spec, bodyColor))
  return { g, body, heads, tails, wings, tailRoot, back }
}

function bird(look) {
  const p = look.proportions ?? {}
  const L = num(p.bodyLength, 0.7), bodyColor = colorOf(look, 'body', '#8d7f68')
  const g = new THREE.Group(), body = new THREE.Group()
  g.add(body)
  const torso = ink(sphere(1, 14), toon(bodyColor))
  torso.scale.set(L * 0.46, L * 0.32, L * 0.32)
  body.add(torso)
  const headR = num(p.headSize, 0.26) * 0.5
  const heads = addHeads(body, look, new THREE.Vector3(L * 0.43, L * 0.17, 0), headR, colorOf(look, 'head', bodyColor), 0)
  const beakColor = colorOf(look, 'beak', '#c9a23a')
  for (const head of heads) {
    const beak = ink(new THREE.ConeGeometry(headR * 0.28, num(p.beak, 0.12), 6), toon(beakColor))
    beak.rotation.z = -Math.PI / 2
    beak.position.set(headR * 1.2, -headR * 0.1, 0)
    head.add(beak)
  }
  const tailRoot = new THREE.Group()
  tailRoot.position.set(-L * 0.42, 0.02, 0)
  body.add(tailRoot)
  const tailSpecs = partsOf(look, 'tail')
  if (tailSpecs.length === 0) {
    const tail = ink(new THREE.ConeGeometry(0.12, 0.3, 4), toon(colorOf(look, 'accent', bodyColor)))
    tail.rotation.z = Math.PI / 2
    tail.scale.set(1, 1, 0.3)
    tail.position.x = -0.1
    tailRoot.add(tail)
  }
  const tails = tailSpecs.flatMap(spec => addTails(tailRoot, look, spec, bodyColor))
  const wingSpecs = partsOf(look, 'wing')
  const wings = (wingSpecs.length === 0 ? [{ type: 'wing', count: 2 }] : wingSpecs).flatMap(spec => addWings(body, look, spec, colorOf(look, 'wing', '#6f6352')))
  return { g, body, heads, tails, wings, tailRoot, back: body }
}

function fish(look) {
  const p = look.proportions ?? {}
  const L = num(p.bodyLength, 0.84), bodyColor = colorOf(look, 'body', '#c8432f')
  const g = new THREE.Group(), body = new THREE.Group()
  g.add(body)
  const torso = ink(sphere(1, 14), toon(bodyColor))
  torso.scale.set(L * 0.5, num(p.bodyHeight, 0.36) * 0.5, L * 0.18)
  body.add(torso)
  const head = new THREE.Group()
  head.position.set(L * 0.36, 0, 0)
  body.add(head)
  const r = num(p.bodyHeight, 0.36) * 0.36
  if (partsOf(look, 'face').some(f => f.style === 'human')) addHumanFace(head, look, r)
  else addEyes(head, look, r, num(partsOf(look, 'eye')[0]?.count, 2))
  const tailRoot = new THREE.Group()
  tailRoot.position.x = -L * 0.45
  body.add(tailRoot)
  const fin = ink(new THREE.ConeGeometry(0.16, 0.26, 4), toon(colorOf(look, 'accent', bodyColor)))
  fin.rotation.z = Math.PI / 2
  fin.scale.set(1, 1, 0.25)
  fin.position.x = -0.1
  tailRoot.add(fin)
  for (const spec of partsOf(look, 'fin')) {
    for (let i = 0; i < num(spec.count, 2); i++) {
      const f = ink(new THREE.ConeGeometry(0.08 * num(spec.size, 1), 0.18 * num(spec.size, 1), 4), toon(colorOf(look, spec.color ?? 'accent', bodyColor)))
      f.scale.z = 0.25
      f.position.set(L * 0.05 - i * 0.12, i % 2 === 0 ? 0.12 : -0.1, 0)
      body.add(f)
    }
  }
  // Wings on a fish are pectoral wings (a flying fish).
  const wings = partsOf(look, 'wing').flatMap(spec => addWings(body, look, spec, bodyColor, 0.45))
  return { g, body, heads: [head], tails: [], wings, swimmer: tailRoot, tailRoot, back: body }
}

function serpent(look) {
  const p = look.proportions ?? {}
  const len = num(p.length, 2.4), thick = num(p.thickness, 0.12)
  // Enough overlapping segments that the body reads as one coil, not beads.
  const n = Math.max(Math.round(num(p.segments, 10)), Math.ceil(len / (thick * 0.9)))
  const bodyColor = colorOf(look, 'body', '#5d7a52'), belly = colorOf(look, 'accent', bodyColor)
  const g = new THREE.Group(), body = new THREE.Group()
  g.add(body)
  const segs = []
  for (let i = 0; i < n; i++) {
    const r = thick * (1 - 0.6 * i / n)
    const s = ink(sphere(r, 10), toon(i % 6 === 0 ? belly : bodyColor))
    s.position.set(-i * len / n, r, 0)
    body.add(s)
    segs.push(s)
  }
  const headR = thick * 1.25
  const heads = addHeads(body, look, new THREE.Vector3(headR * 0.9, headR * 1.1, 0), headR, bodyColor, headR * 0.6)
  const wings = partsOf(look, 'wing').flatMap(spec => addWings(segs[Math.min(2, n - 1)], look, spec, bodyColor, 0.45))
  return { g, body, heads, tails: [], wings, slither: segs, tailRoot: segs[n - 1], back: segs[Math.min(2, n - 1)] }
}

function humanoid(look) {
  const p = look.proportions ?? {}
  const h = num(p.height, 1.2), bodyColor = colorOf(look, 'body', '#57677a'), skin = colorOf(look, 'skin', '#f0dcc2')
  const g = new THREE.Group(), body = new THREE.Group()
  g.add(body)
  const robe = ink(new THREE.ConeGeometry(h * 0.27, h * 0.8, 10), toon(bodyColor))
  robe.position.y = h * 0.4
  body.add(robe)
  const r = h * 0.13
  const heads = addHeads(body, look, new THREE.Vector3(0, h * 0.9, 0), r, skin, 0)
  for (const s of [-1, 1]) {
    // Arms hang at the sides, the hands a little out from the robe.
    const arm = ink(new THREE.CapsuleGeometry(h * 0.045, h * 0.3, 4, 8), toon(bodyColor))
    arm.position.set(0, h * 0.5, s * h * 0.21)
    arm.rotation.x = -s * 0.22
    body.add(arm)
  }
  const tailRoot = new THREE.Group()
  tailRoot.position.set(-h * 0.15, h * 0.2, 0)
  body.add(tailRoot)
  const tails = partsOf(look, 'tail').flatMap(spec => addTails(tailRoot, look, spec, bodyColor))
  const back = new THREE.Group()
  back.position.set(-h * 0.1, h * 0.65, 0)
  body.add(back)
  const wings = partsOf(look, 'wing').flatMap(spec => addWings(back, look, spec, bodyColor))
  return { g, body, heads, tails, wings, tailRoot, back }
}

const BASES = { quadruped, bird, fish, serpent, humanoid }
const BUILTIN_PARTS = new Set(['ear', 'horn', 'tail', 'wing', 'fin', 'eye', 'face'])
const PARTS = {}

/** Helpers a project's own bodies and parts build with. */
function kitFor(look) {
  return {
    THREE, ink, toon, flat,
    color: (key, fallback) => colorOf(look, key, fallback),
    sphere,
    addTails: (anchor, spec, bodyColor) => addTails(anchor, look, spec, bodyColor),
    addWings: (anchor, spec, bodyColor) => addWings(anchor, look, spec, bodyColor),
    addHeads: (parent, at, r, bodyColor, snout = 0) => addHeads(parent, look, at, r, bodyColor, snout),
  }
}

/**
 * Register a body the built-ins do not cover (a robot, a slime, a cart…).
 * `make(look, kit)` returns `{ g, body, heads?, tails?, wings?, tailRoot?, back? }`:
 * `g` is the model root, `body` breathes, the rest are what parts attach to
 * and motions drive. `kit` carries `THREE`, `ink`, `toon`, `flat`, `color`,
 * `sphere`, `addTails`, `addWings`, `addHeads`.
 */
export function defineBase(name, make) { BASES[name] = make }

/**
 * Register a part type. `make({ look, spec, anchors, kit })` adds meshes to
 * `anchors.body` / `anchors.heads[i]` / `anchors.tailRoot` / `anchors.back`
 * and may return `{ update(t) }` for its own motion. `spec.extra` carries the
 * part's own parameters from the recipe.
 */
export function definePart(type, make) { PARTS[type] = make }

/** A hull draws the same shape keys as its mesh: they share the influences. */
function shareMorphs(mesh, hull) {
  if (!mesh.morphTargetInfluences) return
  hull.morphTargetInfluences = mesh.morphTargetInfluences
  hull.morphTargetDictionary = mesh.morphTargetDictionary
}

/** What stands in for a glTF model that failed to load: a labeled block, never a crash. */
function gltfStandIn(look) {
  const g = new THREE.Group()
  const box = ink(new THREE.BoxGeometry(0.6, 0.6, 0.6), toon('#c9bda4'))
  box.position.y = 0.3
  g.add(box)
  g.userData.update = () => {}
  g.userData.standIn = look.src
  return g
}

/* ------------------------------------------------------------------- glTF */

/** Model loads in flight; `loaded()` and the workbench's checks wait on them. */
const pending = new Set()

/** Resolves once every model `build` has started so far has loaded (or failed). */
export function loaded() { return Promise.all([...pending]).then(() => undefined) }
window.__dshPending = loaded

let gltfLoader = null
async function loaderFor() {
  if (gltfLoader === null) {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
    const manager = new THREE.LoadingManager()
    // Project paths (the model, a .gltf's .bin and textures) become the sandbox's own blob URLs.
    manager.setURLModifier(url => window.__dshFileUrl?.(url) ?? url)
    gltfLoader = new GLTFLoader(manager)
  }
  return gltfLoader
}

/** The style's toon material over a loaded material's colors, vertex colors, textures and glow. */
function toonOver(m) {
  const params = { gradientMap: gradientFor(style.shades), color: m.color ? m.color.clone() : new THREE.Color('#ffffff') }
  if (m.map) params.map = m.map
  if (m.vertexColors) params.vertexColors = true
  if (m.emissive) params.emissive = m.emissive.clone()
  if (m.emissiveMap) params.emissiveMap = m.emissiveMap
  if (m.transparent) { params.transparent = true; params.opacity = m.opacity }
  if (m.alphaTest) params.alphaTest = m.alphaTest
  params.side = m.side
  const toonMat = rimmed(new THREE.MeshToonMaterial(params))
  toonMat.name = m.name
  m.dispose()
  return toonMat
}

/**
 * A glTF look: the model frame comes back at once and the .glb fills it when
 * loaded (`model.userData.loaded` resolves then). Toon by default; the
 * outline hull is skipped on skinned meshes (it would not follow the bones).
 * A failed load reports itself and falls back to the look's recipe, else a block.
 */
function gltfModel(look, lookOrId) {
  const g = new THREE.Group()
  const body = new THREE.Group()
  g.add(body)
  g.scale.setScalar(num(look.scale, 1))
  g.userData.src = look.src
  // Skeletal animation: the mixer runs on the world's clock (update(t) from step).
  let mixer = null, clips = [], current = null, wanted = null, last = null
  g.userData.animations = []
  // Named tweaks from the look (tint by material, bones by name, shape keys by name), applied
  // after the animation every frame so a clip never overwrites them.
  const parts = { materials: new Map(), bones: new Map(), morphMeshes: [] }
  let tune = { tint: {}, bones: {}, morphs: {} }
  const tunedBones = new Set()
  function collect(root, meshes) {
    for (const o of meshes) {
      for (const m of [o.material].flat()) {
        if (!m || !m.name) continue
        if (!parts.materials.has(m.name)) parts.materials.set(m.name, [])
        parts.materials.get(m.name).push(m)
        m.userData.baseColor = m.color ? m.color.clone() : null
      }
      if (o.morphTargetDictionary && o.morphTargetInfluences && !o.userData.outline) { o.userData.restMorphs = [...o.morphTargetInfluences]; parts.morphMeshes.push(o) }
    }
    root.traverse(n => { if (n.name && (n.isBone || !n.isMesh) && !parts.bones.has(n.name)) parts.bones.set(n.name, { node: n, scale: n.scale.clone(), quat: n.quaternion.clone() }) })
  }
  function restBones() {
    for (const name of tunedBones) { const b = parts.bones.get(name); if (b) { b.node.scale.copy(b.scale); b.node.quaternion.copy(b.quat) } }
  }
  function tuneBones() {
    for (const [name, spec] of Object.entries(tune.bones ?? {})) {
      const b = parts.bones.get(name)
      if (!b) continue
      tunedBones.add(name)
      if (typeof spec.scale === 'number') b.node.scale.multiplyScalar(spec.scale)
      else if (Array.isArray(spec.scale)) b.node.scale.multiply(new THREE.Vector3(...spec.scale))
      if (Array.isArray(spec.rotate)) b.node.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...spec.rotate.map(v => deg(v)))))
    }
  }
  function tuneMorphs() {
    const wanted = Object.entries(tune.morphs ?? {})
    if (wanted.length === 0) return
    for (const o of parts.morphMeshes) for (const [name, v] of wanted) { const i = o.morphTargetDictionary[name]; if (i !== undefined) o.morphTargetInfluences[i] = v }
  }
  /** Apply a look's tweaks again without reloading (the panel's live edits). */
  function retune(next) {
    tune = { tint: next.tint ?? {}, bones: next.bones ?? {}, morphs: next.morphs ?? {} }
    for (const [name, list] of parts.materials) for (const m of list) {
      const c = tune.tint[name]
      if (m.userData.baseColor) m.color.copy(c ? new THREE.Color(c) : m.userData.baseColor)
    }
    for (const o of parts.morphMeshes) o.userData.restMorphs.forEach((v, i) => { o.morphTargetInfluences[i] = v })
    restBones(); tuneBones(); tuneMorphs()
  }
  g.userData.retune = next => { if (parts.bones.size + parts.materials.size + parts.morphMeshes.length > 0) retune(next) }
  /** What the loaded model can be tuned by: its named materials, bones and shape keys. */
  g.userData.parts = () => ({
    materials: [...parts.materials].map(([name, list]) => ({ name, color: '#' + (list[0].userData.baseColor ?? new THREE.Color('#ffffff')).getHexString(), vertexColors: list.some(m => m.vertexColors) })),
    bones: [...parts.bones.values()].filter(b => b.node.isBone).map(b => b.node.name),
    morphs: [...new Set(parts.morphMeshes.flatMap(o => Object.keys(o.morphTargetDictionary)))],
  })
  g.userData.update = t => {
    restBones()
    if (mixer !== null) mixer.update(last === null ? 0 : Math.max(0, t - last))
    last = t
    tuneBones(); tuneMorphs()
  }
  /**
   * Play a clip by name, cross-fading from the one before (`{ fade: 0.2, loop: true }`).
   * Called before the model has loaded, it plays once it has. Returns the action, or null.
   */
  g.userData.play = (name, { fade = 0.2, loop = true } = {}) => {
    wanted = name
    if (mixer === null) return null
    const clip = clips.find(c => c.name === name)
    if (!clip) { console.error(`dsh3d：模型 ${look.src} 没有叫「${name}」的动画（有：${clips.map(c => c.name).join('、') || '无'}）`); return null }
    const action = mixer.clipAction(clip)
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity)
    action.clampWhenFinished = !loop
    action.reset().fadeIn(current === null ? 0 : fade).play()
    if (current !== null && current !== action) current.fadeOut(fade)
    current = action
    return action
  }
  const toonMode = look.material !== 'original'
  const withOutline = look.outline ?? toonMode
  const job = loaderFor()
    .then(loader => loader.loadAsync(look.src))
    .then(gltf => {
      // Collected first: the hulls added below are meshes too, and must not be visited.
      const meshes = []
      gltf.scene.traverse(o => { if (o.isMesh) meshes.push(o) })
      meshes.forEach(o => {
        if (toonMode) o.material = Array.isArray(o.material) ? o.material.map(toonOver) : toonOver(o.material)
        if (withOutline && style.outlineWidth > 0) {
          if (o.isSkinnedMesh) {
            // A skinned hull rides the same skeleton, as a sibling with the mesh's own transform.
            const hull = new THREE.SkinnedMesh(o.geometry, outline())
            hull.raycast = () => {}
            hull.userData.outline = true
            hull.position.copy(o.position); hull.quaternion.copy(o.quaternion); hull.scale.copy(o.scale)
            hull.bindMode = o.bindMode
            o.parent.add(hull)
            hull.updateMatrixWorld(true)
            hull.bind(o.skeleton, o.bindMatrix)
            shareMorphs(o, hull)
          } else {
            const hull = new THREE.Mesh(o.geometry, outline())
            hull.raycast = () => {}
            hull.userData.outline = true
            o.add(hull)
            shareMorphs(o, hull)
          }
        }
      })
      collect(gltf.scene, meshes)
      retune(look)
      body.add(gltf.scene)
      clips = gltf.animations
      g.userData.animations = clips.map(c => c.name)
      if (clips.length > 0) {
        mixer = new THREE.AnimationMixer(gltf.scene)
        const idle = look.animation ?? clips.find(c => /idle|待机|stand/i.test(c.name))?.name ?? clips[0].name
        g.userData.play(wanted ?? idle)
      }
    })
    .catch(error => {
      console.error(`dsh3d：模型 ${look.src} 加载失败：${error?.message ?? error}`)
      body.add(look.recipe ? buildLook(look.recipe, lookOrId) : gltfStandIn(look))
    })
    .finally(() => { pending.delete(job) })
  pending.add(job)
  g.userData.loaded = job
  return g
}

/**
 * Build a model from a look (or an element id, read from `window.dshElements`).
 * The model's `userData.update(t)` runs its procedural motion.
 */
export function build(lookOrId) {
  const model = buildLook(typeof lookOrId === 'string' ? window.dshElements?.[lookOrId]?.look : lookOrId, lookOrId)
  if (typeof lookOrId === 'string') model.userData.builtFrom = lookOrId
  return model
}

function buildLook(look, lookOrId) {
  if (!look || typeof look !== 'object') throw new Error(`dsh3d.build：没有可用的 look（${String(lookOrId)}）`)
  if (look.kind === 'gltf') return gltfModel(look, lookOrId)
  const make = BASES[look.base]
  if (!make) throw new Error(`dsh3d.build：base「${look.base}」没有注册（内置 ${Object.keys(BASES).join('、')}；自己的身体用 defineBase 注册）`)
  const kit = kitFor(look)
  const built = make(look, kit)
  const { g, body, swimmer, slither } = built
  const heads = built.heads ?? [], tails = built.tails ?? [], wings = built.wings ?? []
  const anchors = { body, heads, tailRoot: built.tailRoot ?? body, back: built.back ?? body }
  const partMotions = []
  for (const spec of look.parts ?? []) {
    if (BUILTIN_PARTS.has(spec.type)) continue
    const part = PARTS[spec.type]
    if (!part) throw new Error(`dsh3d.build：part「${spec.type}」没有注册（自己的部件用 definePart 注册）`)
    const motion = part({ look, spec, anchors, kit })
    if (motion && typeof motion.update === 'function') partMotions.push(motion)
  }
  const m = look.motion ?? {}
  const sway = m.tailSway, breath = m.breath, flap = m.flap, swim = m.swim, bob = m.bob
  g.scale.setScalar(num(look.scale, 1))
  g.userData.update = t => {
    if (breath) body.scale.y = 1 + num(breath.amplitude, 0.02) * Math.sin(t * 2 * Math.PI / num(breath.period, 2.4))
    for (const head of heads) head.rotation.z = 0.06 * Math.sin(t * 0.9)
    const swayAmp = deg(num(sway?.amplitude, 12)), swayPh = t * 2 * Math.PI / num(sway?.period, 1.6)
    tails.forEach((segs, i) => segs.forEach((seg, k) => { seg.rotation.x = swayAmp * (0.45 + 0.35 * k) * Math.sin(swayPh - i * 0.55 - k * 0.9) }))
    if (wings.length) {
      const a = deg(num(flap?.amplitude, 34)), ph = t * 2 * Math.PI / num(flap?.period, 0.7)
      for (const w of wings) w.pivot.rotation.x = w.side * (0.15 + a / 34 * 0.6 * Math.sin(ph))
    }
    if (swimmer) swimmer.rotation.y = deg(num(swim?.amplitude, 28)) * Math.sin(t * 2 * Math.PI / num(swim?.period, 0.9))
    if (slither) slither.forEach((s, i) => { s.position.z = Math.sin(t * 2 * Math.PI / num(swim?.period, 1.6) - i * 0.7) * deg(num(swim?.amplitude, 20)) * 0.25 })
    if (bob) body.position.y = num(bob.amplitude, 0.1) * Math.sin(t * 2 * Math.PI / num(bob.period, 2))
    for (const m of partMotions) m.update(t)
  }
  return g
}

/** Triangle count of an object tree (budgets: ~10k per creature, ~150k per scene). */
export function triangles(object) {
  let n = 0
  object.traverse(o => {
    if (o.isMesh && !o.userData.outline) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1)
  })
  return Math.round(n)
}

/* ------------------------------------------------------------------- world */

/** The style keys a scene may override (shading bands and the ink outline stay global: every material shares them). */
const SCENE_STYLE_KEYS = ['bg', 'ground', 'ground2', 'water', 'fog', 'light']

/** Free an object tree's GPU resources, sparing the shared cached materials. */
function release(object) {
  const shared = new Set(materials.values())
  if (outlineMaterial) shared.add(outlineMaterial)
  object.traverse(o => {
    o.geometry?.dispose()
    for (const m of [o.material].flat()) {
      if (!m || shared.has(m)) continue
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose()
      m.dispose()
    }
    if (o.isInstancedMesh) o.dispose()
  })
}

/** A small seeded random source (mulberry32), so a scatter lands the same way every load. */
function seeded(seed) {
  let a = (Math.floor(seed) >>> 0) || 1
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CAMERA_OFFSET = new THREE.Vector3(12, 13.5, 12)

/**
 * The game world: renderer, 45° orthographic camera, loop, terrain and the
 * entity registry the workbench hooks read.
 * @param {{ canvas?: HTMLCanvasElement, style?: string|object, view?: number, region?: (x:number, z:number) => string }} options
 *   `style` defaults to game.json's `style3d` (or the preset its `artStyle` names).
 */
export function createWorld(options = {}) {
  const baseSpec = options.style ?? manifestStyle()
  const baseObj = typeof baseSpec === 'string' ? { preset: baseSpec } : { ...baseSpec }
  let s = useStyle(baseSpec)
  const canvas = options.canvas ?? document.querySelector('canvas') ?? document.body.appendChild(document.createElement('canvas'))
  // preserveDrawingBuffer: the workbench's blank-screen probe and screenshots read the canvas.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(s.bg)
  scene.fog = new THREE.Fog(s.bg, s.fog[0], s.fog[1])
  const hemi = new THREE.HemisphereLight(s.hemi[0], s.hemi[1], s.hemi[2])
  const sun = new THREE.DirectionalLight(0xffffff, s.sun)
  const SUN_OFFSET = new THREE.Vector3(-6, 14, 8)
  sun.position.copy(SUN_OFFSET)
  scene.add(hemi, sun)
  // Shadows are opt-in (style3d.shadows): the sun casts, and its shadow box follows the camera's target.
  const shadows = s.shadows === true
  if (shadows) {
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    const box = sun.shadow.camera
    box.left = -24; box.right = 24; box.top = 24; box.bottom = -24; box.near = 0.5; box.far = 80
    sun.shadow.bias = -0.0005
    scene.add(sun.target)
  }
  /** Marks a newly added object's meshes to cast and receive shadows (outline hulls stay out). */
  function shade(object) {
    if (!shadows) return
    object.traverse(o => { if (o.isMesh && !o.userData.outline) { o.castShadow = true; o.receiveShadow = true } })
  }
  const iso = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300)
  /** The camera in use: the built-in 45° one, or the game's own (`setCamera`). */
  let camera = iso
  /** The follow rig `followCamera` set up, while its camera is the one in use. */
  let followRig = null
  const swayTime = { value: 0 }
  let renderHook = null
  const target = new THREE.Vector3()
  let zoom = 1, view = num(options.view, 6.2), followed = null, focusUntil = 0
  const entities = []
  const updates = []
  const rings = new THREE.Group()
  scene.add(rings)
  let heightFn = () => 0, ground = null, time = 0, paused = false, running = false, last = 0
  /** The scene entered last: `{ name, group, entities, updates, ground }`, or null before any. */
  let current = null
  /** Objects that count as ground for `groundAt`. */
  const walkables = []
  const groundRay = new THREE.Raycaster(), down = new THREE.Vector3(), DOWN = new THREE.Vector3(0, -1, 0)
  const testing = () => window.__GAMEDEV_TEST__ === true

  /** Background, fog and light from a resolved style (terrain colors are read when terrain is built). */
  function applyLook(st) {
    scene.background.set(st.bg)
    scene.fog.color.set(st.bg)
    scene.fog.near = st.fog[0]
    scene.fog.far = st.fog[1]
    hemi.color.set(st.hemi[0]); hemi.groundColor.set(st.hemi[1]); hemi.intensity = st.hemi[2]
    sun.intensity = st.sun
  }

  /** Camera pose and world matrices, as a render would leave them (pick needs them without a render). */
  function sync() {
    if (followRig !== null && camera === followRig.camera) {
      const r = followRig, t = r.target.position
      const pitch = Math.min(1.35, Math.max(-0.35, r.pitch))
      camera.position.set(t.x + Math.sin(r.yaw) * Math.cos(pitch) * r.distance, t.y + r.height + Math.sin(pitch) * r.distance, t.z + Math.cos(r.yaw) * Math.cos(pitch) * r.distance)
      camera.lookAt(t.x, t.y + r.height, t.z)
    }
    // The built-in camera tracks the target; a game's own camera is the game's to place.
    if (camera === iso) {
      iso.position.copy(target).add(CAMERA_OFFSET)
      iso.lookAt(target)
    }
    if (shadows) { sun.position.copy(target).add(SUN_OFFSET); sun.target.position.copy(target) }
    scene.updateMatrixWorld()
    camera.updateMatrixWorld()
  }

  /**
   * A private copy of a material whose vertices bend with the wind: higher
   * vertices swing more (the base stays put), each copy out of step with the
   * next. `{ amplitude: 0.06, period: 2.4 }` per metre of height. Shadows stay still.
   */
  function swaying(material, sway) {
    const amp = num(sway.amplitude, 0.06), period = Math.max(0.2, num(sway.period, 2.4))
    const m = material.clone()
    m.onBeforeCompile = shader => {
      shader.uniforms.swayT = swayTime
      shader.uniforms.swayAmp = { value: amp }
      shader.uniforms.swayPeriod = { value: period }
      shader.vertexShader = 'uniform float swayT; uniform float swayAmp; uniform float swayPeriod;\n' + shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nfloat swayPh = 0.0;\n#ifdef USE_INSTANCING\nswayPh = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.61;\n#endif\n'
        + 'float swayH = max(transformed.y, 0.0);\ntransformed.x += sin(swayT * 6.2832 / swayPeriod + swayPh) * swayAmp * swayH;\ntransformed.z += cos(swayT * 5.0265 / swayPeriod + swayPh) * swayAmp * 0.5 * swayH;')
    }
    m.customProgramCacheKey = () => 'dsh3d-sway'
    m.userData.sway = { amplitude: amp, period }
    return m
  }

  /** Leave the current scene: everything it registered goes, and its GPU resources with it. */
  function leaveScene() {
    if (current === null) return
    const gone = new Set(current.entities)
    for (let i = entities.length - 1; i >= 0; i--) if (gone.has(entities[i])) entities.splice(i, 1)
    for (const fn of current.updates) { const i = updates.indexOf(fn); if (i >= 0) updates.splice(i, 1) }
    for (const w of current.walkables) { const i = walkables.indexOf(w); if (i >= 0) walkables.splice(i, 1) }
    if (followed && gone.has(followed)) followed = null
    for (const r of [...rings.children]) if (gone.has(r.userData.follow)) rings.remove(r)
    scene.remove(current.group)
    release(current.group)
    if (current.ground !== null && ground === current.ground) dropGround()
    current = null
  }

  function dropGround() {
    if (ground === null) return
    scene.remove(ground)
    release(ground)
    ground = null
    heightFn = () => 0
  }

  function resize() {
    const w = canvas.clientWidth || canvas.width || 640, h = canvas.clientHeight || canvas.height || 400
    renderer.setSize(w, h, false)
    const aspect = w / h, half = Math.max(view, view * 0.84 / aspect) / zoom
    iso.left = -half * aspect; iso.right = half * aspect; iso.top = half; iso.bottom = -half
    iso.updateProjectionMatrix()
    if (camera.isPerspectiveCamera) { camera.aspect = aspect; camera.updateProjectionMatrix() }
  }
  resize()
  addEventListener('resize', resize)

  const world = {
    THREE, scene, renderer, canvas,
    /** The camera in use (the built-in 45° orthographic one until `setCamera`). */
    get camera() { return camera },
    /** The two lights, for a game to tune: `hemi` (sky/ground fill) and `sun` (directional; casts when style3d.shadows). */
    lights: { hemi, sun },
    /**
     * Use the game's own camera (a perspective follow camera, say) for
     * rendering and for the workbench's pick, highlight and focus; the game
     * places it every frame. `setCamera(null)` goes back to the built-in one.
     */
    setCamera(next) {
      if (followRig !== null && next !== followRig.camera) followRig = null
      camera = next ?? iso
      resize()
      return camera
    },
    /**
     * A third-person camera behind `target`: perspective, `distance` back and
     * `height` up, turned by `yaw` / `pitch` (radians; change them on the
     * returned rig, or call `rig.look(dx, dy)` with mouse deltas). `mouse: true`
     * grabs the pointer on a click (Esc lets go) and turns with the mouse.
     * Pick and rings follow it; `setCamera(null)` returns to the 45° view.
     */
    followCamera({ target, distance = 7, height = 1.4, yaw = 0, pitch = 0.35, fov = 50, mouse = false, sensitivity = 0.004 } = {}) {
      const rig = {
        target, distance, height, yaw, pitch, camera: new THREE.PerspectiveCamera(fov, 1, 0.1, 500),
        look(dx, dy) { rig.yaw -= dx * sensitivity; rig.pitch = Math.min(1.35, Math.max(-0.35, rig.pitch + dy * sensitivity)) },
      }
      world.setCamera(rig.camera)
      followRig = rig
      if (mouse) {
        canvas.addEventListener('click', () => { if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.() })
        addEventListener('mousemove', e => { if (followRig === rig && document.pointerLockElement === canvas) rig.look(e.movementX, e.movementY) })
      }
      return rig
    },
    /**
     * Take over drawing (post-processing, a second pass): `fn({ renderer, scene, camera })`
     * runs instead of the plain render. Returns a function that hands it back.
     */
    onRender(fn) {
      renderHook = fn
      return () => { if (renderHook === fn) renderHook = null }
    },
    /** The active style: the game's, with the current scene's overrides. */
    get style() { return s },
    /** The current scene's name, or null. */
    get sceneName() { return current?.name ?? null },
    /** Ground height at (x, z) — what `terrain` was given. */
    heightAt: (x, z) => heightFn(x, z),
    /**
     * Paper-toned terrain. `height(x, z)` shapes it; `size` is its side.
     * Clicking it in 「指一下」 gives a ground reference.
     */
    terrain({ size = 70, segments = 70, height } = {}) {
      // One ground at a time: a new terrain replaces (and frees) the old one.
      dropGround()
      if (height) heightFn = height
      const geo = new THREE.PlaneGeometry(size, size, segments, segments)
      geo.rotateX(-Math.PI / 2)
      const pos = geo.attributes.position, cols = [], c1 = new THREE.Color(s.ground), c2 = new THREE.Color(s.ground2)
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i)
        pos.setY(i, heightFn(x, z))
        const c = c1.clone().lerp(c2, Math.min(1, Math.max(0, 0.5 + 0.5 * Math.sin(x * 0.4 + z * 0.23) * Math.cos(z * 0.5))))
        cols.push(c.r, c.g, c.b)
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
      geo.computeVertexNormals()
      ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }))
      ground.userData.ground = true
      ground.receiveShadow = shadows
      scene.add(ground)
      if (current !== null) current.ground = ground
      return ground
    },
    /**
     * Add an object as a pickable entity. `id` is the element id (what the
     * panel and the model talk about), `inst` this instance, `state` a string
     * or a function returning one (shown in the reference: 「摆尾中」).
     */
    add(object, { id, inst, name, state, walkable } = {}) {
      object.userData.entity = { id, inst, name, state }
      if (walkable) world.walkable(object)
      // Inside a scene, an entity belongs to it and leaves with it.
      ;(current?.group ?? scene).add(object)
      shade(object)
      object.userData.loaded?.then(() => { shade(object) })
      entities.push(object)
      current?.entities.push(object)
      return object
    },
    /**
     * Count an object (stairs, a platform, a bridge, a roof) as ground:
     * `groundAt` lands on it. Inside a scene it leaves with the scene.
     * `walkable(object, false)` takes it back.
     */
    walkable(object, on = true) {
      const i = walkables.indexOf(object)
      if (on && i < 0) { walkables.push(object); current?.walkables.push(object); object.updateMatrixWorld(true) }
      if (!on && i >= 0) walkables.splice(i, 1)
      return object
    },
    /**
     * The height to stand at (x, z): the highest walkable surface (or the
     * terrain) at or below `fromY`. A character passes its feet plus a step
     * height, so it climbs a stair but not onto a roof above it; with no
     * `fromY` the topmost surface counts.
     */
    groundAt(x, z, fromY = Infinity) {
      const top = Number.isFinite(fromY) ? fromY + 0.001 : 1e4
      down.set(x, top, z)
      groundRay.set(down, DOWN)
      groundRay.far = top + 1e4
      const hits = groundRay.intersectObjects(ground ? [...walkables, ground] : walkables, true)
      for (const hit of hits) if (hit.point.y <= top) return hit.point.y
      return heightFn(x, z)
    },
    /** Put an object on the ground at (x, z). */
    place(object, x, z) {
      object.position.set(x, heightFn(x, z), z)
      return object
    },
    remove(object) {
      object.parent?.remove(object)
      const i = entities.indexOf(object)
      if (i >= 0) entities.splice(i, 1)
    },
    /** Run `fn(dt, t)` every step (game logic). Inside a scene it stops when the scene is left. Returns a function that stops it. */
    onUpdate(fn) {
      updates.push(fn)
      current?.updates.push(fn)
      return () => { const i = updates.indexOf(fn); if (i >= 0) updates.splice(i, 1) }
    },
    /**
     * Switch scenes: free everything the previous scene registered (its
     * entities, scatters, onUpdate callbacks and terrain), apply this scene's
     * style overrides — game.json `style3d.scenes[name]`, then `opts.style` —
     * and run `setup(world)`; whatever it adds, scatters, terrains or
     * registers belongs to this scene. Things registered outside any scene
     * (the player, say) stay. Returns setup's result (await it when setup is async).
     */
    enterScene(name, setup, opts = {}) {
      leaveScene()
      const fromData = (window.dshManifest?.style3d?.scenes ?? {})[name] ?? {}
      const overrides = {}
      for (const key of SCENE_STYLE_KEYS) {
        const v = opts.style?.[key] ?? fromData[key]
        if (v !== undefined) overrides[key] = v
      }
      s = resolveStyle({ ...baseObj, ...overrides })
      applyLook(s)
      const group = new THREE.Group()
      group.name = `scene:${name}`
      scene.add(group)
      current = { name, group, entities: [], updates: [], walkables: [], ground: null }
      const result = setup?.(world)
      if (!testing()) world.render()
      return result
    },
    /**
     * One element (or look) built once and instanced over the ground: each
     * copy lands on the terrain with a random facing and size. `points` is a
     * list of `[x, z]` / `{ x, z }`, or a count spread over `spread` (a
     * square side, centered on `center`). Picking a copy answers the element
     * with `inst: 'id#n'`. Static: no per-copy motion.
     */
    scatter(idOrLook, points, { seed = 1, spread = 40, center = [0, 0], rotate = true, scale = [0.85, 1.15], name, inst, sway } = {}) {
      const rnd = seeded(seed)
      const spots = typeof points === 'number'
        ? Array.from({ length: Math.max(0, Math.floor(points)) }, () => [center[0] + (rnd() - 0.5) * spread, center[1] + (rnd() - 0.5) * spread])
        : (points ?? []).map(p => (Array.isArray(p) ? p : [p.x, p.z]))
      const id = typeof idOrLook === 'string' ? idOrLook : null
      // Placed once: a rebuild (an edited look) keeps every copy where it was.
      const matrices = spots.map(([x, z]) => {
        const k = scale[0] + rnd() * (scale[1] - scale[0])
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotate ? rnd() * Math.PI * 2 : 0)
        return new THREE.Matrix4().compose(new THREE.Vector3(x, heightFn(x, z), z), q, new THREE.Vector3(k, k, k))
      })
      const make = () => {
        const model = build(idOrLook)
        const group = new THREE.Group()
        // A glTF look fills in later: the copies are made once it has.
        const fill = () => { model.updateMatrixWorld(true); instance(model, group); shade(group) }
        if (model.userData.loaded) model.userData.loaded.then(fill)
        else fill()
        group.userData.scatter = { count: spots.length }
        if (id !== null) group.userData.builtFrom = id
        group.userData.rescatter = make
        return group
      }
      const instance = (model, group) => {
        model.traverse(o => {
          if (!o.isMesh) return
          const copies = new THREE.InstancedMesh(o.geometry, sway ? swaying(o.material, sway) : o.material, matrices.length)
          matrices.forEach((m, i) => { copies.setMatrixAt(i, m.clone().multiply(o.matrixWorld)) })
          copies.instanceMatrix.needsUpdate = true
          copies.computeBoundingSphere()
          if (o.userData.outline) { copies.userData.outline = true; copies.raycast = () => {} }
          group.add(copies)
        })
      }
      const elementName = id !== null ? window.dshElements?.[id]?.name : undefined
      return world.add(make(), { id: id ?? undefined, inst, name: name ?? elementName })
    },
    /** Keep the camera on an object. */
    follow(object) { followed = object },
    /** Swing the camera to an object for a few seconds. */
    focus(object, seconds = 3) { target.copy(object.position); focusUntil = time + seconds },
    setZoom(z) { zoom = Math.min(12, Math.max(0.2, z)); resize() },
    get time() { return time },
    get paused() { return paused },
    /** Advance `dt` seconds: game logic, motion, camera, render. Tests drive this. */
    step(dt) {
      time += dt
      swayTime.value = time
      for (const fn of updates) fn(dt, time)
      for (const e of entities) e.userData.update?.(time)
      if (followed && time > focusUntil) target.lerp(followed.position, Math.min(1, dt * 5))
      for (const r of rings.children) {
        const o = r.userData.follow
        r.position.set(o.position.x, heightFn(o.position.x, o.position.z) + 0.05, o.position.z)
        r.scale.setScalar(1 + 0.06 * Math.sin(time * 4))
      }
      // Checks drive hundreds of steps: logic and the camera pose there (tests project
      // screen points with it), no drawing; the probe renders once.
      if (testing()) sync()
      else world.render()
    },
    render() {
      sync()
      if (renderHook !== null) renderHook({ renderer, scene, camera })
      else renderer.render(scene, camera)
    },
    /** Play: step on every animation frame while not paused. */
    start() {
      if (running) return
      running = true
      last = performance.now()
      const frame = now => {
        const dt = Math.min(0.05, (now - last) / 1000)
        last = now
        if (!paused) world.step(dt)
        else world.render()
        requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    },
    /** Freeze time (the panel's 「指一下」 does this). */
    pause(on = true) { paused = !!on },
    /**
     * What is at canvas pixel (x, y): `{ id, inst, name, state, point }` for
     * an entity, `{ id: null, ground: true, point, region }` for the ground,
     * or null.
     */
    pick(x, y) {
      sync()
      // A posed skinned mesh can leave its rest-pose bounds: refresh them before the ray.
      for (const e of entities) e.traverse(o => { if (o.isSkinnedMesh && !o.userData.outline) { o.computeBoundingBox(); o.computeBoundingSphere() } })
      const ray = new THREE.Raycaster()
      ray.setFromCamera(new THREE.Vector2(x / canvas.width * 2 - 1, -(y / canvas.height) * 2 + 1), camera)
      const hits = ray.intersectObjects(ground ? [...entities, ground] : entities, true)
      for (const hit of hits) {
        let o = hit.object
        while (o && !o.userData.entity && !o.userData.ground) o = o.parent
        if (!o) continue
        const point = { x: +hit.point.x.toFixed(2), y: +hit.point.y.toFixed(2), z: +hit.point.z.toFixed(2) }
        if (o.userData.ground) return { id: null, ground: true, point, region: options.region?.(point.x, point.z) ?? null, scene: current?.name ?? null }
        const e = o.userData.entity
        const state = typeof e.state === 'function' ? e.state() : e.state
        // A scattered copy answers its element plus which copy (1-based).
        const copy = o.userData.scatter && hit.instanceId !== undefined ? hit.instanceId + 1 : null
        const inst = e.inst ?? (copy !== null && e.id ? `${e.id}#${copy}` : null)
        return { id: e.id ?? null, inst: inst ?? null, name: e.name ?? null, state: state ?? null, point, region: options.region?.(point.x, point.z) ?? null, scene: current?.name ?? null }
      }
      return null
    },
    /** Ring entities: `[{ id, tone: 'changed' | 'added' }]` (element id or instance id). An empty list clears. */
    highlight(list = []) {
      rings.clear()
      for (const { id, tone } of list) {
        for (const o of entities) {
          const e = o.userData.entity
          if (e.id !== id && e.inst !== id) continue
          // A ring around a whole forest says nothing; scattered copies are not ringed.
          if (o.userData.scatter) continue
          const box = new THREE.Box3().setFromObject(o), r = Math.max(0.5, box.getSize(new THREE.Vector3()).x * 0.6)
          const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.14, 48),
            new THREE.MeshBasicMaterial({ color: tone === 'added' ? '#1f9a55' : '#2f6fe0', transparent: true, opacity: 0.85, depthWrite: false, depthTest: false, side: THREE.DoubleSide }))
          ring.rotation.x = -Math.PI / 2
          // Drawn over the terrain: on a slope the ground would otherwise cut the ring in half.
          ring.renderOrder = 10
          ring.userData.follow = o
          ring.raycast = () => {}
          rings.add(ring)
        }
      }
      world.render()
    },
    /** Triangles on screen (for the budget check). */
    stats() { return { triangles: triangles(scene), entities: entities.length } },
  }
  // The panel's element edits arrive as `dshelements` events (the bridge
  // updates window.dshElements first): rebuild every model built from that
  // element in place, keeping its position, facing and entity registration.
  addEventListener('dshelements', event => {
    const id = event.detail?.id
    if (typeof id !== 'string') return
    for (const old of [...entities]) {
      if (old.userData.builtFrom !== id) continue
      let fresh
      try { fresh = old.userData.rescatter ? old.userData.rescatter() : build(id) } catch (error) { console.error(error); continue }
      fresh.position.copy(old.position)
      fresh.rotation.copy(old.rotation)
      fresh.userData.entity = old.userData.entity
      const parent = old.parent ?? scene
      parent.remove(old)
      if (old.userData.scatter) release(old)
      parent.add(fresh)
      shade(fresh)
      if (current?.entities.includes(old)) current.entities[current.entities.indexOf(old)] = fresh
      entities[entities.indexOf(old)] = fresh
      if (followed === old) followed = fresh
      for (const r of rings.children) if (r.userData.follow === old) r.userData.follow = fresh
    }
    world.render()
  })
  window.dsh3dWorld = world
  return world
}
