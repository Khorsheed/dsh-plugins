/**
 * The canvas agent's two tools, built per `openWith` and handed to side-chat
 * for attachment on the canvas context's agent (never globally registered —
 * an ordinary session never sees a canvas tool placeholder).
 *
 * Both definitions are origin-tagged the way the community convention
 * documents: the tag is the `Symbol.for('dsh.tool.origin')`-keyed property
 * (host-side only, never on the model wire), set directly — the
 * `@khorsheed/dsh-capability-catalog` helper's own module documents this
 * no-import path, and this package keeps exactly one cross-plugin edge
 * (canvas → sidechat, a probed service name declared in `dsh.references`).
 *
 * @module @khorsheed/dsh-canvas
 */
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type { CanvasBoardService } from './store.ts'
import { categoryMenuOf, menuCategoriesOf } from './prompt.ts'
import {
  BOARD_CARD_KINDS,
  type BoardCardSource, type BoardCategory, type CardCategoryId,
} from './types.ts'

/** The community tool-origin tag (the catalog's documented no-import path). */
function tagOrigin<T extends object>(definition: T): T {
  ;(definition as Record<PropertyKey, unknown>)[Symbol.for('dsh.tool.origin')] = {
    channel: 'plugin',
    owner: '@khorsheed/dsh-canvas',
  }
  return definition
}

/** The session one tool execution fences with: the calling agent's own, else the ask's. */
function fenceSession(exec: { agent?: Agent }, fallback: Session): Session {
  return exec.agent?.session ?? fallback
}

/** One tool outcome as model-facing text (the card id matters most). */
function renderOutcome(outcome: { ok: boolean; error?: string | undefined; cardId?: string | undefined }): string {
  if (!outcome.ok) return `失败：${outcome.error ?? 'io'}`
  return outcome.cardId === undefined ? '完成' : `完成：${outcome.cardId}`
}

/** The `kind` enum's ids: the board's enabled catalog, on the same floor the
 *  description's menu is spelled from (`menuCategoriesOf`), so a canvas whose
 *  user retired every category still gets a wire-legal enum — and it is the
 *  store's per-board check that refuses the writes it would make. */
function kindEnum(categories: readonly BoardCategory[]): string[] {
  return menuCategoriesOf(categories).map(category => category.id)
}

/**
 * Build the two canvas tools for one `openWith` call.
 * @param board - the board service the tools delegate to (same fence path as every write).
 * @param canvasId - the canvas these tools act on (the context they are attached to).
 * @param fallbackSession - the session whose ask primed the context (the
 *   execution prefers `exec.agent.session` — the canvas agent's own fence).
 * @param categories - THIS canvas's catalog: stage ⑤ made the category set
 *   per-canvas, so the enum is read off the board the ask came from.
 * @returns the tagged definitions, ready for side-chat's `tools` input.
 */
export function canvasToolDefinitions(
  board: CanvasBoardService,
  canvasId: string,
  fallbackSession: Session,
  categories: readonly BoardCategory[],
): ToolDefinition[] {
  const propose = defineTool({
    name: 'canvas_propose_card',
    description:
      '提议一张新卡落到这块画布上：它以 proposed（待确认）状态出现在板上，用户 ✓ 收下才转为正式卡、✗ 归档。'
      + '找来源、提问题、归纳共识、给反例或例子都走这里——绝不在回复正文里贴卡片全文冒充落卡。'
      + `kind 取值（这块画布的分类）：${categoryMenuOf(categories)}。`
      + 'grounding 只能提议，用户复述确认才算数；reference 务必带 source 出处。'
      + 'comment 写一句提议理由，会作为你的评论挂在卡上。',
    parameters: {
      kind: {
        type: 'string',
        enum: kindEnum(categories),
        required: true,
        description: '卡片种类（这块画布分类目录里的一个 id）。',
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
      const outcome = await board.proposeCard({
        canvasId,
        kind: args.kind as CardCategoryId,
        text: args.text,
        ...(args.source === undefined ? {} : { source: args.source }),
        ...(args.comment === undefined ? {} : { comment: args.comment }),
      }, fenceSession(exec, fallbackSession))
      if (!outcome.ok) return renderOutcome({ ok: false, error: outcome.error })
      const card = outcome.board.cards[outcome.board.cards.length - 1]
      return renderOutcome({ ok: true, cardId: card?.id })
    },
  })

  const comment = defineTool({
    name: 'canvas_comment',
    description:
      '给板上的一张卡挂一条你的评论：指出一个隐含假设或张力，并以一个尖锐问题收尾。'
      + '评论挂在卡上（板上与详情里都可见）；对问题卡评论会把它从「待探索」推进到「探索中」。'
      + 'cardId 来自板上卡片或 canvas_propose_card 的返回。',
    parameters: {
      cardId: { type: 'string', required: true, description: '目标卡的 id。' },
      text: { type: 'string', required: true, description: '评论正文（指出假设/张力 + 追问收尾）。' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: async (args: { cardId: string; text: string }, exec: { agent?: Agent }): Promise<string> => {
      const outcome = await board.addComment({
        canvasId, cardId: args.cardId, text: args.text, author: 'agent',
      }, fenceSession(exec, fallbackSession))
      return renderOutcome({ ok: outcome.ok, ...(outcome.ok ? {} : { error: outcome.error }) })
    },
  })

  return [tagOrigin(propose), tagOrigin(comment)]
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

  return [tagOrigin(propose), tagOrigin(comment)]
}
