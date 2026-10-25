/**
 * 3D look previews in the panel: the element turntable, the proposal cards
 * and the turn card's before/after. Every preview runs in the same sandbox as
 * the play area, on the project's live version bundle (kit files and the
 * project's own `src/looks.js` registrations included) with a preview entry
 * swapped in — so the panel never carries a second copy of the builder, and
 * what it shows is exactly what the game builds.
 *
 * `spin` keeps a live, draggable turntable that follows look edits; `still`
 * renders once, posts a PNG back and is replaced by that image (cached per
 * look, so a scrolled-back card costs nothing). Stills render a couple at a
 * time — a grid of element cards would otherwise open a WebGL context per
 * card at once — and show their `placeholder` until the image arrives.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { BundleFile, Look3D } from '../types.ts'
import { shellHtml, type FrameMessage } from '../vfs.ts'
import type { GameApi } from './contract.ts'
import { failureOf } from './contract.ts'
import css from './GameTab.module.css'

/** The id the previewed look rides under in `window.dshElements`. */
const PREVIEW_ID = '__preview'

/** The preview entry: build the look, fit it, spin or snapshot. Kept as a string (it runs in the frame). */
const PREVIEW_MAIN = `
const { createWorld, build, THREE } = await import('dsh3d')
try { await import('../src/looks.js') } catch (e) {}
const mode = (await (await fetch('_preview/mode.json')).json()).mode
const world = createWorld({ canvas: document.querySelector('canvas') })
let model = null, angle = 0.5, drag = null
function place() {
  model.position.set(0, 0, 0)
  model.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(model)
  if (box.isEmpty()) return
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3())
  model.position.set(-center.x, -box.min.y - size.y / 2, -center.z)
  world.setZoom(6.2 / Math.max(0.6, Math.max(size.x, size.y, size.z) * 0.85))
}
async function fit() {
  if (model) world.remove(model)
  // From the look object, not the id: the world's own rebuild-by-element must not touch the preview.
  model = build(window.dshElements['${PREVIEW_ID}'].look)
  world.add(model, { id: '${PREVIEW_ID}' })
  place()
  // A glTF look fills in later: measure again once it has, and say which clips it has.
  if (model.userData.loaded) { await model.userData.loaded; place() }
  parent.postMessage({ gamedev: 'preview-clips', names: model.userData.animations ?? [] }, '*')
}
addEventListener('message', e => { if (e.data && e.data.gamedev === 'preview-play' && model) model.userData.play?.(e.data.name) })
await fit()
addEventListener('dshelements', () => { setTimeout(fit) })
const canvas = world.canvas
canvas.addEventListener('pointerdown', e => { drag = e.clientX; canvas.setPointerCapture(e.pointerId) })
canvas.addEventListener('pointermove', e => { if (drag !== null) { angle += (e.clientX - drag) * 0.012; drag = e.clientX } })
canvas.addEventListener('pointerup', () => { drag = null })
world.onUpdate(dt => { if (mode === 'spin' && drag === null) angle += dt * 0.5; if (model) model.rotation.y = angle })
if (mode === 'still') {
  world.step(0.4)
  parent.postMessage({ gamedev: 'preview', png: canvas.toDataURL('image/png') }, '*')
} else world.start()
`

const PREVIEW_HTML = '<style>html,body{margin:0;height:100%;overflow:hidden}canvas{width:100%;height:100%;display:block;touch-action:none}</style>'
  + '<canvas></canvas><script type="module" src="_preview/main.js"></script>'

/** Live version bundles per project, fetched once per version (three.js rides in them). */
const bundles = new Map<string, Promise<Readonly<Record<string, BundleFile>> | null>>()
function liveBundle(api: GameApi, projectId: string, version: number): Promise<Readonly<Record<string, BundleFile>> | null> {
  const key = `${projectId}:${version}`
  let pending = bundles.get(key)
  if (pending === undefined) {
    pending = api.bundle(projectId, 'current').then(r => (failureOf(r) === undefined && r.ok && r.value.ok ? r.value.bundle.files : null))
    bundles.set(key, pending)
  }
  return pending
}

/** The working copy of a glTF look's file (a model exported moments ago may not be in any version yet). */
async function withModel(api: GameApi, projectId: string, look: Look3D, files: Readonly<Record<string, BundleFile>> | null): Promise<Readonly<Record<string, BundleFile>> | null> {
  if (files === null || look.kind !== 'gltf') return files
  const r = await api.workingFile(projectId, look.src)
  return failureOf(r) === undefined && r.ok && r.value.ok ? { ...files, [look.src]: r.value.file } : files
}

/** Still images per look (and project version, whose style and registrations shape it). */
const stills = new Map<string, string>()

/** Stills rendering at once; the rest wait their turn. */
const STILL_SLOTS = 2
/** A still that never posts its image gives its slot back after this long. */
const STILL_TIMEOUT_MS = 15_000
let stillsRunning = 0
const stillQueue: (() => void)[] = []

/** Wait for a render slot; the returned function gives it back (idempotent). */
function stillSlot(): { ready: Promise<void>; release: () => void } {
  let granted = false
  let released = false
  let grant!: () => void
  const ready = new Promise<void>(resolve => { grant = () => { granted = true; stillsRunning++; resolve() } })
  if (stillsRunning < STILL_SLOTS) grant()
  else stillQueue.push(grant)
  const release = (): void => {
    if (released) return
    released = true
    if (!granted) {
      const at = stillQueue.indexOf(grant)
      if (at >= 0) stillQueue.splice(at, 1)
      return
    }
    stillsRunning--
    stillQueue.shift()?.()
  }
  return { ready, release }
}

/** Props of {@link Preview3D}. */
export interface Preview3DProps {
  readonly api: GameApi
  readonly projectId: string
  /** The live version; previews need one to run (kit files and project registrations ride in it). */
  readonly version: number | undefined
  readonly look: Look3D
  readonly mode: 'spin' | 'still'
  readonly className?: string | undefined
  /** Shown while there is no live version yet. */
  readonly emptyLabel: string
  /** Shown instead of `emptyLabel`, and under a still while it renders. */
  readonly placeholder?: ReactNode
  /** A turntable reports a model's animation clips here once it has loaded. */
  readonly onClips?: (names: readonly string[]) => void
  /** A turntable plays this clip (bump `n` to play the same one again). */
  readonly clip?: { readonly name: string; readonly n: number } | null
}

/** One 3D look preview. */
export function Preview3D({ api, projectId, version, look, mode, className, emptyLabel, placeholder, onClips, clip }: Preview3DProps): ReactNode {
  const lookJson = JSON.stringify(look)
  const stillKey = `${projectId}:${version}:${lookJson}`
  const [files, setFiles] = useState<Readonly<Record<string, BundleFile>> | null>(null)
  const [image, setImage] = useState<string | null>(mode === 'still' ? stills.get(stillKey) ?? null : null)
  const [visible, setVisible] = useState(mode === 'spin')
  const box = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const booted = useRef(false)
  const shell = useMemo(() => shellHtml(), [])
  // A glTF look's file: switching it reloads the frame (other look edits stream in live).
  const modelSrc = look.kind === 'gltf' ? look.src : ''
  useEffect(() => { booted.current = false }, [modelSrc])

  // A still follows its key (a new live version or an edited look): start over from the cache or a fresh render.
  useEffect(() => {
    if (mode !== 'still') return
    setImage(stills.get(stillKey) ?? null)
    setFiles(null)
    booted.current = false
  }, [mode, stillKey])

  // Stills wait until they scroll into view: a long chat history costs nothing until read.
  useEffect(() => {
    if (visible || box.current === null) return
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) setVisible(true) })
    io.observe(box.current)
    return () => { io.disconnect() }
  }, [visible])

  useEffect(() => {
    if (version === undefined || !visible || image !== null) return
    let live = true
    if (mode === 'spin') {
      void liveBundle(api, projectId, version).then(f => withModel(api, projectId, look, f)).then(f => { if (live) setFiles(f) })
      return () => { live = false }
    }
    // A still holds a render slot from loading until its image lands (or it times out).
    const slot = stillSlot()
    let timer: ReturnType<typeof setTimeout> | undefined
    void slot.ready.then(() => liveBundle(api, projectId, version)).then(f => withModel(api, projectId, look, f)).then(f => {
      if (!live) return
      if (f === null) { slot.release(); return }
      timer = setTimeout(slot.release, STILL_TIMEOUT_MS)
      setFiles(f)
    })
    return () => { live = false; clearTimeout(timer); slot.release() }
  }, [api, projectId, version, visible, image, mode, modelSrc]) // eslint-disable-line react-hooks/exhaustive-deps -- look is read for its model file only (modelSrc)

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== frame.current?.contentWindow) return
      const data = event.data as FrameMessage | undefined
      if (data?.gamedev === 'preview' && mode === 'still') {
        stills.set(stillKey, data.png)
        setImage(data.png)
      }
      if (data?.gamedev === 'preview-clips' && mode === 'spin') onClips?.(data.names)
    }
    window.addEventListener('message', onMessage)
    return () => { window.removeEventListener('message', onMessage) }
  }, [mode, stillKey, onClips])

  useEffect(() => {
    if (clip == null || mode !== 'spin' || !booted.current) return
    frame.current?.contentWindow?.postMessage({ gamedev: 'preview-play', name: clip.name }, '*')
  }, [clip, mode])

  // A spinning preview follows look edits live (the same element message the play area gets).
  useEffect(() => {
    if (mode !== 'spin' || !booted.current) return
    frame.current?.contentWindow?.postMessage({ gamedev: 'element', element: { id: PREVIEW_ID, name: PREVIEW_ID, type: 'preview', look } }, '*')
  }, [lookJson, mode]) // eslint-disable-line react-hooks/exhaustive-deps -- lookJson stands for look

  const boot = (): void => {
    if (files === null || booted.current) return
    const previewFiles: Record<string, BundleFile> = {
      ...files,
      'index.html': { type: 'text/html', text: PREVIEW_HTML },
      '_preview/main.js': { type: 'text/javascript', text: PREVIEW_MAIN },
      '_preview/mode.json': { type: 'application/json', text: JSON.stringify({ mode }) },
      [`elements/${PREVIEW_ID}.json`]: { type: 'application/json', text: JSON.stringify({ id: PREVIEW_ID, name: PREVIEW_ID, type: 'preview', look }) },
    }
    frame.current?.contentWindow?.postMessage({ gamedev: 'files', files: previewFiles, saves: {}, params: {} }, '*')
    booted.current = true
  }

  const waiting = placeholder ?? (version === undefined ? <span className={css.preview3dNote}>{emptyLabel}</span> : null)
  return <div ref={box} className={[css.preview3d, className].filter(Boolean).join(' ')}>
    {image !== null ? <img src={image} alt="" /> : <>
      {(mode === 'still' || version === undefined) && waiting}
      {version !== undefined && files !== null && <iframe key={modelSrc} ref={frame} className={css.preview3dFrame} data-mode={mode} title="preview" sandbox="allow-scripts" srcDoc={shell} onLoad={boot} />}
    </>}
  </div>
}
