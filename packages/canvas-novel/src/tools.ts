/**
 * The canvas-novel's main-session tools, registered by the `./agent`
 * composition entry: one read (`novel_read`), one write (`novel_write`) and
 * the two-phase reconciliation (`novel_extract`). They cover what only a
 * novel has — the brief, the ledger, the pending queue, the chapters; cards
 * are read and written with `canvas_read` / `canvas_write`, which hand the
 * role categories to the genre's hooks (genre-agent.ts). They act on the novel
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
import { PHASE_NAMES, ROLE_NAMES, foreshadowFacts, relationFacts } from './genre-agent.ts'
import type { NovelService } from './store.ts'
import type { ChapterPlan, ExtractPayload, PendingItem, ReviewAction } from './types.ts'

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

/** One pending item as the model reads it (one line, evidence attached). */
function pendingLine(item: PendingItem): string {
  return `- [${item.id}] ${item.kind}${item.confidence === undefined ? '' : `（${item.confidence}）`}${item.reason}${item.evidenceInText === undefined ? '' : `\n  原文：「${item.evidenceInText}」`}`
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
      'Read the bound novel canvas. what=brief renders a material pack (for=write/plan/extract); '
      + 'chapters/ledger/pending/chapter read the work (cards: canvas_read). Load the novel skill for the workflow.',
    parameters: {
      what: {
        type: 'string',
        enum: ['brief', 'chapters', 'ledger', 'pending', 'chapter'],
        required: true,
        description: 'What to read.',
      },
      for: { type: 'string', enum: ['write', 'plan', 'extract'], description: 'brief: the variant (default write).' },
      chapter: { type: 'number', description: 'brief/chapter: the chapter number (default: the one being planned).' },
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
          ...(ledger.relations.length === 0 ? [] : ['关系榜（可升在前）：', ...ledger.relations.map(view => `- [${view.ref}] ${view.name}（${relationFacts(view)}）`)]),
        ].join('\n')
      }
      if (args.what === 'pending') {
        const items = await store.listPending({ workId })
        if (items.length === 0) return '待审队列为空（新卡片直接落在画布上、带 ✦ 新卡标记，不在这里）。'
        return [`待审队列（${items.length} 条，✓采纳/✗丢弃走 novel_write(what=review, id, action=accept|discard)）：`, ...items.map(pendingLine)].join('\n')
      }
      if (args.what === 'chapter') {
        if (args.chapter === undefined) return '失败：what=chapter 要给 chapter（章号）。'
        const outcome = await store.readChapter({ workId, n: args.chapter })
        if (!outcome.ok) return `失败：没有第 ${args.chapter} 章。novel_read(what=chapters) 看章节索引。`
        return outcome.body === ''
          ? `第 ${args.chapter} 章《${outcome.chapter!.title}》（${PHASE_NAMES[outcome.phase!] ?? outcome.phase}）：正文为空。`
          : `第 ${args.chapter} 章《${outcome.chapter!.title}》（${PHASE_NAMES[outcome.phase!] ?? outcome.phase}）：\n\n${outcome.body}`
      }
      return '失败：what 只能是 brief/chapters/ledger/pending/chapter；卡片用 canvas_read。'
    },
  })

  const write = defineTool({
    name: 'novel_write',
    description:
      'Write the bound novel canvas. chapter creates (auto n=max+1) or re-plans; content writes the manuscript '
      + 'first and refuses the registration when the fence refuses the write. review decides a pending item '
      + '(action=accept|discard). Cards: canvas_write. Load the novel skill first.',
    parameters: {
      what: { type: 'string', enum: ['chapter', 'review'], required: true, description: 'What to write.' },
      id: { type: 'string', description: 'review: the pending item id.' },
      title: { type: 'string', description: 'chapter: the title.' },
      content: { type: 'string', description: 'chapter: the manuscript body — written to the mounted workspace before registering.' },
      chapter: { type: 'number', description: 'chapter: n to re-plan or to write the body of (omit to create).' },
      byUser: {
        type: 'boolean',
        description: 'chapter: true when the text is the user\'s own manuscript (用户原稿 — imported or pasted): it needs no plan, '
          + 'and the reconciliation skips the plan check. Without it, content is refused until the user confirmed the chapter\'s plan.',
      },
      plan: {
        type: 'object', additionalProperties: true,
        description: 'chapter: {summary (梗概, 2-3 sentences), beats[{at (time label), text, mark?: 转折|落点}], conflict, highlight (看点), '
          + 'foreshadowOps[{op: 推进|暗示|新埋|揭晓, id (the foreshadow\'s ref, e.g. #12 — never its question) | question (新埋 only), note (what it advances or plants)}], cast[{who (ref or name), role}], infoGaps[{who (ref or name), fact (what they learn this chapter — ideally a line of their 不知道)}], pov, hook}.',
      },
      action: { type: 'string', enum: ['accept', 'discard'], description: 'review: accept or discard the pending item.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: async (args: WriteArgs, exec: { agent?: Agent }): Promise<string> => {
      const resolved = await target(exec)
      if ('message' in resolved) return resolved.message
      const { workId } = resolved
      if (args.what === 'chapter') {
        if ((args.title ?? '').trim() === '') return '失败：what=chapter 要给 title。'
        const outcome = await store.writeChapter({
          workId,
          title: args.title!,
          ...(args.chapter === undefined ? {} : { n: args.chapter }),
          ...(args.plan === undefined ? {} : { plan: args.plan }),
          ...(args.content === undefined ? {} : { content: args.content }),
          ...(args.byUser === true ? { byUser: true } : {}),
        }, resolved.session)
        if (!outcome.ok) {
          if (outcome.error === 'missing' && args.chapter !== undefined) {
            return `失败：没有第 ${args.chapter} 章。novel_read(what=chapters) 看索引；新建不要传 chapter。`
          }
          if (outcome.error === 'invalid-name' && args.plan !== undefined) {
            return '失败：plan 读不出来——至少要有 summary（梗概，两三句）；走向写 beats，伏笔写 foreshadowOps，出场写 cast。'
          }
          if (outcome.error === 'denied') {
            return '失败：正文写不进画布挂载的工作区（会话沙箱围栏拒绝）。请用户给画布挂一个本会话可写的工作区，或把正文贴给我用 novel_write(what=chapter, content=…) 重写。'
          }
          if (outcome.error === 'plan-unconfirmed') {
            return args.chapter === undefined
              ? '失败：正文只能写进已确认计划的章节。先 novel_write(what=chapter, title, plan) 登记计划、等用户确认，再带 chapter=N 写正文；用户自己写好的稿子加 byUser=true 登记。'
              : `失败：第 ${args.chapter} 章的计划还没经用户确认（或刚改过计划），不写正文。请用户点会话卡片或章节页上的「确认计划」。`
          }
          if (outcome.error === 'unknown-foreshadow') {
            return `失败：计划里的伏笔要写编号，这几条对不上伏笔卡：${(outcome.unknown ?? []).map(id => `「${id}」`).join('、')}。`
              + '推进/暗示/揭晓的 id 写台账里的编号（如 #12，novel_read 看伏笔台账）；还没有卡的新伏笔写 op=新埋 + question。'
          }
          if (outcome.error === 'no-workspace') {
            return '失败：这张画布还没有挂工作区，章节正文无处可写。请用户先在画布里挂一个工作区（正文写到 <工作区>/<画布标题>/第N章.md）。'
          }
          return `失败：${outcome.error ?? 'io'}`
        }
        const chapter = outcome.chapter!
        const plan = chapter.plan as ChapterPlan | undefined
        return plan === undefined
          ? `已建第 ${chapter.n} 章《${chapter.title}》（画布 ${workId} · 规划中 · ${chapter.file}）。`
          : `已登记第 ${chapter.n} 章《${chapter.title}》（画布 ${workId}）plan：走向 ${plan.beats.length} 拍 / 伏笔 ${plan.foreshadowOps.length} 条 / 出场 ${plan.cast.length} 人。`
            + '完整计划已在会话卡片和章节页上，回复只用两三句说这章怎么走、最想让用户拍板的是什么，不要再贴一遍计划表。用户确认后开写。'
      }
      if (args.what === 'review') {
        if (args.id === undefined || args.action === undefined) return '失败：what=review 要给 id（待审项）和 action（accept|discard）。'
        const outcome = await store.decidePending({ workId, id: args.id, action: args.action }, resolved.session)
        if (!outcome.ok) return outcome.error === 'missing' ? `失败：没有待审项 ${args.id}。` : `失败：${outcome.error ?? 'io'}`
        return args.action === 'accept' ? `已采纳并落库：${args.id}。` : `已丢弃：${args.id}。`
      }
      return '失败：what 只能是 chapter/review；卡片用 canvas_write。'
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
      const lines = [
        `计划命中 ✓×${report.verified} / 计划落空 ×${report.missed}${report.beats.missed === 0 ? '' : ` / 走向没写到 ×${report.beats.missed}（只提醒，不进待审）`} / 新卡 ×${report.newCards.length} / 待你确认 ×${report.pending}${report.dropped.length === 0 ? '' : ` / 丢弃 ×${report.dropped.length}`}`,
      ]
      if (report.newCards.length > 0) {
        lines.push('画布上的新卡（已进 brief，画布上带 ✦ 新卡标记；不对的让用户改或归档，要补内容用 canvas_write(op=card, cardId=编号) 改这张，不要另起）：', ...report.newCards.map(card => `- [${card.ref ?? card.cardId}] ${ROLE_NAMES[card.role]}「${card.text}」`))
      }
      if (report.pendingItems.length > 0) {
        lines.push('待确认清单：', ...report.pendingItems.map(item => `- [${item.id}] ${item.reason}`))
      }
      if (report.dropped.length > 0) {
        lines.push('丢弃（防编造闸）：', ...report.dropped.map(drop => {
          const why = drop.reason === 'evidence-not-found' ? '原文引用在正文里 grep 不到'
            : drop.reason === 'id-not-in-ledger' ? (drop.kind === 'relation' ? '关系不在关系榜' : '伏笔 id 不在活跃榜单')
              : drop.reason === 'card-refused' ? '画布拒绝了这张卡'
                : drop.reason === 'duplicate' ? '画布上已有这张卡'
                  : drop.reason === 'stage-mismatch' ? '这对关系现在的阶段走不了这一步（没到可升、不在裂痕里、或没经过裂痕就转对手）' : '角色不在花名册'
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

/** `novel_write`'s arguments; which ones matter depends on `what`. */
interface WriteArgs {
  what: string
  id?: string
  title?: string
  content?: string
  chapter?: number
  byUser?: boolean
  plan?: Record<string, unknown>
  action?: ReviewAction
}
