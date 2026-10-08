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
export { capacityOf, targetWordsOf, WORDS_PER_BEAT } from './types.ts'
import {
  capacityOf, coreSuspenseNudge, isOverdue, targetWordsOf, WORDS_PER_BEAT, nextMilestoneOf, RELATION_POINT_SCALE, relationStanding, revealText, revealVolume, volumeNumeral, volumePosition,
  type ChapterPlan, type ChapterRecord, type CharacterView, type ExperienceEntry, type ForeshadowOp, type ForeshadowView, type OutlineDoc,
  type RelationView, type RuleView,
} from './types.ts'

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
  /** Every kept relation card (the plan's 关系 block and the extract's 关系榜). */
  readonly relations: readonly RelationView[]
  /** The kept relations whose two sides are both in scene (every relation when the chapter has no cast). */
  readonly inSceneRelations: readonly RelationView[]
  /** Earlier chapters carrying a recap, seq-ordered. */
  readonly previousRecaps: readonly ChapterRecord[]
  /** The previous chapter's last ~200 characters (write variant only). */
  readonly previousTail?: string
  /** The adopted outline (规划), when the work has one. */
  readonly outline?: OutlineDoc
  /** The whole chapter index, seq-ordered (where the book stands against its volumes). */
  readonly chapters?: readonly ChapterRecord[]
}

/* ------------------------------------------------------------- budget (字数) */


/** The budget line a plan brief leads with. */
export function budgetLine(words: number): string {
  const room = capacityOf(words)
  const beats = room.beats[0] === room.beats[1] ? `${room.beats[0]}` : `${room.beats[0]}–${room.beats[1]}`
  return `目标字数 ${words}：每拍约 ${WORDS_PER_BEAT.low}–${WORDS_PER_BEAT.high} 字，走向 ${beats} 拍，伏笔操作至多 ${room.ops} 条，出场以不超过 ${room.cast} 人为宜。装不下就删或拆章，别压缩每一拍。`
}

/**
 * What a registered plan overshoots: beats, ops or cast past the chapter's
 * room, and reveals of a core suspense before its volume. Reminders only —
 * the user confirms or not.
 * @param plan - the registered plan.
 * @param words - the chapter's 目标字数 (undefined: no budget to check).
 * @param foreshadows - every foreshadow (the reveal timings).
 * @param volumeIndex - the chapter's volume (1-based), when the outline has volumes.
 * @param volumeCount - how many volumes the outline plans.
 */
export function planOvershoots(
  plan: ChapterPlan,
  words: number | undefined,
  foreshadows: readonly ForeshadowView[],
  volumeIndex: number | undefined,
  volumeCount: number,
): string[] {
  const notes: string[] = []
  if (words !== undefined) {
    const room = capacityOf(words)
    if (plan.beats.length > room.beats[1]) notes.push(`走向 ${plan.beats.length} 拍，按 ${words} 字建议至多 ${room.beats[1]} 拍——删掉或挪到下一章`)
    if (plan.foreshadowOps.length > room.ops) notes.push(`伏笔操作 ${plan.foreshadowOps.length} 条，一章至多 ${room.ops} 条为宜`)
    if (plan.cast.length > room.cast) notes.push(`出场 ${plan.cast.length} 人，${words} 字里写不开`)
  }
  if (volumeIndex !== undefined) {
    for (const op of plan.foreshadowOps) {
      if (op.op !== '揭晓' || op.id === undefined) continue
      const view = foreshadows.find(candidate => candidate.cardId === op.id || candidate.ref === op.id)
      const due = revealVolume(view?.reveal, volumeCount)
      if (view !== undefined && due !== undefined && due > volumeIndex) {
        notes.push(`揭晓 ${view.ref} 提前了：它定在卷${volumeNumeral(due)}揭晓，这章在卷${volumeNumeral(volumeIndex)}`)
      }
    }
  }
  return notes
}

/* ------------------------------------------------------------- outline block */

/** The protagonist's card lines for a brief (name first, then the fields that steer every choice). */
function protagonistLines(outline: OutlineDoc, roster: readonly CharacterView[]): string[] {
  const id = outline.sheet.protagonist
  const hero = id === undefined ? undefined : roster.find(view => view.cardId === id)
  if (hero === undefined) return []
  const parts = [
    hero.want === undefined ? '' : `目标：${hero.want}`,
    hero.ambition === undefined ? '' : `抱负：${hero.ambition}`,
    hero.values === undefined ? '' : `价值观：${hero.values}`,
    hero.lack === undefined ? '' : `缺失：${hero.lack}`,
  ].filter(part => part !== '')
  return [`主角：${hero.name}${identityOf(hero)}${parts.length === 0 ? '' : `——${parts.join('；')}`}`]
}

/** The outline block a plan brief opens with: the sheet's spine, the protagonist, where the book stands, the near sketches. */
function outlineBlock(data: BriefData): string[] {
  const outline = data.outline
  if (outline === undefined || outline.revision === 0) return []
  const sheet = outline.sheet
  const lines = ['## 一页纸']
  if (sheet.logline !== undefined) lines.push(`一句话主线：${sheet.logline}`)
  if (sheet.conflict !== undefined) lines.push(`核心冲突：${sheet.conflict}`)
  lines.push(...protagonistLines(outline, data.roster))
  if (sheet.arc !== undefined) lines.push(`成长弧线：${sheet.arc}`)
  if (sheet.ending !== undefined) lines.push(`结局方向：${sheet.ending}`)
  const position = volumePosition(outline.volumes, data.chapters ?? [], data.target)
  if (position !== undefined) {
    const volume = position.volume
    lines.push('', `## 本卷：卷${volumeNumeral(position.index)} · ${volume.title}（已写 ${position.written}${volume.chapters === undefined ? '' : ` / 约 ${volume.chapters}`} 章）`)
    if (volume.goal !== undefined) lines.push(`要完成：${volume.goal}`)
    if (volume.landing !== undefined) lines.push(`卷末落点：${volume.landing}`)
    const next = outline.volumes[position.index]
    if (next !== undefined) lines.push(`下一卷：${next.title}${next.goal === undefined ? '' : `——${next.goal}`}`)
  }
  const near = outline.sketches.filter(row => row.n >= data.target.n && row.n <= data.target.n + 2)
  if (near.length > 0) lines.push('', '## 已细化的近处', ...near.map(row => `- 第${row.n}章：${row.line}`))
  return [...lines, '']
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
  return `- [${view.ref}] ${view.starred ? '★ ' : ''}${view.question}${parts.length === 0 ? '' : `（${parts.join(' · ')}）`}`
}

/**
 * The plan-variant ledger line: `- [#12] ★ 门缝里的东西（埋于第1章 · 已 4 章未动 ⚠）` — ★ is the user's star.
 * A core suspense shows its reveal volume instead of a sleep count.
 */
function foreshadowLinePlan(view: ForeshadowView, data?: BriefData): string {
  const slept = view.slept
  const core = data?.outline === undefined ? undefined : coreSuspenseNudge(view, data.outline.volumes, data.chapters ?? [])
  // In its reveal volume the planner needs the answer to build toward it; before that it never sees it.
  const position = data?.outline === undefined ? undefined : volumePosition(data.outline.volumes, data.chapters ?? [], data.target)
  const due = data?.outline === undefined ? undefined : revealVolume(view.reveal, data.outline.volumes.length)
  const answer = core !== undefined && view.answer !== undefined && due !== undefined && position !== undefined && position.index >= due
    ? `；谜底：${view.answer}`
    : ''
  const sleeping = core !== undefined
    ? `${core.text}${answer}${core.nudge ? ' ⚠' : ''}`
    : view.reveal !== undefined && view.reveal.kind !== 'chapter'
      ? `定在${revealText(view.reveal)}揭晓`
      : slept === undefined ? '' : slept <= 0 ? '最近一章刚动过' : `已 ${slept} 章未动${isOverdue(view) ? ' ⚠' : ''}`
  const parts = [
    view.plantedAt === undefined ? '' : `埋于第${view.plantedAt}章`,
    view.reveal?.kind === 'chapter' ? '本章内回收' : '',
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
  // The answer reaches the brief only in the chapter that reveals it.
  const answer = op.op === '揭晓' && view?.answer !== undefined ? `（谜底：${view.answer}）` : ''
  return `${op.op} [${subject}]${op.note === undefined ? '' : `：${op.note}`}${answer}`
}

/** The 本章计划 block (write variant, and the extract pack's 【本章计划】, whose beat numbers the import reads back). */
function planLines(target: ChapterRecord, foreshadows: readonly ForeshadowView[], roster: readonly CharacterView[]): string[] {
  if (target.byUser === true) return ['（用户原稿：没有计划，不核对走向。）']
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
  if (plan.infoGaps !== undefined) {
    lines.push('信息差：', ...plan.infoGaps.map((gap, index) => `  ${index + 1}. ${nameOf(gap.who)} 得知：${gap.fact}`))
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
  if (character.appearance !== undefined) lines.push(`外貌：${character.appearance}`)
  if (character.voice !== undefined) lines.push(`说话方式：${character.voice}`)
  if (recent.length > 0 && expPerChar > 0) {
    lines.push(`近来：${recent.slice(-expPerChar).map(row => `第${row.chapter}章 ${row.entry}`).join('；')}`)
  }
  const join = (items: readonly string[]): string => items.length === 0 ? '—' : items.join('、')
  lines.push(`知道 ${join(character.knows)}；不知道 ${join(character.unaware)}；秘密 ${join(character.secrets)}`)
  lines.push('（非 POV 角色只写可观察的外在言行。）')
  return lines
}

/**
 * The ledger lines one render pass keeps: every starred foreshadow (the
 * user's ★ is never trimmed by the budget), then the longest-sleeping rest up
 * to the cap. The input is already starred-first (store `sortBySleep`).
 */
function keptForeshadows(views: readonly ForeshadowView[], cap: number): readonly ForeshadowView[] {
  const starred = views.filter(view => view.starred)
  return [...starred, ...views.filter(view => !view.starred).slice(0, Math.max(0, cap - starred.length))]
}

/** The plan roster line: identity, then the drives a plan arcs on (想要 / 缺失 / 旧伤). */
function rosterLine(character: CharacterView): string {
  const drives = [
    character.want === undefined ? '' : `想要 ${character.want}`,
    character.lack === undefined ? '' : `缺 ${character.lack}`,
    character.wound === undefined ? '' : `旧伤 ${character.wound}`,
  ].filter(part => part !== '')
  return `- ${character.name}：${character.identity ?? '—'}${drives.length === 0 ? '' : `（${drives.join(' · ')}）`}`
}

/** How many relation lines the plan brief lists (可升 pairs first). */
const PLAN_RELATION_CAP = 15

/** The write brief's 在场关系 line: `- [r2] 老周 × 小满 · 师徒 · 受教：小满偷偷在学修表`, each side's view below. */
function relationLineWrite(view: RelationView): string[] {
  return [
    `- [${view.ref}] ${view.name} · ${view.type} · ${view.stage}${view.now === undefined ? '' : `：${view.now}`}`,
    ...view.views.map(line => `  ${line}`),
  ]
}

/** The plan / extract line: `- [r2] 老周 × 小满 · 师徒 · 受教（可升 → 传承：交出真正的底牌…）`, or the bar (`2/3`) / the rift. */
function relationLinePlan(view: RelationView): string {
  const next = view.ready ? nextMilestoneOf(view) : undefined
  return `- [${view.ref}] ${view.name} · ${view.type} · ${view.stage}（${relationStanding(view)}${next === undefined ? '' : `：${next.milestone}`}）`
}

/** The plan brief's 关系 block: 可升 pairs first, then the rest, capped; the pacing rule always closes it. */
function relationBlockPlan(relations: readonly RelationView[]): string[] {
  if (relations.length === 0) return []
  const ordered = [...relations.filter(view => view.ready), ...relations.filter(view => !view.ready)]
  const shown = ordered.slice(0, PLAN_RELATION_CAP)
  return [
    '',
    '## 关系（阶段与进度）',
    ...shown.map(relationLinePlan),
    ...(ordered.length > shown.length ? [`（另有 ${ordered.length - shown.length} 对关系未列入，canvas_read(kind=关系) 可取。）`] : []),
    ...(relations.some(view => view.ready) ? ['标「可升」的关系攒够了分：可以考虑在这一章或接下来几章安排一场关键戏，让括号里那件事在正文里发生。'] : []),
    '一章最多让一对关系升一级，别让关系一下子跳级。',
  ]
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
  const foreshadows = keptForeshadows(data.activeForeshadows, limits.foreshadowTopK)
  const recaps = data.previousRecaps.slice(-limits.recapMax)
  const words = targetWordsOf(data.target, data.outline)
  const lines = [
    `# 《${data.workTitle}》写作约束 · 第${data.target.n}章 ${data.target.title}`,
    ...(words === undefined ? [] : ['', `目标字数：约 ${words} 字（上下两成以内）。`]),
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
    ...(data.inSceneRelations.length === 0 ? [] : ['', '## 在场关系', ...data.inSceneRelations.flatMap(relationLineWrite)]),
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
  const foreshadows = keptForeshadows(data.activeForeshadows, limits.foreshadowTopK)
  const recaps = data.previousRecaps.slice(-limits.recapMax)
  const words = targetWordsOf(data.target, data.outline)
  const lines = [
    `# 《${data.workTitle}》第${data.target.n}章规划参考`,
    '',
    ...(words === undefined ? [] : ['## 篇幅', budgetLine(words), '']),
    ...outlineBlock(data),
    '## 硬约束',
    ...(data.canonRules.length === 0 ? ['（还没有固化约束。）'] : data.canonRules.map(rule => `- [${rule.ref}] ${rule.text}`)),
    '',
    '## 伏笔台账（全部活跃+沉睡；已揭带答案）',
    ...(foreshadows.length === 0 && data.resolvedForeshadows.length === 0
      ? ['（台账为空。）']
      : [
          ...foreshadows.map(view => foreshadowLinePlan(view, data)),
          ...data.resolvedForeshadows.map(view => `- [已揭 ${view.ref}] ${view.question} → ${view.answer ?? '（未登记答案）'}`),
        ]),
  ]
  if (data.unplantedForeshadows.length > 0) {
    lines.push('', '## 待埋（立了还没写进正文的悬念；不必这章就埋，定在后面几卷揭晓的先只暗示）', ...data.unplantedForeshadows.map(view =>
      `- [${view.ref}] ${view.question}${view.reveal === undefined ? '' : `（${revealText(view.reveal)}揭晓）`}`))
  }
  lines.push(
    '',
    '## 最近章节摘要',
    ...(recaps.length === 0 ? ['（还没有已摘要的章节。）'] : recaps.map(chapter => `- 第${chapter.n}章 ${chapter.recap ?? ''}`)),
    '',
    '## 可用角色（身份与动机）',
    ...(data.roster.length === 0 ? ['（还没有角色卡。）'] : data.roster.map(rosterLine)),
    ...relationBlockPlan(data.relations),
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
  "info_gaps_closed": [{ "gap": 信息差的序号（从 1 起）, "evidence_in_text": "≤50字原文" }],
  "memories": [{ "kind": "世界|原则", "name": "仅世界：这条设定叫什么（地点、势力、道具或规则的名字）", "world_kind": "仅世界：地点|势力|道具|规则|历史|其他", "content": "具体的设定或写作原则，能复述", "evidence_in_text": "≤50字原文" }],
  "foreshadow_mentions": [{ "foreshadow_id": "#12", "kind": "planted|advanced|hinted|resolved", "answer": "仅 resolved 给", "note": "…", "confidence": "high|medium|low", "evidence_in_text": "≤50字原文" }],
  "new_foreshadows": [{ "question": "…", "evidence_in_text": "≤50字原文" }],
  "new_characters": [{ "name": "…", "identity": "一句身份", "evidence_in_text": "≤50字原文" }],
  "experiences": [{ "character_id": "c1", "entry": "本章做了什么、状态怎么变，1-2句", "confidence": "high|medium|low", "evidence_in_text": "≤50字原文" }],
  "current_states": [{ "character_id": "c1", "where": "…", "state": "…", "concern": "…", "confidence": "high|medium|low" }],
  "relation_points": [{ "relation_id": "r2", "delta": -2到2的整数, "evidence_in_text": "≤50字原文" }],
  "relation_milestones": [{ "relation_id": "r2", "evidence_in_text": "≤50字原文" }],
  "relation_changes": [{ "relation_id": "r2", "change": "裂痕|决裂|修复|转类型", "to_type": "仅转类型给：爱情|亲情|友情|师徒|对手|同盟|其他", "evidence_in_text": "≤50字原文" }],
  "new_relations": [{ "a": "c1 或名字", "b": "c2 或名字", "type": "爱情|亲情|友情|师徒|对手|同盟|其他", "now": "一句现状", "evidence_in_text": "≤50字原文" }],
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
    `你是长篇小说的记忆对账员。输入是第${data.target.n}章正文、本章计划、活跃伏笔榜、角色花名册、关系榜。`,
    '输出严格 JSON（schema 在最后）。规则：',
    '1. 每条产出必须带 evidence：≤50 字原文引用，逐字摘自本章正文的一段连续文字；不用省略号拼接两处，不改字、不转述；',
    '2. 伏笔/角色只按 id 引用榜单与名册中的对象；不认识的对象放 new_*，不硬靠；',
    '   new_foreshadows 只收读者会一直惦记、后文必须回收的问题（一章至多 2 条），一闪而过的好奇不算；',
    '   本章新登场的角色写进 new_characters，他们的经历和现状照样写，character_id 填名字；',
    '   世界设定给 name（设定的名字）和具体内容，同一个设定只写一条；',
    '3. confidence 只用在伏笔提及、角色经历与现状上：拿不准的给 medium/low；',
    '   伏笔提及的 kind：hinted（暗示）= 读者能察觉、但剧情没动；advanced（推进）= 出现了新信息或新行动；',
    '4. 本章计划的走向逐条核对：正文写到了的那一拍写进 beats_delivered（带 evidence），没写到的不报；',
    '   信息差同样逐条核对：那个角色在正文里确实得知了那件事，才写进 info_gaps_closed；',
    '   伏笔只按实际写到的报 foreshadow_mentions，计划列了却没写到的不要编；',
    '5. 角色经历每人 1-2 句：本章做了什么、状态怎么变；current_state 给',
    '   where/state/concern 三字段；',
    '6. 关系只打分、不定级：关系榜上两人都在本章出场的每一对，按两人之间的互动给 relation_points——',
    ...RELATION_POINT_SCALE.map(step => `   ${step.delta > 0 ? '+' : ''}${step.delta}：${step.meaning}；`),
    '   两人没有实质互动的不打；一章只按最重的那次互动打一个分；',
    '   标「可升」的一对，括号里那件事在正文里确实发生了，才写进 relation_milestones；',
    '   关系出现裂痕、决裂、修复，或变成另一种关系（转类型，给 to_type），写进 relation_changes；',
    '   两个角色之间出现了值得追踪、榜上还没有的关系，写进 new_relations。',
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
    '【关系榜】',
    ...(data.relations.length === 0 ? ['（还没有关系卡。）'] : data.relations.map(relationLinePlan)),
    '',
    '【输出 schema】',
    EXTRACT_OUTPUT_SCHEMA,
  ].join('\n')
}

/* ---------------------------------------------------------- outline read */

/**
 * The outline as `novel_read(what=outline)` answers it: the adopted sheet
 * (the protagonist's fields read off their card), the volumes with the
 * chapters filed under each, the near sketches, the core suspenses with
 * their pacing line, and the proposal waiting on the user.
 * @param outline - the work's outline.
 * @param roster - the kept characters.
 * @param chapters - the chapter index.
 * @param foreshadows - the kept foreshadows.
 */
export function renderOutlineRead(
  outline: OutlineDoc,
  roster: readonly CharacterView[],
  chapters: readonly ChapterRecord[],
  foreshadows: readonly ForeshadowView[],
): string {
  const sheet = outline.sheet
  const lines: string[] = []
  if (outline.revision === 0) {
    lines.push('还没有采用过的大纲。先和用户聊清楚一句话主线、核心冲突、主角、结局方向和篇幅，再用 novel_write(what=outline, sheet=…, volumes=…) 提议，用户在「规划」页采用后生效。')
  } else {
    lines.push(`# 一页纸（v${outline.revision}）`)
    const row = (label: string, value: string | undefined): void => { if (value !== undefined) lines.push(`${label}：${value}`) }
    row('一句话主线', sheet.logline)
    row('核心冲突', sheet.conflict)
    lines.push(...protagonistLines(outline, roster))
    row('成长弧线', sheet.arc)
    row('主题', sheet.theme)
    row('类型与基调', sheet.tone)
    row('结局方向', sheet.ending)
    const length = sheet.length
    if (length !== undefined) {
      lines.push(`篇幅：${[
        length.words === undefined ? '' : `目标 ${length.words} 字`,
        length.volumes === undefined ? '' : `${length.volumes} 卷`,
        length.chapters === undefined ? '' : `约 ${length.chapters} 章`,
        length.perChapter === undefined ? '' : `单章 ${length.perChapter} 字`,
      ].filter(part => part !== '').join(' · ')}`)
    }
    if (outline.volumes.length > 0) {
      lines.push('', '# 分卷')
      outline.volumes.forEach((volume, index) => {
        const filed = chapters.filter(chapter => (chapter.volume ?? outline.volumes[0]?.id) === volume.id).map(chapter => chapter.n)
        lines.push(`- 卷${volumeNumeral(index + 1)} ${volume.title}（${volume.id}${volume.chapters === undefined ? '' : ` · 约 ${volume.chapters} 章`}${filed.length === 0 ? '' : ` · 已有第 ${filed[0]}–${filed[filed.length - 1]} 章`}）`
          + `${volume.goal === undefined ? '' : `：${volume.goal}`}${volume.landing === undefined ? '' : `；卷末落点：${volume.landing}`}`)
      })
    }
    const ahead = outline.sketches.filter(sketch => !chapters.some(chapter => chapter.n === sketch.n))
    if (ahead.length > 0) lines.push('', '# 已细化、还没建的章', ...ahead.map(sketch => `- 第${sketch.n}章：${sketch.line}`))
  }
  const cores = foreshadows
    .map(view => ({ view, line: coreSuspenseNudge(view, outline.volumes, chapters) }))
    .filter((row): row is { view: ForeshadowView; line: { text: string; nudge: boolean } } => row.line !== undefined)
  if (cores.length > 0) {
    lines.push('', '# 核心悬念', ...cores.map(({ view, line }) =>
      `- [${view.ref}] ${view.question}（${line.text}${line.nudge ? ' ⚠' : ''}；已碰过 ${view.mentionChapters?.length ?? 0} 次）`))
  }
  const proposal = outline.proposal
  if (proposal !== undefined) {
    lines.push('', '# 等用户采用的提议', `提议于 ${proposal.at}：${[
      ...Object.keys(proposal.sheet ?? {}),
      ...(proposal.volumes === undefined ? [] : [`分卷 ${proposal.volumes.length} 卷`]),
      ...(proposal.sketches === undefined ? [] : [`细化第 ${proposal.sketches.map(row => row.n).join('、')} 章`]),
    ].join('、')}。再次提议会合并进这一版。`)
  }
  return lines.join('\n')
}
