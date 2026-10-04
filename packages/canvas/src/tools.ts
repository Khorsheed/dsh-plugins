/**
 * The canvas's main-session tools, registered by the `./agent` composition
 * entry: one read (`canvas_read`), one write (`canvas_write`: card, comment,
 * manuscript) and the type proposal (`canvas_propose_type`). They act on the
 * canvas the session's right-Sidebar tab has open. Three used to be seven
 * (2026-09-30): the long catalog crowded the writing preset's model, so the
 * details moved to the on-demand `canvas` skill (skill.ts).
 *
 * The definitions are origin-tagged the way the community convention
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
import { cardBlocksOf } from './blocks.ts'
import { cardTitleOf } from './card-format.ts'
import {
  checkFieldValues, fieldSignature, fieldValueText, renderDefinition, typedTitleOf,
  type FieldValue, type RefResolver, type TypeDefinition,
} from './card-types.ts'
import { imageRefOf } from './image-token.ts'
import {
  isBoardCardKind,
  type BoardCard, type BoardCardSource, type BoardCategory, type CanvasBoard, type CanvasImageRef, type CardCategoryId,
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

/**
 * The built-in categories' names as the model reads them. A built-in's stored
 * label is '' (the client localizes it), so the host names it here, in the
 * language the tool answers speak (the descriptions are English, like every
 * other plugin's; the answers stay Chinese, and the propose-type row parses them).
 */
const BUILTIN_KIND_NAMES: Readonly<Record<string, string>> = {
  fragment: '灵感', question: '问题', grounding: '共识', reference: '来源', document: '文档',
}

/** Most card lines one `canvas_read` answer lists. */
const MAX_BOARD_READ_CARDS = 200

/** A category's display name: its own label, else the built-in's name, else its id. */
function categoryNameOf(category: BoardCategory): string {
  if (category.label.trim() !== '') return category.label.trim()
  return BUILTIN_KIND_NAMES[category.id] ?? category.id
}

/** The enabled categories as `id（名称）`, the valid `kind` values for a new card. */
function enabledKinds(board: CanvasBoard): string {
  return board.categories
    .filter(category => category.enabled)
    .map(category => `${category.id}（${categoryNameOf(category)}）`)
    .join('、')
}

/** A card's name as the model reads it: its typed title field, else its body's first line. */
function cardNameOf(card: BoardCard, definition: TypeDefinition | undefined): string {
  return typedTitleOf(definition, card.fields) || cardTitleOf(card.text)
}

/**
 * The reference resolver `canvas_write` (op=card) checks `ref` fields with: a
 * card id on the board, else a card whose name matches exactly — within the
 * field's `refKind` when it names one. Archived cards never match by name.
 */
function refResolverOf(board: CanvasBoard): RefResolver {
  const definitions = new Map(board.categories.map(category => [category.id, category.definition]))
  return (entry, refKind) => {
    const byId = board.cards.find(card => card.id === entry)
    if (byId !== undefined) return byId.id
    const named = board.cards.filter(card =>
      card.status !== 'archived'
      && (refKind === undefined || card.kind === refKind)
      && cardNameOf(card, definitions.get(card.kind)) === entry)
    return named.length === 1 ? named[0]!.id : undefined
  }
}

/** Most sample cards one `canvas_read` kind answer shows. */
const MAX_TYPE_SAMPLES = 3

/** Most images one `canvas_read` kind answer carries. */
const MAX_TYPE_IMAGES = 8

/** What each card status reads as to the model. */
const STATUS_NAMES: Readonly<Record<string, string>> = { proposed: '待确认', kept: '已收下', archived: '已归档' }

/**
 * The category catalog as the model reads it: each category's id (the `kind`
 * a card files under), name, card count, and its fields when it has a type.
 */
function renderCatalog(board: CanvasBoard): string {
  const lines = [`画布：${board.title}（${board.id}）`, '分类（落卡时 kind 填 id）：']
  for (const category of board.categories) {
    const count = board.cards.filter(card => card.kind === category.id && card.status !== 'archived').length
    const retired = category.draft === true ? '　草拟中（等用户采用）' : category.enabled ? '' : '　已停用（不能再落新卡）'
    lines.push(`- ${category.id}　${categoryNameOf(category)}　${count} 张${retired}`)
    if (category.definition !== undefined) {
      lines.push(`  字段（落卡时 fields 按这些 key 填）：${category.definition.fields.map(fieldSignature).join('；')}`)
    }
    if (category.proposal !== undefined) lines.push('  有一版类型提议等用户确认（canvas_read 带 kind 查看）')
  }
  return lines.join('\n')
}

/** One line per card, optionally one category's; archived cards are counted, not listed, unless asked for. */
function renderCards(board: CanvasBoard, options: { kind?: string; includeArchived: boolean }): string {
  const names = new Map(board.categories.map(category => [category.id, categoryNameOf(category)]))
  const definitions = new Map(board.categories.map(category => [category.id, category.definition]))
  const cards = board.cards.filter(card =>
    (options.includeArchived || card.status !== 'archived')
    && (options.kind === undefined || card.kind === options.kind))
  const archived = options.includeArchived
    ? 0
    : board.cards.filter(card => card.status === 'archived' && (options.kind === undefined || card.kind === options.kind)).length
  const lines = [`卡片（${cards.length} 张${archived > 0 ? `，另有 ${archived} 张已归档未列出` : ''}）：`]
  for (const card of cards.slice(0, MAX_BOARD_READ_CARDS)) {
    const title = cardNameOf(card, definitions.get(card.kind)) || '（无文字）'
    lines.push(`- ${card.id}　[${names.get(card.kind) ?? card.kind}]　${STATUS_NAMES[card.status] ?? card.status}　${title}`)
  }
  if (cards.length > MAX_BOARD_READ_CARDS) lines.push(`……还有 ${cards.length - MAX_BOARD_READ_CARDS} 张未列出（用 kind 缩小范围）。`)
  return lines.join('\n')
}

/** What the main-session tools answer when there is no canvas to act on. */
const NO_CANVAS_MESSAGE = '没有打开的画布：请先在右栏「画布详情」tab 打开一块画布，再让我改它。'

/**
 * Build the canvas tools for the MAIN session (M3's second entrance): the
 * target canvas resolves per call
 * from the canvas the session is bound to (genre work), else its focused
 * canvas — the one the right-sidebar canvas tab last reported open. No open canvas is a plain answer, never an error.
 * @param board - the board service the tools delegate to.
 * @returns the tagged definitions for the profile-root tools registry.
 */
export function canvasMainSessionToolDefinitions(board: CanvasBoardService): ToolDefinition[] {
  /** Resolve the call's target: the bound canvas, else the focused one, plus the fencing session. */
  const target = async (exec: { agent?: Agent }): Promise<{ canvasId: string; session: Session } | { message: string }> => {
    const session = exec.agent?.session
    if (session === undefined) return { message: NO_CANVAS_MESSAGE }
    const canvasId = await board.targetCanvasId(session)
    if (canvasId === undefined) return { message: NO_CANVAS_MESSAGE }
    return { canvasId, session }
  }

  /** One category's type as the model reads it: brief (with its pictures), definition, proposal, history, samples. */
  const renderType = async (
    read: CanvasBoard,
    category: BoardCategory,
    exec: { agent?: Agent; signal?: AbortSignal },
  ): Promise<{ text: string; images: CanvasImageRef[] }> => {
    const seesImages = await board.routeSeesImages(exec.agent, exec.signal)
    const images: CanvasImageRef[] = []
    const brief: string[] = []
    for (const block of cardBlocksOf(category.brief ?? '', category.briefDrawings, { images: true })) {
      if (block.kind === 'text') { brief.push(block.text); continue }
      const label = block.kind === 'draw' ? '手绘' : '贴图'
      if (!seesImages) { brief.push(`[${label}：当前模型不支持看图]`); continue }
      if (images.length >= MAX_TYPE_IMAGES) { brief.push(`[${label}：图太多，未附上]`); continue }
      const strokes = block.kind === 'draw' ? category.briefDrawings?.[block.id] : undefined
      const ref = block.kind === 'image' ? imageRefOf(block.src) : strokes === undefined ? undefined : await board.drawingImage(strokes)
      if (ref === undefined) { brief.push(`[${label}：读不出来]`); continue }
      images.push(ref)
      brief.push(`[${label} ${images.length}：见附图 ${images.length}]`)
    }
    const lines = [`分类：${category.id}（${categoryNameOf(category)}）${category.draft === true ? '　草拟中，等用户采用' : ''}`, '', '参考稿：']
    lines.push(brief.length === 0 ? '（用户还没写参考稿）' : brief.join('\n\n'))
    lines.push('', '已采用的定义：', category.definition === undefined ? '（还没有——这个分类的卡只有正文）' : renderDefinition(category.definition))
    if (category.proposal !== undefined) {
      lines.push('', `等用户确认的提议（v${category.proposal.definition.version}）：`, renderDefinition(category.proposal.definition))
      if (category.proposal.rationale !== '') lines.push(`理由：${category.proposal.rationale}`)
    }
    if (category.history !== undefined && category.history.length > 0) {
      lines.push('', '改版记录：')
      for (const row of category.history.slice(-8)) lines.push(`- v${row.version}　${row.summary}${row.request === undefined ? '' : `（用户要的：${row.request}）`}`)
    }
    const samples = read.cards.filter(card => card.kind === category.id && card.status !== 'archived').slice(0, MAX_TYPE_SAMPLES)
    if (samples.length > 0) {
      lines.push('', `样例卡（${samples.length} 张）：`)
      const definitions = new Map(read.categories.map(row => [row.id, row.definition]))
      const nameOf = (id: string): string => {
        const card = read.cards.find(candidate => candidate.id === id)
        return card === undefined ? id : cardNameOf(card, definitions.get(card.kind)) || id
      }
      for (const card of samples) {
        lines.push(`- ${card.id}　${cardNameOf(card, category.definition) || '（无文字）'}`)
        for (const [key, value] of Object.entries(card.fields ?? {})) lines.push(`    ${key}: ${fieldValueText(value, nameOf)}`)
      }
    }
    return { text: lines.join('\n'), images }
  }

  /** One manuscript in full: header, the cards it used / left out, then the body. */
  const renderManuscript = async (canvasId: string, cards: readonly BoardCard[], manuscriptId: string): Promise<string> => {
    const outcome = await board.readManuscript({ canvasId, manuscriptId })
    if (!outcome.ok) return renderOutcome({ ok: false, error: outcome.error })
    const { manuscript, body } = outcome
    return [
      `${manuscript.id}　${manuscript.title}　v${manuscript.version}　${manuscript.status === 'final' ? '定稿' : '写作中'}`,
      `用到的素材：${sourceList(manuscript.sources.used, cards)}`,
      `没用到的素材：${sourceList(manuscript.sources.unused, cards)}`,
      '---',
      body,
    ].join('\n')
  }

  // The descriptions are deliberately terse (2026-09-30): the tools live in
  // the writing preset, where a long catalog crowds the model's writing. The
  // mechanics — card kinds, fields, the type grammar, the revision protocol —
  // are the `canvas` skill's, loaded on demand (skill.ts).
  const read = defineTool({
    name: 'canvas_read',
    description:
      'Read the open canvas. No arguments: categories, cards and manuscripts. '
      + 'kind: that category\'s type (brief, fields, samples) and its cards. manuscriptId: that manuscript\'s full text and version.',
    parameters: {
      kind: { type: 'string', description: 'Category id.' },
      manuscriptId: { type: 'string', description: 'Manuscript id (ms_…).' },
      includeArchived: { type: 'boolean', description: 'Also list archived cards.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
          images: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                attachmentId: { type: 'string', required: true },
                mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], required: true },
                bytes: { type: 'integer', required: true },
                width: { type: 'integer', required: true },
                height: { type: 'integer', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: value.text },
        // The id is the attachment store's own (branded host-side); the canvas
        // takes no dependency on the attachments package just to re-brand it.
        ...value.images.map(image => ({ type: 'image' as const, attachment: { ...image, attachmentId: image.attachmentId as never } })),
      ],
    },
    isConcurrencySafe: () => true,
    execute: async (
      args: { kind?: string; manuscriptId?: string; includeArchived?: boolean },
      exec: { agent?: Agent; signal?: AbortSignal },
    ): Promise<{ text: string; images: CanvasImageRef[] }> => {
      const resolved = await target(exec)
      if ('message' in resolved) return { text: resolved.message, images: [] }
      const loaded = await board.readBoard({ canvasId: resolved.canvasId })
      if (!loaded.ok) return { text: renderOutcome({ ok: false, error: loaded.error }), images: [] }
      const current = loaded.board
      if (args.manuscriptId !== undefined) {
        return { text: await renderManuscript(resolved.canvasId, current.cards, args.manuscriptId), images: [] }
      }
      const includeArchived = args.includeArchived === true
      if (args.kind !== undefined) {
        const category = current.categories.find(candidate => candidate.id === args.kind)
        if (category === undefined) {
          return { text: `失败：这块画布没有 id 为「${args.kind}」的分类。可用的：${current.categories.map(row => `${row.id}（${categoryNameOf(row)}）`).join('、')}。`, images: [] }
        }
        const type = await renderType(current, category, exec)
        return { text: `${type.text}\n\n${renderCards(current, { kind: category.id, includeArchived })}`, images: type.images }
      }
      const manuscripts = current.manuscripts.length === 0
        ? '成稿：（还没有）'
        : ['成稿：', ...current.manuscripts.map(manuscript =>
          `- ${manuscript.id}　${manuscript.title}　v${manuscript.version}　${manuscript.status === 'final' ? '定稿' : '写作中'}`)].join('\n')
      return { text: [renderCatalog(current), renderCards(current, { includeArchived }), manuscripts].join('\n'), images: [] }
    },
  })

  const write = defineTool({
    name: 'canvas_write',
    description:
      'Write to the open canvas. op=card proposes a card (the user keeps or rejects it); op=comment comments on cardId; '
      + 'op=manuscript creates a manuscript, or revises manuscriptId from baseVersion. Load the canvas skill first.',
    parameters: {
      op: { type: 'string', enum: ['card', 'comment', 'manuscript'], required: true, description: 'What to write.' },
      text: { type: 'string', description: 'Card text, comment text, or the whole manuscript (Markdown).' },
      kind: {
        type: 'string',
        // Open on purpose: this definition is registered once at boot, before
        // any canvas is open, so an enum could only ever advertise the five
        // built-ins — and a closed one refuses a custom category the model
        // just read off the board. The store checks the id against the focused
        // board, and a miss answers with that board's valid ids.
        description: 'card: category id.',
      },
      fields: { type: 'object', additionalProperties: true, description: 'card: field values by key.' },
      source: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['url', 'file', 'paste'], required: true },
          ref: { type: 'string', required: true },
          title: { type: 'string' },
        },
        additionalProperties: false,
        description: 'card: where it comes from.',
      },
      comment: { type: 'string', description: 'card: why, attached as your comment.' },
      cardId: { type: 'string', description: 'comment: the card.' },
      manuscriptId: { type: 'string', description: 'manuscript: id to revise.' },
      baseVersion: { type: 'number', description: 'manuscript: version the revision starts from.' },
      title: { type: 'string', description: 'manuscript: title.' },
      sources: {
        type: 'object',
        properties: {
          used: { type: 'array', items: { type: 'string' } },
          unused: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
        description: 'manuscript: card ids used and left out.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: async (args: WriteArgs, exec: { agent?: Agent }): Promise<string> => {
      const resolved = await target(exec)
      if ('message' in resolved) return resolved.message
      if (args.op === 'comment') return writeComment(args, resolved)
      if (args.op === 'manuscript') return writeManuscript(args, resolved)
      if (args.op === 'card') return writeCard(args, resolved)
      return '失败：op 只能是 card、comment 或 manuscript。'
    },
  })

  type Target = { canvasId: string; session: Session }

  const writeCard = async (args: WriteArgs, resolved: Target): Promise<string> => {
    if (args.kind === undefined || args.kind.trim() === '') return '失败：op=card 要给 kind（分类 id，canvas_read 可查）。'
    const kind = args.kind
    const text = args.text ?? ''
    let fields: Record<string, FieldValue> | undefined
    if (args.fields !== undefined && Object.keys(args.fields).length > 0) {
      const read = await board.readBoard({ canvasId: resolved.canvasId })
      if (!read.ok) return renderOutcome({ ok: false, error: read.error })
      const category = read.board.categories.find(candidate => candidate.id === kind)
      if (category?.definition === undefined) {
        return `失败：分类「${category === undefined ? kind : categoryNameOf(category)}」没有字段定义，不能填 fields——把内容写进 text。`
      }
      const check = checkFieldValues(category.definition, args.fields, refResolverOf(read.board))
      if (!check.ok) return `失败：字段不合「${categoryNameOf(category)}」的定义——\n${check.problems.map(problem => `- ${problem}`).join('\n')}`
      fields = check.values
    }
    if (text.trim().length === 0 && fields === undefined) return '失败：text 和 fields 至少要有一样。'
    const outcome = await board.proposeCard({
      canvasId: resolved.canvasId,
      kind: kind as CardCategoryId,
      text,
      ...(fields === undefined ? {} : { fields }),
      ...(args.source === undefined ? {} : { source: args.source }),
      ...(args.comment === undefined ? {} : { comment: args.comment }),
    }, resolved.session)
    if (!outcome.ok && outcome.error === 'invalid-name') {
      const read = await board.readBoard({ canvasId: resolved.canvasId })
      if (read.ok) {
        const category = read.board.categories.find(candidate => candidate.id === kind)
        const why = category === undefined
          ? `这块画布没有 id 为「${kind}」的分类`
          : `分类「${categoryNameOf(category)}」已停用`
        return `失败：${why}。可用的 kind：${enabledKinds(read.board)}。`
          + (isBoardCardKind(kind) || category !== undefined ? '' : '用户说的是分类名的话，从这里挑对应的 id。')
      }
    }
    if (!outcome.ok) return renderOutcome({ ok: false, error: outcome.error })
    const card = outcome.board.cards[outcome.board.cards.length - 1]
    return renderOutcome({ ok: true, cardId: card?.id })
  }

  const writeComment = async (args: WriteArgs, resolved: Target): Promise<string> => {
    if (args.cardId === undefined || (args.text ?? '').trim() === '') return '失败：op=comment 要给 cardId 和 text。'
    const outcome = await board.addComment({
      canvasId: resolved.canvasId, cardId: args.cardId, text: args.text ?? '', author: 'agent',
    }, resolved.session)
    return renderOutcome({ ok: outcome.ok, ...(outcome.ok ? {} : { error: outcome.error }) })
  }

  const writeManuscript = async (args: WriteArgs, resolved: Target): Promise<string> => {
    if ((args.text ?? '').trim() === '') return '失败：op=manuscript 要把整篇正文放在 text。'
    const outcome = await board.writeManuscript({
      canvasId: resolved.canvasId,
      body: args.text ?? '',
      ...(args.manuscriptId === undefined ? {} : { manuscriptId: args.manuscriptId }),
      ...(args.title === undefined ? {} : { title: args.title }),
      ...(args.baseVersion === undefined ? {} : { baseVersion: args.baseVersion }),
      ...(args.sources === undefined ? {} : { sources: args.sources }),
    }, resolved.session, 'agent')
    if (outcome.ok) return `完成：${outcome.manuscript.id} v${outcome.manuscript.version}`
    if (outcome.error === 'stale' && outcome.currentVersion !== undefined) {
      return `冲突：这篇成稿当前是 v${outcome.currentVersion}，已被改过。先用 canvas_read 带 manuscriptId 读最新版，再在它上面改。`
    }
    return renderOutcome({ ok: false, error: outcome.error })
  }

  // Its own tool, not a canvas_write op: the conversation's type-proposal row
  // is keyed by tool name (client/index.ts), and a keyed row replaces the
  // generic one for EVERY call of that name.
  const proposeType = defineTool({
    name: 'canvas_propose_type',
    description:
      'Propose a field definition for category kind, or for a new category named label; it waits for the user to adopt it. '
      + 'Load the canvas skill first.',
    parameters: {
      kind: { type: 'string', description: 'Category id to change.' },
      label: { type: 'string', description: 'New category name (instead of kind).' },
      definition: { type: 'object', required: true, additionalProperties: true, description: '{ layout, fields, example }.' },
      rationale: { type: 'string', required: true, description: 'Why this design.' },
      renames: { type: 'object', additionalProperties: true, description: 'Old field key → new key.' },
      summary: { type: 'string', description: 'What this version changes.' },
      request: { type: 'string', description: 'What the user asked for.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: async (
      args: { kind?: string; label?: string; definition: unknown; rationale: string; renames?: unknown; summary?: string; request?: string },
      exec: { agent?: Agent },
    ): Promise<string> => {
      const resolved = await target(exec)
      if ('message' in resolved) return resolved.message
      const outcome = await board.proposeType({
        canvasId: resolved.canvasId,
        ...(args.kind === undefined ? {} : { kind: args.kind as CardCategoryId }),
        ...(args.label === undefined ? {} : { label: args.label }),
        definition: args.definition,
        rationale: args.rationale,
        ...(args.renames === undefined ? {} : { renames: args.renames }),
        ...(args.summary === undefined ? {} : { summary: args.summary }),
        ...(args.request === undefined ? {} : { request: args.request }),
      }, resolved.session)
      if (outcome.ok) {
        const category = outcome.board.categories.find(row => row.id === outcome.kind)
        const fields = category?.proposal?.definition.fields.length ?? 0
        // The canvas id rides the answer so the conversation's tool row can
        // open THIS canvas's type page later, whatever canvas is open by then.
        return `完成：${outcome.kind}（${category === undefined ? '' : categoryNameOf(category)}）的类型提议已放到类型页（画布 ${resolved.canvasId}），${fields} 个字段，等用户采用。`
      }
      if (outcome.error === 'invalid-name') {
        return args.kind === undefined && (args.label ?? '').trim() === ''
          ? '失败：新建一类要给 label；改已有分类要给 kind。'
          : '失败：definition 里没有一个合格的字段——每个字段要有合法的 key（小写字母开头）、label、type 和 hint。'
      }
      if (outcome.error === 'missing') return `失败：这块画布没有 id 为「${args.kind ?? ''}」的分类。先用 canvas_read 读出 id。`
      return renderOutcome({ ok: false, error: outcome.error })
    },
  })

  return [tagOrigin(read), tagOrigin(write), tagOrigin(proposeType)]
}

/** `canvas_write`'s arguments; which ones matter depends on `op`. */
interface WriteArgs {
  op: string
  text?: string
  kind?: string
  fields?: Record<string, unknown>
  source?: BoardCardSource
  comment?: string
  cardId?: string
  manuscriptId?: string
  baseVersion?: number
  title?: string
  sources?: { used?: string[]; unused?: string[] }
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
