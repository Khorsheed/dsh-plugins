/**
 * The canvas-novel's main-session tools, registered by the `./agent`
 * composition entry: one read (`novel_read`), one write (`novel_write`) and
 * the two-phase reconciliation (`novel_extract`). They act on the novel
 * canvas the session is BOUND to (the canvas binding chip); unbound, every
 * tool answers with guidance, never an error. Descriptions stay terse — the
 * workflow is the `novel` skill's, loaded on demand (the 2026-09-30 canvas
 * slimming precedent).
 *
 * The definitions are origin-tagged the way the community convention
 * documents: the tag is the `Symbol.for('dsh.tool.origin')`-keyed property
 * (host-side only, never on the model wire), set directly — the
 * `@khorsheed/dsh-capability-catalog` helper's own module documents this
 * no-import path, so the package needs no dependency on the catalog.
 *
 * @module @khorsheed/dsh-canvas-novel
 */
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { renderPlanBrief, renderWriteBrief } from './brief.ts'
import type { NovelService, WorkEntries } from './store.ts'
import type { ChapterPlan, EntryRole, ExtractPayload, ForeshadowView, PendingItem, ReviewAction } from './types.ts'

/** The community tool-origin tag (the catalog's documented no-import path). */
function tagOrigin<T extends object>(definition: T): T {
  ;(definition as Record<PropertyKey, unknown>)[Symbol.for('dsh.tool.origin')] = {
    channel: 'plugin',
    owner: '@khorsheed/dsh-canvas-novel',
  }
  return definition
}

/** What the tools answer when the session is bound to no novel canvas (guidance, never a throw). */
const NO_WORK_MESSAGE = '本会话还没有绑定「长篇小说」画布：先 novel_bind 按对话说的作品绑定（不带参数列出作品），或请用户在会话头的「绑定作品」里选。'

/** The extract gate's refusal, phase-aware (对账只发生在写作后、审过收章前). */
function extractGateMessage(phase: string | undefined): string {
  if (phase === 'planning') return '这章还没有正文——没有什么可对账的。先写完，再对账。'
  if (phase === 'extracted') return '这章已对过账（已抽取）。要重新对账，先告诉我为什么。'
  if (phase === 'reviewed') return '这章已审过收章，不再对账。'
  if (phase === 'fileMissing') return '这章的正文文件丢了（登记在、文件不在）。先重新定位文件，再谈对账。'
  return '对账只对「写作中」的章开放。'
}

/** The role names the model sends (the board's category labels). */
const ROLE_OF_NAME: Readonly<Record<string, EntryRole>> = { 人物: 'character', 世界: 'world', 原则: 'principle', 伏笔: 'foreshadow' }

/** A role's display name. */
const ROLE_NAMES: Readonly<Record<EntryRole, string>> = { character: '人物', world: '世界', principle: '原则', foreshadow: '伏笔' }

/** The flags one card carries for the model (ghost / automatic import). */
function cardFlags(entries: WorkEntries, cardId: string, status: string): string {
  const flags = [
    status === 'proposed' ? '待采纳' : '',
    entries.annotations.notes[cardId]?.autoImported === true ? '自动·可撤销' : '',
  ].filter(flag => flag !== '').join('·')
  return flags === '' ? '' : `（${flags}）`
}

/** One foreshadow's ledger state as one parenthesized run. */
function foreshadowFacts(view: ForeshadowView): string {
  const slept = view.slept
  return [
    view.state,
    view.plantedAt === undefined ? '' : `埋于第${view.plantedAt}章`,
    view.lastActiveChapter === undefined ? '' : `最后活跃第${view.lastActiveChapter}章`,
    slept === undefined ? '' : `已 ${slept} 章未动${slept >= 3 ? ' ⚠' : ''}`,
    view.tension === undefined ? '' : `势${view.tension}`,
  ].filter(part => part !== '').join(' · ')
}

/** The visible cards of a work (kept + ghosts; archived ones are hidden), one line each. */
function cardLines(entries: WorkEntries, role: EntryRole | undefined): string[] {
  const lines: string[] = []
  const visible = (status: string): boolean => status !== 'archived'
  if (role === undefined || role === 'character') {
    for (const view of entries.characters.filter(view => visible(view.cardStatus))) {
      lines.push(`- [${view.ref}] 人物 ${view.name}${view.identity === undefined ? '' : `（${view.identity}）`}${cardFlags(entries, view.cardId, view.cardStatus)}`)
    }
  }
  for (const view of entries.rules.filter(view => visible(view.status) && (role === undefined || role === view.role))) {
    lines.push(`- [${view.ref}] ${ROLE_NAMES[view.role]} ${view.text}${cardFlags(entries, view.cardId, view.status)}`)
  }
  if (role === undefined || role === 'foreshadow') {
    for (const view of entries.foreshadows.filter(view => visible(view.cardStatus))) {
      lines.push(`- [${view.ref}] 伏笔 ${view.question}（${foreshadowFacts(view)}）${cardFlags(entries, view.cardId, view.cardStatus)}`)
    }
  }
  return lines
}

/** One pending item as the model reads it (one line, evidence attached). */
function pendingLine(item: PendingItem): string {
  return `- [${item.id}] ${item.kind}（${item.confidence}）${item.reason}${item.evidenceInText === undefined ? '' : `\n  原文：「${item.evidenceInText}」`}`
}

/** The chapter phase's display name. */
const PHASE_NAMES: Readonly<Record<string, string>> = {
  planning: '规划中', writing: '写作中', extracted: '已抽取', reviewed: '已审过', fileMissing: '文件丢失',
}


/** The refusal of one card write, in the model's words. */
function cardErrorMessage(error: string | undefined, role: EntryRole): string {
  if (error === 'missing') return `失败：找不到这张${ROLE_NAMES[role]}卡（novel_read(what=cards) 看 ref）。`
  if (error === 'invalid-name') return `失败：字段不全或不合法——新建${ROLE_NAMES[role]}卡至少要给主字段；改卡至少要给一个认识的字段。`
  return `失败：${error ?? 'io'}`
}

/**
 * Build the novel tools for the MAIN session: the target work resolves per
 * call from the session's bound canvas, the fencing session rides the agent.
 * No binding is a plain guidance answer, never an error. Every call first
 * gives new cards their refs (a no-op when the sidecar is current), so the
 * model always reads and sends the same `c3` / `#12` / `w5`.
 * @param store - the novel service the tools delegate to.
 * @returns the tagged definitions for the profile-root tools registry.
 */
export function novelToolDefinitions(store: NovelService): ToolDefinition[] {
  /** Resolve the call's target: the bound work plus the fencing session. */
  const target = async (exec: { agent?: Agent }): Promise<{ workId: string; session: Session } | { message: string }> => {
    const session = exec.agent?.session
    if (session === undefined) return { message: NO_WORK_MESSAGE }
    const work = await store.boundWork(String(session.id))
    if (work === undefined) return { message: NO_WORK_MESSAGE }
    await store.ensureRefs(work.id, session)
    return { workId: work.id, session }
  }

  const read = defineTool({
    name: 'novel_read',
    description:
      'Read the bound novel canvas. what=brief renders a material pack (for=write/plan/extract); cards/card/'
      + 'chapters/ledger/pending/chapter read the work. Load the novel skill for the workflow.',
    parameters: {
      what: {
        type: 'string',
        enum: ['brief', 'cards', 'card', 'chapters', 'ledger', 'pending', 'chapter'],
        required: true,
        description: 'What to read.',
      },
      for: { type: 'string', enum: ['write', 'plan', 'extract'], description: 'brief: the variant (default write).' },
      chapter: { type: 'number', description: 'brief/chapter: the chapter number (default: the one being planned).' },
      role: { type: 'string', enum: ['人物', '世界', '原则', '伏笔'], description: 'cards: filter by category.' },
      id: { type: 'string', description: 'card: its ref (c3, #12, w5), card id, or a character\'s exact name.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    isConcurrencySafe: () => true,
    execute: async (args: {
      what: string
      for?: 'write' | 'plan' | 'extract'
      chapter?: number
      role?: string
      id?: string
    }, exec: { agent?: Agent }): Promise<string> => {
      const resolved = await target(exec)
      if ('message' in resolved) return resolved.message
      const { workId } = resolved
      if (args.what === 'brief') {
        const gathered = await store.gatherBrief({ workId, ...(args.chapter === undefined ? {} : { chapter: args.chapter }) })
        if (!gathered.ok || gathered.data === undefined) {
          return gathered.error === 'missing'
            ? '还没有可定位的章节：先 novel_write(what=chapter, title=…[, plan=…]) 建章，再取 brief。'
            : `失败：${gathered.error ?? 'io'}`
        }
        if (args.for === 'plan') return renderPlanBrief(gathered.data)
        if (args.for === 'extract') {
          const chapter = gathered.data.target
          if (chapter.phase !== 'planning') return extractGateMessage(chapter.phase)
          const prepared = await store.extractPrepare({ workId, n: chapter.n })
          return prepared.ok ? prepared.text! : `失败：${prepared.error ?? 'io'}`
        }
        return renderWriteBrief(gathered.data)
      }
      if (args.what === 'cards' || args.what === 'card') {
        const entries = await store.readEntries(workId)
        if (entries === undefined) return NO_WORK_MESSAGE
        if (args.what === 'cards') {
          const role = args.role === undefined ? undefined : ROLE_OF_NAME[args.role]
          const lines = cardLines(entries, role)
          if (lines.length === 0) return '还没有卡片：聊设定时 novel_write(what=card, role=…) 落幽灵卡，用户采纳后才进 brief。'
          return [`卡片（${lines.length} 张，待采纳的不进 brief）：`, ...lines].join('\n')
        }
        if (args.id === undefined) return '失败：what=card 要给 id（ref、卡 id 或人物名字）。'
        const handle = store.resolveCard(entries, args.id)
        if (handle === undefined) return `失败：没有卡片「${args.id}」。novel_read(what=cards) 看全部 ref。`
        return await cardDetail(store, workId, entries, handle.cardId, handle.role)
      }
      if (args.what === 'chapters') {
        const chapters = await store.listChapters({ workId })
        if (chapters.length === 0) return '还没有章节：novel_write(what=chapter, title=…[, plan=…]) 建第 1 章。'
        return [
          `章节（${chapters.length} 章，按 seq 排序）：`,
          ...chapters.map(({ chapter, phase }) =>
            `- 第${chapter.n}章 ${chapter.title}（${PHASE_NAMES[phase] ?? phase}）${chapter.recap ?? ''}`),
        ].join('\n')
      }
      if (args.what === 'ledger') {
        const ledger = await store.ledger({ workId })
        if (!ledger.ok) return `失败：${ledger.error ?? 'io'}`
        return [
          `伏笔健康度：活跃 ${ledger.counts.active} / 超期⚠ ${ledger.counts.overdue} / 已揭 ${ledger.counts.resolved} / 弃置 ${ledger.counts.abandoned}（当前第 ${ledger.currentChapter} 章）`,
          '沉睡榜（最久未动在前）：',
          ...(ledger.active.length === 0 ? ['（台账为空。）'] : ledger.active.map(view => `- [${view.ref}] ${view.question}（${foreshadowFacts(view)}）`)),
        ].join('\n')
      }
      if (args.what === 'pending') {
        const items = await store.listPending({ workId })
        if (items.length === 0) return '待审队列为空（新卡片在画布上以幽灵卡待采纳，不在这里）。'
        return [`待审队列（${items.length} 条，✓采纳/✗丢弃走 novel_write(what=review, target=pending, id, action)）：`, ...items.map(pendingLine)].join('\n')
      }
      if (args.what === 'chapter') {
        if (args.chapter === undefined) return '失败：what=chapter 要给 chapter（章号）。'
        const outcome = await store.readChapter({ workId, n: args.chapter })
        if (!outcome.ok) return `失败：没有第 ${args.chapter} 章。novel_read(what=chapters) 看章节索引。`
        return outcome.body === ''
          ? `第 ${args.chapter} 章《${outcome.chapter!.title}》（${PHASE_NAMES[outcome.phase!] ?? outcome.phase}）：正文为空。`
          : `第 ${args.chapter} 章《${outcome.chapter!.title}》（${PHASE_NAMES[outcome.phase!] ?? outcome.phase}）：\n\n${outcome.body}`
      }
      return '失败：what 只能是 brief/cards/card/chapters/ledger/pending/chapter。'
    },
  })

  const write = defineTool({
    name: 'novel_write',
    description:
      'Write the bound novel canvas. card proposes a ghost card in a category (role=人物|世界|原则|伏笔, fields); '
      + 'with id it patches that card. chapter creates (auto n=max+1) or re-plans; content writes the manuscript '
      + 'first and refuses the registration when the fence refuses the write. review decides (target=card|pending, '
      + 'action=accept|discard|archive|retract). Load the novel skill first.',
    parameters: {
      what: { type: 'string', enum: ['card', 'chapter', 'review'], required: true, description: 'What to write.' },
      role: { type: 'string', enum: ['人物', '世界', '原则', '伏笔'], description: 'card: the category.' },
      fields: {
        type: 'object', additionalProperties: true,
        description: 'card: 人物 {name, identity, want, lack, wound, appearance, voice, knows, unaware, secrets, relations}; '
          + '世界 {rule}; 原则 {principle}; 伏笔 {question, status, plantedAt, answer}. Lists: one item per line.',
      },
      comment: { type: 'string', description: 'card (new): why you propose it — shown on the ghost card.' },
      id: { type: 'string', description: 'card: the ref to patch. review: card ref or pending id.' },
      title: { type: 'string', description: 'chapter: the title.' },
      content: { type: 'string', description: 'chapter: the manuscript body — written to the mounted workspace before registering.' },
      chapter: { type: 'number', description: 'chapter: n to re-plan (omit to create).' },
      plan: { type: 'object', additionalProperties: true, description: 'chapter: {pov, goal, foreshadowOps[{op, id|question}], characters[], hook}.' },
      target: { type: 'string', enum: ['card', 'pending'], description: 'review: a card on the board, or the pending queue.' },
      action: { type: 'string', enum: ['accept', 'discard', 'archive', 'retract'], description: 'review: the decision.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: async (args: WriteArgs, exec: { agent?: Agent }): Promise<string> => {
      const resolved = await target(exec)
      if ('message' in resolved) return resolved.message
      const { workId } = resolved
      if (args.what === 'card') {
        const role = args.role === undefined ? undefined : ROLE_OF_NAME[args.role]
        if (role === undefined) return '失败：what=card 要给 role（人物|世界|原则|伏笔）。'
        const outcome = await store.writeCard({
          workId, role, fields: args.fields ?? {},
          ...(args.id === undefined ? {} : { id: args.id }),
          ...(args.comment === undefined ? {} : { comment: args.comment }),
        }, resolved.session)
        if (!outcome.ok) return cardErrorMessage(outcome.error, role)
        const ignored = outcome.ignored === undefined || outcome.ignored.length === 0 ? '' : `（忽略了不认识的字段：${outcome.ignored.join('、')}）`
        return args.id === undefined
          ? `已落幽灵卡 [${outcome.ref}]（${ROLE_NAMES[role]}·待用户采纳）${ignored}。`
          : `已更新 [${outcome.ref}]${ignored}。`
      }
      if (args.what === 'chapter') {
        if ((args.title ?? '').trim() === '') return '失败：what=chapter 要给 title。'
        const outcome = await store.writeChapter({
          workId,
          title: args.title!,
          ...(args.chapter === undefined ? {} : { n: args.chapter }),
          ...(args.plan === undefined ? {} : { plan: args.plan }),
          ...(args.content === undefined ? {} : { content: args.content }),
        }, resolved.session)
        if (!outcome.ok) {
          if (outcome.error === 'missing' && args.chapter !== undefined) {
            return `失败：没有第 ${args.chapter} 章。novel_read(what=chapters) 看索引；新建不要传 chapter。`
          }
          if (outcome.error === 'denied') {
            return '失败：正文写不进画布挂载的工作区（会话沙箱围栏拒绝）。请用户给画布挂一个本会话可写的工作区，或把正文贴给我用 novel_write(what=chapter, content=…) 重写。'
          }
          if (outcome.error === 'no-workspace') {
            return '失败：这张画布还没有挂工作区，章节正文无处可写。请用户先在画布里挂一个工作区（正文写到 <工作区>/<画布标题>/第N章.md）。'
          }
          return `失败：${outcome.error ?? 'io'}`
        }
        const chapter = outcome.chapter!
        const plan = chapter.plan as ChapterPlan | undefined
        return plan === undefined
          ? `已建第 ${chapter.n} 章《${chapter.title}》（规划中 · ${chapter.file}）。`
          : `已登记第 ${chapter.n} 章《${chapter.title}》plan：POV ${plan.pov ?? '未定'} / 目标 ${plan.goal} / 伏笔操作 ${plan.foreshadowOps.length} 条 / 钩子 ${plan.hook ?? '无'}。用户确认后开写。`
      }
      if (args.what === 'review') {
        if (args.target === undefined || args.id === undefined || args.action === undefined) {
          return '失败：what=review 要给 target（card|pending）、id 和 action（accept|discard|archive|retract）。'
        }
        if (args.target === 'card') {
          const outcome = await store.reviewCard({ workId, id: args.id, action: args.action }, resolved.session)
          if (!outcome.ok) return outcome.error === 'missing' ? `失败：没有卡片 ${args.id}。` : `失败：这张卡当前状态不接受 ${args.action}（${outcome.error ?? 'io'}）。`
          const names: Readonly<Record<ReviewAction, string>> = { accept: '已采纳（进 brief）', discard: '已丢弃（归档）', archive: '已归档', retract: '已撤销自动入库（归档）' }
          return `${names[args.action]}：${args.id}。`
        }
        const outcome = await store.decidePending({ workId, id: args.id, action: args.action === 'accept' ? 'accept' : 'discard' }, resolved.session)
        if (!outcome.ok) return outcome.error === 'missing' ? `失败：没有待审项 ${args.id}。` : `失败：${outcome.error ?? 'io'}`
        return args.action === 'accept' ? `已采纳并落库：${args.id}。` : `已丢弃：${args.id}。`
      }
      return '失败：what 只能是 card/chapter/review。'
    },
  })

  const extract = defineTool({
    name: 'novel_extract',
    description:
      'Reconcile a written chapter. phase=prepare returns the material pack (delegate it to a fresh subagent, take '
      + 'back strict JSON); phase=import runs the five gates on payload and files the results. Load the novel skill first.',
    parameters: {
      chapter: { type: 'number', required: true, description: 'The chapter number.' },
      phase: { type: 'string', enum: ['prepare', 'import'], required: true, description: 'Which half.' },
      payload: { type: 'object', additionalProperties: true, description: 'import: the subagent\'s strict JSON.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: async (args: { chapter: number; phase: 'prepare' | 'import'; payload?: ExtractPayload }, exec: { agent?: Agent }): Promise<string> => {
      const resolved = await target(exec)
      if ('message' in resolved) return resolved.message
      if (args.phase === 'prepare') {
        const prepared = await store.extractPrepare({ workId: resolved.workId, n: args.chapter })
        if (!prepared.ok) {
          if (prepared.error === 'not-reviewed') {
            const read = await store.readChapter({ workId: resolved.workId, n: args.chapter })
            return extractGateMessage(read.ok ? read.phase : undefined)
          }
          return prepared.error === 'missing' ? `失败：没有第 ${args.chapter} 章。` : `失败：${prepared.error ?? 'io'}`
        }
        return prepared.text!
      }
      if (args.payload === undefined || typeof args.payload !== 'object') {
        return '失败：phase=import 要给 payload（subagent 返回的严格 JSON）。'
      }
      const report = await store.extractImport({ workId: resolved.workId, n: args.chapter, payload: args.payload }, resolved.session)
      if (!report.ok) {
        if (report.error === 'not-reviewed') {
          const read = await store.readChapter({ workId: resolved.workId, n: args.chapter })
          return extractGateMessage(read.ok ? read.phase : undefined)
        }
        return report.error === 'missing' ? `失败：没有第 ${args.chapter} 章。` : `失败：${report.error ?? 'io'}`
      }
      const waiting = report.pending + report.proposedCards.length
      const lines = [
        `计划命中 ✓×${report.verified} / 计划落空 ×${report.missed} / 自动入库 ×${report.autoImported} / 待你确认 ×${waiting}${report.dropped.length === 0 ? '' : ` / 丢弃 ×${report.dropped.length}`}`,
      ]
      if (report.proposedCards.length > 0) {
        lines.push('画布上的新幽灵卡（用户采纳后进 brief）：', ...report.proposedCards.map(card => `- ${ROLE_NAMES[card.role]}「${card.text}」`))
      }
      if (report.pendingItems.length > 0) {
        lines.push('待确认清单：', ...report.pendingItems.map(item => `- [${item.id}] ${item.reason}`))
      }
      if (report.dropped.length > 0) {
        lines.push('丢弃（防编造闸）：', ...report.dropped.map(drop => {
          const why = drop.reason === 'evidence-not-found' ? '原文引用在正文里 grep 不到'
            : drop.reason === 'id-not-in-ledger' ? '伏笔 id 不在活跃榜单'
              : drop.reason === 'card-refused' ? '画布拒绝了这张卡' : '角色不在花名册'
          return `- ${drop.kind}「${drop.ref}」：${why}`
        }))
      }
      return lines.join('\n')
    },
  })

  return [tagOrigin(read), tagOrigin(write), tagOrigin(extract)]
}

/** The tool that binds a session to a work — present in every session the grant scope owns, bound or not. */
export const NOVEL_BIND_TOOL = 'novel_bind'

/**
 * Build `novel_bind`: the model's own way to the binding the chip gives the
 * user. No `work` lists the 长篇小说 canvases; a `work` binds the calling
 * session to it, and the novel_* tools appear from the next step on (the
 * host re-assembles the tool list per step). It is the one novel tool an
 * unbound session holds, so the model can bind by the conversation's
 * subject instead of asking the user to find the chip.
 * @param store - the novel service the tool delegates to.
 * @param granted - settles the calling agent's grant after a bind, so the
 *   tools are registered before the reply says they are (the binding event's
 *   own re-check is not awaited by anyone).
 * @returns the tagged definition, registered once for the mounting scope.
 */
export function novelBindDefinition(store: NovelService, granted: (agent: Agent) => Promise<void>): ToolDefinition {
  const listing = (works: readonly { title: string }[]): string =>
    works.length === 0
      ? '还没有体裁为「长篇小说」的画布：请用户在画布里新建一张，⋯ → 创作体裁选「长篇小说」。'
      : `长篇小说作品：${works.map(work => `《${work.title}》`).join('、')}`
  const bind = defineTool({
    name: NOVEL_BIND_TOOL,
    description:
      'Bind this session to a novel work (a 长篇小说 canvas) so the novel_* tools appear. No work: list the works. '
      + 'Bind when the conversation is about one of them; if it is unclear which, ask the user.',
    parameters: {
      work: { type: 'string', description: 'The work\'s title (or canvas id). Omit to list.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: async (args: { work?: string }, exec: { agent?: Agent }): Promise<string> => {
      const agent = exec.agent
      const current = agent === undefined ? undefined : await store.boundWork(String(agent.session.id))
      if (args.work === undefined || args.work.trim() === '') {
        const works = await store.listWorks()
        return [listing(works), current === undefined ? '本会话未绑定。' : `本会话已绑定《${current.title}》。`].join('\n')
      }
      if (agent === undefined) return '失败：这次调用没有会话，无法绑定。'
      const bound = await store.bindWork(args.work, agent.session)
      if (!bound.ok) {
        if (bound.error === 'ambiguous') return `「${args.work}」对应多部作品，请问用户是哪一部：${bound.works.map(work => `《${work.title}》`).join('、')}`
        if (bound.error === 'missing') return `没有叫「${args.work}」的长篇小说作品。${listing(bound.works)}`
        return `失败：${bound.error}`
      }
      await granted(agent)
      return `已绑定《${bound.work.title}》：novel_read / novel_write / novel_extract 从下一步起可用，先加载 novel skill。用户可在会话头的画布 chip 里改绑或解绑。`
    },
  })
  return tagOrigin(bind)
}

/** One card in full, as `novel_read(what=card)` answers it. */
async function cardDetail(store: NovelService, workId: string, entries: WorkEntries, cardId: string, role: EntryRole): Promise<string> {
  const note = entries.annotations.notes[cardId]
  const audit = note?.extractedBy === 'llm'
    ? `来源：第${note.firstChapter ?? '?'}章对账（${note.confidence ?? '?'}${note.autoImported === true ? ' · 自动·可撤销' : ''}）${note.evidenceInText === undefined ? '' : `「${note.evidenceInText}」`}`
    : undefined
  const join = (items: readonly string[]): string => items.length === 0 ? '—' : items.join('、')
  if (role === 'character') {
    const view = entries.characters.find(candidate => candidate.cardId === cardId)!
    const experiences = await store.listExperiences({ workId, characterId: cardId })
    const current = view.currentState
    return [
      `[${view.ref}] ${view.name}${view.identity === undefined ? '' : `（${view.identity}）`}${cardFlags(entries, cardId, view.cardStatus)}`,
      `内核：想要 ${view.want ?? '—'}；缺失 ${view.lack ?? '—'}；旧伤 ${view.wound ?? '—'}`,
      `外貌 ${view.appearance ?? '—'}；说话方式 ${view.voice ?? '—'}`,
      `知道的事：${join(view.knows)}`,
      `不知道的事：${join(view.unaware)}`,
      `秘密：${join(view.secrets)}`,
      ...(view.relations.length === 0 ? [] : [`关系：${view.relations.join('；')}`]),
      ...(current === undefined ? [] : [`当前态：${current.where ?? '—'} / ${current.state ?? '—'} / 牵挂 ${current.concern ?? '—'}`]),
      ...(experiences.length === 0 ? [] : ['经历：', ...experiences.slice(-8).map(entry => `- 第${entry.chapter}章 ${entry.entry}${entry.id === undefined ? '' : ` [${entry.id}]`}`)]),
      ...(audit === undefined ? [] : [audit]),
    ].join('\n')
  }
  if (role === 'foreshadow') {
    const view = entries.foreshadows.find(candidate => candidate.cardId === cardId)!
    const mentions = await store.listMentions({ workId, foreshadowId: cardId })
    return [
      `[${view.ref}] ${view.question}${cardFlags(entries, cardId, view.cardStatus)}`,
      `状态：${foreshadowFacts(view)}`,
      ...(view.answer === undefined ? [] : [`答案：${view.answer}`]),
      ...(mentions.length === 0 ? [] : ['轨迹：', ...mentions.map(mention => `- 第${mention.chapter}章 ${mention.kind}${mention.planned ? '（计划内）' : ''}${mention.note === undefined ? '' : ` ${mention.note}`}`)]),
      ...(audit === undefined ? [] : [audit]),
    ].join('\n')
  }
  const view = entries.rules.find(candidate => candidate.cardId === cardId)!
  return [
    `[${view.ref}] ${ROLE_NAMES[view.role]}：${view.text}${cardFlags(entries, cardId, view.status)}`,
    ...(audit === undefined ? [] : [audit]),
  ].join('\n')
}

/** `novel_write`'s arguments; which ones matter depends on `what`. */
interface WriteArgs {
  what: string
  role?: string
  fields?: Record<string, unknown>
  comment?: string
  id?: string
  title?: string
  content?: string
  chapter?: number
  plan?: Record<string, unknown>
  target?: 'card' | 'pending'
  action?: ReviewAction
}
