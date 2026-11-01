/**
 * 整理设定 (novel@5, 2026-11-01): moving a work's old 世界 cards onto the four
 * 世界观 shelves — 体系 / 地点 / 势力 / 物种与道具 — and the 原则 cards that are
 * really settings onto 体系 (or settings that are really writing rules onto
 * 写作原则), with the parents that tie them together and the shelf entries the
 * text only implied (a 体系 a group of rules shares, a 势力 named inside a rule).
 *
 * It is two-step on purpose: the agent proposes, the engine stores the plan
 * and answers the 整理结果; only a person who has spoken since may have it
 * applied (the plan-confirm guard). This module is the pure half: the plan's
 * shape, its tolerant read, and its rendering.
 *
 * @module @khorsheed/dsh-canvas-novel
 */
import { SETTING_SORTS, settingSortOf, type SettingSort } from './genre.ts'

/** Where a card goes: a 世界观 shelf, or 写作原则. */
export type OrganizeTarget = SettingSort | 'principle'

/** One card moved: to a shelf, under a parent (a card id, or a new entry's key). */
export interface OrganizeMove {
  readonly cardId: string
  readonly to: OrganizeTarget
  /** The name a 原则 card gets when it becomes a setting. */
  readonly name?: string
  readonly parent?: string
}

/** One shelf entry the text only implied, created by the plan (keyed `n1`, `n2`, … so moves can sit under it). */
export interface OrganizeCreate {
  readonly key: string
  readonly to: SettingSort
  readonly name: string
  readonly rule: string
  readonly parent?: string
}

/** A stored plan: what applying it does, and where it was put to the person. */
export interface OrganizePlan {
  readonly moves: readonly OrganizeMove[]
  readonly creates: readonly OrganizeCreate[]
  readonly ask?: { readonly session: string; readonly userSeq: number }
  readonly at: string
  /** Set once applied: an applied plan never applies again. */
  readonly appliedAt?: string
}

/** The target a word names: a shelf (体系、地点、势力、物种与道具 …) or 原则 / 写作原则. */
export function organizeTargetOf(word: unknown): OrganizeTarget | undefined {
  if (typeof word !== 'string') return undefined
  const text = word.trim()
  if (text === '原则' || text === '写作原则' || text === 'principle') return 'principle'
  return settingSortOf(text)
}

/** Tolerant read of a stored plan. */
export function normalizeOrganizePlan(raw: unknown): OrganizePlan | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const text = (value: unknown, max: number): string | undefined => typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : undefined
  const moves = (Array.isArray(record['moves']) ? record['moves'] : []).flatMap((row): OrganizeMove[] => {
    if (typeof row !== 'object' || row === null) return []
    const item = row as Record<string, unknown>
    const cardId = text(item['cardId'], 80)
    const to = organizeTargetOf(item['to'])
    if (cardId === undefined || to === undefined) return []
    const name = text(item['name'], 80)
    const parent = text(item['parent'], 80)
    return [{ cardId, to, ...(name === undefined ? {} : { name }), ...(parent === undefined ? {} : { parent }) }]
  })
  const creates = (Array.isArray(record['creates']) ? record['creates'] : []).flatMap((row): OrganizeCreate[] => {
    if (typeof row !== 'object' || row === null) return []
    const item = row as Record<string, unknown>
    const key = text(item['key'], 20)
    const to = settingSortOf(text(item['to'], 20))
    const name = text(item['name'], 80)
    const rule = text(item['rule'], 2000)
    if (key === undefined || to === undefined || name === undefined || rule === undefined) return []
    const parent = text(item['parent'], 80)
    return [{ key, to, name, rule, ...(parent === undefined ? {} : { parent }) }]
  })
  const askRaw = record['ask'] as Record<string, unknown> | undefined
  const ask = typeof askRaw === 'object' && askRaw !== null && typeof askRaw['session'] === 'string' && typeof askRaw['userSeq'] === 'number'
    ? { session: askRaw['session'], userSeq: askRaw['userSeq'] }
    : undefined
  const at = text(record['at'], 40) ?? ''
  const appliedAt = text(record['appliedAt'], 40)
  return { moves, creates, ...(ask === undefined ? {} : { ask }), at, ...(appliedAt === undefined ? {} : { appliedAt }) }
}

/** A target's label. */
export function targetLabel(to: OrganizeTarget): string {
  return to === 'principle' ? '写作原则' : SETTING_SORTS[to]
}

/**
 * The 整理结果 as the agent shows it: shelf by shelf, each entry with what
 * sits under it, the new entries marked.
 * @param plan - the plan.
 * @param nameOf - a card's display name (`[w3] 命名维护`).
 * @param fromOf - where a card sits now (世界 · 规则, 原则 …).
 */
export function renderOrganizePlan(plan: OrganizePlan, nameOf: (cardId: string) => string, fromOf: (cardId: string) => string): string {
  const labelOfParent = (parent: string | undefined): string | undefined => {
    if (parent === undefined) return undefined
    const created = plan.creates.find(row => row.key === parent)
    return created === undefined ? nameOf(parent) : `${created.name}（新建）`
  }
  const lines: string[] = [`整理结果：${plan.moves.length} 张卡换位置，新建 ${plan.creates.length} 张。`]
  for (const to of ['system', 'place', 'faction', 'item', 'principle'] as const) {
    const created = plan.creates.filter(row => row.to === to)
    const moved = plan.moves.filter(row => row.to === to)
    if (created.length + moved.length === 0) continue
    lines.push('', `## ${targetLabel(to)}（${created.length + moved.length}）`)
    for (const row of created) {
      const under = labelOfParent(row.parent)
      lines.push(`- 新建「${row.name}」${under === undefined ? '' : ` · 属于 ${under}`}：${row.rule.slice(0, 40)}${row.rule.length > 40 ? '…' : ''}`)
    }
    for (const row of moved) {
      const under = labelOfParent(row.parent)
      lines.push(`- ${row.name === undefined ? nameOf(row.cardId) : `${nameOf(row.cardId)} → 「${row.name}」`}（原来：${fromOf(row.cardId)}）${under === undefined ? '' : ` · 属于 ${under}`}`)
    }
  }
  return lines.join('\n')
}
