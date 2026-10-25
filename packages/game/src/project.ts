/**
 * Pure project logic: the creation gate, manifest parsing, chapter status,
 * element validation and which files make up a playable build. No I/O —
 * the store feeds it file contents, the specs feed it strings.
 * @module @khorsheed/dsh-game
 */
import { isKitId } from './kits/ids.ts'
import type { KitId, KitRef, RuntimeKit } from './kits/types.ts'
import {
  ART_STYLES, ART_STYLES_3D, isPixelLook, LOOK_CHARS, MANIFEST_FILE, STATE_DIR,
  type ArtStyle, type ChapterStatus, type SceneStyle3D, type Style3D, type CheckFailure, type ElementLook, type ElementView, type GameManifest, type GameParam,
} from './types.ts'

/** What `game_open create` must carry before a project exists (the light gate, decision D2). */
export interface CreateRequest {
  /** `2d` (default) or `3d`; the kit the project is pinned to. */
  readonly runtime?: string | undefined
  readonly title?: string | undefined
  readonly pitch?: string | undefined
  readonly elementTypes?: readonly string[] | string | undefined
  readonly artStyle?: string | undefined
  readonly pillars?: readonly string[] | string | undefined
}

/** The gate's verdict: a manifest to write, or what is still missing (model-facing Chinese). */
export type GateVerdict =
  | { readonly ok: true; readonly manifest: Omit<GameManifest, 'id' | 'createdAt'> }
  | { readonly ok: false; readonly missing: readonly string[] }

/** Split a list given either as an array or as one 、/,/newline-separated string. */
export function listOf(value: readonly string[] | string | undefined): string[] {
  const raw = typeof value === 'string' ? value.split(/[、,，;；\n]/) : Array.isArray(value) ? value : []
  const out: string[] = []
  for (const item of raw) {
    const clean = typeof item === 'string' ? item.trim() : ''
    if (clean !== '' && !out.includes(clean)) out.push(clean)
  }
  return out
}

/**
 * Resolve the art style the user picked: an example id, its Chinese label,
 * or `custom:<description>`. Anything else is not a choice the user made.
 * @param value - what the model passed.
 * @returns the stored spelling, or undefined when it names no style.
 */
export function resolveArtStyle(value: string | undefined, styles: readonly ArtStyle[] = ART_STYLES): string | undefined {
  const wanted = (value ?? '').trim()
  if (wanted === '') return undefined
  const known = styles.find(style => style.id === wanted || style.label === wanted)
  if (known !== undefined) return known.id
  if (/^custom[:：]\s*\S/.test(wanted)) return `custom:${wanted.replace(/^custom[:：]\s*/, '')}`
  return undefined
}

/** The style's human label (`custom:` keeps the user's own words). */
export function artStyleLabel(id: string): string {
  if (id.startsWith('custom:')) return id.slice('custom:'.length)
  return [...ART_STYLES, ...ART_STYLES_3D].find(style => style.id === id)?.label ?? id
}

/** The kit a create request asks for: `3d` / `3d-three` → 3D, anything else 2D. */
export function requestedKit(runtime: string | undefined): KitId {
  return /^3d/i.test((runtime ?? '').trim()) ? '3d-three' : '2d-canvas'
}

/** The example styles a kit offers. */
export function stylesFor(kit: KitId): readonly ArtStyle[] {
  return kit === '3d-three' ? ART_STYLES_3D : ART_STYLES
}

/**
 * The light gate: a project needs a title, a one-sentence pitch, at least one
 * element type and a chosen art style. The model gets back exactly what is
 * missing, so it asks the user instead of inventing it.
 * @param request - the create arguments.
 * @returns the manifest body, or the missing items.
 */
export function gate(request: CreateRequest): GateVerdict {
  const missing: string[] = []
  const title = (request.title ?? '').trim().slice(0, 60)
  const pitch = (request.pitch ?? '').trim().slice(0, 400)
  const elementTypes = listOf(request.elementTypes).slice(0, 12)
  const kit = requestedKit(request.runtime)
  const styles = stylesFor(kit)
  const artStyle = resolveArtStyle(request.artStyle, styles)
  if (title === '') missing.push('title（游戏名）')
  if (pitch === '') missing.push('pitch（一句话：玩家做什么、为什么好玩）')
  if (elementTypes.length === 0) missing.push('elementTypes（游戏里有哪几类元素，如 角色、敌人、道具）')
  if (artStyle === undefined) {
    missing.push(`artStyle（用户从示例里选的美术风格：${styles.map(s => `${s.id}=${s.label}`).join('、')}，或 custom:描述）`)
  }
  if (missing.length > 0) return { ok: false, missing }
  return {
    ok: true,
    manifest: {
      schema: 1,
      title,
      pitch,
      elementTypes,
      artStyle: artStyle!,
      pillars: listOf(request.pillars).slice(0, 5),
      autoConfirm: true,
      params: [],
      palette: stylePalette(artStyle!),
      // 2D projects keep the pre-kit manifest shape (no runtime key).
      ...(kit === '2d-canvas' ? {} : { runtime: { kit, version: 1 } }),
    },
  }
}

/** A style's palette; custom styles start from the pixel palette (the agent may set its own in game.json). */
export function stylePalette(styleId: string): string[] {
  return [...([...ART_STYLES, ...ART_STYLES_3D].find(style => style.id === styleId) ?? ART_STYLES[0]!).palette]
}

const HEX = /^#[0-9a-f]{6}$/i

/** Parse `game.json` `params[]`, dropping malformed rows and clamping each value into its range. */
export function parseParams(raw: unknown): GameParam[] {
  if (!Array.isArray(raw)) return []
  const out: GameParam[] = []
  for (const row of raw) {
    if (row === null || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const key = typeof r.key === 'string' ? r.key.trim() : ''
    const min = Number(r.min), max = Number(r.max)
    if (key === '' || !Number.isFinite(min) || !Number.isFinite(max) || max <= min || out.some(p => p.key === key)) continue
    const step = Number(r.step) > 0 ? Number(r.step) : (max - min) / 100
    const value = Number.isFinite(Number(r.value)) ? Math.min(max, Math.max(min, Number(r.value))) : min
    out.push({
      key, label: typeof r.label === 'string' && r.label.trim() !== '' ? r.label.trim() : key, min, max, step, value,
      ...(typeof r.unit === 'string' && r.unit !== '' ? { unit: r.unit } : {}),
    })
  }
  return out.slice(0, 24)
}

/** What a usable pixel look needs, worded for the model. */
export const PIXEL_LOOK_HINT = 'look 不可用：需要 palette（#rrggbb 数组）和 states（状态名 → 像素行数组）'

/**
 * Normalize an element's `look`: a palette of `#rrggbb` colors and pixel
 * rows per state, every row padded/cut to the widest row, characters outside
 * the palette turned transparent. Anything unusable is null.
 */
export function normalizeLook(raw: unknown): ElementLook | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const palette = Array.isArray(r.palette) ? r.palette.filter((c): c is string => typeof c === 'string' && HEX.test(c)).slice(0, LOOK_CHARS.length) : []
  if (palette.length === 0 || r.states === null || typeof r.states !== 'object') return null
  const states: Record<string, string[]> = {}
  for (const [name, rowsRaw] of Object.entries(r.states as Record<string, unknown>).slice(0, 8)) {
    if (!Array.isArray(rowsRaw)) continue
    const rows = rowsRaw.filter((row): row is string => typeof row === 'string').slice(0, 64)
    if (rows.length === 0) continue
    const width = Math.min(64, Math.max(...rows.map(row => row.length)))
    states[name] = rows.map(row => [...row.padEnd(width, '.').slice(0, width)].map(ch => {
      const index = LOOK_CHARS.indexOf(ch.toLowerCase())
      return index >= 0 && index < palette.length ? ch.toLowerCase() : '.'
    }).join(''))
  }
  return Object.keys(states).length === 0 ? null : { palette, states }
}

/** The look's grid size (first state). */
export function lookSize(look: ElementLook): { w: number; h: number } {
  const rows = Object.values(look.states)[0] ?? []
  return { w: rows[0]?.length ?? 0, h: rows.length }
}

/**
 * Parse `game.json`. Unknown keys are dropped; a missing optional key takes
 * its default, so a hand-edited manifest still loads.
 * @param text - the file's contents.
 * @returns the manifest, or a Chinese reason.
 */
export function parseManifest(text: string): { ok: true; manifest: GameManifest } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: `${MANIFEST_FILE} 不是合法 JSON：${(error as Error).message}` }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: `${MANIFEST_FILE} 应是一个对象` }
  const r = raw as Record<string, unknown>
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  const id = str(r.id)
  if (id === '') return { ok: false, error: `${MANIFEST_FILE} 缺少 id` }
  return {
    ok: true,
    manifest: {
      schema: 1,
      id,
      title: str(r.title) || id,
      pitch: str(r.pitch),
      elementTypes: listOf(Array.isArray(r.elementTypes) ? r.elementTypes.filter((x): x is string => typeof x === 'string') : str(r.elementTypes)),
      artStyle: str(r.artStyle),
      pillars: listOf(Array.isArray(r.pillars) ? r.pillars.filter((x): x is string => typeof x === 'string') : str(r.pillars)),
      autoConfirm: r.autoConfirm !== false,
      params: parseParams(r.params),
      palette: Array.isArray(r.palette) && r.palette.some(c => typeof c === 'string' && HEX.test(c))
        ? r.palette.filter((c): c is string => typeof c === 'string' && HEX.test(c))
        : stylePalette(str(r.artStyle)),
      createdAt: str(r.createdAt),
      ...(runtimeOf(r.runtime) ?? {}),
      ...(style3dOf(r.style3d) ?? {}),
    },
  }
}

/** The manifest's `style3d`, keeping valid colors and clamped numbers; undefined when nothing usable. */
function style3dOf(raw: unknown): { style3d: Style3D } | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  const out: { -readonly [K in keyof Style3D]: Style3D[K] } = {}
  if (typeof r.preset === 'string' && /^[a-z][\w-]{0,31}$/.test(r.preset)) out.preset = r.preset
  Object.assign(out, sceneStyleOf(r))
  if (typeof r.outline === 'string' && HEX.test(r.outline)) out.outline = r.outline.toLowerCase()
  const width = clampNum(r.outlineWidth, 0, 0.2), shades = clampNum(r.shades, 2, 5)
  if (width !== undefined) out.outlineWidth = width
  if (shades !== undefined) out.shades = Math.round(shades)
  if (typeof r.shadows === 'boolean') out.shadows = r.shadows
  // The game's own scenes (any names, a bounded number): each keeps only what a scene may override.
  if (r.scenes !== null && typeof r.scenes === 'object' && !Array.isArray(r.scenes)) {
    const scenes: Record<string, SceneStyle3D> = {}
    for (const [name, raw] of Object.entries(r.scenes as Record<string, unknown>).slice(0, 32)) {
      if (name.trim() === '' || name.length > 40 || raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
      scenes[name] = sceneStyleOf(raw as Record<string, unknown>)
    }
    if (Object.keys(scenes).length > 0) out.scenes = scenes
  }
  return Object.keys(out).length === 0 ? undefined : { style3d: out }
}

const clampNum = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined

/** The keys a scene may override (and the game-wide style shares): colors, fog, light. */
function sceneStyleOf(r: Record<string, unknown>): { -readonly [K in keyof SceneStyle3D]: SceneStyle3D[K] } {
  const out: { -readonly [K in keyof SceneStyle3D]: SceneStyle3D[K] } = {}
  for (const key of ['bg', 'ground', 'ground2', 'water'] as const) {
    const v = r[key]
    if (typeof v === 'string' && HEX.test(v)) out[key] = v.toLowerCase()
  }
  const light = clampNum(r.light, 0, 4)
  if (light !== undefined) out.light = light
  if (Array.isArray(r.fog) && r.fog.length === 2) {
    const a = clampNum(r.fog[0], 0, 500), b = clampNum(r.fog[1], 0, 1000)
    if (a !== undefined && b !== undefined && b > a) out.fog = [a, b]
  }
  return out
}

/** The manifest's `runtime` when it names a shipped kit with a positive integer version. */
function runtimeOf(raw: unknown): { runtime: KitRef } | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  if (!isKitId(r.kit)) return undefined
  const version = typeof r.version === 'number' && Number.isInteger(r.version) && r.version > 0 ? r.version : 1
  return { runtime: { kit: r.kit, version } }
}

/** Serialize a manifest the way the plugin writes it. */
export function serializeManifest(manifest: GameManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

/**
 * A chapter's status from its text: empty is `todo`, a `状态：定稿` (or
 * `status: done`) line is `done`, anything else is a `draft`.
 */
export function chapterStatus(text: string | undefined): ChapterStatus {
  if (text === undefined || text.trim() === '') return 'todo'
  if (/^\s*(状态[:：]\s*定稿|status:\s*done)\s*$/im.test(text)) return 'done'
  return 'draft'
}

/**
 * The one-pager (pitch, element types, style, pillars) lives in `game.json`
 * and the panel pins it; `design/pillars.md` holds only the notes about the
 * pillars (why each matters, how to test it). Projects created before
 * 2026-10-10 got a pillars.md that restated the one-pager: this strips those
 * restated lines so the notes view never shows the card twice.
 * @param text - the chapter's text.
 * @param manifest - the one-pager it may restate.
 * @returns the notes that are not a restatement (trimmed; '' when none).
 */
export function pillarNotes(text: string, manifest: Pick<GameManifest, 'title' | 'pitch' | 'pillars' | 'artStyle' | 'elementTypes'> | null): string {
  if (manifest === null) return text.trim()
  const pillars = new Set(manifest.pillars.map(p => p.trim()))
  const kept = text.split('\n').filter(line => {
    const l = line.trim()
    if (/^#\s/.test(l) && /设计支柱|支柱说明/.test(l)) return false
    if (l.startsWith('>') && l.replace(/^>\s*/, '') === manifest.pitch.trim()) return false
    if (/^(\d+\.|[-*])\s/.test(l) && pillars.has(l.replace(/^(\d+\.|[-*])\s+/, ''))) return false
    if (l === `美术风格：${artStyleLabel(manifest.artStyle)}` || l === `元素类型：${manifest.elementTypes.join('、')}`) return false
    if (l.startsWith('（还没定支柱')) return false
    return true
  })
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Element-file scalar values worth tabulating. */
function scalarStats(r: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(r)) {
    if (key === 'id' || key === 'type' || key === 'name' || key === 'look' || key === 'lore') continue
    if (typeof value === 'number' || typeof value === 'boolean' || (typeof value === 'string' && value.length <= 40)) out[key] = value
  }
  return out
}

/**
 * Validate the element files. A file holds one element object or an array of
 * them; each needs `id`, `name` and a `type` the manifest declares, and ids
 * are unique across files.
 * @param files - project-relative path → contents, only `elements/*.json`.
 * @param elementTypes - the manifest's declared types (empty = accept any).
 * @param looks - how the project's kit normalizes a `look` (default: 2D pixel rows).
 * @returns the elements that parsed, and one failure per problem.
 */
export function validateElements(
  files: Readonly<Record<string, string>>,
  elementTypes: readonly string[],
  looks: Pick<RuntimeKit, 'normalizeLook' | 'lookHint'> = { normalizeLook, lookHint: PIXEL_LOOK_HINT },
): { elements: ElementView[]; failures: CheckFailure[] } {
  const elements: ElementView[] = []
  const failures: CheckFailure[] = []
  const seen = new Map<string, string>()
  for (const [file, text] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch (error) {
      failures.push({ where: file, message: `不是合法 JSON：${(error as Error).message}` })
      continue
    }
    const items = Array.isArray(raw) ? raw : [raw]
    items.forEach((item, index) => {
      const at = Array.isArray(raw) ? `${file}[${index}]` : file
      if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        failures.push({ where: at, message: '元素应是对象' })
        return
      }
      const r = item as Record<string, unknown>
      const id = typeof r.id === 'string' ? r.id.trim() : ''
      const name = typeof r.name === 'string' ? r.name.trim() : ''
      const type = typeof r.type === 'string' ? r.type.trim() : ''
      if (id === '') failures.push({ where: at, message: '缺少 id' })
      if (name === '') failures.push({ where: at, message: '缺少 name' })
      if (type === '') failures.push({ where: at, message: '缺少 type' })
      else if (elementTypes.length > 0 && !elementTypes.includes(type)) {
        failures.push({ where: at, message: `type「${type}」不在 game.json 的 elementTypes（${elementTypes.join('、')}）里` })
      }
      if (id !== '') {
        const earlier = seen.get(id)
        if (earlier !== undefined) failures.push({ where: at, message: `id「${id}」和 ${earlier} 重复` })
        else seen.set(id, at)
      }
      if (r.look !== undefined && looks.normalizeLook(r.look) === null) failures.push({ where: at, message: looks.lookHint })
      if (id !== '' && name !== '' && type !== '') {
        const look = looks.normalizeLook(r.look)
        elements.push({
          file, index: Array.isArray(raw) ? index : -1, id, type, name, stats: scalarStats(r),
          look: look !== null && isPixelLook(look) ? look : null,
          look3d: look !== null && !isPixelLook(look) ? look : null,
          lore: typeof r.lore === 'string' ? r.lore.trim() : '',
        })
      }
    })
  }
  return { elements, failures }
}

/** The generated 元素与数值 chapter: one table per element type. */
export function elementsChapter(elements: readonly ElementView[], elementTypes: readonly string[]): string {
  if (elements.length === 0) return ''
  const types = [...elementTypes, ...elements.map(e => e.type).filter(t => !elementTypes.includes(t))]
  const lines = ['# 元素与数值', '', '（由 elements/ 里的文件自动生成，改数值请改元素文件。）', '']
  for (const type of types) {
    const rows = elements.filter(e => e.type === type)
    if (rows.length === 0) continue
    const keys = [...new Set(rows.flatMap(e => Object.keys(e.stats)))].slice(0, 8)
    lines.push(`## ${type}`, '', `| 名称 | id | ${keys.join(' | ')} |`.replace(/ \|  \|$/, ' |'), `|${' --- |'.repeat(2 + keys.length)}`)
    for (const e of rows) lines.push(`| ${e.name} | ${e.id} | ${keys.map(k => String(e.stats[k] ?? '')).join(' | ')} |`.replace(/ \|  \|$/, ' |'))
    lines.push('')
  }
  return lines.join('\n')
}

/** The generated 元素设定 chapter: every element's 设定 by type (elements without one are left out). */
export function loreChapter(elements: readonly ElementView[], elementTypes: readonly string[]): string {
  const written = elements.filter(e => e.lore !== '')
  if (written.length === 0) return ''
  const types = [...elementTypes, ...written.map(e => e.type).filter(t => !elementTypes.includes(t))]
  const lines = ['# 元素设定', '', '（由元素文件里的设定自动汇总，在「元素」里打开一个元素就能改。）', '']
  for (const type of types) {
    const rows = written.filter(e => e.type === type)
    if (rows.length === 0) continue
    lines.push(`## ${type}`, '')
    for (const e of rows) lines.push(`### ${e.name}`, '', e.lore, '')
  }
  return lines.join('\n')
}

/** Directories never part of a playable build. */
const NON_BUILD_DIRS = new Set([STATE_DIR, 'design', 'tests', 'node_modules', '.git'])

/**
 * Whether a project-relative path belongs in a playable build: everything
 * except the plugin's state, the design doc, the tests and dot-files.
 */
export function isBuildFile(path: string): boolean {
  const segments = path.split('/')
  if (segments.some(s => s.startsWith('.') && s !== '.')) return false
  return !NON_BUILD_DIRS.has(segments[0] ?? '')
}

/** File-extension → MIME type for the sandbox loader. */
const TYPES: Readonly<Record<string, string>> = {
  html: 'text/html', htm: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json',
  txt: 'text/plain', md: 'text/markdown', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', wav: 'audio/wav', ogg: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  glb: 'model/gltf-binary', gltf: 'model/gltf+json',
}

/** Extensions shipped as text (everything else is base64). */
const TEXT_EXT = new Set(['html', 'htm', 'js', 'mjs', 'css', 'json', 'txt', 'md', 'svg'])

/** The extension of a path, lower-cased, without the dot. */
function extOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
}

/** A file's MIME type by extension. */
export function mimeOf(path: string): string {
  return TYPES[extOf(path)] ?? 'application/octet-stream'
}

/** Whether a file ships to the sandbox as text. */
export function isTextFile(path: string): boolean {
  return TEXT_EXT.has(extOf(path))
}

/**
 * A directory-safe project folder name from a title: ASCII letters and
 * digits kept, other runs collapsed to `-`; a title with none falls back to
 * `game`. The store appends `-2`, `-3` … on collision.
 */
export function slugOf(title: string): string {
  const slug = title.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return slug === '' ? 'game' : slug
}

/**
 * Apply a patch to one element inside its file's text (an object, or one
 * entry of an array), keeping every other key. `undefined` values delete.
 * @returns the new file text, or undefined when the element is not there.
 */
export function patchElementText(text: string, elementId: string, patch: Readonly<Record<string, unknown>>): string | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return undefined
  }
  const items = Array.isArray(raw) ? raw : [raw]
  const target = items.find(item => item !== null && typeof item === 'object' && (item as Record<string, unknown>).id === elementId) as Record<string, unknown> | undefined
  if (target === undefined) return undefined
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'id') continue
    if (value === undefined) delete target[key]
    else target[key] = value
  }
  return `${JSON.stringify(raw, null, 2)}\n`
}

/** A look as model-facing text: palette, then each state's rows. */
export function lookText(look: ElementLook): string {
  const lines = [`palette: ${look.palette.map((c, i) => `${LOOK_CHARS[i]}=${c}`).join(' ')}`]
  for (const [state, rows] of Object.entries(look.states)) lines.push(`${state}:`, ...rows.map(row => `  ${row}`))
  return lines.join('\n')
}
