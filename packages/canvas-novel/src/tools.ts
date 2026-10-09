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
import { planOvershoots, renderOutlineRead, renderPlanBrief, renderWriteBrief, targetWordsOf } from './brief.ts'
import { PHASE_NAMES, ROLE_NAMES, foreshadowFacts, relationFacts } from './genre-agent.ts'
import type { NovelService } from './store.ts'
import { volumeNumeral, volumePosition, type ChapterPlan, type ExtractPayload, type ImportDrop, type PendingItem, type ReviewAction } from './types.ts'

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
    case 'id-not-in-ledger': return drop.kind === 'relation' ? '关系不在关系榜' : '伏笔 id 不在活跃榜单'
    case 'card-refused': return '画布拒绝了这张卡'
    case 'duplicate': return '画布上已有这张卡'
    case 'stage-mismatch': return '这对关系现在的阶段走不了这一步（没到可升、不在裂痕里、或没经过裂痕就转对手）'
    default: return '角色不在花名册'
  }
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
      + 'outline reads the one-page outline, volumes and core suspenses; '
      + 'chapters/ledger/pending/chapter read the work (cards: canvas_read). Load the novel skill for the workflow.',
    parameters: {
      what: {
        type: 'string',
        enum: ['brief', 'outline', 'chapters', 'ledger', 'pending', 'chapter'],
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
      return '失败：what 只能是 brief/outline/chapters/ledger/pending/chapter；卡片用 canvas_read。'
    },
  })

  const write = defineTool({
    name: 'novel_write',
    description:
      'Write the bound novel canvas. chapter creates (auto n=max+1) or re-plans; content writes the manuscript '
      + 'first and refuses the registration when the fence refuses the write. outline proposes outline changes '
      + '(the user adopts them on the 规划 page). review decides a pending item '
      + '(action=accept|discard). Cards: canvas_write. Load the novel skill first.',
    parameters: {
      what: { type: 'string', enum: ['chapter', 'confirm', 'outline', 'review'], required: true, description: 'What to write. confirm: record the user\'s confirmation of a chapter plan (chapter=N) — only when their latest message says so.' },
      id: { type: 'string', description: 'review: the pending item id.' },
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
          + 'foreshadowOps[{op: 推进|暗示|新埋|揭晓, id (the foreshadow\'s ref, e.g. #12 — never its question) | question (新埋 only), note (what it advances or plants)}], cast[{who (ref or name), role}], infoGaps[{who (ref or name), fact (what they learn this chapter — ideally a line of their 不知道)}], pov, hook}.',
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
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: async (arrived: WriteArgs, exec: { agent?: Agent }): Promise<string> => {
      const resolved = await target(exec)
      if ('message' in resolved) return resolved.message
      const { workId } = resolved
      const args = withTextForms(arrived)
      if (args.what === 'chapter') {
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
              : `失败：第 ${args.chapter} 章的计划还没经用户确认（或刚改过计划），不写正文。用户在对话里已经明确同意这版计划的话，先 novel_write(what=confirm, chapter=${args.chapter}) 登记确认再写；没有就请用户确认（对话里说一声，或点章节页的「确认计划」）。`
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
        if (plan === undefined) return `${attached}已建第 ${chapter.n} 章《${chapter.title}》（画布 ${workId} · 规划中 · ${chapter.file}）。`
        const [outline, entries, chapters] = await Promise.all([
          store.readOutline(workId), store.readEntries(workId), store.listChapters({ workId }),
        ])
        const words = targetWordsOf(chapter, outline)
        const position = volumePosition(outline.volumes, chapters.map(row => row.chapter), chapter)
        const overshoots = planOvershoots(plan, words, entries?.foreshadows ?? [], position?.index, outline.volumes.length)
        return `${attached}已登记第 ${chapter.n} 章《${chapter.title}》（画布 ${workId}${position === undefined ? '' : ` · 卷${volumeNumeral(position.index)}`}）plan：`
          + `${words === undefined ? '' : `目标 ${words} 字 / `}走向 ${plan.beats.length} 拍 / 伏笔 ${plan.foreshadowOps.length} 条 / 出场 ${plan.cast.length} 人。`
          + (overshoots.length === 0 ? '' : `\n提醒（只提醒，不拦）：${overshoots.join('；')}。在回复里跟用户说一句，按他的意思改或保留。`)
          + '\n完整计划已在右栏打开的章节页上。回复只用两三句说这章怎么走、最想让用户拍板的是什么，不要再贴一遍计划表。'
          + `用户在对话里同意后，先 novel_write(what=confirm, chapter=${chapter.n}) 再开写；他也可能直接在章节页点了确认。`
      }
      if (args.what === 'confirm') {
        if (args.chapter === undefined) return '失败：what=confirm 要给 chapter（章号）。'
        const outcome = await store.confirmChapterPlan({ workId, n: args.chapter }, resolved.session)
        if (!outcome.ok) {
          if (outcome.error === 'missing') return `失败：没有第 ${args.chapter} 章。`
          if (outcome.error === 'invalid-name') return `失败：第 ${args.chapter} 章还没有计划，先 novel_write(what=chapter, plan=…) 登记。`
          return `失败：${outcome.error ?? 'io'}`
        }
        return `已确认第 ${args.chapter} 章的计划（按用户在对话里的同意），可以写正文了：先 novel_read(brief, for=write, chapter=${args.chapter})。`
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
        return `已提交大纲提议（画布 ${workId}），在「规划」页等用户采用；采用前不生效，再提会合并进这一版。`
          + '回复里用两三句说改了什么、为什么，不要贴整份大纲。'
      }
      if (args.what === 'review') {
        if (args.id === undefined || args.action === undefined) return '失败：what=review 要给 id（待审项）和 action（accept|discard）。'
        const outcome = await store.decidePending({ workId, id: args.id, action: args.action }, resolved.session)
        if (!outcome.ok) return outcome.error === 'missing' ? `失败：没有待审项 ${args.id}。` : `失败：${outcome.error ?? 'io'}`
        return args.action === 'accept' ? `已采纳并落库：${args.id}。` : `已丢弃：${args.id}。`
      }
      return '失败：what 只能是 chapter/outline/review；卡片用 canvas_write。'
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
      if (!report.settled) {
        return [
          `未对完，修正引用后重新导入：${report.dropped.length} 条引用对不上第 ${args.chapter} 章正文，这次什么都没写，这章仍是「待对账」。`,
          '引用必须是正文里一段连续的原文，逐字照抄、50 字以内；不能用省略号拼接两处，不能转述或补字。',
          '把下面这些条目的 evidence_in_text 改对（交回同一个 subagent 修，不要自己手拼 JSON），再 novel_extract(import)：',
          ...report.dropped.map(drop => `- ${drop.kind}「${drop.ref}」：${dropReason(drop)}`),
        ].join('\n')
      }
      const lines = [
        // The first line names the chapter and the canvas: the conversation's
        // 已对账 card reads them off the answer (client/write-row.ts).
        `第 ${args.chapter} 章已对账（画布 ${resolved.workId}）。`,
        `计划命中 ✓×${report.verified} / 计划落空 ×${report.missed}${report.beats.missed === 0 ? '' : ` / 走向没写到 ×${report.beats.missed}（只提醒，不进待审）`} / 新卡 ×${report.newCards.length}${report.linked === 0 ? '' : ` / 关联已有设定 ×${report.linked}`} / 待你确认 ×${report.pending}${report.dropped.length === 0 ? '' : ` / 丢弃 ×${report.dropped.length}`}`,
      ]
      if (report.newCards.length > 0) {
        lines.push('画布上的新卡（已进 brief，画布上带 ✦ 新卡标记；不对的让用户改或归档，要补内容用 canvas_write(op=card, cardId=编号) 改这张，不要另起）：', ...report.newCards.map(card => `- [${card.ref ?? card.cardId}] ${ROLE_NAMES[card.role]}「${card.text}」`))
      }
      if (report.pendingItems.length > 0) {
        lines.push('待确认清单：', ...report.pendingItems.map(item => `- [${item.id}] ${item.reason}`))
      }
      if (report.dropped.length > 0) {
        lines.push('丢弃（防编造闸）：', ...report.dropped.map(drop => `- ${drop.kind}「${drop.ref}」：${dropReason(drop)}`))
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
  replace?: boolean
  plan?: Record<string, unknown>
  action?: ReviewAction
  volume?: string
  sheet?: Record<string, unknown>
  volumes?: unknown[]
  sketches?: unknown[]
  rationale?: string
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
