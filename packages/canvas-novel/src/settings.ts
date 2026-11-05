import { SETTING_SORTS, settingSortOf, type SettingSort } from './genre.ts'
import type { RuleView } from './types.ts'

/** A setting search hit, with the reason it matched. */
export interface SettingSearchHit {
  readonly rule: RuleView
  readonly match: 'exact' | 'name' | 'content'
}

/** A setting whose name may overlap the incoming one. */
export interface SettingDuplicate {
  readonly rule?: RuleView
  readonly reason: string
}

const GENERIC_NAMES = new Set(['公司', '企业', '团队', '组织', '世界', '地点', '道具', '规则', '体系'])

function normalized(value: string): string {
  return value.replace(/[（(](?:工作稿|暂定|待定|草稿)[）)]/g, '').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

function nameOf(rule: RuleView): string {
  return rule.name ?? rule.text.split(/[：:]/)[0]!.slice(0, 80)
}

/** Search kept and proposed settings by shelf, ref, name and content. */
export function searchSettings(
  rules: readonly RuleView[],
  request: { readonly query?: string; readonly kind?: string; readonly refs?: readonly string[]; readonly max?: number },
): SettingSearchHit[] {
  const sort = settingSortOf(request.kind)
  const refs = new Set(request.refs ?? [])
  const tokens = (request.query ?? '').toLocaleLowerCase().split(/\s+/).map(token => token.trim()).filter(Boolean)
  const normalizedQuery = normalized(request.query ?? '')
  const hits: { readonly hit: SettingSearchHit; readonly score: number; readonly index: number }[] = []
  rules.forEach((rule, index) => {
    if (rule.role !== 'world' || rule.status === 'archived' || (sort !== undefined && rule.sort !== sort)) return
    if (refs.size > 0 && !refs.has(rule.ref) && !refs.has(rule.cardId)) return
    const name = nameOf(rule)
    const haystack = `${name}\n${rule.text}`.toLocaleLowerCase()
    if (refs.size === 0 && tokens.length > 0 && !tokens.every(token => haystack.includes(token))) return
    const normalizedName = normalized(name)
    const exact = normalizedQuery !== '' && normalizedName === normalizedQuery
    const named = normalizedQuery !== '' && (normalizedName.includes(normalizedQuery) || normalizedQuery.includes(normalizedName))
    const match: SettingSearchHit['match'] = exact ? 'exact' : named ? 'name' : 'content'
    const score = refs.size > 0 ? 100 : exact ? 100 : named ? 60 + Math.min(20, normalizedName.length) : tokens.length > 0 ? 30 : 0
    hits.push({ hit: { rule, match }, score, index })
  })
  return hits.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, request.max ?? 20).map(row => row.hit)
}

/** One conservative suspected duplicate; never a decision to merge by itself. */
export function suspectedSettingDuplicate(rules: readonly RuleView[], incoming: string): SettingDuplicate | undefined {
  const candidate = normalized(incoming)
  if (candidate === '') return undefined
  const live = rules.filter(rule => rule.role === 'world' && rule.status !== 'archived' && rule.name !== undefined)
  const parts = incoming.split(/[与、+×]/u).map(part => part.trim()).filter(part => normalized(part) !== '')
  if (parts.length > 1) {
    const matches = parts.map(part => live.find(rule => normalized(rule.name!) === normalized(part))).filter((rule): rule is RuleView => rule !== undefined)
    if (matches.length > 0) return { rule: matches[0]!, reason: `名称像多个已有设定的合并名（${matches.map(rule => rule.name).join('、')}）` }
    return { reason: '名称像合并设定；先确认它是不是一个独立实体' }
  }
  const overlapping = live.flatMap(rule => {
    const existing = normalized(rule.name!)
    if (existing === candidate || existing.length < 2 || GENERIC_NAMES.has(existing)) return []
    return existing.includes(candidate) || candidate.includes(existing) ? [{ rule, size: existing.length }] : []
  }).sort((a, b) => b.size - a.size)
  const found = overlapping[0]
  return found === undefined ? undefined : { rule: found.rule, reason: `名称互相包含：「${incoming}」与「${found.rule.name}」` }
}

/** The shelf label used by search results and reconciliation rosters. */
export function settingKindOf(rule: RuleView): string {
  return rule.sort === undefined ? '体系' : SETTING_SORTS[rule.sort as SettingSort]
}
