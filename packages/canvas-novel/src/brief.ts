/**
 * The brief renderer: the three material-pack variants of proposal §4.2,
 * laid out exactly as the CP0 copy deck (story-cp0-texts.md §2) fixes them —
 * field names (知道的事/不知道的事/秘密), the ledger line formats and the
 * in-scene character block are user-reviewed copy, not invention space.
 * Pure and synchronous: the store's `gatherBrief` assembles {@link BriefData}
 * asynchronously, this module only renders.
 *
 * Token budgets (proposal §4.2): write ~2k, plan ~2.5k, extract rides the
 * chapter body unbudgeted. The estimate counts one CJK character as one
 * token and ASCII runs at 4 chars/token; when a render overshoots, it
 * re-renders with tighter caps and says what was elided (从略), so the
 * budget is a rule with an honest footnote rather than a silent truncation.
 * The iron rule stands in every variant: NEVER all chapters, NEVER the
 * whole foreshadow history — the memory system exists to replace full-text
 * injection.
 *
 * @module @khorsheed/dsh-canvas-novel
 */
import { isOverdue, type ChapterRecord, type CharacterView, type ExperienceEntry, type ForeshadowOp, type ForeshadowView, type RuleView } from './types.ts'

/** Everything one brief renders (assembled by the store's `gatherBrief`; kept cards only). */
export interface BriefData {
  readonly workTitle: string
  /** The chapter being planned / written / reconciled. */
  readonly target: ChapterRecord
  /** 世界 cards — the 硬约束. */
  readonly canonRules: readonly RuleView[]
  /** 原则 cards — the 创作原则. */
  readonly principles: readonly RuleView[]
  /** The live ledger (已埋/推进中), longest-slept first. */
  readonly activeForeshadows: readonly ForeshadowView[]
  /** 未埋 foreshadows — questions the user set up but the text has not planted yet. */
  readonly unplantedForeshadows: readonly ForeshadowView[]
  /** Resolved foreshadows, answers attached (the plan variant prints them). */
  readonly resolvedForeshadows: readonly ForeshadowView[]
  /** Every foreshadow card, any status (the plan line's op lookup). */
  readonly allForeshadows: readonly ForeshadowView[]
  /** The newest chapter number — the sleeping baseline. */
  readonly currentChapter: number
  /** The in-scene characters with their last ≤3 experience entries. */
  readonly inScene: readonly { readonly character: CharacterView; readonly recent: readonly ExperienceEntry[] }[]
  /** Every kept character (the plan roster and the extract roster). */
  readonly roster: readonly CharacterView[]
  /** Earlier chapters carrying a recap, seq-ordered. */
  readonly previousRecaps: readonly ChapterRecord[]
  /** The previous chapter's last ~200 characters (write variant only). */
  readonly previousTail?: string
}

/** The variant budgets, in estimated tokens (proposal §4.2). */
export const BRIEF_BUDGETS = { write: 2000, plan: 2500 } as const

/** One CJK character ≈ one token; ASCII runs ≈ 4 chars/token. */
export function estimateTokens(text: string): number {
  let cjk = 0
  let other = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code >= 0x2e80) cjk += 1
    else other += 1
  }
  return cjk + Math.ceil(other / 4)
}

/** Section caps per render pass (the budget guard tightens these). */
interface RenderLimits {
  readonly foreshadowTopK: number
  readonly recapMax: number
  readonly expPerChar: number
}

const WRITE_LIMITS: RenderLimits = { foreshadowTopK: 8, recapMax: 10, expPerChar: 3 }
const WRITE_TIGHT: RenderLimits = { foreshadowTopK: 5, recapMax: 4, expPerChar: 1 }
const PLAN_LIMITS: RenderLimits = { foreshadowTopK: 20, recapMax: 5, expPerChar: 0 }
const PLAN_TIGHT: RenderLimits = { foreshadowTopK: 10, recapMax: 3, expPerChar: 0 }

/** The write-variant ledger line: `- [#12] 门缝里的东西（埋于第1章 · 最后活跃第3章）`. */
function foreshadowLineWrite(view: ForeshadowView): string {
  const last = view.lastActiveChapter ?? view.plantedAt
  const parts = [
    view.plantedAt === undefined ? '' : `埋于第${view.plantedAt}章`,
    last === undefined ? '' : `最后活跃第${last}章`,
  ].filter(part => part !== '')
  return `- [${view.ref}] ${view.question}${parts.length === 0 ? '' : `（${parts.join(' · ')}）`}`
}

/** The plan-variant ledger line: `- [#12] ★ 门缝里的东西（埋于第1章 · 已 4 章未动 ⚠）` — ★ is the user's star. */
function foreshadowLinePlan(view: ForeshadowView): string {
  const slept = view.slept
  const sleeping = slept === undefined ? '' : slept <= 0 ? '最近一章刚动过' : `已 ${slept} 章未动${isOverdue(view) ? ' ⚠' : ''}`
  const parts = [
    view.plantedAt === undefined ? '' : `埋于第${view.plantedAt}章`,
    sleeping,
  ].filter(part => part !== '')
  return `- [${view.ref}] ${view.starred ? '★ ' : ''}${view.question}${parts.length === 0 ? '' : `（${parts.join(' · ')}）`}`
}

/** One planned op as the plan line reads it: `推进 [#12 门缝里的东西]：多了一道划痕` / `新埋 [蓝色叶子指向谁]`. */
function foreshadowOpText(op: ForeshadowOp, foreshadows: readonly ForeshadowView[]): string {
  const view = op.op === '新埋' || op.id === undefined
    ? undefined
    : foreshadows.find(candidate => candidate.cardId === op.id || candidate.ref === op.id)
  const subject = view === undefined ? op.question ?? op.id ?? '' : `${view.ref} ${view.question}`
  return `${op.op} [${subject}]${op.note === undefined ? '' : `：${op.note}`}`
}

/** The 本章计划 block (write variant, and the extract pack's 【本章计划】, whose beat numbers the import reads back). */
function planLines(target: ChapterRecord, foreshadows: readonly ForeshadowView[], roster: readonly CharacterView[]): string[] {
  const plan = target.plan
  if (plan === undefined) return ['（本章还没有计划——先 novel_write(chapter) 写 plan，用户确认前不开写。）']
  const nameOf = (token: string): string => roster.find(view => view.cardId === token)?.name ?? token
  const lines = [`梗概：${plan.summary}`]
  if (plan.beats.length > 0) {
    lines.push('走向：', ...plan.beats.map((beat, index) =>
      `  ${index + 1}. ${beat.at === undefined ? '' : `${beat.at}｜`}${beat.text}${beat.mark === undefined ? '' : `（${beat.mark}）`}`))
  }
  if (plan.conflict !== undefined) lines.push(`冲突：${plan.conflict}`)
  if (plan.highlight !== undefined) lines.push(`看点：${plan.highlight}`)
  if (plan.foreshadowOps.length > 0) {
    lines.push('伏笔：', ...plan.foreshadowOps.map(op => `  - ${foreshadowOpText(op, foreshadows)}`))
  }
  if (plan.cast.length > 0 || plan.pov !== undefined) {
    const pov = plan.pov === undefined ? undefined : nameOf(plan.pov)
    const cast = plan.cast.map(member => {
      const name = nameOf(member.who)
      return `${name}${name === pov ? '（POV）' : ''}${member.role === undefined ? '' : `：${member.role}`}`
    })
    if (pov !== undefined && !cast.some(line => line.startsWith(`${pov}（POV）`))) cast.unshift(`${pov}（POV）`)
    lines.push('出场：', ...cast.map(line => `  - ${line}`))
  }
  if (plan.hook !== undefined) lines.push(`章末钩子：${plan.hook}`)
  return lines
}

/** A character's one-line identity suffix: `（identity）`, or nothing. */
function identityOf(character: CharacterView): string {
  return character.identity === undefined ? '' : `（${character.identity}）`
}

/** The in-scene character block (~100字/人, CP0 §2.A 在场角色). */
function characterBlock(entry: { readonly character: CharacterView; readonly recent: readonly ExperienceEntry[] }, expPerChar: number): string[] {
  const { character, recent } = entry
  const lines = [`### ${character.name}${identityOf(character)}`]
  const current = character.currentState ?? {}
  lines.push(`此刻：${current.where ?? '未定'} / ${current.state ?? '未定'} / 牵挂：${current.concern ?? '无'}`)
  if (recent.length > 0 && expPerChar > 0) {
    lines.push(`近来：${recent.slice(-expPerChar).map(row => `第${row.chapter}章 ${row.entry}`).join('；')}`)
  }
  const join = (items: readonly string[]): string => items.length === 0 ? '—' : items.join('、')
  lines.push(`知道 ${join(character.knows)}；不知道 ${join(character.unaware)}；秘密 ${join(character.secrets)}`)
  lines.push('（非 POV 角色只写可观察的外在言行。）')
  return lines
}

/** The 从略 footnote the budget guard appends when caps bit. */
function omissionNote(omittedForeshadows: number, omittedRecaps: number): string[] {
  const parts = [
    omittedForeshadows > 0 ? `${omittedForeshadows} 条活跃伏笔` : '',
    omittedRecaps > 0 ? `${omittedRecaps} 章摘要` : '',
  ].filter(part => part !== '')
  return parts.length === 0 ? [] : ['', `（预算从略：${parts.join('、')}未列入，novel_read 可取。）`]
}

/**
 * The write variant (`for=write`, CP0 §2.A): canon hard constraints,
 * principles, this chapter's plan, the active ledger topK, the in-scene
 * character blocks, earlier recaps, the previous chapter's tail. The
 * previous chapter's FULL TEXT is never injected — the model asks
 * novel_read(chapter) when it needs it.
 * @param data - the gathered render data.
 * @returns the rendered brief, within the write budget (tight caps + 从略 note when overshooting).
 */
export function renderWriteBrief(data: BriefData): string {
  return renderWriteWithin(data, WRITE_LIMITS, BRIEF_BUDGETS.write)
    ?? renderWriteWithin(data, WRITE_TIGHT, BRIEF_BUDGETS.write, true)!
}

/** One render pass under the given limits; undefined when still over budget (the caller tightens). */
function renderWriteWithin(data: BriefData, limits: RenderLimits, budget: number, lastResort = false): string | undefined {
  const foreshadows = data.activeForeshadows.slice(0, limits.foreshadowTopK)
  const recaps = data.previousRecaps.slice(-limits.recapMax)
  const lines = [
    `# 《${data.workTitle}》写作约束 · 第${data.target.n}章 ${data.target.title}`,
    '',
    '## 硬约束（违反即返工）',
    ...(data.canonRules.length === 0 ? ['（还没有固化约束。）'] : data.canonRules.map(rule => `- [${rule.ref}] ${rule.text}`)),
    '',
    '## 创作原则',
    ...(data.principles.length === 0 ? ['（还没有创作原则。）'] : data.principles.map(rule => `- ${rule.text}`)),
    '',
    '## 本章计划',
    ...planLines(data.target, data.allForeshadows, data.roster),
    '',
    '## 伏笔台账（活跃）',
    ...(foreshadows.length === 0 ? ['（台账为空。）'] : foreshadows.map(foreshadowLineWrite)),
    '',
    '## 在场角色',
    ...(data.inScene.length === 0
      ? ['（本章未登记出场角色——plan.cast 的 who 填角色 ref 或名字。）']
      : data.inScene.flatMap(entry => [...characterBlock(entry, limits.expPerChar), '']).slice(0, -1)),
    '',
    '## 此前脉络（摘要）',
    ...(recaps.length === 0 ? ['（这是第一章。）'] : recaps.map(chapter => `- 第${chapter.n}章 ${chapter.recap ?? ''}`)),
  ]
  if (data.previousTail !== undefined) {
    lines.push('', '## 上一章末段（原文）', '', `> ${data.previousTail}`)
  }
  lines.push(...omissionNote(
    data.activeForeshadows.length - foreshadows.length,
    data.previousRecaps.length - recaps.length,
  ))
  const text = lines.join('\n')
  if (!lastResort && estimateTokens(text) > budget) return undefined
  return text
}

/**
 * The plan variant (`for=plan`, CP0 §2.B): hard constraints, the WHOLE live
 * ledger (active + sleeping — capped by budget with a 从略 note), resolved
 * foreshadows WITH their answers (planning must not contradict a reveal),
 * the 待埋 questions, recent recaps, the one-line roster. No character
 * blocks, no previous tail (proposal §4.2).
 * @param data - the gathered render data.
 * @returns the rendered brief, within the plan budget.
 */
export function renderPlanBrief(data: BriefData): string {
  return renderPlanWithin(data, PLAN_LIMITS, BRIEF_BUDGETS.plan)
    ?? renderPlanWithin(data, PLAN_TIGHT, BRIEF_BUDGETS.plan, true)!
}

/** One plan render pass under the given limits; undefined when still over budget. */
function renderPlanWithin(data: BriefData, limits: RenderLimits, budget: number, lastResort = false): string | undefined {
  const foreshadows = data.activeForeshadows.slice(0, limits.foreshadowTopK)
  const recaps = data.previousRecaps.slice(-limits.recapMax)
  const lines = [
    `# 《${data.workTitle}》第${data.target.n}章规划参考`,
    '',
    '## 硬约束',
    ...(data.canonRules.length === 0 ? ['（还没有固化约束。）'] : data.canonRules.map(rule => `- [${rule.ref}] ${rule.text}`)),
    '',
    '## 伏笔台账（全部活跃+沉睡；已揭带答案）',
    ...(foreshadows.length === 0 && data.resolvedForeshadows.length === 0
      ? ['（台账为空。）']
      : [
          ...foreshadows.map(foreshadowLinePlan),
          ...data.resolvedForeshadows.map(view => `- [已揭 ${view.ref}] ${view.question} → ${view.answer ?? '（未登记答案）'}`),
        ]),
  ]
  if (data.unplantedForeshadows.length > 0) {
    lines.push('', '## 待埋（立了还没写进正文的悬念）', ...data.unplantedForeshadows.map(view => `- [${view.ref}] ${view.question}`))
  }
  lines.push(
    '',
    '## 最近章节摘要',
    ...(recaps.length === 0 ? ['（还没有已摘要的章节。）'] : recaps.map(chapter => `- 第${chapter.n}章 ${chapter.recap ?? ''}`)),
    '',
    '## 可用角色（一句身份）',
    ...(data.roster.length === 0 ? ['（还没有角色卡。）'] : data.roster.map(character => `- ${character.name}：${character.identity ?? '—'}`)),
  )
  lines.push(...omissionNote(
    data.activeForeshadows.length - foreshadows.length,
    data.previousRecaps.length - recaps.length,
  ))
  const text = lines.join('\n')
  if (!lastResort && estimateTokens(text) > budget) return undefined
  return text
}

/** The extract pack's output schema (the subagent's strict JSON contract; the import gate reads these keys). */
export const EXTRACT_OUTPUT_SCHEMA = `{
  "beats_delivered": [{ "beat": 走向的序号（从 1 起）, "evidence_in_text": "≤50字原文" }],
  "memories": [{ "kind": "世界|原则", "name": "仅世界：这条设定叫什么（地点、势力、道具或规则的名字）", "world_kind": "仅世界：地点|势力|道具|规则|历史|其他", "content": "具体的设定或写作原则，能复述", "evidence_in_text": "≤50字原文" }],
  "foreshadow_mentions": [{ "foreshadow_id": "#12", "kind": "planted|advanced|hinted|resolved", "answer": "仅 resolved 给", "note": "…", "confidence": "high|medium|low", "evidence_in_text": "≤50字原文" }],
  "new_foreshadows": [{ "question": "…", "evidence_in_text": "≤50字原文" }],
  "new_characters": [{ "name": "…", "identity": "一句身份", "evidence_in_text": "≤50字原文" }],
  "experiences": [{ "character_id": "c1", "entry": "本章做了什么、状态怎么变，1-2句", "confidence": "high|medium|low", "evidence_in_text": "≤50字原文" }],
  "current_states": [{ "character_id": "c1", "where": "…", "state": "…", "concern": "…", "confidence": "high|medium|low" }],
  "recap": "本章 2-3 句摘要"
}`

/**
 * The extract variant (`for=extract`, CP0 §2.C): the reconciliation
 * material pack — subagent instructions, the chapter body IN FULL (the one
 * full-text scene), this chapter's plan, the active ledger with ids, the
 * roster with ids, and the output schema. Unbudgeted by design (it rides
 * the chapter body); the stable prefix (instructions → schema → roster →
 * ledger → body would reorder per chapter, so the pack orders
 * instructions → body → plan → ledger → roster → schema, keeping the two
 * most stable blocks first per the CP0 deck).
 * @param data - the gathered render data.
 * @param body - the chapter's full manuscript text.
 * @returns the material pack, ready to hand to the subagent as a one-shot task.
 */
export function renderExtractBrief(data: BriefData, body: string): string {
  return [
    `你是长篇小说的记忆对账员。输入是第${data.target.n}章正文、本章计划、活跃伏笔榜、角色花名册。`,
    '输出严格 JSON（schema 在最后）。规则：',
    '1. 每条产出必须带 evidence：≤50 字原文引用，逐字摘自本章正文；',
    '2. 伏笔/角色只按 id 引用榜单与名册中的对象；不认识的对象放 new_*，不硬靠；',
    '   本章新登场的角色写进 new_characters，他们的经历和现状照样写，character_id 填名字；',
    '   世界设定给 name（设定的名字）和具体内容，同一个设定只写一条；',
    '3. confidence 只用在伏笔提及、角色经历与现状上：拿不准的给 medium/low；',
    '   伏笔提及的 kind：hinted（暗示）= 读者能察觉、但剧情没动；advanced（推进）= 出现了新信息或新行动；',
    '4. 本章计划的走向逐条核对：正文写到了的那一拍写进 beats_delivered（带 evidence），没写到的不报；',
    '   伏笔只按实际写到的报 foreshadow_mentions，计划列了却没写到的不要编；',
    '5. 角色经历每人 1-2 句：本章做了什么、状态怎么变；current_state 给',
    '   where/state/concern 三字段。',
    '',
    '【本章正文】',
    body.trim() === '' ? '（正文为空——没有什么可对账的。）' : body,
    '',
    '【本章计划】',
    ...planLines(data.target, data.allForeshadows, data.roster),
    '',
    '【活跃伏笔榜】',
    ...(data.activeForeshadows.length + data.unplantedForeshadows.length === 0
      ? ['（台账为空。）']
      : [...data.activeForeshadows, ...data.unplantedForeshadows].map(foreshadowLineWrite)),
    '',
    '【角色花名册】',
    ...(data.roster.length === 0 ? ['（还没有角色卡。）'] : data.roster.map(character => `- [${character.ref}] ${character.name}${identityOf(character)}`)),
    '',
    '【输出 schema】',
    EXTRACT_OUTPUT_SCHEMA,
  ].join('\n')
}
