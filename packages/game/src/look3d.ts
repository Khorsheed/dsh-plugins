/**
 * Validation for 3D looks (`parts3d` recipes and `gltf` files). Pure data,
 * no three.js: the store, the tools and the browser half all use it, and the
 * 3d-three kit's `dsh3d.build` trusts what passes here.
 *
 * Normalizing is forgiving the way the pixel-look normalizer is: unknown
 * keys drop, numbers clamp into range, bad colors drop; only a look with no
 * usable body (an unknown base, or a gltf path that leaves the project) is
 * rejected outright.
 * @module @khorsheed/dsh-game
 */
import {
  BODY_BASES, PART_TYPES,
  type BodyBase, type GltfLook, type Look3D, type MotionSpec, type PartSpec, type PartType, type Parts3DLook, type PreviewAngle, type BoneTweak,
} from './types.ts'

const HEX = /^#[0-9a-f]{6}$/i
const MOTIONS = ['tailSway', 'breath', 'flap', 'swim', 'bob'] as const
/** Proportions that are counts (六足, 多首, a serpent's segments), with their integer ranges. */
const COUNTS: Readonly<Record<string, readonly [number, number]>> = { legs: [0, 8], heads: [1, 9], segments: [3, 40] }

/** What a usable 3D look needs, worded for the model. */
export const LOOK3D_HINT = 'look 不可用：3D 外观要么是 { kind: "parts3d", base: '
  + `${BODY_BASES.map(b => `"${b}"`).join(' / ')} 或项目里 defineBase 注册的名字, proportions, parts, palette, motion }，`
  + '要么是 { kind: "gltf", src: "assets/….glb" }（路径在项目里）'

function clamp(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : undefined
}

function record(raw: unknown): Record<string, unknown> | undefined {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined
}

/** A name a project may register with `defineBase` / `definePart`: lowercase identifier. */
const NAME = /^[a-z][\w-]{0,31}$/

function part(raw: unknown): PartSpec | undefined {
  const r = record(raw)
  // Built-in part types, or a name the project registers in its own code (dsh3d.definePart).
  if (r === undefined || typeof r.type !== 'string' || !NAME.test(r.type)) return undefined
  const out: { -readonly [K in keyof PartSpec]: PartSpec[K] } = { type: r.type as PartType }
  const count = clamp(r.count, 1, 12)
  if (count !== undefined) out.count = Math.round(count)
  for (const [key, min, max] of [['size', 0.01, 3], ['length', 0.01, 5], ['fan', 0, 360], ['thickness', 0.005, 1]] as const) {
    const v = clamp(r[key], min, max)
    if (v !== undefined) out[key] = v
  }
  if (typeof r.color === 'string' && r.color.length <= 24) out.color = r.color
  if (typeof r.style === 'string' && r.style.length <= 24) out.style = r.style
  if (!(PART_TYPES as readonly unknown[]).includes(r.type)) {
    // A project-defined part keeps its own extra numbers and short strings.
    const extra: Record<string, number | string> = {}
    for (const [k, v] of Object.entries(r).slice(0, 16)) {
      if (k in out || k === 'type' || !NAME.test(k)) continue
      if (typeof v === 'number' && Number.isFinite(v)) extra[k] = Math.min(1000, Math.max(-1000, v))
      else if (typeof v === 'string' && v.length <= 40) extra[k] = v
    }
    if (Object.keys(extra).length > 0) out.extra = extra
  }
  return out
}

function parts3d(r: Record<string, unknown>): Parts3DLook | null {
  // A built-in body, or one the project registers (dsh3d.defineBase); an
  // unregistered name fails loudly at build time, which the smoke check reports.
  if (typeof r.base !== 'string' || !NAME.test(r.base)) return null
  const proportions: Record<string, number> = {}
  for (const [k, v] of Object.entries(record(r.proportions) ?? {}).slice(0, 16)) {
    const count = COUNTS[k]
    const n = count === undefined ? clamp(v, 0.01, 5) : clamp(v, count[0], count[1])
    if (n !== undefined && k.length <= 24) proportions[k] = count === undefined ? n : Math.round(n)
  }
  const palette: Record<string, string> = {}
  for (const [k, v] of Object.entries(record(r.palette) ?? {}).slice(0, 12)) {
    if (typeof v === 'string' && HEX.test(v) && k.length <= 24) palette[k] = v.toLowerCase()
  }
  const motion: Record<string, MotionSpec> = {}
  for (const name of MOTIONS) {
    const m = record(record(r.motion)?.[name])
    if (m === undefined) continue
    const amplitude = clamp(m.amplitude, 0, 90), period = clamp(m.period, 0.1, 20)
    motion[name] = { ...(amplitude === undefined ? {} : { amplitude }), ...(period === undefined ? {} : { period }) }
  }
  const refine: Record<string, number> = {}
  for (const [k, v] of Object.entries(record(r.refine) ?? {}).slice(0, 8)) {
    const n = clamp(v, 0, 100_000)
    if (n !== undefined) refine[k] = n
  }
  const scale = clamp(r.scale, 0.05, 50)
  return {
    kind: 'parts3d',
    base: r.base as BodyBase,
    proportions,
    parts: (Array.isArray(r.parts) ? r.parts : []).slice(0, 16).map(part).filter((p): p is PartSpec => p !== undefined),
    palette,
    motion,
    ...(scale === undefined ? {} : { scale }),
    ...previewOf(r),
    ...(Object.keys(refine).length === 0 ? {} : { refine }),
  }
}

/** A look's `preview` angle (degrees), when it has a usable one. */
function previewOf(r: Record<string, unknown>): { preview?: PreviewAngle } {
  const p = record(r.preview)
  if (p === undefined) return {}
  const yaw = clamp(p.yaw, -360, 360), pitch = clamp(p.pitch, -10, 80)
  const out = { ...(yaw === undefined ? {} : { yaw }), ...(pitch === undefined ? {} : { pitch }) }
  return Object.keys(out).length === 0 ? {} : { preview: out }
}

/** Names the model chose (materials, bones, shape keys): any text, bounded. */
const PART_NAME = /^[^\u0000-\u001f]{1,60}$/

/** A glTF look's named tweaks: tint, bones, morphs (each kept only when usable, at most 64 names). */
function tweaksOf(r: Record<string, unknown>): Pick<GltfLook, 'tint' | 'bones' | 'morphs'> {
  const entries = (raw: unknown): [string, unknown][] => Object.entries(record(raw) ?? {}).filter(([k]) => PART_NAME.test(k)).slice(0, 64)
  const tint = Object.fromEntries(entries(r.tint).filter(([, v]) => typeof v === 'string' && HEX.test(v)).map(([k, v]) => [k, (v as string).toLowerCase()]))
  const morphs = Object.fromEntries(entries(r.morphs).map(([k, v]) => [k, clamp(v, -1, 2)]).filter(([, v]) => v !== undefined)) as Record<string, number>
  const bones: Record<string, BoneTweak> = {}
  for (const [k, v] of entries(r.bones)) {
    const b = record(v)
    if (b === undefined) continue
    const triple = (raw: unknown, min: number, max: number): [number, number, number] | undefined => {
      if (!Array.isArray(raw) || raw.length !== 3) return undefined
      const t = raw.map(x => clamp(x, min, max))
      return t.every(x => x !== undefined) ? t as [number, number, number] : undefined
    }
    const scale = typeof b.scale === 'number' ? clamp(b.scale, 0.1, 5) : triple(b.scale, 0.1, 5)
    const rotate = triple(b.rotate, -180, 180)
    if (scale !== undefined || rotate !== undefined) bones[k] = { ...(scale === undefined ? {} : { scale }), ...(rotate === undefined ? {} : { rotate }) }
  }
  return {
    ...(Object.keys(tint).length === 0 ? {} : { tint }),
    ...(Object.keys(bones).length === 0 ? {} : { bones }),
    ...(Object.keys(morphs).length === 0 ? {} : { morphs }),
  }
}

function gltf(r: Record<string, unknown>): GltfLook | null {
  const src = typeof r.src === 'string' ? r.src.trim().replace(/^\.\//, '') : ''
  if (!/\.(glb|gltf)$/i.test(src) || src.startsWith('/') || src.split('/').includes('..')) return null
  const scale = clamp(r.scale, 0.05, 50)
  const recipe = record(r.recipe)
  const baked = recipe === undefined ? null : parts3d(recipe)
  const material = r.material === 'original' || r.material === 'toon' ? r.material : undefined
  return {
    kind: 'gltf', src, ...(scale === undefined ? {} : { scale }),
    ...(material === undefined ? {} : { material }), ...(typeof r.outline === 'boolean' ? { outline: r.outline } : {}),
    ...(typeof r.animation === 'string' && r.animation.trim() !== '' ? { animation: r.animation.trim().slice(0, 80) } : {}),
    ...previewOf(r),
    ...tweaksOf(r),
    ...(baked === null ? {} : { recipe: baked }),
  }
}

/**
 * Normalize a 3D look; null when it has no usable body.
 * @param raw - the element's `look` as written.
 */
export function normalizeLook3d(raw: unknown): Look3D | null {
  const r = record(raw)
  if (r === undefined) return null
  if (r.kind === 'parts3d') return parts3d(r)
  if (r.kind === 'gltf') return gltf(r)
  return null
}
