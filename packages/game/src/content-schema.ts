/**
 * Content-data checks driven by the project's own `design/schema.json`.
 *
 * The plugin ships NO subject-matter vocabulary: the project declares its ID
 * namespaces, where references to them sit, and the parameters of its own
 * conditions and effects. This module only knows the declaration grammar —
 * source paths, basic types, `all / any / not`, the `elements` source and
 * `clip(…)` (an animation clip in an element's glTF model) — and reports every
 * reference that does not resolve.
 *
 * Source paths: `<file glob>#<path>`, or `elements#<path>` for every element
 * object. Path segments are dot-separated; `name[]` walks each item of the
 * array at `name`, `*` each value of a map, `@` each key of a map.
 * @module @khorsheed/dsh-game/content-schema
 */
import type { CheckFailure } from './types.ts'

/** The declaration file a project may add. */
export const SCHEMA_FILE = 'design/schema.json'

/** At most this many failures are reported (the first ones say enough). */
const MAX_FAILURES = 40

/** One JSON document the checks look at. */
export interface ContentDoc {
  /** Project-relative path. */
  readonly file: string
  readonly value: unknown
}

/** What the checker needs beyond the documents. */
export interface ContentInput {
  /** `design/**\/*.json` documents (the schema file excluded). */
  readonly docs: readonly ContentDoc[]
  /** Element objects with the file each came from. */
  readonly elements: readonly { readonly file: string; readonly element: Readonly<Record<string, unknown>> }[]
  /** Clip names of a project model file (glb/gltf), undefined when unreadable. */
  readonly clipsOf: (path: string) => readonly string[] | undefined
}

/** A located value found by walking a source path. */
interface Hit {
  readonly file: string
  readonly where: string
  readonly value: unknown
  /** The enclosing object (for `clip(param)` siblings). */
  readonly parent: unknown
  /** Set when the value is a map key (`@`). */
  readonly key?: boolean
}

type Obj = Readonly<Record<string, unknown>>
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Glob (`*` within a segment, `**` across) → RegExp. */
function globRe(glob: string): RegExp {
  const body = glob.split('**').map(part => part.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*')
  return new RegExp(`^${body}$`)
}

/** Walk `path` from `root`, collecting every value (or key) it lands on. */
function walk(file: string, root: unknown, path: string): Hit[] {
  let hits: Hit[] = [{ file, where: '', value: root, parent: undefined }]
  for (const raw of path.split('.').filter(s => s !== '')) {
    const next: Hit[] = []
    const each = raw.endsWith('[]')
    const name = each ? raw.slice(0, -2) : raw
    for (const h of hits) {
      if (h.key === true) continue
      let stage: Hit[]
      if (name === '*') stage = isObj(h.value) ? Object.entries(h.value).map(([k, v]) => ({ file, where: `${h.where}.${k}`, value: v, parent: h.value })) : []
      else if (name === '@') stage = isObj(h.value) ? Object.keys(h.value).map(k => ({ file, where: `${h.where}.${k}`, value: k, parent: h.value, key: true })) : []
      else if (name === '') stage = [h]
      else stage = isObj(h.value) && name in h.value ? [{ file, where: `${h.where}.${name}`, value: h.value[name], parent: h.value }] : []
      if (each) {
        for (const s of stage) {
          if (Array.isArray(s.value)) s.value.forEach((v, i) => next.push({ file, where: `${s.where}[${i}]`, value: v, parent: s.value }))
        }
      } else next.push(...stage)
    }
    hits = next
  }
  return hits.map(h => ({ ...h, where: h.where.replace(/^\./, '') }))
}

/** Every value a source points at, across the matching documents. */
function resolveSource(source: string, input: ContentInput): Hit[] | string {
  const hash = source.indexOf('#')
  if (hash < 0) return `来源「${source}」缺少 #：写成「文件#路径」，例如 design/scenes/*.json#zones[].id`
  const files = source.slice(0, hash)
  const path = source.slice(hash + 1)
  if (files === 'elements') return input.elements.flatMap(e => walk(e.file, e.element, path))
  const re = globRe(files)
  return input.docs.filter(d => re.test(d.file)).flatMap(d => walk(d.file, d.value, path))
}

/** A namespace's members (and, for alias maps, what each alias stands for). */
interface Namespace {
  readonly members: ReadonlySet<string>
  readonly alias?: Readonly<Record<string, string>>
}

/** One declared type, parsed. */
type TypeSpec =
  | { readonly kind: 'basic'; readonly name: 'string' | 'number' | 'boolean' | 'any' }
  | { readonly kind: 'ns'; readonly name: string }
  | { readonly kind: 'clip'; readonly of: string }
  | { readonly kind: 'map'; readonly item: TypeSpec }
  | { readonly kind: 'list'; readonly item: TypeSpec }
  | { readonly kind: 'union'; readonly options: readonly TypeSpec[] }

const BASIC = new Set(['string', 'number', 'boolean', 'any'])

/** Parse `a|b`, `map<T>`, `list<T>`, `clip(x)`, a basic type or a namespace name. */
function parseType(text: string, namespaces: ReadonlyMap<string, Namespace>): TypeSpec | string {
  const t = text.trim()
  const parts: string[] = []
  let depth = 0, start = 0
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (c === '<' || c === '(') depth++
    else if (c === '>' || c === ')') depth--
    else if (c === '|' && depth === 0) { parts.push(t.slice(start, i)); start = i + 1 }
  }
  parts.push(t.slice(start))
  if (parts.length > 1) {
    const options: TypeSpec[] = []
    for (const p of parts) { const o = parseType(p, namespaces); if (typeof o === 'string') return o; options.push(o) }
    return { kind: 'union', options }
  }
  const wrapped = /^(map|list)<(.+)>$/.exec(t)
  if (wrapped) {
    const item = parseType(wrapped[2]!, namespaces)
    return typeof item === 'string' ? item : { kind: wrapped[1] as 'map' | 'list', item }
  }
  const clip = /^clip\((.+)\)$/.exec(t)
  if (clip) return { kind: 'clip', of: clip[1]!.trim() }
  if (BASIC.has(t)) return { kind: 'basic', name: t as 'string' }
  if (namespaces.has(t) || t === 'element') return { kind: 'ns', name: t }
  return `未知类型「${t}」：基本类型是 string / number / boolean / any，其余要先在 ids 里声明`
}

/** A declared parameter: its type and whether it may be absent. */
interface Param { readonly type: TypeSpec; readonly optional: boolean }

/** Parse a `{ name: "type?" }` parameter table. */
function parseParams(table: unknown, namespaces: ReadonlyMap<string, Namespace>): Map<string, Param> | string {
  if (!isObj(table)) return '参数表必须是对象，例如 { "id": "element", "count": "number?" }'
  const out = new Map<string, Param>()
  for (const [name, raw] of Object.entries(table)) {
    if (typeof raw !== 'string') return `参数「${name}」的类型必须是字符串`
    const optional = raw.trim().endsWith('?')
    const type = parseType(optional ? raw.trim().slice(0, -1) : raw, namespaces)
    if (typeof type === 'string') return `参数「${name}」：${type}`
    out.set(name, { type, optional })
  }
  return out
}

/**
 * Check the project's content data against its declaration.
 * @param schemaText - the raw `design/schema.json`.
 * @param input - the documents, elements and a clip reader.
 * @returns the failures, empty when every reference resolves.
 */
export function checkContent(schemaText: string, input: ContentInput): CheckFailure[] {
  const failures: CheckFailure[] = []
  const fail = (where: string, message: string): void => { if (failures.length < MAX_FAILURES) failures.push({ where, message }) }
  let schema: unknown
  try { schema = JSON.parse(schemaText) } catch (error) {
    fail(SCHEMA_FILE, `不是合法的 JSON：${(error as Error).message}`)
    return failures
  }
  if (!isObj(schema)) { fail(SCHEMA_FILE, '顶层必须是对象'); return failures }

  // ---- namespaces
  const elementIds = new Set(input.elements.map(e => e.element.id).filter((id): id is string => typeof id === 'string'))
  const elementOf = new Map(input.elements.filter(e => typeof e.element.id === 'string').map(e => [e.element.id as string, e]))
  const namespaces = new Map<string, Namespace>([['element', { members: elementIds }]])
  const ids = isObj(schema.ids) ? schema.ids : {}
  for (const [name, decl] of Object.entries(ids)) {
    const where = `${SCHEMA_FILE} › ids.${name}`
    if (!isObj(decl)) { fail(where, '必须是对象：{ "from": "文件#路径" }、{ "list": [...] } 或 { "map": { 别名: 元素ID } }'); continue }
    if (typeof decl.from === 'string') {
      if (decl.from === 'elements') { namespaces.set(name, { members: elementIds }); continue }
      const hits = resolveSource(decl.from, input)
      if (typeof hits === 'string') { fail(where, hits); continue }
      const members = new Set<string>()
      for (const h of hits) if (typeof h.value === 'string') members.add(h.value)
      if (members.size === 0) fail(where, `来源「${decl.from}」一个编号也没找到：检查文件名和路径`)
      namespaces.set(name, { members })
    } else if (Array.isArray(decl.list)) {
      namespaces.set(name, { members: new Set(decl.list.filter((v): v is string => typeof v === 'string')) })
    } else if (isObj(decl.map)) {
      const alias: Record<string, string> = {}
      for (const [a, target] of Object.entries(decl.map)) {
        if (typeof target !== 'string' || !elementIds.has(target)) fail(`${where}.map.${a}`, `别名「${a}」指向的元素「${String(target)}」不存在`)
        else alias[a] = target
      }
      namespaces.set(name, { members: new Set(Object.keys(alias)), alias })
    } else fail(where, '要写 from、list 或 map 之一')
  }

  // ---- value checks
  /** The element a clip target names: an element id, or an alias of an alias map. */
  const targetElement = (name: string): string | undefined => {
    if (elementIds.has(name)) return name
    for (const ns of namespaces.values()) if (ns.alias?.[name] !== undefined) return ns.alias[name]
    return undefined
  }
  const clipCache = new Map<string, readonly string[] | undefined>()
  const clipsOfElement = (id: string): readonly string[] | string => {
    const e = elementOf.get(id)
    const look = e?.element.look
    if (!isObj(look) || look.kind !== 'gltf' || typeof look.src !== 'string') return `元素「${id}」没有 glTF 模型外观，核对不了动画`
    if (!clipCache.has(look.src)) clipCache.set(look.src, input.clipsOf(look.src))
    const clips = clipCache.get(look.src)
    return clips === undefined ? `读不出 ${look.src} 里的动画` : clips
  }

  const isRuntimeParam = (v: unknown): boolean => typeof v === 'string' && v.startsWith('$')
  /** Check one value; returns the problem or undefined. */
  const check = (value: unknown, type: TypeSpec, parent: unknown, key?: string): string | undefined => {
    if (isRuntimeParam(value)) return undefined
    switch (type.kind) {
      case 'basic':
        return type.name === 'any' || typeof value === type.name ? undefined : `应为 ${type.name}，实际是 ${JSON.stringify(value)}`
      case 'ns': {
        const ns = namespaces.get(type.name)!
        if (typeof value !== 'string') return `应为「${type.name}」编号（字符串），实际是 ${JSON.stringify(value)}`
        return ns.members.has(value) ? undefined : `「${value}」不是已有的 ${type.name}${hintOf(ns.members, value)}`
      }
      case 'clip': {
        if (typeof value !== 'string') return `动画名应为字符串，实际是 ${JSON.stringify(value)}`
        const ownerName = type.of === '@' ? key : isObj(parent) && typeof parent[type.of] === 'string' ? parent[type.of] as string : undefined
        if (ownerName === undefined || isRuntimeParam(ownerName)) return undefined
        const element = targetElement(ownerName)
        if (element === undefined) return `动画目标「${ownerName}」既不是元素也不是声明过的别名`
        const clips = clipsOfElement(element)
        if (typeof clips === 'string') return clips
        return clips.includes(value) ? undefined : `「${element}」的模型里没有动画「${value}」${clips.length > 0 ? `（有：${clips.slice(0, 12).join('、')}）` : '（模型里没有动画）'}`
      }
      case 'map': {
        if (!isObj(value)) return `应为对象（映射），实际是 ${JSON.stringify(value)}`
        for (const [k, v] of Object.entries(value)) { const p = check(v, type.item, value, k); if (p !== undefined) return `${k}：${p}` }
        return undefined
      }
      case 'list': {
        if (!Array.isArray(value)) return `应为数组，实际是 ${JSON.stringify(value)}`
        for (const [i, v] of value.entries()) { const p = check(v, type.item, value); if (p !== undefined) return `[${i}]：${p}` }
        return undefined
      }
      case 'union': {
        const problems = type.options.map(o => check(value, o, parent, key))
        return problems.some(p => p === undefined) ? undefined : problems[0]
      }
    }
  }
  const at = (h: Hit): string => (h.where === '' ? h.file : `${h.file} › ${h.where}`)

  // ---- refs
  const refs = isObj(schema.refs) ? schema.refs : {}
  for (const [source, typeText] of Object.entries(refs)) {
    const where = `${SCHEMA_FILE} › refs`
    if (typeof typeText !== 'string') { fail(where, `「${source}」的类型必须是字符串`); continue }
    const type = parseType(typeText, namespaces)
    if (typeof type === 'string') { fail(where, `「${source}」：${type}`); continue }
    const hits = resolveSource(source, input)
    if (typeof hits === 'string') { fail(where, hits); continue }
    for (const h of hits) {
      const values = Array.isArray(h.value) ? h.value : [h.value]
      for (const v of values) {
        const problem = check(v, type, h.parent, h.key === true ? undefined : h.where.split('.').pop())
        if (problem !== undefined) fail(at(h), problem)
      }
    }
  }

  // ---- conditions and effects
  const conditions = new Map<string, Param | Map<string, Param>>()
  for (const [name, decl] of Object.entries(isObj(schema.conditions) ? schema.conditions : {})) {
    const where = `${SCHEMA_FILE} › conditions.${name}`
    if (['all', 'any', 'not'].includes(name)) { fail(where, 'all / any / not 是内置组合，不用声明'); continue }
    if (typeof decl === 'string') {
      const optional = decl.trim().endsWith('?')
      const type = parseType(optional ? decl.trim().slice(0, -1) : decl, namespaces)
      if (typeof type === 'string') fail(where, type)
      else conditions.set(name, { type, optional })
    } else {
      const params = parseParams(decl, namespaces)
      if (typeof params === 'string') fail(where, params)
      else conditions.set(name, params)
    }
  }
  const effects = new Map<string, Map<string, Param>>()
  for (const [name, decl] of Object.entries(isObj(schema.effects) ? schema.effects : {})) {
    const params = parseParams(decl, namespaces)
    if (typeof params === 'string') fail(`${SCHEMA_FILE} › effects.${name}`, params)
    else effects.set(name, params)
  }
  const checkParams = (obj: Obj, params: Map<string, Param>, where: string, skip: readonly string[]): void => {
    for (const [name, p] of params) {
      if (!(name in obj)) { if (!p.optional) fail(where, `缺少参数「${name}」`); continue }
      const problem = check(obj[name], p.type, obj, name)
      if (problem !== undefined) fail(`${where}.${name}`, problem)
    }
    for (const name of Object.keys(obj)) if (!skip.includes(name) && !params.has(name)) fail(`${where}.${name}`, `没有声明的参数「${name}」（声明里有：${[...params.keys()].join('、') || '无'}）`)
  }
  const checkCondition = (value: unknown, where: string): void => {
    if (value === true || value === false) return
    if (!isObj(value)) { fail(where, `条件应为对象或 true/false，实际是 ${JSON.stringify(value)}`); return }
    for (const [name, arg] of Object.entries(value)) {
      if (name === 'all' || name === 'any') {
        if (!Array.isArray(arg)) fail(`${where}.${name}`, '应为条件数组')
        else arg.forEach((c, i) => { checkCondition(c, `${where}.${name}[${i}]`) })
        continue
      }
      if (name === 'not') { checkCondition(arg, `${where}.not`); continue }
      const decl = conditions.get(name)
      if (decl === undefined) { fail(`${where}.${name}`, `未声明的条件「${name}」${hintOf(new Set(conditions.keys()), name)}`); continue }
      if (decl instanceof Map) {
        if (!isObj(arg)) fail(`${where}.${name}`, `应为参数对象，实际是 ${JSON.stringify(arg)}`)
        else checkParams(arg, decl, `${where}.${name}`, [])
      } else {
        const problem = check(arg, decl.type, value, name)
        if (problem !== undefined) fail(`${where}.${name}`, problem)
      }
    }
  }
  const checkEffect = (value: unknown, where: string): void => {
    if (!isObj(value) || typeof value.type !== 'string') { fail(where, '效果应为带 type 的对象'); return }
    const params = effects.get(value.type)
    if (params === undefined) { fail(`${where}.type`, `未声明的效果「${value.type}」${hintOf(new Set(effects.keys()), value.type)}`); return }
    checkParams(value, params, where, ['type'])
  }
  const slots = isObj(schema.slots) ? schema.slots : {}
  for (const [source, kind] of Object.entries(slots)) {
    if (kind !== 'condition' && kind !== 'effect') { fail(`${SCHEMA_FILE} › slots`, `「${source}」只能是 condition 或 effect`); continue }
    const hits = resolveSource(source, input)
    if (typeof hits === 'string') { fail(`${SCHEMA_FILE} › slots`, hits); continue }
    for (const h of hits) (kind === 'condition' ? checkCondition : checkEffect)(h.value, at(h))
  }
  return failures
}

/** «did you mean» for a near miss (same text ignoring case/dashes, or one edit away). */
function hintOf(members: ReadonlySet<string>, value: string): string {
  const norm = (s: string): string => s.toLowerCase().replace(/[-_\s]/g, '')
  const near = [...members].find(m => norm(m) === norm(value) || distance(m, value) === 1)
  return near === undefined ? '' : `（是不是「${near}」？）`
}

/** Edit distance with adjacent transpositions (so `valut` is one step from `vault`); 2 means «2 or more». */
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1)
      d[i]![j] = v
    }
  }
  return d[a.length]![b.length]!
}

/**
 * Animation clip names in a glb / glTF file (the JSON chunk's `animations[].name`).
 * @param data - the file bytes.
 * @returns the names, or undefined when the file cannot be read as glTF.
 */
export function gltfClips(data: Buffer): readonly string[] | undefined {
  try {
    let json: unknown
    if (data.length >= 20 && data.readUInt32LE(0) === 0x46546c67) {
      const len = data.readUInt32LE(12)
      if (data.readUInt32LE(16) !== 0x4e4f534a) return undefined
      json = JSON.parse(data.subarray(20, 20 + len).toString('utf8'))
    } else json = JSON.parse(data.toString('utf8'))
    const anims = isObj(json) && Array.isArray(json.animations) ? json.animations : []
    return anims.map((a, i) => (isObj(a) && typeof a.name === 'string' ? a.name : `animation_${i}`))
  } catch {
    return undefined
  }
}
