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
  type BodyBase, type GltfLook, type Look3D, type MotionSpec, type PartSpec, type PartType, type Parts3DLook,
} from './types.ts'

const HEX = /^#[0-9a-f]{6}$/i
const MOTIONS = ['tailSway', 'breath', 'flap', 'swim', 'bob'] as const
/** Proportions that are counts (六足, 多首, a serpent's segments), with their integer ranges. */
const COUNTS: Readonly<Record<string, readonly [number, number]>> = { legs: [0, 8], heads: [1, 9], segments: [3, 40] }

/** What a usable 3D look needs, worded for the model. */
export const LOOK3D_HINT = 'look 不可用：3D 外观要么是 { kind: "parts3d", base: '
  + `${BODY_BASES.map(b => `"${b}"`).join(' / ')}, proportions, parts, palette, motion }，`
  + '要么是 { kind: "gltf", src: "assets/….glb" }（路径在项目里）'

function clamp(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : undefined
}

function record(raw: unknown): Record<string, unknown> | undefined {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined
}

function part(raw: unknown): PartSpec | undefined {
  const r = record(raw)
  if (r === undefined || !(PART_TYPES as readonly unknown[]).includes(r.type)) return undefined
  const out: { -readonly [K in keyof PartSpec]: PartSpec[K] } = { type: r.type as PartType }
  const count = clamp(r.count, 1, 12)
  if (count !== undefined) out.count = Math.round(count)
  for (const [key, min, max] of [['size', 0.01, 3], ['length', 0.01, 5], ['fan', 0, 360], ['thickness', 0.005, 1]] as const) {
    const v = clamp(r[key], min, max)
    if (v !== undefined) out[key] = v
  }
  if (typeof r.color === 'string' && r.color.length <= 24) out.color = r.color
  if (typeof r.style === 'string' && r.style.length <= 24) out.style = r.style
  return out
}

function parts3d(r: Record<string, unknown>): Parts3DLook | null {
  if (!(BODY_BASES as readonly unknown[]).includes(r.base)) return null
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
    ...(Object.keys(refine).length === 0 ? {} : { refine }),
  }
}

function gltf(r: Record<string, unknown>): GltfLook | null {
  const src = typeof r.src === 'string' ? r.src.trim().replace(/^\.\//, '') : ''
  if (!/\.(glb|gltf)$/i.test(src) || src.startsWith('/') || src.split('/').includes('..')) return null
  const scale = clamp(r.scale, 0.05, 50)
  const recipe = record(r.recipe)
  const baked = recipe === undefined ? null : parts3d(recipe)
  return { kind: 'gltf', src, ...(scale === undefined ? {} : { scale }), ...(baked === null ? {} : { recipe: baked }) }
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
