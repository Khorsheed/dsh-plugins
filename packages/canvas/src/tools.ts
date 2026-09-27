/**
 * The canvas's main-session tools, registered by the `./agent` composition
 * entry: the card pair (`canvas_propose_card` / `canvas_comment`) and the
 * manuscript pair (`canvas_read_manuscript` / `canvas_write_manuscript`). They
 * act on the canvas the session's right-Sidebar tab has open.
 *
 * Both definitions are origin-tagged the way the community convention
 * documents: the tag is the `Symbol.for('dsh.tool.origin')`-keyed property
 * (host-side only, never on the model wire), set directly — the
 * `@khorsheed/dsh-capability-catalog` helper's own module documents this
 * no-import path, so the package needs no dependency on the catalog.
 *
 * @module @khorsheed/dsh-canvas
 */
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type { CanvasBoardService } from './store.ts'
import { cardTitleOf } from './card-format.ts'
import {
  BOARD_CARD_KINDS,
  type BoardCard, type BoardCardSource, type CardCategoryId,
} from './types.ts'

/** The community tool-origin tag (the catalog's documented no-import path). */
function tagOrigin<T extends object>(definition: T): T {
  ;(definition as Record<PropertyKey, unknown>)[Symbol.for('dsh.tool.origin')] = {
    channel: 'plugin',
    owner: '@khorsheed/dsh-canvas',
  }
  return definition
}

/** One tool outcome as model-facing text (the card id matters most). */
function renderOutcome(outcome: { ok: boolean; error?: string | undefined; cardId?: string | undefined }): string {
  if (!outcome.ok) return `失败：${outcome.error ?? 'io'}`
  return outcome.cardId === undefined ? '完成' : `完成：${outcome.cardId}`
}

/** What the main-session tools answer when there is no canvas to act on. */
const NO_CANVAS_MESSAGE = '没有打开的画布：请先在右栏「画布详情」tab 打开一块画布，再让我改它。'

/**
 * Build the two canvas tools for the MAIN session (M3's second entrance):
 * same names, same descriptions, but the target canvas resolves per call
 * from the session's focused canvas — the one the right-sidebar canvas tab
 * last reported open. No open canvas is a plain answer, never an error.
 * @param board - the board service the tools delegate to.
 * @returns the tagged definitions for the profile-root tools registry.
 */
export function canvasMainSessionToolDefinitions(board: CanvasBoardService): ToolDefinition[] {
  /** Resolve the call's target: the focused canvas plus the fencing session. */
  const target = (exec: { agent?: Agent }): { canvasId: string; session: Session } | { message: string } => {
    const session = exec.agent?.session
    if (session === undefined) return { message: NO_CANVAS_MESSAGE }
    const canvasId = board.focusedCanvasId(session)
    if (canvasId === undefined) return { message: NO_CANVAS_MESSAGE }
    return { canvasId, session }
  }

  const propose = defineTool({
    name: 'canvas_propose_card',
    description:
      '提议一张新卡落到当前打开的画布上：它以 proposed（待确认）状态出现在板上，用户 ✓ 收下才转为正式卡、✗ 归档。'
      + '找来源、提问题、归纳共识、给反例或例子都走这里——绝不在回复正文里贴卡片全文冒充落卡。'
      + 'kind 取值：fragment（灵感）、question（问题）、grounding（共识，只能提议，用户复述确认才算数）、'
      + 'reference（来源，务必带 source 出处）、document（文档）。'
      + '一块画布可能自建了更多分类：只在你能看见它的 id 时才用它，否则用上面五个之一。'
      + 'comment 写一句提议理由，会作为你的评论挂在卡上。'
      + '作用于右栏「画布详情」tab 当前打开的画布；没打开任何画布时会告诉你，不要自己猜一块。',
    parameters: {
      kind: {
        type: 'string',
        // Closed here and only here: this definition is registered once at boot
        // for the main session, before any canvas is open, so there is no board
        // to read a catalog off. The execution still accepts a custom id (the
        // store checks it against the focused board), the enum just cannot
        // advertise one the model has not been shown.
        enum: [...BOARD_CARD_KINDS],
        required: true,
        description: '卡片种类。',
      },
      text: { type: 'string', required: true, description: '卡片正文（保持小而具体）。' },
      source: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['url', 'file', 'paste'], required: true, description: '出处类型。' },
          ref: { type: 'string', required: true, description: '出处引用（url、绝对路径或粘贴说明）。' },
          title: { type: 'string', description: '出处标题（页面标题、文件名）。' },
        },
        additionalProperties: false,
        description: '来源卡的出处；reference 卡必填。',
      },
      comment: { type: 'string', description: '提议理由（作为你的评论挂在卡上）。' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: async (args: { kind: string; text: string; source?: BoardCardSource; comment?: string }, exec: { agent?: Agent }): Promise<string> => {
      const resolved = target(exec)
      if ('message' in resolved) return resolved.message
      const outcome = await board.proposeCard({
        canvasId: resolved.canvasId,
        kind: args.kind as CardCategoryId,
        text: args.text,
        ...(args.source === undefined ? {} : { source: args.source }),
        ...(args.comment === undefined ? {} : { comment: args.comment }),
      }, resolved.session)
      if (!outcome.ok) return renderOutcome({ ok: false, error: outcome.error })
      const card = outcome.board.cards[outcome.board.cards.length - 1]
      return renderOutcome({ ok: true, cardId: card?.id })
    },
  })

  const comment = defineTool({
    name: 'canvas_comment',
    description:
      '给当前打开画布上的一张卡挂一条你的评论：指出一个隐含假设或张力，并以一个尖锐问题收尾。'
      + '评论挂在卡上（板上与详情里都可见）；对问题卡评论会把它从「待探索」推进到「探索中」。'
      + 'cardId 来自板上卡片或 canvas_propose_card 的返回。'
      + '作用于右栏「画布详情」tab 当前打开的画布；没打开任何画布时会告诉你，不要自己猜一块。',
    parameters: {
      cardId: { type: 'string', required: true, description: '目标卡的 id。' },
      text: { type: 'string', required: true, description: '评论正文（指出假设/张力 + 追问收尾）。' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: async (args: { cardId: string; text: string }, exec: { agent?: Agent }): Promise<string> => {
      const resolved = target(exec)
      if ('message' in resolved) return resolved.message
      const outcome = await board.addComment({
        canvasId: resolved.canvasId, cardId: args.cardId, text: args.text, author: 'agent',
      }, resolved.session)
      return renderOutcome({ ok: outcome.ok, ...(outcome.ok ? {} : { error: outcome.error }) })
    },
  })

  const readManuscript = defineTool({
    name: 'canvas_read_manuscript',
    description:
      '读当前打开画布上的成稿。不带 manuscriptId：列出这块画布的全部成稿（id、标题、版本、状态）。'
      + '带 manuscriptId：返回正文全文、当前版本号和它用到 / 没用到的素材卡。'
      + '改写一篇成稿前必须先读，拿到版本号作为 canvas_write_manuscript 的 baseVersion。',
    parameters: {
      manuscriptId: { type: 'string', description: '成稿 id（ms_…）；省略则列出全部。' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: async (args: { manuscriptId?: string }, exec: { agent?: Agent }): Promise<string> => {
      const resolved = target(exec)
      if ('message' in resolved) return resolved.message
      if (args.manuscriptId === undefined) {
        const read = await board.readBoard({ canvasId: resolved.canvasId })
        if (!read.ok) return renderOutcome({ ok: false, error: read.error })
        if (read.board.manuscripts.length === 0) return '这块画布还没有成稿。'
        return read.board.manuscripts
          .map(manuscript => `${manuscript.id}　${manuscript.title}　v${manuscript.version}　${manuscript.status === 'final' ? '定稿' : '写作中'}`)
          .join('\n')
      }
      const outcome = await board.readManuscript({ canvasId: resolved.canvasId, manuscriptId: args.manuscriptId })
      if (!outcome.ok) return renderOutcome({ ok: false, error: outcome.error })
      const read = await board.readBoard({ canvasId: resolved.canvasId })
      const cards = read.ok ? read.board.cards : []
      const { manuscript, body } = outcome
      return [
        `${manuscript.id}　${manuscript.title}　v${manuscript.version}　${manuscript.status === 'final' ? '定稿' : '写作中'}`,
        `用到的素材：${sourceList(manuscript.sources.used, cards)}`,
        `没用到的素材：${sourceList(manuscript.sources.unused, cards)}`,
        '---',
        body,
      ].join('\n')
    },
  })

  const writeManuscript = defineTool({
    name: 'canvas_write_manuscript',
    description:
      '把成稿直接落到当前打开的画布上（「成稿」面，用户可读、可改、可导出），而不是贴在回复正文里。'
      + '新写一篇：省略 manuscriptId，给 body（Markdown，首个标题会作为成稿标题，也可显式给 title）。'
      + '改写一篇：给 manuscriptId 和 baseVersion（先 canvas_read_manuscript 读到的版本号），body 是改后的全文。'
      + '版本不符说明用户或别人刚改过——不要硬写，先重新读再改。'
      + 'sources 标出这一版用到（used）和刻意没用（unused）的素材卡 id；改写时给了就整体替换，省略则沿用。'
      + '作用于右栏「画布详情」tab 当前打开的画布；没打开任何画布时会告诉你，不要自己猜一块。',
    parameters: {
      manuscriptId: { type: 'string', description: '要改写的成稿 id；新写一篇时省略。' },
      title: { type: 'string', description: '成稿标题；省略时取正文的首个标题。' },
      body: { type: 'string', required: true, description: '成稿全文（Markdown）。' },
      baseVersion: { type: 'number', description: '改写所依据的版本号（canvas_read_manuscript 返回）；改写时必填。' },
      sources: {
        type: 'object',
        properties: {
          used: { type: 'array', items: { type: 'string' }, description: '这一版用到的素材卡 id。' },
          unused: { type: 'array', items: { type: 'string' }, description: '看过但刻意没用的素材卡 id。' },
        },
        additionalProperties: false,
        description: '素材取舍。',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: async (
      args: { manuscriptId?: string; title?: string; body: string; baseVersion?: number; sources?: { used?: string[]; unused?: string[] } },
      exec: { agent?: Agent },
    ): Promise<string> => {
      const resolved = target(exec)
      if ('message' in resolved) return resolved.message
      const outcome = await board.writeManuscript({
        canvasId: resolved.canvasId,
        body: args.body,
        ...(args.manuscriptId === undefined ? {} : { manuscriptId: args.manuscriptId }),
        ...(args.title === undefined ? {} : { title: args.title }),
        ...(args.baseVersion === undefined ? {} : { baseVersion: args.baseVersion }),
        ...(args.sources === undefined ? {} : { sources: args.sources }),
      }, resolved.session, 'agent')
      if (outcome.ok) return `完成：${outcome.manuscript.id} v${outcome.manuscript.version}`
      if (outcome.error === 'stale' && outcome.currentVersion !== undefined) {
        return `冲突：这篇成稿当前是 v${outcome.currentVersion}，已被改过。先用 canvas_read_manuscript 读最新版，再在它上面改。`
      }
      return renderOutcome({ ok: false, error: outcome.error })
    },
  })

  return [tagOrigin(propose), tagOrigin(comment), tagOrigin(readManuscript), tagOrigin(writeManuscript)]
}

/** A manuscript's source ids as `id（标题）` handles, so the model sees what each one was. */
function sourceList(ids: readonly string[], cards: readonly BoardCard[]): string {
  if (ids.length === 0) return '（无）'
  return ids.map((id) => {
    const card = cards.find(candidate => candidate.id === id)
    const title = card === undefined ? '' : cardTitleOf(card.text)
    return title.length === 0 ? id : `${id}（${title}）`
  }).join('、')
}
