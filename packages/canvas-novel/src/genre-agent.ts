/**
 * The novel genre's hooks into the canvas tools (`CanvasGenreDefinition.agent`):
 * on a 长篇小说 canvas, `canvas_read` and `canvas_write` stay the one place
 * the agent reads and writes cards, and hand the role categories here. The
 * genre supplies what the canvas cannot know — the refs (`c3`, `#12`, `w5`),
 * the duplicate check, cards that land live and go straight into the brief,
 * a relation's pair, the ledger facts on each line, and the chapters as the
 * canvas's 成稿 (2026-10-06: one card tool instead of novel_write beside
 * canvas_write).
 *
 * Every hook first gives new cards their refs (a no-op when the sidecar is
 * current), so the model always reads and sends the same handles.
 *
 * @module @khorsheed/dsh-canvas-novel
 */
import type { Session } from '@deepseek-ai/dsh-session'
import type { NovelGenreAgent } from './genre.ts'
import type { NovelService, WorkEntries } from './store.ts'
import {
  isOverdue, nextMilestoneOf, relationStanding,
  type EntryRole, type ForeshadowView, type RelationView,
} from './types.ts'

/** The role names the model may send as kind (the genre's category labels). */
const ROLE_OF_NAME: Readonly<Record<string, EntryRole>> = { 人物: 'character', 世界: 'world', 原则: 'principle', 伏笔: 'foreshadow', 关系: 'relation' }

/** A role's display name. */
export const ROLE_NAMES: Readonly<Record<EntryRole, string>> = { character: '人物', world: '世界', principle: '原则', foreshadow: '伏笔', relation: '关系' }

/** The chapter phase's display name. */
export const PHASE_NAMES: Readonly<Record<string, string>> = {
  planning: '规划中', writing: '写作中', stale: '待对账（正文改过）', extracted: '已抽取', reviewed: '已审过', fileMissing: '文件丢失',
}

/** What op=manuscript answers on a novel canvas: the chapters are its 成稿. */
export const NOVEL_MANUSCRIPT_GUIDE =
  '这块画布是长篇小说，成稿就是章节：建章、登记计划、写正文都走 novel_write(what=chapter)，读正文用 novel_read(what=chapter)。'
  + '看不到这两个工具时，请用户在写作模式里把会话绑定到这部作品。'

/**
 * The role a `kind` names on this board: a role category's id, its current
 * label (a renamed category keeps its role), the genre's own label, or the
 * role itself.
 */
function roleOfKind(entries: WorkEntries, kind: string): EntryRole | undefined {
  const text = kind.trim()
  const category = entries.board.categories.find(row => row.id === text)
  if (category !== undefined) return category.role as EntryRole | undefined
  return ROLE_OF_NAME[text] ?? (Object.keys(ROLE_NAMES) as EntryRole[]).find(role => role === text)
}

/** The flag a card not in the brief carries for the model: a canvas-native proposal, or an archived card. */
function cardFlags(status: string): string {
  return status === 'proposed' ? '（画布提议·未确认）' : status === 'archived' ? '（已归档）' : ''
}

/** One foreshadow's ledger state as one parenthesized run. */
export function foreshadowFacts(view: ForeshadowView): string {
  const slept = view.slept
  return [
    view.state,
    view.plantedAt === undefined ? '' : `埋于第${view.plantedAt}章`,
    view.lastActiveChapter === undefined ? '' : `最后活跃第${view.lastActiveChapter}章`,
    slept === undefined ? '' : `已 ${slept} 章未动${isOverdue(view) ? ' ⚠' : ''}`,
    view.starred ? '星标' : '',
  ].filter(part => part !== '').join(' · ')
}

/** One relation's type, stage and bar as one parenthesized run. */
export function relationFacts(view: RelationView): string {
  return `${view.type} · ${view.stage} · ${relationStanding(view)}`
}

/** The cards of a work, one line each (archived ones only when asked for). */
function cardLines(entries: WorkEntries, role: EntryRole | undefined, includeArchived: boolean): string[] {
  const lines: string[] = []
  const visible = (status: string): boolean => includeArchived || status !== 'archived'
  if (role === undefined || role === 'character') {
    for (const view of entries.characters.filter(view => visible(view.cardStatus))) {
      lines.push(`- [${view.ref}] 人物 ${view.name}${view.identity === undefined ? '' : `（${view.identity}）`}${cardFlags(view.cardStatus)}`)
    }
  }
  for (const view of entries.rules.filter(view => visible(view.status) && (role === undefined || role === view.role))) {
    lines.push(`- [${view.ref}] ${ROLE_NAMES[view.role]} ${view.text}${cardFlags(view.status)}`)
  }
  if (role === undefined || role === 'foreshadow') {
    for (const view of entries.foreshadows.filter(view => visible(view.cardStatus))) {
      lines.push(`- [${view.ref}] 伏笔 ${view.question}（${foreshadowFacts(view)}）${cardFlags(view.cardStatus)}`)
    }
  }
  if (role === undefined || role === 'relation') {
    for (const view of entries.relations.filter(view => visible(view.cardStatus))) {
      lines.push(`- [${view.ref}] 关系 ${view.name}（${relationFacts(view)}）${cardFlags(view.cardStatus)}`)
    }
  }
  return lines
}

/** The refusal of one card write, in the model's words. */
function cardErrorMessage(error: string | undefined, role: EntryRole, ref?: string): string {
  if (error === 'duplicate') {
    return `失败：画布上已经有同名的${ROLE_NAMES[role]}卡 [${ref}]。要补内容就改那张，不要另起一张：canvas_write(op=card, cardId=${ref}, fields=…)；`
      + `cardId 到不了的话，在 text 第一行写「编号：${ref}」，后面每行「字段名：值」只写要改的字段。`
  }
  if (error === 'missing') return `失败：找不到这张${ROLE_NAMES[role]}卡（canvas_read 看编号）。`
  if (error === 'invalid-name') return `失败：字段不全或不合法——新建${ROLE_NAMES[role]}卡至少要给主字段；改卡至少要给一个认识的字段。`
  return `失败：${error ?? 'io'}`
}

/**
 * Build the genre's agent hooks over the novel engine.
 * @param store - the novel service the hooks delegate to.
 * @returns the hooks the genre registers with the canvas.
 */
export function novelGenreAgent(store: NovelService): NovelGenreAgent {
  /** The work's entries with every card's ref given, or undefined when the canvas is no novel work. */
  const entriesOf = async (canvasId: string, session: Session): Promise<WorkEntries | undefined> => {
    await store.ensureRefs(canvasId, session)
    return store.readEntries(canvasId)
  }

  return {
    async cardLines(request, session) {
      const entries = await entriesOf(request.canvasId, session as Session)
      if (entries === undefined) return []
      const role = request.kind === undefined ? undefined : roleOfKind(entries, request.kind)
      if (request.kind !== undefined && role === undefined) return []
      return cardLines(entries, role, request.includeArchived)
    },

    async cardDetail(request, session) {
      const entries = await entriesOf(request.canvasId, session as Session)
      const handle = entries === undefined ? undefined : store.resolveCard(entries, request.cardId)
      if (entries === undefined || handle === undefined) return undefined
      return cardDetail(store, request.canvasId, entries, handle.cardId, handle.role)
    },

    async writeCard(request, session) {
      const entries = await entriesOf(request.canvasId, session as Session)
      if (entries === undefined) return undefined
      let role: EntryRole | undefined
      let id: string | undefined
      if (request.cardId !== undefined) {
        const handle = store.resolveCard(entries, request.cardId)
        if (handle === undefined) {
          // A card outside the role categories is the canvas's; an unknown handle is ours to refuse.
          return entries.board.cards.some(card => card.id === request.cardId)
            ? undefined
            : `失败：找不到卡片「${request.cardId}」（canvas_read 看卡片编号）。`
        }
        role = handle.role
        id = handle.cardId
      } else {
        role = request.kind === undefined ? undefined : roleOfKind(entries, request.kind)
        if (role === undefined) return undefined
      }
      if (request.fields === undefined || Object.keys(request.fields).length === 0) {
        return `失败：${ROLE_NAMES[role]}卡按字段写，放在 fields 里（字段见 canvas_read 带 kind）；fields 到不了的话，在 text 里每行写一个「字段名：值」。`
      }
      const outcome = await store.writeCard({
        workId: request.canvasId, role, fields: request.fields,
        ...(id === undefined ? {} : { id }),
        ...(request.comment === undefined ? {} : { comment: request.comment }),
      }, session as Session)
      if (!outcome.ok) return cardErrorMessage(outcome.error, role, outcome.ref)
      // A foreshadow's status and 埋于 are the 对账's to set (store.writeCard
      // drops them), which is not the same as a key nobody knows.
      const ledgerOwned = role === 'foreshadow' ? ['status', 'plantedAt'] : []
      const unknown = (outcome.ignored ?? []).filter(key => !ledgerOwned.includes(key))
      const owned = (outcome.ignored ?? []).filter(key => ledgerOwned.includes(key))
      const ignored = (unknown.length === 0 ? '' : `（忽略了不认识的字段：${unknown.join('、')}）`)
        + (owned.length === 0 ? '' : '（伏笔的状态和埋于第几章由对账按正文更新，没有用你填的值；新伏笔一律从「未埋」开始，不想要了可以填「已放弃」）')
      return id === undefined
        ? `已落卡 [${outcome.ref}]（${ROLE_NAMES[role]}·已进 brief，画布上带 ✦ 新卡标记）${ignored}。`
        : `已更新 [${outcome.ref}]${ignored}。`
    },

    async resolveCard(request, session) {
      const entries = await entriesOf(request.canvasId, session as Session)
      return entries === undefined ? undefined : store.resolveCard(entries, request.token)?.cardId
    },

    async manuscripts(request) {
      const chapters = await store.listChapters({ workId: request.canvasId })
      if (chapters.length === 0) return '章节：（还没有）。' + NOVEL_MANUSCRIPT_GUIDE
      return [
        `章节（${chapters.length} 章，按顺序）：`,
        ...chapters.map(({ chapter, phase }) => `- 第${chapter.n}章 ${chapter.title}（${PHASE_NAMES[phase] ?? phase}）${chapter.recap ?? ''}`),
      ].join('\n')
    },

    manuscriptGuide: NOVEL_MANUSCRIPT_GUIDE,
  }
}

/** One card in full, as `canvas_read(cardId)` answers it on a novel canvas. */
async function cardDetail(store: NovelService, workId: string, entries: WorkEntries, cardId: string, role: EntryRole): Promise<string> {
  const note = entries.annotations.notes[cardId]
  const audit = note?.evidenceInText === undefined ? undefined : `原文依据：「${note.evidenceInText}」`
  const join = (items: readonly string[]): string => items.length === 0 ? '—' : items.join('、')
  if (role === 'character') {
    const view = entries.characters.find(candidate => candidate.cardId === cardId)!
    const experiences = await store.listExperiences({ workId, characterId: cardId })
    const current = view.currentState
    return [
      `[${view.ref}] ${view.name}${view.identity === undefined ? '' : `（${view.identity}）`}${cardFlags(view.cardStatus)}`,
      `内核：想要 ${view.want ?? '—'}；缺失 ${view.lack ?? '—'}；旧伤 ${view.wound ?? '—'}`,
      `外貌 ${view.appearance ?? '—'}；说话方式 ${view.voice ?? '—'}`,
      `知道的事：${join(view.knows)}`,
      `不知道的事：${join(view.unaware)}`,
      `秘密：${join(view.secrets)}`,
      ...(view.relations.length === 0 ? [] : [`关系：${view.relations.join('；')}`]),
      ...(current === undefined ? [] : [`当前态：${current.where ?? '—'} / ${current.state ?? '—'} / 牵挂 ${current.concern ?? '—'}`]),
      ...(experiences.length === 0 ? [] : ['经历：', ...experiences.slice(-8).map(entry => `- 第${entry.chapter}章 ${entry.entry}`)]),
      ...(audit === undefined ? [] : [audit]),
    ].join('\n')
  }
  if (role === 'relation') {
    const view = entries.relations.find(candidate => candidate.cardId === cardId)!
    const journal = await store.listRelationJournal({ workId, relationId: cardId })
    const next = nextMilestoneOf(view)
    return [
      `[${view.ref}] ${view.name}${cardFlags(view.cardStatus)}`,
      `${relationFacts(view)}${next === undefined ? '' : `；下一级「${next.stage}」：${next.milestone}`}`,
      ...(view.now === undefined ? [] : [`现状：${view.now}`]),
      ...(view.views.length === 0 ? [] : [`各自怎么看：${view.views.join('；')}`]),
      ...(journal.length === 0 ? [] : ['轨迹：', ...journal.slice(-10).map(entry => entry.kind === 'points'
        ? `- 第${entry.chapter}章 ${entry.delta > 0 ? '+' : ''}${entry.delta}${entry.evidence === undefined ? '' : `「${entry.evidence}」`}`
        : `- 第${entry.chapter}章 → ${entry.stage}${entry.toType === undefined ? '' : `（转为${entry.toType}）`}`)]),
      ...(audit === undefined ? [] : [audit]),
    ].join('\n')
  }
  if (role === 'foreshadow') {
    const view = entries.foreshadows.find(candidate => candidate.cardId === cardId)!
    const mentions = await store.listMentions({ workId, foreshadowId: cardId })
    return [
      `[${view.ref}] ${view.question}${cardFlags(view.cardStatus)}`,
      `状态：${foreshadowFacts(view)}`,
      ...(view.answer === undefined ? [] : [`答案：${view.answer}`]),
      ...(mentions.length === 0 ? [] : ['轨迹：', ...mentions.map(mention => `- 第${mention.chapter}章 ${mention.kind}${mention.planned ? '（计划内）' : ''}${mention.note === undefined ? '' : ` ${mention.note}`}`)]),
      ...(audit === undefined ? [] : [audit]),
    ].join('\n')
  }
  const view = entries.rules.find(candidate => candidate.cardId === cardId)!
  return [
    `[${view.ref}] ${ROLE_NAMES[view.role]}：${view.text}${cardFlags(view.status)}`,
    ...(audit === undefined ? [] : [audit]),
  ].join('\n')
}
