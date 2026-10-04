/**
 * The canvas-novel's main-session tools, registered by the `./agent`
 * composition entry: one read (`story_read`), one write (`story_write`) and
 * the two-phase reconciliation (`story_extract`). They act on the novel
 * canvas the session is BOUND to (the canvas binding chip); unbound, every
 * tool answers with guidance, never an error. Descriptions stay terse — the
 * workflow is the `story` skill's, loaded on demand (the 2026-09-30 canvas
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
import type { StoryBibleService } from './store.ts'
import {
  canonRefOf, foreshadowRefOf, type ChapterPlan, type ExtractPayload, type MemoryRecord, type PendingItem,
} from './types.ts'

/** The community tool-origin tag (the catalog's documented no-import path). */
function tagOrigin<T extends object>(definition: T): T {
  ;(definition as Record<PropertyKey, unknown>)[Symbol.for('dsh.tool.origin')] = {
    channel: 'plugin',
    owner: '@khorsheed/dsh-canvas-novel',
  }
  return definition
}

/** What the tools answer when the session is bound to no novel canvas (guidance, never a throw). */
const NO_WORK_MESSAGE = '本会话还没有绑定「长篇小说」画布：请用户在会话头的画布 chip 里选一张体裁为「长篇小说」的画布，再进行读写。'

/** The extract gate's refusal, phase-aware (对账只发生在写作后、审过收章前). */
function extractGateMessage(phase: string | undefined): string {
  if (phase === 'planning') return '这章还没有正文——没有什么可对账的。先写完，再对账。'
  if (phase === 'extracted') return '这章已对过账（已抽取）。要重新对账，先告诉我为什么。'
  if (phase === 'reviewed') return '这章已审过收章，不再对账。'
  if (phase === 'fileMissing') return '这章的正文文件丢了（登记在、文件不在）。先重新定位文件，再谈对账。'
  return '对账只对「写作中」的章开放。'
}

/** One memory as the model reads it (one line). */
function memoryLine(memory: MemoryRecord): string {
  const ref = memory.type === 'prospective' ? foreshadowRefOf(memory.id) : canonRefOf(memory.id)
  const layer = memory.layer === 'intent' ? `灵感·${memory.intentStatus ?? 'draft'}` : 'canon'
  const flags = [
    memory.reviewed ? '' : '未审',
    memory.autoImported === true ? '自动·可撤销' : '',
    memory.status === 'archived' ? '已归档' : '',
  ].filter(flag => flag !== '').join('·')
  return `- [${ref}] ${layer}/${memory.type}/${memory.confidence}${flags === '' ? '' : `（${flags}）`} ${memory.content}`
}

/** One pending item as the model reads it (one line, evidence attached). */
function pendingLine(item: PendingItem): string {
  return `- [${item.id}] ${item.kind}（${item.confidence}）${item.reason}${item.evidenceInText === undefined ? '' : `\n  原文：「${item.evidenceInText}」`}`
}

/** The chapter phase's display name. */
const PHASE_NAMES: Readonly<Record<string, string>> = {
  planning: '规划中', writing: '写作中', extracted: '已抽取', reviewed: '已审过', fileMissing: '文件丢失',
}

/**
 * Build the story tools for the MAIN session: the target work resolves per
 * call from the session's bound canvas, the fencing session rides the agent.
 * No binding is a plain guidance answer, never an error.
 * @param store - the story service the tools delegate to.
 * @returns the tagged definitions for the profile-root tools registry.
 */
export function storyMainSessionToolDefinitions(store: StoryBibleService): ToolDefinition[] {
  /** Resolve the call's target: the bound work plus the fencing session. */
  const target = async (exec: { agent?: Agent }): Promise<{ workId: string; session: Session } | { message: string }> => {
    const session = exec.agent?.session
    if (session === undefined) return { message: NO_WORK_MESSAGE }
    const work = await store.boundWork(String(session.id))
    if (work === undefined) return { message: NO_WORK_MESSAGE }
    return { workId: work.id, session }
  }

  const read = defineTool({
    name: 'story_read',
    description:
      'Read the bound novel canvas. what=brief renders a material pack (for=write/plan/extract); memories/character/'
      + 'chapters/ledger/pending/chapter read the store. Load the story skill for the workflow.',
    parameters: {
      what: {
        type: 'string',
        enum: ['brief', 'memories', 'character', 'chapters', 'ledger', 'pending', 'chapter'],
        required: true,
        description: 'What to read.',
      },
      for: { type: 'string', enum: ['write', 'plan', 'extract'], description: 'brief: the variant (default write).' },
      chapter: { type: 'number', description: 'brief/chapter: the chapter number (default: the one being planned).' },
      id: { type: 'string', description: 'character: character id or exact name.' },
      layer: { type: 'string', enum: ['canon', 'intent'], description: 'memories: filter by layer.' },
      type: { type: 'string', description: 'memories: filter by type (prospective = 伏笔).' },
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
      id?: string
      layer?: 'canon' | 'intent'
      type?: string
    }, exec: { agent?: Agent }): Promise<string> => {
      const resolved = await target(exec)
      if ('message' in resolved) return resolved.message
      const { workId } = resolved
      if (args.what === 'brief') {
        const gathered = await store.gatherBrief({ workId, ...(args.chapter === undefined ? {} : { chapter: args.chapter }) })
        if (!gathered.ok || gathered.data === undefined) {
          return gathered.error === 'missing'
            ? '还没有可定位的章节：先 story_write(what=chapter, title=…[, plan=…]) 建章，再取 brief。'
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
      if (args.what === 'memories') {
        const memories = await store.listMemories({
          workId,
          ...(args.layer === undefined ? {} : { layer: args.layer }),
          ...(args.type === undefined ? {} : { type: args.type as MemoryRecord['type'] }),
        })
        if (memories.length === 0) return '还没有记忆：聊设定时 story_write(what=memory) 落幽灵卡，对账后记忆自动入库。'
        return [`记忆（${memories.length} 条，灵感未采纳不进 brief）：`, ...memories.map(memoryLine)].join('\n')
      }
      if (args.what === 'character') {
        if (args.id === undefined) {
          const roster = await store.listCharacters({ workId })
          return roster.length === 0
            ? '还没有角色卡。'
            : `角色花名册：${roster.map(character => `${character.id} ${character.name}（${character.identity}）`).join('；')}。用 id 或名字取单卡。`
        }
        const character = await store.readCharacter({ workId, idOrName: args.id })
        if (character === undefined) return `失败：没有角色「${args.id}」。`
        const experiences = await store.listExperiences({ workId, characterId: character.id })
        const join = (items: readonly string[]): string => items.length === 0 ? '—' : items.join('、')
        return [
          `${character.id} ${character.name}（${character.identity}）`,
          `档案：外貌 ${character.profile.appearance ?? '—'}；口癖 ${character.profile.voice ?? '—'}`,
          `内核：想要 ${character.core.want ?? '—'}；缺失 ${character.core.lack ?? '—'}；伤口 ${character.core.wound ?? '—'}`,
          `知道的事：${join(character.knowledge.knows)}`,
          `不知道的事：${join(character.knowledge.unaware)}`,
          `秘密：${join(character.knowledge.secrets)}`,
          `当前态：${character.currentState.where ?? '—'} / ${character.currentState.state ?? '—'} / 牵挂 ${character.currentState.concern ?? '—'}`,
          ...(character.relationships.length === 0 ? [] : [
            '关系：',
            ...character.relationships.map(rel =>
              `- ${rel.target}：${rel.description}${rel.changes.length === 0 ? '' : `（${rel.changes.map(change => `▲第${change.chapter}章 ${change.note}`).join('；')}）`}`),
          ]),
          ...(experiences.length === 0 ? [] : ['经历：', ...experiences.slice(-8).map(entry => `- 第${entry.chapter}章 ${entry.entry}`)]),
        ].join('\n')
      }
      if (args.what === 'chapters') {
        const chapters = await store.listChapters({ workId })
        if (chapters.length === 0) return '还没有章节：story_write(what=chapter, title=…[, plan=…]) 建第 1 章。'
        return [
          `章节（${chapters.length} 章，按 seq 排序）：`,
          ...chapters.map(({ chapter, phase }) =>
            `- 第${chapter.n}章 ${chapter.title}（${PHASE_NAMES[phase] ?? phase}）${chapter.recap ?? ''}`),
        ].join('\n')
      }
      if (args.what === 'ledger') {
        const ledger = await store.ledger({ workId })
        if (!ledger.ok) return `失败：${ledger.error ?? 'io'}`
        const lines = [
          `伏笔健康度：活跃 ${ledger.counts.active} / 超期⚠ ${ledger.counts.overdue} / 已揭 ${ledger.counts.resolved} / 弃置 ${ledger.counts.abandoned}（当前第 ${ledger.currentChapter} 章）`,
          '沉睡榜（最久未动在前）：',
          ...(ledger.active.length === 0 ? ['（台账为空。）'] : ledger.active.map((memory) => {
            const specifics = memory.specifics
            const planted = specifics?.plantedAt ?? memory.firstChapter
            const last = memory.lastActiveChapter ?? planted
            const slept = ledger.currentChapter - (last ?? ledger.currentChapter)
            return `- [${foreshadowRefOf(memory.id)}] ${specifics?.question ?? memory.content}（埋于第${planted ?? '?'}章 · 最后活跃第${last ?? '?'}章 · 已 ${slept} 章未动${slept >= 3 ? ' ⚠' : ''} · 势${specifics?.tension ?? '?'}）`
          })),
        ]
        return lines.join('\n')
      }
      if (args.what === 'pending') {
        const items = await store.listPending({ workId })
        if (items.length === 0) return '待审队列为空。'
        return [`待审队列（${items.length} 条，✓采纳/✗丢弃走 story_write(what=review, target=pending, id, action)）：`, ...items.map(pendingLine)].join('\n')
      }
      if (args.what === 'chapter') {
        if (args.chapter === undefined) return '失败：what=chapter 要给 chapter（章号）。'
        const outcome = await store.readChapter({ workId, n: args.chapter })
        if (!outcome.ok) return `失败：没有第 ${args.chapter} 章。story_read(what=chapters) 看章节索引。`
        return outcome.body === ''
          ? `第 ${args.chapter} 章《${outcome.chapter!.title}》（${PHASE_NAMES[outcome.phase!] ?? outcome.phase}）：正文为空。`
          : `第 ${args.chapter} 章《${outcome.chapter!.title}》（${PHASE_NAMES[outcome.phase!] ?? outcome.phase}）：\n\n${outcome.body}`
      }
      return '失败：what 只能是 brief/memories/character/chapters/ledger/pending/chapter。'
    },
  })

  const write = defineTool({
    name: 'story_write',
    description:
      'Write the bound novel canvas. memory drops a ghost '
      + 'card (layer=intent draft by default); character upserts a card; chapter creates (auto n=max+1) or re-plans; '
      + 'review decides (target=memory|pending, action=accept|discard|archive|retract). chapter content writes the '
      + 'manuscript first and refuses the registration when the fence refuses the write. Load the story skill first.',
    parameters: {
      what: { type: 'string', enum: ['memory', 'character', 'chapter', 'review'], required: true, description: 'What to write.' },
      title: { type: 'string', description: 'chapter: the title.' },
      content: { type: 'string', description: "memory: the content (one restatable sentence). chapter: the manuscript body — written to the mounted workspace before registering." },
      type: { type: 'string', description: 'memory: episodic|semantic|source|prospective|emotional|procedural|implicit.' },
      layer: { type: 'string', enum: ['canon', 'intent'], description: 'memory: layer (default intent draft — the ghost card).' },
      kind: { type: 'string', enum: ['世界', '人物', '章节', '伏笔点子', '原则'], description: 'memory: the filing route.' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'memory: confidence (unsure = medium/low).' },
      specifics: { type: 'object', additionalProperties: true, description: 'memory: prospective ledger fields {question, status, tension, plantedAt, answer}.' },
      owner: { type: 'string', description: 'memory: creator or a character id.' },
      evidence: { type: 'string', description: 'memory: ≤50 chars quoted from the chapter.' },
      id: { type: 'string', description: 'character: id to patch. review: memory id or pending id.' },
      name: { type: 'string', description: 'character: the name.' },
      identity: { type: 'string', description: 'character: 一句身份.' },
      profile: { type: 'object', additionalProperties: true, description: 'character: {appearance, voice}.' },
      core: { type: 'object', additionalProperties: true, description: 'character: {want, lack, wound}.' },
      knowledge: { type: 'object', additionalProperties: true, description: 'character: {knows[], unaware[], secrets[]}.' },
      currentState: { type: 'object', additionalProperties: true, description: 'character: {where, state, concern}.' },
      chapter: { type: 'number', description: 'chapter: n to re-plan (omit to create).' },
      plan: { type: 'object', additionalProperties: true, description: 'chapter: {pov, goal, foreshadowOps[], characters[], hook}.' },
      target: { type: 'string', enum: ['memory', 'pending'], description: 'review: which queue.' },
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
      if (args.what === 'memory') {
        if ((args.content ?? '').trim() === '') return '失败：what=memory 要给 content（一句话能复述、且影响后续创作的才落卡）。'
        const outcome = await store.writeMemory({
          workId,
          content: args.content!,
          ...(args.type === undefined ? {} : { type: args.type as MemoryRecord['type'] }),
          ...(args.layer === undefined ? {} : { layer: args.layer }),
          ...(args.kind === undefined ? {} : { kind: args.kind }),
          ...(args.confidence === undefined ? {} : { confidence: args.confidence }),
          ...(args.owner === undefined ? {} : { owner: args.owner }),
          ...(args.evidence === undefined ? {} : { evidenceInText: args.evidence }),
          ...(args.specifics === undefined ? {} : { specifics: args.specifics as MemoryRecord['specifics'] }),
        }, resolved.session, 'agent')
        if (!outcome.ok) return `失败：${outcome.error ?? 'io'}`
        const memory = outcome.memory!
        return memory.layer === 'intent'
          ? `已落卡 ${memory.id}（${memory.kind ?? '未分类'}·提议中）。`
          : `已登记 ${memory.id}（canon/${memory.type}，待用户审）：「${memory.content.slice(0, 40)}」。`
      }
      if (args.what === 'character') {
        if ((args.name ?? '').trim() === '') return '失败：what=character 要给 name。'
        const outcome = await store.writeCharacter({
          workId,
          name: args.name!,
          ...(args.id === undefined ? {} : { id: args.id }),
          ...(args.identity === undefined ? {} : { identity: args.identity }),
          ...(args.profile === undefined ? {} : { profile: args.profile as never }),
          ...(args.core === undefined ? {} : { core: args.core as never }),
          ...(args.knowledge === undefined ? {} : { knowledge: args.knowledge as never }),
          ...(args.currentState === undefined ? {} : { currentState: args.currentState as never }),
        }, resolved.session)
        if (!outcome.ok) return `失败：${outcome.error ?? 'io'}`
        return `${args.id === undefined ? '已建角色卡' : '已更新角色卡'} ${outcome.character!.id} ${outcome.character!.name}（${outcome.character!.identity || '一句身份未填'}）。`
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
            return `失败：没有第 ${args.chapter} 章。story_read(what=chapters) 看索引；新建不要传 chapter。`
          }
          if (outcome.error === 'denied') {
            return '失败：正文写不进画布挂载的工作区（会话沙箱围栏拒绝）。请用户给画布挂一个本会话可写的工作区，或把正文贴给我用 story_write(what=chapter, content=…) 重写。'
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
          return '失败：what=review 要给 target（memory|pending）、id 和 action（accept|discard|archive|retract）。'
        }
        if (args.target === 'memory') {
          const outcome = await store.decideMemory({ workId, id: args.id, action: args.action }, resolved.session)
          if (!outcome.ok) return outcome.error === 'missing' ? `失败：没有记忆 ${args.id}。` : `失败：该记忆当前状态不接受 ${args.action}（${outcome.error ?? 'io'}）。`
          const names: Readonly<Record<string, string>> = { accept: '已采纳（进 brief）', discard: '已丢弃', archive: '已归档', retract: '已撤销自动入库' }
          return `${names[args.action] ?? '完成'}：${args.id}。`
        }
        const outcome = await store.decidePending({ workId, id: args.id, action: args.action === 'accept' ? 'accept' : 'discard' }, resolved.session)
        if (!outcome.ok) return outcome.error === 'missing' ? `失败：没有待审项 ${args.id}。` : `失败：${outcome.error ?? 'io'}`
        return args.action === 'accept' ? `已采纳并落库：${args.id}。` : `已丢弃：${args.id}。`
      }
      return '失败：what 只能是 memory/character/chapter/review。'
    },
  })

  const extract = defineTool({
    name: 'story_extract',
    description:
      'Reconcile a REVIEWED chapter. phase=prepare returns the material pack (delegate it to a fresh subagent, take '
      + 'back strict JSON); phase=import runs the five store gates on payload and files the results. Load the story skill first.',
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
        `计划命中 ✓×${report.verified} / 计划落空 ×${report.missed} / 自动入库 ×${report.autoImported} / 待你确认 ×${report.pending}${report.dropped.length === 0 ? '' : ` / 丢弃 ×${report.dropped.length}`}`,
      ]
      if (report.pendingItems.length > 0) {
        lines.push('待确认清单：', ...report.pendingItems.map(item => `- [${item.id}] ${item.reason}`))
      }
      if (report.dropped.length > 0) {
        lines.push('丢弃（防编造闸）：', ...report.dropped.map(drop => {
          const why = drop.reason === 'evidence-not-found' ? '原文引用在正文里 grep 不到'
            : drop.reason === 'id-not-in-ledger' ? '伏笔 id 不在活跃榜单' : '角色不在花名册'
          return `- ${drop.kind}「${drop.ref}」：${why}`
        }))
      }
      return lines.join('\n')
    },
  })

  return [tagOrigin(read), tagOrigin(write), tagOrigin(extract)]
}

/** `story_write`'s arguments; which ones matter depends on `what`. */
interface WriteArgs {
  what: string
  title?: string
  content?: string
  type?: string
  layer?: 'canon' | 'intent'
  kind?: MemoryRecord['kind']
  confidence?: MemoryRecord['confidence']
  specifics?: Record<string, unknown>
  owner?: string
  evidence?: string
  id?: string
  name?: string
  identity?: string
  profile?: Record<string, unknown>
  core?: Record<string, unknown>
  knowledge?: Record<string, unknown>
  currentState?: Record<string, unknown>
  chapter?: number
  plan?: Record<string, unknown>
  target?: 'memory' | 'pending'
  action?: 'accept' | 'discard' | 'archive' | 'retract'
}
