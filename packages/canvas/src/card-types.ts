/**
 * Card types (2026-09-30 proposal, P1a): a category can carry a DEFINITION —
 * a field table, a layout and an example card — that the agent drafts as a
 * PROPOSAL and the user adopts. A category without one stays a plain note
 * card, exactly as before.
 *
 * Everything here is runtime-agnostic (no DOM, no node): the host reads and
 * checks with it, the client renders with it. Two reads, deliberately apart:
 *
 * - the TOLERANT reads (`normalize*`) are for what is already stored — a
 *   hand-edited `canvas.json` drops a bad field or value, never the card, and
 *   a value whose field the definition no longer has is KEPT (the card page
 *   lists it under 「已移除的字段」; nothing is silently deleted);
 * - the STRICT check (`checkFieldValues`) is for what the agent sends — every
 *   problem is listed back, nothing is silently dropped.
 *
 * @module @khorsheed/dsh-canvas
 */
import type { CardCategoryId } from './types.ts'

/** The field kinds a definition may use (Novelcrafter's small set, plus number). */
export const FIELD_TYPES = ['line', 'text', 'select', 'tags', 'ref', 'number'] as const

/** One field kind. */
export type FieldType = (typeof FIELD_TYPES)[number]

/** The layouts a definition may pick (custom HTML templates are P1c). */
export const TYPE_LAYOUTS = ['note', 'profile', 'entry'] as const

/** One layout. */
export type TypeLayout = (typeof TYPE_LAYOUTS)[number]

/**
 * One stored value: text for line/text/select, a number, or a list (tags, and
 * the card ids a reference points at).
 */
export type FieldValue = string | number | string[]

/** One row of a definition's field table. */
export interface FieldDef {
  /** The stable id: a relabel keeps it, so values survive a rename. */
  readonly key: string
  readonly label: string
  readonly type: FieldType
  /** `select` only: the allowed values, in menu order. */
  readonly options?: readonly string[]
  /** `ref` only: which category's cards it may point at (absent = any). */
  readonly refKind?: CardCategoryId
  /** How to fill it — one line, for agents and people alike. */
  readonly hint: string
  readonly required?: boolean
  /** Shown on the card's board face. */
  readonly face?: boolean
}

/** The structured contract of one type. */
export interface TypeDefinition {
  /** +1 on every adoption; a proposal carries the number it would become. */
  readonly version: number
  readonly fields: readonly FieldDef[]
  readonly layout: TypeLayout
  /** How to write this kind of card overall (for agents). */
  readonly guide?: string
  /** One example card's values, the preview's default subject. */
  readonly example: Readonly<Record<string, FieldValue>>
}

/** The agent's pending draft for one type; at most one waits at a time. */
export interface TypeProposal {
  readonly definition: TypeDefinition
  readonly rationale: string
  /** Old field key → new, when a revision renames keys. */
  readonly renames?: Readonly<Record<string, string>>
  readonly createdAt: string
}

/** Most fields one definition holds. */
export const MAX_TYPE_FIELDS = 16

/** Most options one select field offers. */
export const MAX_FIELD_OPTIONS = 24

/** Most entries one list value (tags, references) holds. */
export const MAX_FIELD_LIST = 32

/** Longest single field value, in code units (a `text` field is a paragraph, not a chapter). */
export const MAX_FIELD_TEXT_LENGTH = 4000

/** Longest field label. */
export const MAX_FIELD_LABEL_LENGTH = 24

/** Longest field hint. */
export const MAX_FIELD_HINT_LENGTH = 200

/** Longest definition guide. */
export const MAX_TYPE_GUIDE_LENGTH = 2000

/** Longest proposal rationale. */
export const MAX_TYPE_RATIONALE_LENGTH = 2000

/** Longest brief (the same markdown a card body holds, but a brief is a note to the agent). */
export const MAX_TYPE_BRIEF_LENGTH = 20_000

/** Most fields shown on a board face (the title is not counted). */
export const MAX_FACE_FIELDS = 3

const FIELD_KEY = /^[a-z][a-z0-9_]{0,31}$/

/** Whether a string can be a field key. */
export function isFieldKey(value: unknown): value is string {
  return typeof value === 'string' && FIELD_KEY.test(value)
}

/** Whether a value is a field kind. */
export function isFieldType(value: unknown): value is FieldType {
  return typeof value === 'string' && (FIELD_TYPES as readonly string[]).includes(value)
}

/** Whether a value is a layout. */
export function isTypeLayout(value: unknown): value is TypeLayout {
  return typeof value === 'string' && (TYPE_LAYOUTS as readonly string[]).includes(value)
}

/** One line of display text: control characters out, whitespace collapsed, clipped. */
function cleanLine(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

/** Multi-line text: control characters other than newlines out, trimmed, clipped. */
function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max)
}

/** Read one untrusted field row, or undefined when it is unusable. */
function normalizeFieldDef(raw: unknown): FieldDef | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  if (!isFieldKey(record['key']) || !isFieldType(record['type'])) return undefined
  const label = cleanLine(record['label'], MAX_FIELD_LABEL_LENGTH) || record['key']
  const type = record['type']
  const field: {
    key: string; label: string; type: FieldType; hint: string
    options?: string[]; refKind?: CardCategoryId; required?: boolean; face?: boolean
  } = { key: record['key'], label, type, hint: cleanLine(record['hint'], MAX_FIELD_HINT_LENGTH) }
  if (type === 'select') {
    const options = Array.isArray(record['options'])
      ? [...new Set((record['options'] as unknown[]).map(option => cleanLine(option, MAX_FIELD_LABEL_LENGTH)).filter(option => option !== ''))]
      : []
    // A menu with nothing on it is not a menu; it reads as a line instead.
    if (options.length === 0) field.type = 'line'
    else field.options = options.slice(0, MAX_FIELD_OPTIONS)
  }
  if (type === 'ref' && typeof record['refKind'] === 'string' && record['refKind'] !== '') {
    field.refKind = record['refKind']
  }
  if (record['required'] === true) field.required = true
  if (record['face'] === true) field.face = true
  return field
}

/**
 * Read an untrusted definition, or undefined when nothing usable is left (no
 * field survived). Fields are unique by key, first row wins.
 * @param raw - a stored or wire `definition`.
 * @returns the definition, or undefined.
 */
export function normalizeDefinition(raw: unknown): TypeDefinition | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const fields: FieldDef[] = []
  const seen = new Set<string>()
  for (const entry of Array.isArray(record['fields']) ? record['fields'] as unknown[] : []) {
    if (fields.length >= MAX_TYPE_FIELDS) break
    const field = normalizeFieldDef(entry)
    if (field === undefined || seen.has(field.key)) continue
    seen.add(field.key)
    fields.push(field)
  }
  if (fields.length === 0) return undefined
  const version = typeof record['version'] === 'number' && Number.isFinite(record['version']) && record['version'] >= 1
    ? Math.floor(record['version'])
    : 1
  const guide = cleanText(record['guide'], MAX_TYPE_GUIDE_LENGTH)
  const example = normalizeFieldValues(record['example'])
  // An example keeps only the values its own fields can hold.
  for (const key of Object.keys(example)) if (!seen.has(key)) delete example[key]
  return {
    version,
    fields,
    layout: isTypeLayout(record['layout']) ? record['layout'] : 'note',
    ...(guide === '' ? {} : { guide }),
    example,
  }
}

/** Read an untrusted proposal, or undefined when its definition is unusable. */
export function normalizeTypeProposal(raw: unknown): TypeProposal | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const definition = normalizeDefinition(record['definition'])
  if (definition === undefined) return undefined
  const renames = normalizeRenames(record['renames'])
  return {
    definition,
    rationale: cleanText(record['rationale'], MAX_TYPE_RATIONALE_LENGTH),
    ...(Object.keys(renames).length === 0 ? {} : { renames }),
    createdAt: typeof record['createdAt'] === 'string' ? record['createdAt'] : new Date(0).toISOString(),
  }
}

/** Read an untrusted `renames` map: key → key, both well-formed, no self-maps. */
export function normalizeRenames(raw: unknown): Record<string, string> {
  const renames: Record<string, string> = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return renames
  for (const [from, to] of Object.entries(raw as Record<string, unknown>)) {
    if (isFieldKey(from) && isFieldKey(to) && from !== to) renames[from] = to
  }
  return renames
}

/** One stored value read tolerantly, or undefined. */
function normalizeFieldValue(raw: unknown): FieldValue | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined
  if (typeof raw === 'string') {
    const text = cleanText(raw, MAX_FIELD_TEXT_LENGTH)
    return text === '' ? undefined : text
  }
  if (Array.isArray(raw)) {
    const list = (raw as unknown[])
      .map(item => cleanLine(item, MAX_FIELD_LABEL_LENGTH * 4))
      .filter(item => item !== '')
      .slice(0, MAX_FIELD_LIST)
    return list.length === 0 ? undefined : list
  }
  return undefined
}

/**
 * Read an untrusted values map (a card's `fields`, a definition's example).
 * No definition is consulted: a value whose field was removed stays.
 * @param raw - the stored map.
 * @returns the well-formed values; empty ones drop out.
 */
export function normalizeFieldValues(raw: unknown): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return values
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isFieldKey(key)) continue
    const normalized = normalizeFieldValue(value)
    if (normalized !== undefined) values[key] = normalized
  }
  return values
}

/**
 * Move a card's values along a revision's renames. A value already under the
 * new key wins (it was written against the newer shape).
 * @param values - the card's values.
 * @param renames - old key → new key.
 * @returns the moved map (a new object).
 */
export function applyRenames(
  values: Readonly<Record<string, FieldValue>>,
  renames: Readonly<Record<string, string>> | undefined,
): Record<string, FieldValue> {
  const moved: Record<string, FieldValue> = { ...values }
  if (renames === undefined) return moved
  for (const [from, to] of Object.entries(renames)) {
    const value = values[from]
    if (value === undefined) continue
    delete moved[from]
    if (moved[to] === undefined) moved[to] = value
  }
  return moved
}

/** What a reference value's entries resolve against: `name → card id`, or undefined for no match. */
export type RefResolver = (entry: string, refKind: CardCategoryId | undefined) => string | undefined

/** The strict check's answer: the values to store, or every problem found. */
export type FieldCheck =
  | { readonly ok: true; readonly values: Record<string, FieldValue> }
  | { readonly ok: false; readonly problems: readonly string[] }

/** A list from whatever the agent sent: an array, or one string split on 、，, and ;. */
function listOf(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) return (raw as unknown[]).map(item => cleanLine(item, MAX_FIELD_LABEL_LENGTH * 4)).filter(item => item !== '')
  if (typeof raw === 'string') return raw.split(/[、,，;；]/).map(item => cleanLine(item, MAX_FIELD_LABEL_LENGTH * 4)).filter(item => item !== '')
  return undefined
}

/**
 * Check what the agent sent against a definition. Every problem is listed —
 * an unknown key, a missing required field, a value of the wrong shape, a
 * reference that names no card — so one retry can fix them all.
 * @param definition - the adopted definition.
 * @param raw - the agent's `fields` argument.
 * @param resolveRef - turns a reference entry (id or card name) into a card id.
 * @returns the values to store, or the problems.
 */
export function checkFieldValues(definition: TypeDefinition, raw: unknown, resolveRef: RefResolver): FieldCheck {
  const problems: string[] = []
  const values: Record<string, FieldValue> = {}
  const given = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  if (raw !== undefined && given !== raw) problems.push('fields 应是一个对象（字段 key → 值）。')
  const byKey = new Map(definition.fields.map(field => [field.key, field]))
  for (const key of Object.keys(given)) {
    if (!byKey.has(key)) problems.push(`没有字段「${key}」（可用：${definition.fields.map(field => field.key).join('、')}）。`)
  }
  for (const field of definition.fields) {
    const value = given[field.key]
    const empty = value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
      || (Array.isArray(value) && value.length === 0)
    if (empty) {
      if (field.required === true) problems.push(`缺必填字段 ${field.key}（${field.label}）：${field.hint}`)
      continue
    }
    const name = `${field.key}（${field.label}）`
    switch (field.type) {
      case 'line':
      case 'text': {
        if (typeof value !== 'string' && typeof value !== 'number') { problems.push(`${name} 应是文字。`); break }
        const text = field.type === 'line' ? cleanLine(String(value), MAX_FIELD_TEXT_LENGTH) : cleanText(String(value), MAX_FIELD_TEXT_LENGTH)
        if (text !== '') values[field.key] = text
        break
      }
      case 'number': {
        const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : Number.NaN
        if (!Number.isFinite(number)) { problems.push(`${name} 应是数字。`); break }
        values[field.key] = number
        break
      }
      case 'select': {
        const choice = cleanLine(value, MAX_FIELD_LABEL_LENGTH)
        if (!(field.options ?? []).includes(choice)) {
          problems.push(`${name} 只能取：${(field.options ?? []).join('、')}。`)
          break
        }
        values[field.key] = choice
        break
      }
      case 'tags': {
        const list = listOf(value)
        if (list === undefined) { problems.push(`${name} 应是字符串数组。`); break }
        if (list.length > 0) values[field.key] = [...new Set(list)].slice(0, MAX_FIELD_LIST)
        break
      }
      case 'ref': {
        const list = listOf(value)
        if (list === undefined) { problems.push(`${name} 应是卡片 id 数组。`); break }
        const ids: string[] = []
        for (const entry of list) {
          const id = resolveRef(entry, field.refKind)
          if (id === undefined) problems.push(`${name} 里的「${entry}」对不上画布上的卡（填卡片 id，或这类卡的准确名字）。`)
          else if (!ids.includes(id)) ids.push(id)
        }
        if (ids.length > 0) values[field.key] = ids.slice(0, MAX_FIELD_LIST)
        break
      }
    }
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, values }
}

/**
 * The field that names a card of this type: the first required line field,
 * else the first line field, else undefined (the body's first line then names
 * it, as before).
 */
export function titleFieldOf(definition: TypeDefinition): FieldDef | undefined {
  return definition.fields.find(field => field.type === 'line' && field.required === true)
    ?? definition.fields.find(field => field.type === 'line')
}

/** The fields shown on the board face under the title: at most {@link MAX_FACE_FIELDS}. */
export function faceFieldsOf(definition: TypeDefinition): FieldDef[] {
  const title = titleFieldOf(definition)
  return definition.fields.filter(field => field.face === true && field !== title).slice(0, MAX_FACE_FIELDS)
}

/**
 * One value as display text. References name their cards through `nameOf`
 * (the card's title, or its id when it is gone).
 */
export function fieldValueText(value: FieldValue | undefined, nameOf: (cardId: string) => string = id => id): string {
  if (value === undefined) return ''
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  return value.map(nameOf).join(' · ')
}

/** Whether a field holds a reference list (so its entries are card ids). */
export function isRefField(field: FieldDef | undefined): boolean {
  return field?.type === 'ref'
}

/**
 * A card's name under a definition: its title field's value, or '' when the
 * type has no title field or the card has no value there yet.
 */
export function typedTitleOf(definition: TypeDefinition | undefined, values: Readonly<Record<string, FieldValue>> | undefined): string {
  if (definition === undefined || values === undefined) return ''
  const field = titleFieldOf(definition)
  if (field === undefined) return ''
  const value = values[field.key]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

/** The values a card holds for fields its definition no longer has (「已移除的字段」). */
export function removedFieldValues(
  definition: TypeDefinition,
  values: Readonly<Record<string, FieldValue>> | undefined,
): [string, FieldValue][] {
  if (values === undefined) return []
  const keys = new Set(definition.fields.map(field => field.key))
  return Object.entries(values).filter(([key]) => !keys.has(key))
}

/**
 * The definition as the model reads it in `canvas_read_type`: one line per
 * field with its kind, marks and hint, then the layout, guide and example.
 */
export function renderDefinition(definition: TypeDefinition): string {
  const lines = [`版式：${definition.layout}　版本：v${definition.version}`, '字段：']
  for (const field of definition.fields) lines.push(`- ${fieldSignature(field)}　${field.hint}`)
  if (definition.guide !== undefined) lines.push(`写法：${definition.guide}`)
  lines.push(`示例：${JSON.stringify(definition.example)}`)
  return lines.join('\n')
}

/** One field as `key（名称）: 类型[选项] 必填 卡面` — the short form `canvas_read_board` lists. */
export function fieldSignature(field: FieldDef): string {
  const kind = field.type === 'select'
    ? `select[${(field.options ?? []).join('|')}]`
    : field.type === 'ref' ? `ref${field.refKind === undefined ? '' : `→${field.refKind}`}` : field.type
  const marks = [field.required === true ? '必填' : '', field.face === true ? '卡面' : ''].filter(mark => mark !== '')
  return `${field.key}（${field.label}）: ${kind}${marks.length > 0 ? ` ${marks.join(' ')}` : ''}`
}
