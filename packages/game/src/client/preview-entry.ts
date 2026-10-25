/**
 * The 3D preview's in-frame entry (the element turntable, card stills,
 * proposal stills): plain module source, run in the same sandbox as the play
 * area on the live bundle. Kept apart from the React component so a spec can
 * run it through the real checker.
 *
 * The camera is a perspective orbit around the model. Models face +x (the
 * kit's convention, built-in bodies included), so yaw 0 looks at the face,
 * 90 from the side, 180 from behind; pitch looks down from above. The default
 * view is the look's `preview` (`{ yaw, pitch }` in degrees), else a
 * three-quarter front view from slightly above. A turntable drifts until it
 * is dragged (sideways turns, up and down tilts) or told which side to show.
 * @module @khorsheed/dsh-game/client
 */

/** The id the previewed look rides under in `window.dshElements`. */
export const PREVIEW_ID = '__preview'

/** The default view: three-quarter front, a little from above. */
export const PREVIEW_YAW = 35
export const PREVIEW_PITCH = 18

/** The preview entry module (it runs in the frame). */
export const PREVIEW_MAIN = `
const { createWorld, build, THREE } = await import('dsh3d')
try { await import('../src/looks.js') } catch (e) {}
const mode = (await (await fetch('_preview/mode.json')).json()).mode
const world = createWorld({ canvas: document.querySelector('canvas') })
const cam = new THREE.PerspectiveCamera(32, 1, 0.05, 500)
world.setCamera(cam)
const deg = Math.PI / 180
let model = null, yaw = ${PREVIEW_YAW}, pitch = ${PREVIEW_PITCH}, radius = 4, focusY = 0.5, drag = null, spinning = mode === 'spin', viewKey = null
const lookNow = () => window.dshElements['${PREVIEW_ID}'].look
/** The look's own preview angle, taken again only when it changes (an edit must not reset a dragged view). */
function viewFrom(look) {
  const p = (look && look.preview) || {}, key = JSON.stringify(p)
  if (key === viewKey) return
  viewKey = key
  yaw = Number.isFinite(p.yaw) ? p.yaw : ${PREVIEW_YAW}
  pitch = Number.isFinite(p.pitch) ? p.pitch : ${PREVIEW_PITCH}
}
function aim() {
  pitch = Math.max(-10, Math.min(80, pitch))
  const p = pitch * deg, y = yaw * deg
  cam.position.set(Math.cos(p) * Math.cos(y) * radius, focusY + Math.sin(p) * radius, Math.cos(p) * Math.sin(y) * radius)
  cam.lookAt(0, focusY, 0)
}
/** Stand the model on the origin and back the camera off far enough to frame it. */
function place() {
  model.position.set(0, 0, 0)
  model.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(model)
  if (box.isEmpty()) return
  const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3())
  model.position.set(-center.x, -box.min.y, -center.z)
  focusY = size.y / 2
  const r = Math.max(0.3, box.getBoundingSphere(new THREE.Sphere()).radius)
  radius = r / Math.sin(cam.fov * deg / 2) * 1.08
  aim()
}
async function fit() {
  if (model) world.remove(model)
  const look = lookNow()
  viewFrom(look)
  // From the look object, not the id: the world's own rebuild-by-element must not touch the preview.
  model = build(look)
  world.add(model, { id: '${PREVIEW_ID}' })
  place()
  // A glTF look fills in later: measure again once it has, then say what it can be tuned by.
  if (model.userData.loaded) { await model.userData.loaded; place() }
  parent.postMessage({ gamedev: 'preview-clips', names: model.userData.animations ?? [], parts: model.userData.parts?.() ?? null }, '*')
}
/** What a rebuild depends on; anything else (tint, bones, morphs, angle, clip) is retuned in place. */
const rebuildKey = look => JSON.stringify(look && look.kind === 'gltf' ? [look.src, look.material, look.outline, look.scale] : look)
let builtKey = null
function edited() {
  const look = lookNow(), key = rebuildKey(look)
  if (model && key === builtKey && model.userData.retune) { model.userData.retune(look); viewFrom(look); return }
  builtKey = key
  fit()
}
addEventListener('message', e => {
  const d = e.data
  if (!d || !model) return
  if (d.gamedev === 'preview-play') model.userData.play?.(d.name)
  if (d.gamedev === 'preview-view') { yaw = d.yaw; if (Number.isFinite(d.pitch)) pitch = d.pitch; spinning = false; aim(); world.render() }
})
builtKey = rebuildKey(lookNow())
await fit()
addEventListener('dshelements', () => { setTimeout(edited) })
const canvas = world.canvas
canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; spinning = false; canvas.setPointerCapture(e.pointerId) })
canvas.addEventListener('pointermove', e => {
  if (drag === null) return
  yaw -= (e.clientX - drag.x) * 0.5
  pitch += (e.clientY - drag.y) * 0.35
  drag = { x: e.clientX, y: e.clientY }
})
canvas.addEventListener('pointerup', () => { drag = null })
world.onUpdate(dt => { if (spinning && drag === null) yaw += dt * 18; aim() })
// The checks (and specs) can drive this page like a game.
window.dshGame = { ready: true, step: dt => world.step(dt), input() {}, state: () => ({ yaw, pitch, radius, focusY, perspective: world.camera === cam, spinning }) }
if (mode === 'still') {
  world.step(0.4)
  parent.postMessage({ gamedev: 'preview', png: canvas.toDataURL('image/png') }, '*')
} else world.start()
`

/** The preview page: a full-size canvas and the entry above. */
export const PREVIEW_HTML = '<style>html,body{margin:0;height:100%;overflow:hidden}canvas{width:100%;height:100%;display:block;touch-action:none}</style>'
  + '<canvas></canvas><script type="module" src="_preview/main.js"></script>'
