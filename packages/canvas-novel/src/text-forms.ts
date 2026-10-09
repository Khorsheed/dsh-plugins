/**
 * The text-only forms of `novel_write`'s nested arguments. Some model and
 * provider pairs deliver a call's flat strings and nothing else — Kimi K3 on
 * the coding endpoint sent `{"what":"outline"}` six times over while its
 * reasoning held the whole outline (2026-10-08). So an outline and a chapter
 * plan can also be written as `键：值` lines in `content`, the one free-text
 * argument that arrives; these readers turn them back into the shapes
 * `proposeOutline` and `normalizePlan` already read.
 *
 * @module @khorsheed/dsh-canvas-novel
 */
import type { ChapterPlan } from './types.ts'

/** One `键：值` line (full- or half-width colon), or undefined. */
function keyValueOf(line: string): { key: string; value: string } | undefined {
  const match = /^\s*[-*•]?\s*([^：:\n]{1,16}?)\s*[：:]\s*(.*?)\s*$/.exec(line)
  return match === null ? undefined : { key: match[1]!.trim(), value: match[2]!.trim() }
}

/** A list item line (`- …`, `1. …`, `· …`), its text, or undefined. */
function itemOf(line: string): string | undefined {
  const match = /^\s*(?:[-*•·]|\d{1,2}[.、)）])\s*(.+?)\s*$/.exec(line)
  return match === null ? undefined : match[1]!
}

/** The keys of the one-page outline, as people write them. */
const SHEET_KEYS: Readonly<Record<string, string>> = {
  一句话主线: 'logline', 主线: 'logline', logline: 'logline',
  核心冲突: 'conflict', 冲突: 'conflict', conflict: 'conflict',
  主角: 'protagonist', protagonist: 'protagonist',
  成长弧线: 'arc', 弧线: 'arc', arc: 'arc',
  主题: 'theme', theme: 'theme',
  类型与基调: 'tone', 基调: 'tone', tone: 'tone',
  结局方向: 'ending', 结局: 'ending', ending: 'ending',
}

const LENGTH_KEYS: Readonly<Record<string, string>> = {
  总字数: 'words', 目标字数: 'words', 字数: 'words',
  卷数: 'volumes', 章数: 'chapters', 预计章数: 'chapters', 单章字数: 'perChapter',
}

/** 篇幅 written on one line: 「30万字 / 3卷 / 约100章 / 单章3000字」. */
function lengthOf(value: string): Record<string, string> {
  const length: Record<string, string> = {}
  for (const part of value.split(/[/／|｜,，、;；]/)) {
    const text = part.trim()
    const per = /单章\s*([\d,，.]+\s*万?)/.exec(text)
    if (per !== null) { length['perChapter'] = per[1]!; continue }
    const volumes = /([\d一二三四五六七八九十]+)\s*卷/.exec(text)
    if (volumes !== null) { length['volumes'] = volumes[1]!; continue }
    const chapters = /([\d,，]+)\s*章/.exec(text)
    if (chapters !== null) { length['chapters'] = chapters[1]!; continue }
    const words = /([\d,，.]+\s*万?)\s*字/.exec(text)
    if (words !== null) length['words'] = words[1]!
  }
  return length
}

/** A volume line's value: 「梦醒｜约12章｜要完成：…｜卷末：…」. */
function volumeOf(value: string): Record<string, string> | undefined {
  const parts = value.split(/\s*[|｜]\s*/).map(part => part.trim()).filter(part => part !== '')
  const title = parts.shift()
  if (title === undefined) return undefined
  const volume: Record<string, string> = { title }
  for (const part of parts) {
    const pair = keyValueOf(part)
    const count = /^约?\s*(\d+)\s*章$/.exec(part)
    if (count !== null) volume['chapters'] = count[1]!
    else if (pair !== undefined && /完成|目标|goal/.test(pair.key)) volume['goal'] = pair.value
    else if (pair !== undefined && /卷末|落点|landing/.test(pair.key)) volume['landing'] = pair.value
    else if (volume['goal'] === undefined) volume['goal'] = part
  }
  return volume
}

/**
 * An outline written as lines: the sheet's fields (一句话主线：… / 主角：c1 …),
 * 篇幅 on one line or as 总字数 / 卷数 / 章数 / 单章字数 lines, one 「卷一：标题｜约N章｜
 * 要完成：…｜卷末：…」 line per volume, 「第N章：…」 sketches, and 理由.
 * @param text - the call's content.
 * @returns the proposal parts it found (any may be absent).
 */
export function outlineFromText(text: string): { sheet?: Record<string, unknown>; volumes?: unknown[]; sketches?: unknown[]; rationale?: string } {
  const sheet: Record<string, unknown> = {}
  let length: Record<string, string> = {}
  const volumes: Record<string, string>[] = []
  const sketches: { n: string; line: string }[] = []
  let rationale: string | undefined
  for (const line of text.split('\n')) {
    const pair = keyValueOf(line)
    if (pair === undefined || pair.value === '') continue
    const key = pair.key.replace(/\s+/g, '')
    if (SHEET_KEYS[key] !== undefined) { sheet[SHEET_KEYS[key]!] = pair.value; continue }
    if (key === '篇幅' || key === 'length') { length = { ...length, ...lengthOf(pair.value) }; continue }
    if (LENGTH_KEYS[key] !== undefined) { length[LENGTH_KEYS[key]!] = pair.value.replace(/[字章卷]$/, ''); continue }
    if (/^(?:第)?[一二三四五六七八九十\d]{1,3}卷$|^卷[一二三四五六七八九十\d]{1,3}$/.test(key)) {
      const volume = volumeOf(pair.value)
      if (volume !== undefined) volumes.push(volume)
      continue
    }
    const sketch = /^(?:细化)?第(\d{1,4})章$/.exec(key)
    if (sketch !== null) { sketches.push({ n: sketch[1]!, line: pair.value }); continue }
    if (key === '理由' || key === 'rationale') rationale = pair.value
  }
  if (Object.keys(length).length > 0) sheet['length'] = length
  return {
    ...(Object.keys(sheet).length === 0 ? {} : { sheet }),
    ...(volumes.length === 0 ? {} : { volumes }),
    ...(sketches.length === 0 ? {} : { sketches }),
    ...(rationale === undefined ? {} : { rationale }),
  }
}

/** Whether a chapter call's content is a plan written as lines (it opens on 梗概), not a manuscript. */
export function isPlanText(text: string | undefined): boolean {
  if (text === undefined) return false
  return text.split('\n').slice(0, 3).some(line => /^\s*(?:梗概|summary)\s*[：:]/.test(line))
}

const PLAN_SCALARS: Readonly<Record<string, string>> = {
  梗概: 'summary', summary: 'summary', 冲突: 'conflict', 看点: 'highlight', 章末钩子: 'hook', 钩子: 'hook',
  视角: 'pov', pov: 'pov', 目标字数: 'words', 字数: 'words',
}
const PLAN_LISTS: Readonly<Record<string, string>> = {
  走向: 'beats', 伏笔: 'foreshadowOps', 出场: 'cast', 信息差: 'infoGaps',
}

/** One 走向 item: 「午后｜他推开门（转折）」. */
function beatOf(item: string): Record<string, string> {
  const mark = /[（(](转折|落点)[）)]\s*$/.exec(item)
  const body = mark === null ? item : item.slice(0, mark.index).trim()
  const at = /^([^｜|]{1,12})[｜|]\s*(.+)$/.exec(body)
  return {
    text: at === null ? body : at[2]!,
    ...(at === null ? {} : { at: at[1]!.trim() }),
    ...(mark === null ? {} : { mark: mark[1]! }),
  }
}

/** One 伏笔 item: 「推进 #2：神灵并不惊讶」 / 「新埋：另一个做梦者是谁」. */
function opOf(item: string): Record<string, string> | undefined {
  const match = /^(推进|暗示|新埋|揭晓)\s*([#＃]?\s*[\w\d]+)?\s*(?:[：:]\s*(.*))?$/.exec(item)
  if (match === null) return undefined
  const [, op, id, note] = match
  if (op === '新埋') return { op, question: (note ?? id ?? '').trim() }
  return { op: op!, ...(id === undefined ? {} : { id: id.replace(/\s+/g, '').replace('＃', '#') }), ...(note === undefined || note === '' ? {} : { note }) }
}

/** One 出场 item: 「江眠（视角）：慌但好奇」. */
function castOf(item: string): { who: string; role?: string; pov: boolean } {
  const pair = /^([^：:]+?)\s*[：:]\s*(.+)$/.exec(item)
  const who = (pair === null ? item : pair[1]!).trim()
  const pov = /[（(]\s*(?:视角|POV|pov)\s*[）)]/.test(who)
  return { who: who.replace(/[（(]\s*(?:视角|POV|pov)\s*[）)]/, '').trim(), ...(pair === null ? {} : { role: pair[2]!.trim() }), pov }
}

/** One 信息差 item: 「江眠 得知：…」 / 「江眠：…」. */
function gapOf(item: string): Record<string, string> | undefined {
  const match = /^(.+?)\s*(?:得知)?\s*[：:]\s*(.+)$/.exec(item)
  return match === null ? undefined : { who: match[1]!.replace(/得知$/, '').trim(), fact: match[2]!.trim() }
}

/**
 * A chapter plan written as lines: 梗概 / 目标字数 / 冲突 / 看点 / 视角 /
 * 章末钩子 as `键：值`, and 走向 / 伏笔 / 出场 / 信息差 as a key line followed
 * by `- …` items (or the items on the key line, split by ；).
 * @param text - the call's content.
 * @returns the raw plan object `normalizePlan` reads.
 */
export function planFromText(text: string): Record<string, unknown> {
  const plan: Record<string, unknown> = {}
  const lists: Record<string, string[]> = {}
  let current: string | undefined
  for (const line of text.split('\n')) {
    const pair = keyValueOf(line)
    const key = pair?.key.replace(/\s+/g, '')
    if (pair !== undefined && key !== undefined && (PLAN_SCALARS[key] !== undefined || PLAN_LISTS[key] !== undefined)) {
      if (PLAN_SCALARS[key] !== undefined) {
        plan[PLAN_SCALARS[key]!] = pair.value
        current = undefined
      } else {
        current = PLAN_LISTS[key]!
        lists[current] ??= []
        if (pair.value !== '') lists[current]!.push(...pair.value.split(/\s*[；;]\s*/).filter(part => part !== ''))
      }
      continue
    }
    const item = itemOf(line)
    if (item !== undefined && current !== undefined) lists[current]!.push(item)
  }
  if (lists['beats'] !== undefined) plan['beats'] = lists['beats'].map(beatOf)
  if (lists['foreshadowOps'] !== undefined) plan['foreshadowOps'] = lists['foreshadowOps'].map(opOf).filter(op => op !== undefined)
  if (lists['cast'] !== undefined) {
    const cast = lists['cast'].map(castOf)
    plan['cast'] = cast.map(({ who, role }) => ({ who, ...(role === undefined ? {} : { role }) }))
    const pov = cast.find(member => member.pov)
    if (pov !== undefined && plan['pov'] === undefined) plan['pov'] = pov.who
  }
  if (lists['infoGaps'] !== undefined) plan['infoGaps'] = lists['infoGaps'].map(gapOf).filter(gap => gap !== undefined)
  return plan
}

/** One line of a plan field: newlines folded, so a value never spills into the next key. */
function oneLine(value: string): string {
  return value.replace(/\s*\n+\s*/g, ' ').trim()
}

/**
 * A chapter plan as the lines {@link planFromText} reads back — the chapter
 * page's edit box (2026-10-09). Card ids become what a person writes: a
 * foreshadow its ref (`#2`), a character its name.
 * @param plan - the stored plan.
 * @param handleOf - a card id's handle (ref for foreshadows, name for characters); the id when unknown.
 * @returns the plan as `键：值` lines and `- …` items.
 */
export function planToText(plan: ChapterPlan, handleOf: (id: string) => string): string {
  const lines: string[] = [`梗概：${oneLine(plan.summary)}`]
  if (plan.words !== undefined) lines.push(`目标字数：${plan.words}`)
  if (plan.beats.length > 0) {
    lines.push('走向：')
    for (const beat of plan.beats) {
      lines.push(`- ${beat.at === undefined ? '' : `${oneLine(beat.at)}｜`}${oneLine(beat.text)}${beat.mark === undefined ? '' : `（${beat.mark}）`}`)
    }
  }
  if (plan.conflict !== undefined) lines.push(`冲突：${oneLine(plan.conflict)}`)
  if (plan.highlight !== undefined) lines.push(`看点：${oneLine(plan.highlight)}`)
  if (plan.foreshadowOps.length > 0) {
    lines.push('伏笔：')
    for (const op of plan.foreshadowOps) {
      if (op.op === '新埋') lines.push(`- 新埋：${oneLine(op.question ?? op.note ?? '')}`)
      else lines.push(`- ${op.op}${op.id === undefined ? '' : ` ${handleOf(op.id)}`}${op.note === undefined ? '' : `：${oneLine(op.note)}`}`)
    }
  }
  if (plan.cast.length > 0) {
    lines.push('出场：')
    for (const member of plan.cast) {
      lines.push(`- ${handleOf(member.who)}${member.who === plan.pov ? '（视角）' : ''}${member.role === undefined ? '' : `：${oneLine(member.role)}`}`)
    }
  } else if (plan.pov !== undefined) {
    lines.push(`视角：${handleOf(plan.pov)}`)
  }
  if (plan.infoGaps !== undefined && plan.infoGaps.length > 0) {
    lines.push('信息差：')
    for (const gap of plan.infoGaps) lines.push(`- ${handleOf(gap.who)} 得知：${oneLine(gap.fact)}`)
  }
  if (plan.hook !== undefined) lines.push(`章末钩子：${oneLine(plan.hook)}`)
  return lines.join('\n')
}

/** The plan fields, in the order the page shows them (the keys an edit summary names). */
export const PLAN_FIELDS = ['summary', 'words', 'beats', 'conflict', 'highlight', 'foreshadowOps', 'cast', 'pov', 'infoGaps', 'hook'] as const
export type PlanField = typeof PLAN_FIELDS[number]

/** Which fields an edit changed. */
export function changedPlanFields(before: ChapterPlan | undefined, after: ChapterPlan): PlanField[] {
  return PLAN_FIELDS.filter(field => JSON.stringify(before?.[field] ?? null) !== JSON.stringify(after[field] ?? null))
}
