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
import { isPlanText, outlineFromText, planFromText } from './text-forms.ts'
import { actingSession, announceDeskBind, announceDeskWrite, deskOf, novelWriteItems } from './desk.ts'
import { RECENT_SCOPE, withChapterDestination, withNovelDestination, withoutDestinations } from './nav-line.ts'
import { planOvershoots, renderOutlineRead, renderPlanBrief, renderWriteBrief, targetWordsOf } from './brief.ts'
import { PHASE_NAMES, ROLE_NAMES, foreshadowFacts, relationFacts } from './genre-agent.ts'
import type { NovelService } from './store.ts'
import { volumeNumeral, volumePosition, type ChapterPlan, type ExtractPayload, type ImportDrop, type PendingItem, type ReviewAction } from './types.ts'
import { isFuture, TIER_LABELS, tensionOf, tierReason, type StoryEvent } from './timeline.ts'
import { searchSettings, settingKindOf } from './settings.ts'
import { deletionCounts } from './chapter-deletion.ts'

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

/** The extract gate's refusal, phase-aware (对账只发生在写作后). */
function extractGateMessage(phase: string | undefined): string {
  if (phase === 'planning') return '这章还没有正文——没有什么可对账的。先写完，再对账。'
  if (phase === 'extracted' || phase === 'reviewed') return '这章对过账，正文之后也没改过——记忆和正文一致，不用再对。正文改了会自动变成「待对账」。'
  if (phase === 'fileMissing') return '这章的正文文件丢了（登记在、文件不在）。先重新定位文件，再谈对账。'
  return '对账只对「写作中」和「待对账」的章开放。'
}

/** Why the import dropped one item, in words the model can act on. */
function dropReason(drop: ImportDrop): string {
  switch (drop.reason) {
    case 'evidence-spliced': return '引用里有省略号，把两处原文拼成了一条——只摘一段连续原文'
    case 'evidence-too-long': return '引用超过 50 字，截断后对不上正文——摘一段 50 字以内的连续原文'
    case 'evidence-not-found': return '这段引用正文里没有——要逐字照抄，不改字、不转述'
    case 'id-not-in-ledger': return drop.kind === 'relation' ? '关系不在关系榜' : drop.kind === 'memory' ? '设定 ref 不在已有设定名册' : drop.kind === 'event' ? '事件锚点不在时间轴' : '伏笔 id 不在活跃榜单'
    case 'card-refused': return '画布拒绝了这张卡'
    case 'duplicate': return '画布上已有这张卡'
    case 'stage-mismatch': return '这对关系现在的阶段走不了这一步（没到可升、不在裂痕里、或没经过裂痕就转对手）'
    case 'apply-failed': return '写进卡片时失败了（卡可能已被改动或归档）'
    default: return '角色不在花名册'
  }
}

/** One pending item as the model reads it (one line, evidence attached). */
function pendingLine(item: PendingItem): string {
  const candidates = item.kind !== 'duplicate' || (item.payload.candidateIds?.length ?? 0) < 2 ? ''
    : `\n  可选合并目标：${item.payload.candidateIds!.map((id, index) => `${item.payload.candidateNames?.[index] ?? id}（cardId=${id}）`).join('、')}；accept 时用 cardId 选择`
  return `- [${item.id}] ${item.kind}${item.confidence === undefined ? '' : `（${item.confidence}）`}${item.reason}${candidates}${item.evidenceInText === undefined ? '' : `\n  原文：「${item.evidenceInText}」`}`
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
    // In a room: the coordinator works on the room's novel; a member on its
    // own, else the room's (desk.ts). The fence stays the caller's session.
    const desk = deskOf(exec.agent)
    const work = await store.boundWork(String(actingSession(session, desk).id))
      ?? (desk?.role === 'member' ? await store.boundWork(String(desk.session.id)) : undefined)
    if (work === undefined) return { message: NO_WORK_MESSAGE }
    await store.ensureRefs(work.id, session)
    return { workId: work.id, session }
  }

  const read = defineTool({
    name: 'novel_read',
    description:
      'Read the bound novel canvas. what=brief renders a material pack (for=write/plan/extract); '
      + 'outline reads the one-page outline, volumes and core suspenses; '
      + 'chapters/ledger/pending/chapter read the work (cards: canvas_read); events reads the timeline (ids: those events in full); '
      + 'settings searches world settings by query/kind, or reads refs in full; '
      + 'ideas reads the person\'s 灵感; changes reads 待对齐 — what changed since the book was last aligned, each with the written chapters it touches and only the passages to check. Load the novel skill for the workflow.',
    parameters: {
      what: {
        type: 'string',
        enum: ['brief', 'outline', 'chapters', 'ledger', 'pending', 'chapter', 'events', 'settings', 'ideas', 'changes'],
        required: true,
        description: 'What to read.',
      },
      for: { type: 'string', enum: ['write', 'plan', 'extract'], description: 'brief: the variant (default write).' },
      chapter: { type: 'number', description: 'brief/chapter: the chapter number (default: the one being planned).' },
      ids: { type: 'array', items: { type: 'string' }, description: 'events: the event ids to read in full (causes, the people\'s minds, the settings, bound ideas); omit for the whole timeline, one line each.' },
      query: { type: 'string', description: 'settings: keywords matched against names and content.' },
      kind: { type: 'string', description: 'settings: 体系|地点|势力|物种与道具.' },
      refs: { type: 'array', items: { type: 'string' }, description: 'settings: refs to read in full (w3 or a card id).' },
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
      ids?: string[]
      query?: string
      kind?: string
      refs?: string[]
    }, exec: { agent?: Agent }): Promise<string> => {
      const resolved = await target(exec)
      if ('message' in resolved) return resolved.message
      const { workId } = resolved
      if (args.what === 'settings') {
        const entries = await store.readEntries(workId)
        const hits = searchSettings(entries?.rules ?? [], {
          ...(args.query === undefined ? {} : { query: args.query }),
          ...(args.kind === undefined ? {} : { kind: args.kind }),
          ...(args.refs === undefined ? {} : { refs: args.refs }),
        })
        if (hits.length === 0) return '没有匹配的设定。可换关键字或类型；新设定会在对账导入时再做全量防重。'
        const detailed = (args.refs?.length ?? 0) > 0
        return hits.map(({ rule, match }) => `- [${rule.ref}] ${rule.name ?? rule.text.slice(0, 40)}（${settingKindOf(rule)}；${match === 'exact' ? '名称完全匹配' : match === 'name' ? '名称匹配' : '正文匹配'}）${detailed ? `\n  ${rule.text}` : ''}`).join('\n')
      }
      if (args.what === 'events') return renderEvents(store, workId, args.ids)
      if (args.what === 'changes') return renderChanges(store, workId)
      if (args.what === 'ideas') {
        const doc = await store.readIdeas(workId)
        if (doc.ideas.length === 0) return '还没有灵感。'
        return ['灵感（i 编号；绑定事件用 novel_write(what=idea, id, event)）：', ...doc.ideas.map(idea => `- [${idea.id}]${idea.eventId === undefined ? '（未绑定）' : `（绑定 ${idea.eventId}${idea.writtenIn === undefined ? '' : `，已写入第${idea.writtenIn}章`}）`} ${idea.text}`)].join('\n')
      }
      if (args.what === 'brief') {
        const gathered = await store.gatherBrief({
          workId, ...(args.chapter === undefined ? {} : { chapter: args.chapter }),
          ...(args.for === 'plan' ? { for: 'plan' as const } : args.for === 'extract' ? {} : { for: 'write' as const }),
        })
        if (!gathered.ok || gathered.data === undefined) {
          return gathered.error === 'missing'
            ? '还没有可定位的章节：先 novel_write(what=chapter, title=…[, plan=…]) 建章，再取 brief。'
            : `失败：${gathered.error ?? 'io'}`
        }
        if (args.for === 'plan') return renderPlanBrief(gathered.data)
        if (args.for === 'extract') {
          const chapter = gathered.data.target
          const prepared = await store.extractPrepare({ workId, n: chapter.n })
          if (prepared.ok) return prepared.text!
          if (prepared.error !== 'not-reviewed') return `失败：${prepared.error ?? 'io'}`
          const read = await store.readChapter({ workId, n: chapter.n })
          return extractGateMessage(read.ok ? read.phase : undefined)
        }
        return renderWriteBrief(gathered.data)
      }
      if (args.what === 'outline') {
        const [outline, entries, chapters] = await Promise.all([
          store.readOutline(workId), store.readEntries(workId), store.listChapters({ workId }),
        ])
        return renderOutlineRead(
          outline,
          entries?.characters.filter(view => view.cardStatus === 'kept') ?? [],
          chapters.map(row => row.chapter),
          entries?.foreshadows.filter(view => view.cardStatus === 'kept') ?? [],
        )
      }
      if (args.what === 'chapters') {
        const chapters = await store.listChapters({ workId })
        if (chapters.length === 0) return '还没有章节：novel_write(what=chapter, title=…[, plan=…]) 建第 1 章。'
        const open = chapters.filter(row => row.phase === 'stale' || row.phase === 'writing')
        return [
          `章节（${chapters.length} 章，按 seq 排序）：`,
          ...chapters.map(({ chapter, phase }) =>
            `- 第${chapter.n}章 ${chapter.title}（${PHASE_NAMES[phase] ?? phase}）${chapter.recap ?? ''}`),
          ...(open.length === 0 ? [] : [
            `待对账：${open.map(row => `第${row.chapter.n}章`).join('、')}——记忆还没读过这些正文，规划或续写之前先逐章对账（novel_extract prepare → subagent → import）。`,
          ]),
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
      return '失败：what 只能是 brief/outline/chapters/ledger/pending/chapter/events/settings/ideas/changes；卡片用 canvas_read。'
    },
  })

  const write = defineTool({
    name: 'novel_write',
    description:
      'Write the bound novel canvas. chapter creates (auto n=max+1) or re-plans; content writes the manuscript '
      + 'first and refuses the registration when the fence refuses the write. outline proposes outline changes '
      + '(the user adopts them on the 规划 page). organize moves setting cards onto the 世界观 shelves '
      + '(phase=preview proposes and answers the 整理结果; phase=apply only after the user agreed). review decides a pending item '
      + '(action=accept|discard). Cards: canvas_write. Load the novel skill first.',
    parameters: {
      what: { type: 'string', enum: ['chapter', 'confirm', 'outline', 'organize', 'event', 'idea', 'review', 'delete', 'aligned'], required: true, description: 'What to write. confirm: record the user\'s confirmation of a chapter plan (chapter=N) — only when their latest message says so. delete: remove a setting, person, relation, foreshadow (card id), event (e3) or idea (i2) by id, with the same fixes the person\'s 删除 makes (children move up, references cleared, a person\'s relations go too); the answer lists the written chapters that still carry it. Chapters use chapters=[N] with phase=preview first, then deletionId with phase=apply after the user confirms in a later message; restore/purge use the same operation id.' },
      id: { type: 'string', description: 'review: the pending item id. delete: the card / event / idea id. aligned: the 待对齐 item\'s node id done, or "all".' },
      cardId: { type: 'string', description: 'review accept: the duplicate candidate to merge into; use one of the pending item\'s candidateIds.' },
      title: { type: 'string', description: 'chapter: the title.' },
      content: {
        type: 'string',
        description: 'chapter: the manuscript body — written to the mounted workspace before registering; a content opening on 「梗概：」 is the plan in text form instead. '
          + 'outline: the outline in text form (「键：值」 lines) when sheet/volumes do not arrive.',
      },
      chapter: { type: 'number', description: 'chapter: n to re-plan or to write the body of (omit to create).' },
      replace: {
        type: 'boolean',
        description: 'chapter: true to replace a chapter file that already holds a body (read it first with novel_read). '
          + 'Without it, content onto an existing body is refused.',
      },
      byUser: {
        type: 'boolean',
        description: 'chapter: true when the text is the user\'s own manuscript (用户原稿 — imported or pasted): it needs no plan, '
          + 'and the reconciliation skips the plan check. Without it, content is refused until the user confirmed the chapter\'s plan.',
      },
      plan: {
        type: 'object', additionalProperties: true,
        description: 'chapter: {words (目标字数, default the outline\'s per-chapter length), summary (梗概, 2-3 sentences), beats[{at (time label), text, mark?: 转折|落点}], conflict, highlight (看点), '
          + 'foreshadowOps[{op: 推进|暗示|新埋|揭晓, id (the foreshadow\'s ref, e.g. #12 — never its question) | question (新埋 only), note (what it advances or plants)}], cast[{who (ref or name), role}], infoGaps[{who (ref or name), fact (what they learn this chapter — ideally a line of their 不知道)}], uses (用到的设定: the setting refs or names this chapter leans on, e.g. ["w3", "命名"] — the write brief carries these in full, the rest by name only), pov, hook}.',
      },
      action: { type: 'string', enum: ['accept', 'discard'], description: 'review: accept or discard the pending item.' },
      volume: { type: 'string', description: 'chapter: the volume to file it under (id, title or 卷二); omit to stay in the previous chapter\'s.' },
      sheet: {
        type: 'object', additionalProperties: true,
        description: 'outline: the one-page fields to change — logline, conflict (核心冲突), protagonist (a character card ref or name), '
          + 'arc (成长弧线: start → end), theme, tone, ending, length {words, volumes, chapters, perChapter}.',
      },
      volumes: {
        type: 'array', items: { type: 'object', additionalProperties: true },
        description: 'outline: the whole volume list [{title, chapters (about how many), goal, landing (卷末落点)}] — volumes only, never every chapter.',
      },
      sketches: {
        type: 'array', items: { type: 'object', additionalProperties: true },
        description: 'outline: one-line sketches of the next one or two chapters [{n, line}].',
      },
      rationale: { type: 'string', description: 'outline: why, in a sentence.' },
      event: {
        type: 'object', additionalProperties: true,
        description: 'event: {id? (to change one), title, when (story time as a label), status (happened|preset|planned|hidden|failed; default preset = to come), '
          + 'source (预设|打算|后果|承诺 — a future event\'s origin), who (character refs or names), places (setting refs or names), value (0–1, how much the story needs it), valueWhy, '
          + 'window (卷一末 / 第8章前), windowChapter (that window as a chapter number), pre (["the preconditions"]), causes (event ids it follows from), '
          + 'after (event id it comes right after in story time), before (event id it comes right before, or "first"; mutually exclusive with after), '
          + 'chapters ([N] — for a happened event: the chapters whose text tells it, flashbacks included), evidence (≤50 chars copied verbatim from that chapter), '
          + 'backstory (true: it happened before the story\'s opening scene, whichever chapter tells it; without after/before it joins the backstory group in the order given), delete (true)}. '
          + 'Keep the chapter and the quote out of valueWhy and when: chapters and evidence carry them. '
          + 'idea: the event id to bind the idea to (null unbinds).',
      },
      phase: { type: 'string', enum: ['preview', 'apply', 'restore', 'purge'], description: 'organize: preview/apply. delete with chapters: preview first, then apply only after the user confirms in a later message; restore/purge use deletionId.' },
      chapters: { type: 'array', items: { type: 'number' }, description: 'delete: chapter numbers to preview, restore or permanently purge (batch is one operation).' },
      deletionId: { type: 'string', description: 'delete: the preview/operation id returned by phase=preview.' },
      cards: { type: 'array', items: { type: 'string' }, description: 'delete: cascade card ids to archive on apply, or to restore explicitly later.' },
      position: { type: 'string', enum: ['original', 'next'], description: 'delete restore: original chapter number, or the next free one when it is occupied.' },
      moves: {
        type: 'array', items: { type: 'object', additionalProperties: true },
        description: 'organize: [{card (ref or name), to (体系|地点|势力|物种与道具|写作原则), parent? (the card or new entry it sits under), name? (a 原则 card\'s name as a setting)}]. '
          + 'Old 世界 cards not listed go by their 类型 (地点→地点, 势力→势力, 道具→物种与道具, the rest→体系).',
      },
      create: {
        type: 'array', items: { type: 'object', additionalProperties: true },
        description: 'organize: the shelf entries the cards only imply [{to (体系|地点|势力|物种与道具), name, rule, parent?}] — a 体系 a group of rules shares, a 势力 named inside a rule, a place two places sit in.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: async (arrived: WriteArgs, exec: { agent?: Agent }): Promise<string> => told(exec, () => runWrite(arrived, exec)),
  })

  const runWrite = async (arrived: WriteArgs, exec: { agent?: Agent }): Promise<string> => {
    {
      const resolved = await target(exec)
      if ('message' in resolved) return resolved.message
      const { workId } = resolved
      const args = withTextForms(arrived)
      if (args.what === 'chapter') {
        if (args.delete === true) return '失败：what=chapter 不接受 delete。删除章节请用 novel_write(what=delete, chapters=[N], phase="preview")，确认影响后再 apply；不会把 delete 当成普通写入。'
        if ((args.title ?? '').trim() === '') return '失败：what=chapter 要给 title。'
        // Asking to plan 「第 N 章」 when N is simply the next one is a create, not a miss.
        const existing = args.chapter === undefined ? [] : await store.listChapters({ workId })
        const next = existing.reduce((max, row) => Math.max(max, row.chapter.n), 0) + 1
        const creates = args.chapter !== undefined && args.chapter === next && !existing.some(row => row.chapter.n === args.chapter)
        const outcome = await store.writeChapter({
          workId,
          title: args.title!,
          ...(args.chapter === undefined || creates ? {} : { n: args.chapter }),
          ...(args.plan === undefined ? {} : { plan: args.plan }),
          ...(args.content === undefined ? {} : { content: args.content }),
          ...(args.byUser === true ? { byUser: true } : {}),
          ...(args.replace === true ? { replace: true } : {}),
          ...(args.volume === undefined ? {} : { volume: args.volume }),
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
              : `失败：第 ${args.chapter} 章的计划还没经用户确认（或刚改过计划），不写正文。用户在对话里已经明确同意这版计划的话，先 novel_write(what=confirm, chapter=${args.chapter}) 登记确认再写；没有就请用户确认（对话里说一声，或点章节页的「按计划开写」）。`
          }
          if (outcome.error === 'unknown-foreshadow') {
            return `失败：计划里的伏笔要写编号，这几条对不上伏笔卡：${(outcome.unknown ?? []).map(id => `「${id}」`).join('、')}。`
              + '推进/暗示/揭晓的 id 写台账里的编号（如 #12，novel_read 看伏笔台账）；还没有卡的新伏笔写 op=新埋 + question。'
          }
          if (outcome.error === 'plan-on-draft') {
            return `失败：第 ${args.chapter ?? '新'} 章是用户原稿，不登记计划——计划是你写之前的提案，用户自己写好的稿子直接对账（novel_extract）。`
          }
          if (outcome.error === 'body-exists') {
            return `失败：第 ${args.chapter ?? '新'} 章的文件已经有正文（${outcome.existingLength ?? 0} 字），不会覆盖。`
              + '只登记已在工作区的稿子就不要带 content；确实要整章替换，先 novel_read(what=chapter) 读原文，改好后带 replace=true 重写全文。'
          }
          if (outcome.error === 'unknown-volume') {
            return `失败：大纲里没有「${args.volume ?? ''}」这一卷。novel_read(what=outline) 看分卷；要新开一卷先用 novel_write(what=outline, volumes=…) 提议。`
          }
          if (outcome.error === 'no-workspace') {
            return '失败：这张画布还没有挂工作区，章节正文无处可写。请用户在画布右上角 ⋯ 的「工作区」里勾选一个（正文写到 <工作区>/<画布标题>/第N章.md）。'
          }
          return `失败：${outcome.error ?? 'io'}`
        }
        const chapter = outcome.chapter!
        const plan = chapter.plan as ChapterPlan | undefined
        const attached = outcome.attachedWorkspace === undefined
          ? ''
          : `画布原本没挂工作区，已挂上会话所在的 ${outcome.attachedWorkspace}（用户可在画布 ⋯ 的「工作区」里改）。\n`
        // A body landed (written, pasted, or the person's own file registered):
        // its own answer, so the conversation shows a 正文 card, not the plan again.
        const body = args.content !== undefined && args.content.trim() !== '' ? args.content : undefined
        if (body !== undefined || args.byUser === true) {
          const count = body === undefined ? chapter.wordCount : body.replace(/\s+/g, '').length
          return withChapterDestination(`${attached}已写入第 ${chapter.n} 章《${chapter.title}》正文（画布 ${workId}${count === undefined ? '' : ` · ${count} 字`}）。`
            + `\n正文在画布「章节」页签的第 ${chapter.n} 章（会话里有卡片直达）。回复里汇报三行（字数 / 动用了哪几条伏笔操作 / 有没有偏离计划），然后接着对账这一章，不用等用户点头。`,
          workId, chapter.n, chapter.title, 'body', String(count ?? Date.now()))
        }
        if (plan === undefined) {
          return withChapterDestination(`${attached}已建第 ${chapter.n} 章《${chapter.title}》（画布 ${workId} · 规划中 · ${chapter.file}）。`,
            workId, chapter.n, chapter.title, 'plan', String(Date.now()))
        }
        const [outline, entries, chapters] = await Promise.all([
          store.readOutline(workId), store.readEntries(workId), store.listChapters({ workId }),
        ])
        const words = targetWordsOf(chapter, outline)
        const position = volumePosition(outline.volumes, chapters.map(row => row.chapter), chapter)
        const overshoots = planOvershoots(plan, words, entries?.foreshadows ?? [], position?.index, outline.volumes.length)
        return withChapterDestination(`${attached}已登记第 ${chapter.n} 章《${chapter.title}》（画布 ${workId}${position === undefined ? '' : ` · 卷${volumeNumeral(position.index)}`}）plan：`
          + `${words === undefined ? '' : `目标 ${words} 字 / `}情节 ${plan.beats.length} 段 / 伏笔 ${plan.foreshadowOps.length} 条 / 出场 ${plan.cast.length} 人。`
          + (overshoots.length === 0 ? '' : `\n提醒（只提醒，不拦）：${overshoots.join('；')}。在回复里跟用户说一句，按他的意思改或保留。`)
          + `\n完整计划在画布「章节」页签的第 ${chapter.n} 章（会话里有卡片直达）。回复只用两三句说这章怎么走、最想让用户拍板的是什么，不要再贴一遍计划表。`
          + `用户在对话里同意后，先 novel_write(what=confirm, chapter=${chapter.n}) 再开写；他也可能直接在章节页点了确认。`,
        workId, chapter.n, chapter.title, 'plan', String(Date.now()), { status: '等你确认', awaiting: true, door: '查看并确认计划 →' })
      }
      if (args.what === 'event') {
        const raw = (typeof args.event === 'object' && args.event !== null ? args.event : {}) as Record<string, unknown>
        const outcome = await store.writeEvent({
          workId,
          ...(typeof raw['id'] === 'string' ? { id: raw['id'] } : {}),
          ...(typeof raw['title'] === 'string' ? { title: raw['title'] } : {}),
          ...(typeof raw['when'] === 'string' ? { when: raw['when'] } : {}),
          ...(typeof raw['status'] === 'string' ? { status: raw['status'] } : {}),
          ...(typeof raw['source'] === 'string' ? { source: raw['source'] } : {}),
          ...(raw['who'] === undefined ? {} : { who: raw['who'] }),
          ...(raw['places'] === undefined ? {} : { places: raw['places'] }),
          ...(raw['value'] === undefined ? {} : { value: raw['value'] }),
          ...(typeof raw['valueWhy'] === 'string' ? { valueWhy: raw['valueWhy'] } : {}),
          ...(typeof raw['window'] === 'string' ? { window: raw['window'] } : {}),
          ...(raw['windowChapter'] === undefined ? {} : { windowChapter: raw['windowChapter'] }),
          ...(raw['pre'] === undefined ? {} : { pre: raw['pre'] }),
          ...(raw['causes'] === undefined ? {} : { causes: raw['causes'] }),
          ...(typeof raw['after'] === 'string' ? { after: raw['after'] } : {}),
          ...(typeof raw['before'] === 'string' ? { before: raw['before'] } : {}),
          ...(raw['chapters'] === undefined ? {} : { chapters: raw['chapters'] }),
          ...(typeof raw['evidence'] === 'string' ? { evidence: raw['evidence'] } : {}),
          ...(raw['backstory'] === undefined ? {} : { backstory: raw['backstory'] }),
          ...(raw['delete'] === true ? { delete: true } : {}),
        }, resolved.session)
        if (!outcome.ok) {
          if (outcome.unknown !== undefined) return `失败：这些对不上画布上的卡：${outcome.unknown.join('、')}（人物和设定填编号或准确名字；要的卡还没有就先建）。`
          if (outcome.error === 'missing') return '失败：没有这个事件（novel_read(what=events) 看编号）。'
          return `失败：${outcome.error === 'invalid-name' ? 'title、after 或 before 无效；after 与 before 只能给一个，锚点要是已有事件编号' : outcome.error ?? 'io'}。`
        }
        await store.alignAck({ workId, ids: [outcome.id!] }, resolved.session)
        if (raw['delete'] === true) return `已删除事件 ${outcome.id}。`
        const happened = raw['status'] === 'happened' || raw['status'] === 'failed'
        const noChapter = happened && raw['chapters'] === undefined && raw['id'] === undefined
        return `已记下事件 [${outcome.id}]，在时间轴上。${noChapter ? '没给 chapters：时间轴不知道它写在哪一章，会放进「时间待定」（故事开始前的往事给 backstory=true）。正文写到了就补 chapters 和 evidence。' : ''}`
      }
      if (args.what === 'aligned') {
        if (args.id === undefined) return '失败：what=aligned 要给 id（待对齐里那一项的编号，novel_read(what=changes) 看），或 "all"。'
        const ids = args.id === 'all' ? 'all' as const : args.id.split(/[,，\s]+/).filter(Boolean)
        const outcome = await store.alignAck({ workId, ids }, resolved.session)
        return outcome.ok ? (ids === 'all' ? '待对齐已清空：当前状态记为新的基线。' : `已勾掉 ${ids.join('、')}。`) : `失败：${outcome.error ?? 'io'}`
      }
      if (args.what === 'delete' && (args.chapters !== undefined || args.deletionId !== undefined)) {
        const phase = args.phase
        if (phase === 'preview') {
          if (args.deletionId !== undefined) return '失败：删除预览不需要 deletionId；请用 chapters 指定章节。'
          if (args.chapters === undefined || args.chapters.length === 0) return '失败：删除预览要给 chapters（章号数组）。'
          const outcome = await store.previewChapterDeletion({ workId, chapters: args.chapters }, resolved.session, true)
          if (!outcome.ok) return `失败：${outcome.error === 'missing' ? '有这些章节不存在，先 novel_read(what=chapters) 核对' : outcome.error}。`
          const operation = outcome.operation
          const counts = deletionCounts(operation)
          const answer = [
            `删除预览：第 ${args.chapters.join('、')} 章（${args.chapters.length} 章），尚未删除。`,
            `正文 ${counts.bodies} 份 / 计划 ${counts.plans} 份 / 派生记录 ${counts.mentions + counts.experiences + counts.relations + counts.history + counts.minds + counts.pending + counts.feedback} 条（伏笔 ${counts.mentions}、经历 ${counts.experiences}、关系 ${counts.relations}、卡片历史 ${counts.history}、人物记忆 ${counts.minds}、待审 ${counts.pending}、想法 ${counts.feedback}）。`,
            `级联清理候选 ${operation.cascadeCards.length} 张卡片（${operation.cascadeCards.map(row => row.id).join('、') || '无'}）；共享卡片待对齐 ${operation.reviewCards.length} 项。`,
            `回收站快照约 ${Math.ceil(operation.size / 1024)} KB。正文与计划可恢复，含正文的章节恢复后要重新对账。`,
            `deletionId=${operation.id}。请把影响告诉用户，等他下一条消息明确确认后，再 novel_write(what=delete, deletionId="${operation.id}", phase="apply")；可传 cards 只保留选中的级联候选。`,
          ].join('\n')
          return withNovelDestination(answer, `canvas:${workId}:delete-preview:${operation.id}`, { canvasId: workId, face: 'manuscripts' }, `删除预览 · ${args.chapters.length} 章`, { status: '等你确认', awaiting: true, door: '查看影响 →' })
        }
        if (args.deletionId === undefined) return '失败：章节删除、恢复或彻底删除要给 deletionId（先 phase=preview 获取）。'
        if (phase === 'apply') {
          const outcome = await store.applyChapterDeletion({ workId, deletionId: args.deletionId, ...(args.cards === undefined ? {} : { cards: args.cards }) }, resolved.session, true)
          if (!outcome.ok) return outcome.error === 'plan-unseen'
            ? '失败：预览之后还没有新的用户确认消息。先把影响告诉用户，等他明确同意后再 apply，不能由 Agent 自己确认。'
            : `失败：${outcome.error === 'stale' ? '预览后章节或正文已变化，请重新 preview' : outcome.error ?? 'io'}。`
          const answer = outcome.cleanupPending
            ? `第 ${outcome.operation.chapters.map(row => row.record.n).join('、')} 章已删除并移入回收站，但部分清理尚未完成（${outcome.operation.cleanupError ?? 'io'}）。旧数据不会进入写作；同章号新章要等清理重试成功。`
            : `第 ${outcome.operation.chapters.map(row => row.record.n).join('、')} 章已删除并移入回收站。正文、计划和派生快照长期保留，可逐章恢复；含正文的章节恢复后要重新对账。`
          return withNovelDestination(answer, `canvas:${workId}:delete:${args.deletionId}`, { canvasId: workId, face: 'manuscripts' }, '章节回收站', { status: outcome.cleanupPending ? '清理待完成' : '已移入回收站', awaiting: false, door: '查看回收站 →' })
        }
        if (phase === 'restore') {
          const outcome = await store.restoreChapters({ workId, deletionId: args.deletionId, ...(args.chapters === undefined ? {} : { chapters: args.chapters }), ...(args.cards === undefined ? {} : { cards: args.cards }), ...(args.position === undefined ? {} : { position: args.position }) }, resolved.session)
          if (!outcome.ok) return `失败：${outcome.error === 'duplicate' ? '原章号已被新章占用，请用 position="next" 恢复到下一空闲章号' : outcome.error ?? 'io'}。`
          const answer = `已恢复 ${outcome.restored} 章正文和计划${outcome.cardErrors.length > 0 ? `；${outcome.cardErrors.length} 张卡片恢复失败` : ''}。含正文的章节已标为待对账，旧派生记忆不会自动倒放。`
          return withNovelDestination(answer, `canvas:${workId}:restore:${args.deletionId}`, { canvasId: workId, face: 'manuscripts' }, '章节已恢复', { status: '待对账', awaiting: true, door: '去对账 →' })
        }
        if (phase === 'purge') {
          const outcome = await store.purgeChapters({ workId, deletionId: args.deletionId, ...(args.chapters === undefined ? {} : { chapters: args.chapters }) }, resolved.session)
          if (!outcome.ok) return `失败：${outcome.error ?? 'io'}。`
          return `已彻底删除 ${outcome.purged} 章的回收站快照，无法再通过回收站恢复。当前章节目录不变；会话历史、外部导出副本和系统备份不在清理范围内。`
        }
        return '失败：章节删除 phase 只能是 preview/apply/restore/purge；先 preview，再按流程操作。'
      }
      if (args.what === 'delete') {
        if (args.id === undefined) return '失败：what=delete 要给 id（卡片编号、事件 e3 或灵感 i2）；章节请给 chapters 并先 phase=preview。'
        const outcome = await store.deleteNode({ workId, node: args.id }, resolved.session)
        if (!outcome.ok) return outcome.error === 'unsupported' ? '失败：当前画布版本不支持删卡片。' : `失败：${outcome.error === 'missing' ? `没有 ${args.id}（章节不能这样删）` : outcome.error ?? 'io'}。`
        const impact = outcome.impact!
        await store.alignAck({ workId, ids: [args.id, ...impact.auto.map(fix => fix.id)] }, resolved.session)
        const lines = [`已删除「${impact.node.name}」。`]
        if (impact.auto.length > 0) lines.push(`顺带处理了 ${impact.auto.length} 处引用（下属上移、连线清空、相关关系卡一起删）。`)
        if (impact.chapters.length > 0) lines.push(`第 ${impact.chapters.join('、')} 章正文写到过它：正文没动，需要的话按新设定改那几段。`)
        return lines.join('\n')
      }
      if (args.what === 'idea') {
        if (args.id === undefined) return '失败：what=idea 要给 id（灵感编号，novel_read(what=ideas) 看）。'
        const eventId = args.event === null ? null : typeof args.event === 'string' ? args.event : undefined
        if (eventId === undefined) return '失败：what=idea 要给 event（事件编号；null 表示解绑）。'
        const outcome = await store.changeIdea({ workId, id: args.id, eventId }, resolved.session)
        return outcome.ok ? (eventId === null ? `已解绑灵感 ${args.id}。` : `已把灵感 ${args.id} 绑到事件 ${eventId}：规划到这件事时原文会一起带上。`) : `失败：${outcome.error ?? 'io'}`
      }
      if (args.what === 'organize') {
        if (args.phase === 'apply') {
          const outcome = await store.organizeApply({ workId }, resolved.session)
          if (!outcome.ok) {
            if (outcome.error === 'no-proposal') return '失败：没有待执行的整理方案。先 novel_write(what=organize) 出一份整理结果给用户看。'
            if (outcome.error === 'plan-unseen') return '失败：整理方案是在用户最后一条消息之后才出的，用户还没看过。回复里请用户看一眼整理结果，等他下一条消息明确同意再 apply。'
            return `失败：${outcome.error ?? 'io'}`
          }
          return `已整理：${outcome.moved ?? 0} 张卡换到新位置，新建 ${outcome.created ?? 0} 张。`
            + (outcome.failed === undefined ? '' : `没成功的：${outcome.failed.join('、')}（canvas_read 看现状，必要时单张用 canvas_write 改）。`)
            + '设定页现在按 体系 / 地点 / 势力 / 物种与道具 分开；回复里用一两句告诉用户可以去设定页看。'
        }
        const outcome = await store.organizePreview({
          workId, ...(args.moves === undefined ? {} : { moves: args.moves }), ...(args.create === undefined ? {} : { create: args.create }),
        }, resolved.session)
        if (!outcome.ok) {
          if (outcome.unknown !== undefined) return `失败：这些对不上画布上的卡或新建条目：${outcome.unknown.join('、')}。canvas_read 看编号后重来。`
          return `失败：${outcome.error ?? 'io'}`
        }
        return `${outcome.text ?? ''}\n\n这只是方案，卡片还没动。把整理结果用几句话讲给用户（哪些归成一个体系、拆出了哪些势力、哪些原则其实是设定），`
          + '请他看看；他同意后（下一条消息里）再 novel_write(what=organize, phase=apply)。他要改就带着改过的 moves / create 重新 preview。'
      }
      if (args.what === 'confirm') {
        if (args.chapter === undefined) return '失败：what=confirm 要给 chapter（章号）。'
        const outcome = await store.confirmChapterPlan({ workId, n: args.chapter, byAgent: true }, resolved.session)
        if (!outcome.ok) {
          if (outcome.error === 'plan-unseen') {
            return `失败：第 ${args.chapter} 章这版计划是在用户最后一条消息之后才登记的，用户还没看过，更没同意——用户提的修改意见不等于同意改完的计划。`
              + '现在不要写正文：回复里用两三句说改了什么，请用户看一眼（章节页或会话里的计划卡），等他下一条消息明确同意，再 confirm。'
          }
          if (outcome.error === 'missing') return `失败：没有第 ${args.chapter} 章。`
          if (outcome.error === 'invalid-name') return `失败：第 ${args.chapter} 章还没有计划，先 novel_write(what=chapter, plan=…) 登记。`
          return `失败：${outcome.error ?? 'io'}`
        }
        return withNovelDestination(`已确认第 ${args.chapter} 章的计划（按用户在对话里的同意），可以写正文了：先 novel_read(brief, for=write, chapter=${args.chapter})。`,
          `canvas:${workId}:chapter:${args.chapter}:confirm:${Date.now()}`,
          { canvasId: workId, face: 'manuscripts', item: String(args.chapter), focus: 'plan' }, `第 ${args.chapter} 章计划`,
          { status: '已确认', awaiting: false, door: '查看计划 →' })
      }
      if (args.what === 'outline') {
        const outcome = await store.proposeOutline({
          workId,
          ...(args.sheet === undefined ? {} : { sheet: args.sheet }),
          ...(args.volumes === undefined ? {} : { volumes: args.volumes }),
          ...(args.sketches === undefined ? {} : { sketches: args.sketches }),
          ...(args.rationale === undefined ? {} : { rationale: args.rationale }),
        }, resolved.session)
        if (!outcome.ok) {
          if (outcome.error === 'unknown-protagonist') {
            return '失败：主角要是一张人物卡（写它的编号如 c1，或名字）。还没有就先用 canvas_write 落一张人物卡（名字、身份、想要、抱负、价值观……），再提大纲。'
          }
          if (outcome.error === 'invalid-name') {
            return '失败：sheet、volumes、sketches 都没收到。如果你填了却没到达（当前模型/供应商会丢嵌套参数），改用纯文本：'
              + 'content 里每行一个「键：值」——一句话主线、核心冲突、主角（人物卡编号或名字）、成长弧线、主题、类型与基调、结局方向、'
              + '篇幅（如「30万字 / 3卷 / 约100章 / 单章3000字」），每卷一行「卷一：标题｜约12章｜要完成：…｜卷末：…」，理由：…。'
          }
          return `失败：${outcome.error ?? 'io'}`
        }
        return withNovelDestination(`已提交大纲提议（画布 ${workId}），在「规划」页等用户采用；采用前不生效，再提会合并进这一版。`
          + '回复里用两三句说改了什么、为什么，不要贴整份大纲。',
        `canvas:${workId}:outline:${Date.now()}`, { canvasId: workId, face: 'lead' }, '大纲提议', { status: '等你采用', awaiting: true, door: '去总览采用 →' })
      }
      if (args.what === 'review') {
        if (args.id === undefined || args.action === undefined) return '失败：what=review 要给 id（待审项）和 action（accept|discard）。'
        const pending = (await store.listPending({ workId })).find(item => item.id === args.id)
        const outcome = await store.decidePending({ workId, id: args.id, action: args.action, ...(args.cardId === undefined ? {} : { cardId: args.cardId }) }, resolved.session)
        if (!outcome.ok) return outcome.error === 'missing' ? `失败：没有待审项 ${args.id}。` : `失败：${outcome.error ?? 'io'}`
        if (pending?.kind === 'duplicate') return args.action === 'accept' ? `已合并到已有设定：${args.id}。` : `已确认另建独立设定：${args.id}。`
        return args.action === 'accept' ? `已采纳并落库：${args.id}。` : `已丢弃：${args.id}。`
      }
      return '失败：what 只能是 chapter/outline/review；卡片用 canvas_write。'
    }
  }

  /**
   * Run one novel write, then tell the room what it did when the caller is a
   * room member (desk.ts): the work's cards and chapters read around the call.
   * Outside a room this is exactly the call.
   */
  const told = async (exec: { agent?: Agent }, run: () => Promise<string>): Promise<string> => {
    const desk = deskOf(exec.agent)
    const resolved = desk === undefined ? undefined : await target(exec)
    if (desk === undefined || resolved === undefined || 'message' in resolved) return desk === undefined ? run() : withoutDestinations(await run())
    const before = await store.deskSnapshot(resolved.workId)
    const answer = withoutDestinations(await run())
    const after = before === undefined ? undefined : await store.deskSnapshot(resolved.workId)
    if (before !== undefined && after !== undefined) {
      const names = await store.categoryNames(resolved.workId)
      announceDeskWrite(desk, { id: resolved.workId, title: after.title }, novelWriteItems(before, after, kind => names.get(kind)))
    }
    return answer
  }

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
    execute: async (args: { chapter: number; phase: 'prepare' | 'import'; payload?: ExtractPayload }, exec: { agent?: Agent }): Promise<string> => told(exec, async () => {
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
      // A 对账 brings this chapter's memory up to date: what it moved is aligned (other chapters' text is not its to clear).
      const current = await store.readChapter({ workId: resolved.workId, n: args.chapter })
      const currentId = current.ok && current.chapter !== undefined ? current.chapter.id ?? `ch:${args.chapter}` : `ch:${args.chapter}`
      const moved = (await store.alignMoved(resolved.workId)).filter(id => !/^ch(?::\d+|_)/.test(id) || id === currentId)
      await store.alignAck({ workId: resolved.workId, ids: [...new Set([...moved, currentId])] }, resolved.session)
      if (!report.settled) {
        return [
          `未对完，修正引用后重新导入：${report.dropped.length} 条引用对不上第 ${args.chapter} 章正文，这次什么都没写，这章仍是「待对账」。`,
          '引用必须是正文里一段连续的原文，逐字照抄、50 字以内；不能用省略号拼接两处，不能转述或补字。',
          '把下面这些条目的 evidence_in_text 改对（交回同一个 subagent 修，不要自己手拼 JSON），再 novel_extract(import)：',
          ...report.dropped.map(drop => `- ${drop.kind}「${drop.ref}」：${dropReason(drop)}`),
        ].join('\n')
      }
      const lines = [
        // The first line names the chapter and the canvas (the model reads it;
        // the conversation card goes by the destination line).
        `第 ${args.chapter} 章已对账（画布 ${resolved.workId}）。`,
        `计划命中 ✓×${report.verified} / 计划落空 ×${report.missed}${report.beats.missed === 0 ? '' : ` / 情节没写到 ×${report.beats.missed}`} / 新卡 ×${report.newCards.length}${report.linked === 0 ? '' : ` / 用到已有设定 ×${report.linked}`} / 改了已有卡 ×${report.applied.length}${report.dropped.length === 0 ? '' : ` / 丢弃 ×${report.dropped.length}`}`,
        '全部已写进画布，不用用户审核；用户在「设定 · 最近更新」里能看到这章新建和改过的卡，觉得不对会直接改卡或回复你。',
      ]
      if (report.newCards.length > 0) {
        lines.push('新卡（不对的让用户改或归档；要补内容用 canvas_write(op=card, cardId=编号) 改这张，不要另起）：', ...report.newCards.map(card => `- [${card.ref ?? card.cardId}] ${ROLE_NAMES[card.role]}「${card.text}」`))
      }
      if (report.applied.length > 0) {
        lines.push('改了已有的卡（回复里逐条告诉用户，尤其「补进设定」——正文和原设定说法不一样，用户可能想改正文或改卡）：', ...report.applied.map(item => `- ${item.line}`))
      }
      if (report.planMisses.length > 0) {
        lines.push(`计划里没写到（只提醒，回复里提一句）：${report.planMisses.join('、')}`)
      }
      const memory = report.memory
      if (memory !== undefined && memory.events + memory.advanced.length + memory.happened.length + memory.failed.length + memory.preconditions + memory.beliefs + memory.intents > 0) {
        lines.push(`时间轴与人物记忆：本章事件 +${memory.events}${memory.happened.length === 0 ? '' : `；实现了 ${memory.happened.join('、')}`}${memory.advanced.length === 0 ? '' : `；推进了 ${memory.advanced.join('、')}`}`
          + `${memory.failed.length === 0 ? '' : `；落空 ${memory.failed.join('、')}`}${memory.preconditions === 0 ? '' : `；满足前置 ×${memory.preconditions}`}${memory.beliefs + memory.intents === 0 ? '' : `；人物新认识 ×${memory.beliefs}、新打算 ×${memory.intents}`}。`)
      }
      if (report.dropped.length > 0) {
        lines.push('丢弃（防编造闸）：', ...report.dropped.map(drop => `- ${drop.kind}「${drop.ref}」：${dropReason(drop)}`))
      }
      return withNovelDestination(lines.join('\n'), `canvas:${resolved.workId}:extract:${args.chapter}:${Date.now()}`,
        { canvasId: resolved.workId, face: 'board', scope: RECENT_SCOPE }, `第 ${args.chapter} 章对账 · 最近更新`)
    }),
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
      ? '还没有体裁为「长篇小说」的画布。用户同意后用 canvas_open(create=书名, genre=长篇小说) 新建，新建即绑定；'
        + '没有 canvas_open 这个工具时，请用户在画布里新建一张，⋯ → 创作体裁选「长篇小说」。'
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
      const desk = deskOf(agent)
      // The coordinator binds the room (its sidebar shows the novel); anyone else its own session.
      const binding = agent === undefined ? undefined : actingSession(agent.session, desk)
      const current = binding === undefined ? undefined
        : await store.boundWork(String(binding.id)) ?? (desk?.role === 'member' ? await store.boundWork(String(desk.session.id)) : undefined)
      if (args.work === undefined || args.work.trim() === '') {
        const works = await store.listWorks()
        return [listing(works), current === undefined ? '本会话未绑定。' : `本会话已绑定《${current.title}》。`].join('\n')
      }
      if (agent === undefined) return '失败：这次调用没有会话，无法绑定。'
      const bound = await store.bindWork(args.work, binding ?? agent.session)
      if (!bound.ok) {
        if (bound.error === 'ambiguous') return `「${args.work}」对应多部作品，请问用户是哪一部：${bound.works.map(work => `《${work.title}》`).join('、')}`
        if (bound.error === 'missing') return `没有叫「${args.work}」的长篇小说作品。${listing(bound.works)}`
        return `失败：${bound.error}`
      }
      await granted(agent)
      if (desk !== undefined) {
        announceDeskBind(desk, bound.work)
        const where = desk.role === 'coordinator' ? '房间侧栏已切到这部作品。' : '已放进房间侧栏的画布标签里。'
        return `已绑定《${bound.work.title}》：用 novel_read / novel_write / novel_extract 写作，先加载 novel skill。${where}`
      }
      return `已绑定《${bound.work.title}》：novel_read / novel_write / novel_extract 从下一步起可用，先加载 novel skill。用户可在会话头的画布 chip 里改绑或解绑。`
    },
  })
  return tagOrigin(bind)
}

/** `novel_write`'s arguments; which ones matter depends on `what`. */
interface WriteArgs {
  what: string
  id?: string
  cardId?: string
  title?: string
  content?: string
  chapter?: number
  byUser?: boolean
  replace?: boolean
  delete?: boolean
  plan?: Record<string, unknown>
  action?: ReviewAction
  volume?: string
  sheet?: Record<string, unknown>
  volumes?: unknown[]
  sketches?: unknown[]
  rationale?: string
  phase?: string
  chapters?: number[]
  deletionId?: string
  cards?: string[]
  position?: 'original' | 'next'
  event?: unknown
  moves?: unknown[]
  create?: unknown[]
}

/** The timeline as novel_read(what=events) answers it: every event in a line, or the named ones in full. */
/** 待对齐 for the model: each item, what it touches, and only the passages to check. */
async function renderChanges(store: NovelService, workId: string): Promise<string> {
  const read = await store.alignRead({ workId }, undefined)
  if (!read.ok) return `失败：${read.error ?? 'io'}`
  const items = read.items ?? []
  if (items.length === 0) return `待对齐是空的${(read.auto ?? []).length > 0 ? `（${read.auto!.length} 处改动规则已处理，不用看）` : ''}。`
  const KIND: Record<string, string> = { chapter: '章节', setting: '设定', character: '人物', relation: '关系', foreshadow: '伏笔', event: '事件', idea: '灵感' }
  const lines = [
    `待对齐 ${items.length} 处（自上次对齐 ${read.at?.slice(0, 16).replace('T', ' ') ?? ''} 以来）。逐项处理：按需改设定、事件或人物记忆，或者在回复里问用户；正文要改先问用户。每项做完 novel_write(what=aligned, id=编号)。`,
    '',
  ]
  for (const item of items) {
    const head = item.change === 'text'
      ? `[${item.node}] 第${item.chapters[0]}章正文改了 ${item.paragraphs ?? 0} 段（约 ${Math.round((item.share ?? 0) * 100)}%）：这章记下的事件、人物记忆、伏笔推进要对照新段落更新`
      : item.change === 'removed'
        ? `[${item.node}] ${KIND[item.kind]}「${item.name}」被删了，但第 ${item.chapters.join('、')} 章正文还写着：问用户是情节不要了（改正文）还是只删记录`
        : `[${item.node}] ${KIND[item.kind]}「${item.name}」改了：看第 ${item.chapters.join('、')} 章写到它的段落是否还对得上（novel_read 卡片看新内容：canvas_read）`
    lines.push(head)
    for (const group of item.near) lines.push(`  ${group.label}：${group.names.join('、')}`)
    for (const passage of item.passages) lines.push(`  第${passage.chapter}章：「${passage.text}」`)
  }
  return lines.join('\n')
}

async function renderEvents(store: NovelService, workId: string, ids: readonly string[] | undefined): Promise<string> {
  const { events, current } = await store.allEvents(workId)
  const entries = await store.readEntries(workId)
  const nameOf = (id: string): string => entries?.characters.find(view => view.cardId === id)?.name ?? entries?.rules.find(view => view.cardId === id)?.name ?? id
  const line = (event: StoryEvent): string => {
    const people = [...(event.who ?? []), ...(event.places ?? [])].map(nameOf)
    return `[${event.id}] ${event.when === undefined ? '' : `${event.when} · `}${event.title}${people.length === 0 ? '' : `（${people.join('、')}）`}${event.chapters === undefined ? '' : ` 第${event.chapters.join('、')}章`}`
  }
  if (ids === undefined || ids.length === 0) {
    const past = events.filter(event => event.status === 'happened' || event.status === 'failed').sort((a, b) => a.order - b.order)
    const future = events.filter(isFuture)
    if (past.length + future.length === 0) return '时间轴是空的。和用户聊接下来要发生什么，用 novel_write(what=event) 记下来；对账时本章的事件会自动记上。'
    return [
      `已发生（按故事时间，${past.length} 件）：`, ...past.map(event => `- ${line(event)}${event.status === 'failed' ? '（落空）' : ''}`),
      '', `将发生（${future.length} 件）：`, ...future.map(event => {
        const parts = tensionOf(event, current)
        return `- ${TIER_LABELS[parts.tier]} ${line(event)}${event.source === undefined ? '' : ` · ${event.source}`} —— ${tierReason(event, parts)}`
      }),
    ].join('\n')
  }
  const minds = await store.listMinds({ workId })
  const ideas = await store.readIdeas(workId)
  const out: string[] = []
  for (const id of ids) {
    const event = events.find(candidate => candidate.id === id)
    if (event === undefined) { out.push(`[${id}] 没有这个事件。`); continue }
    const parts = isFuture(event) ? tensionOf(event, current) : undefined
    out.push(`## ${line(event)}`)
    if (event.source !== undefined) out.push(`来源：${event.source}${event.window === undefined ? '' : `；时间窗口：${event.window}`}`)
    if (parts !== undefined) out.push(`张力：${TIER_LABELS[parts.tier]}（${tierReason(event, parts)}）；价值 ${parts.V.toFixed(1)}${event.valueWhy === undefined ? '' : `：${event.valueWhy}`}`)
    if ((event.pre ?? []).length > 0) out.push(`前置：${event.pre!.map((row, index) => `${index + 1}. ${row.text}${row.met === undefined ? '（未满足）' : `（第${row.met}章满足）`}`).join(' ')}`)
    for (const cause of event.causes ?? []) {
      const hit = events.find(candidate => candidate.id === cause)
      if (hit !== undefined) out.push(`起因：${line(hit)}`)
    }
    for (const who of event.who ?? []) {
      const own = minds.filter(row => row.characterId === who)
      const intent = own.filter(row => row.kind === 'intent').at(-1)
      const beliefs = own.filter(row => row.kind === 'belief').slice(-4)
      if (intent !== undefined || beliefs.length > 0) {
        out.push(`${nameOf(who)}：${intent === undefined ? '' : `打算 ${intent.text}；`}${beliefs.length === 0 ? '' : `相信 ${beliefs.map(row => `${row.text}（${row.source ?? '亲历'}）`).join('、')}`}`)
      }
    }
    for (const place of event.places ?? []) {
      const rule = entries?.rules.find(view => view.cardId === place)
      if (rule !== undefined) out.push(`设定 [${rule.ref}] ${rule.text}`)
    }
    for (const idea of ideas.ideas.filter(row => row.eventId === event.id && row.writtenIn === undefined)) out.push(`作者写的片段（尽量保留原文）：「${idea.text}」`)
    out.push('')
  }
  return out.join('\n').trim()
}

/**
 * A call's nested arguments recovered from `content` when they did not
 * arrive (text-forms.ts): an outline written as lines, or a chapter plan
 * written as lines — the latter is a plan, never a manuscript body.
 */
function withTextForms(args: WriteArgs): WriteArgs {
  const content = args.content
  if (content === undefined || content.trim() === '') return args
  if (args.what === 'outline' && args.sheet === undefined && args.volumes === undefined && args.sketches === undefined) {
    const { content: _text, ...rest } = args
    const parsed = outlineFromText(content)
    return {
      ...rest,
      ...(parsed.sheet === undefined ? {} : { sheet: parsed.sheet }),
      ...(parsed.volumes === undefined ? {} : { volumes: parsed.volumes }),
      ...(parsed.sketches === undefined ? {} : { sketches: parsed.sketches }),
      ...(parsed.rationale === undefined || args.rationale !== undefined ? {} : { rationale: parsed.rationale }),
    }
  }
  if (args.what === 'chapter' && args.plan === undefined && isPlanText(content)) {
    const { content: _text, ...rest } = args
    return { ...rest, plan: planFromText(content) }
  }
  return args
}
