/**
 * The canvas's main-session tools, registered by the `./agent` composition
 * entry: one read (`canvas_read`), one write (`canvas_write`: card, comment,
 * archive, manuscript), the type proposal (`canvas_propose_type`) and the door
 * (`canvas_open`: list, switch to, or create a canvas). The first three act
 * on the canvas the session's right-Sidebar tab has open. Three used to be
 * seven (2026-09-30): the long catalog crowded the writing preset's model, so
 * the details moved to the on-demand `canvas` skill (skill.ts). The door came
 * back as a fourth (2026-10-08): a discussion that ended in "put it on a
 * canvas" otherwise stopped until the user made one by hand.
 *
 * On a genre canvas they stay the one card tool: the genre's own categories
 * go through its `agent` hooks (refs, duplicate checks, cards that land live),
 * the rest of the board the generic way (2026-10-06).
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
  type BoardCard, type BoardCardSource, type BoardCategory, type CanvasBoard, type CanvasGenreAgent, type CanvasGenreDefinition, type CanvasImageRef,
  type CardCategoryId,
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

/**
 * One line per card, optionally one category's; archived cards are counted,
 * not listed, unless asked for. `skip` leaves out the categories a genre lists
 * itself.
 */
function renderCards(board: CanvasBoard, options: { kind?: string; includeArchived: boolean; skip?: ReadonlySet<string> }): string {
  const names = new Map(board.categories.map(category => [category.id, categoryNameOf(category)]))
  const definitions = new Map(board.categories.map(category => [category.id, category.definition]))
  const listed = (card: BoardCard): boolean =>
    (options.kind === undefined || card.kind === options.kind) && options.skip?.has(card.kind) !== true
  const cards = board.cards.filter(card => listed(card) && (options.includeArchived || card.status !== 'archived'))
  const archived = options.includeArchived ? 0 : board.cards.filter(card => listed(card) && card.status === 'archived').length
  const lines = [`卡片（${cards.length} 张${archived > 0 ? `，另有 ${archived} 张已归档未列出` : ''}）：`]
  for (const card of cards.slice(0, MAX_BOARD_READ_CARDS)) {
    const title = cardNameOf(card, definitions.get(card.kind)) || '（无文字）'
    lines.push(`- ${card.id}　[${names.get(card.kind) ?? card.kind}]　${STATUS_NAMES[card.status] ?? card.status}　${title}`)
  }
  if (cards.length > MAX_BOARD_READ_CARDS) lines.push(`……还有 ${cards.length - MAX_BOARD_READ_CARDS} 张未列出（用 kind 缩小范围）。`)
  return lines.join('\n')
}

/** One card in full, the generic way: kind, status, fields, body, source, comments. */
function renderCard(board: CanvasBoard, cardId: string): string {
  const card = board.cards.find(candidate => candidate.id === cardId)
  if (card === undefined) return `失败：这块画布没有卡片「${cardId}」。canvas_read 不带参数看全部卡片。`
  const category = board.categories.find(candidate => candidate.id === card.kind)
  const definitions = new Map(board.categories.map(row => [row.id, row.definition]))
  const nameOf = (id: string): string => {
    const target = board.cards.find(candidate => candidate.id === id)
    return target === undefined ? id : cardNameOf(target, definitions.get(target.kind)) || id
  }
  const lines = [`${card.id}　[${category === undefined ? card.kind : categoryNameOf(category)}]　${STATUS_NAMES[card.status] ?? card.status}　${cardNameOf(card, category?.definition) || '（无文字）'}`]
  for (const [key, value] of Object.entries(card.fields ?? {})) {
    const label = category?.definition?.fields.find(field => field.key === key)?.label ?? key
    lines.push(`${label}：${fieldValueText(value, nameOf)}`)
  }
  if (card.text.trim() !== '') lines.push('---', card.text.trim(), '---')
  if (card.source !== undefined) lines.push(`来源：${card.source.title ?? card.source.ref}（${card.source.ref}）`)
  if (card.comments.length > 0) {
    lines.push('评论：', ...card.comments.map(comment => `- ${comment.author === 'agent' ? '你' : '用户'}：${comment.text}`))
  }
  return lines.join('\n')
}

/** The categories a genre seeded (they carry a role): the genre's agent hooks own their cards. */
function genreKinds(board: CanvasBoard): Set<string> {
  return new Set(board.categories.filter(category => category.role !== undefined).map(category => category.id))
}

/** The keys a text line may name the category by (`分类：世界`). */
const KIND_KEYS = new Set(['分类', '类别', 'kind', 'category'])

/** The keys a text line may name the card to patch by (`编号：w7`). */
const CARD_ID_KEYS = new Set(['编号', '卡片', '卡号', 'cardid', 'card', 'id', 'ref'])

/** One `键：值` line (full- or half-width colon), or undefined. */
function keyValueOf(line: string): { key: string; value: string } | undefined {
  const match = /^\s*[-*•]?\s*([^：:\n]{1,16}?)\s*[：:]\s*(.+?)\s*$/.exec(line)
  return match === null ? undefined : { key: match[1]!.trim(), value: match[2]!.trim() }
}

/**
 * The card a text-only write patches: its `编号：w7` line, and the text
 * without it. Read before the rest of the text, because which card is
 * patched decides which category's fields the other lines fill.
 */
export function cardIdLineOf(text: string | undefined): { token?: string; text: string } {
  const lines = (text ?? '').split('\n')
  const index = lines.findIndex((line) => {
    const pair = keyValueOf(line)
    return pair !== undefined && CARD_ID_KEYS.has(pair.key.toLowerCase())
  })
  if (index === -1) return { text: text ?? '' }
  const token = keyValueOf(lines[index]!)!.value
  return { token, text: [...lines.slice(0, index), ...lines.slice(index + 1)].join('\n') }
}

/** A category by id or by the name the board shows. */
function categoryByToken(board: CanvasBoard, token: string | undefined): BoardCategory | undefined {
  const text = token?.trim()
  if (text === undefined || text === '') return undefined
  return board.categories.find(category => category.id === text) ?? board.categories.find(category => categoryNameOf(category) === text)
}

/**
 * One card write's arguments, made whole from whatever arrived. Some model
 * and provider pairs deliver only the flat strings of a call — nested
 * objects (`fields`) and even `kind` go missing on the way (Kimi K3 on the
 * coding endpoint, 2026-10-08: `{"op":"card","text":"","title":""}` a dozen
 * times over while the model's reasoning held the full card). So a card can
 * also be written in `text` alone: a `分类：世界` line names the category,
 * `字段名：值` lines fill its typed fields (matched by label or key), and the
 * remaining lines are the body, and a `title` names a new card when its
 * name field is empty. `kind` stays
 * as the model wrote it (a genre hook reads its own names); `categoryId` is
 * the category it names on this board, for the canvas's own path.
 * @param args - the call's card arguments, as they arrived.
 * @param board - the target board (its categories and their definitions).
 */
export function cardArgsOf(
  args: { kind?: string; fields?: unknown; text?: string; title?: string; cardId?: string },
  board: CanvasBoard,
): { kind?: string; categoryId?: string; fields?: Record<string, unknown>; text: string } {
  let fields = typeof args.fields === 'object' && args.fields !== null && !Array.isArray(args.fields)
    ? { ...(args.fields as Record<string, unknown>) }
    : undefined
  let kind = args.kind === undefined || args.kind.trim() === '' ? undefined : args.kind.trim()
  const rest: string[] = []
  // The category first: an explicit kind, else a 分类 line, else the patched card's.
  for (const line of (args.text ?? '').split('\n')) {
    const pair = keyValueOf(line)
    if (pair !== undefined && KIND_KEYS.has(pair.key.toLowerCase())) {
      kind ??= pair.value
      continue
    }
    rest.push(line)
  }
  const patched = args.cardId === undefined ? undefined : board.cards.find(card => card.id === args.cardId)
  const category = categoryByToken(board, kind) ?? (patched === undefined ? undefined : board.categories.find(row => row.id === patched.kind))
  const definition = category?.definition
  let body = rest
  if (definition !== undefined && (fields === undefined || Object.keys(fields).length === 0)) {
    const found: Record<string, unknown> = {}
    body = []
    for (const line of rest) {
      const pair = keyValueOf(line)
      const field = pair === undefined ? undefined : definition.fields.find(row => row.label === pair.key || row.key === pair.key)
      if (pair === undefined || field === undefined) {
        body.push(line)
        continue
      }
      found[field.key] = field.type === 'number' && /^-?\d+(\.\d+)?$/.test(pair.value) ? Number(pair.value) : pair.value
    }
    if (Object.keys(found).length > 0) fields = found
  }
  const title = args.title?.trim()
  const nameField = definition?.fields.find(row => row.required === true && row.type === 'line')
  if (title !== undefined && title !== '' && nameField !== undefined && patched === undefined && fields?.[nameField.key] === undefined) {
    fields = { ...fields, [nameField.key]: title }
  }
  return {
    ...(kind === undefined ? {} : { kind }),
    ...(category === undefined ? {} : { categoryId: category.id }),
    ...(fields === undefined || Object.keys(fields).length === 0 ? {} : { fields }),
    text: body.join('\n').trim(),
  }
}

/** The answer to a card write that arrived with nothing to file: it names the text-only form, so the next call need not repeat itself. */
const EMPTY_CARD_MESSAGE = '失败：这次 op=card 没收到可用的内容（kind、fields、text 都是空的）。如果你填了却没到达，'
  + '多半是当前模型/供应商把嵌套参数丢了——改用纯文本写法：text 第一行写「分类：世界」（分类名或 id），'
  + '之后每行一个「字段名：值」（如「名称：醒界」「类型：地点」「设定：……」），正文另起一行。一张卡一次调用。'

/**
 * What the main-session tools answer when there is no canvas to act on: the
 * model finds or makes one itself through `canvas_open` instead of stopping
 * on the user.
 */
const NO_CANVAS_MESSAGE = '本会话还没有目标画布：先用 canvas_open() 列出已有画布并切过去；没有合适的，在用户同意后用 canvas_open(create=标题) 新建。'

/** Most canvases one `canvas_open` listing shows. */
const MAX_OPEN_LIST = 50

/** A title as the model may quote it: 《》 stripped, whitespace folded. */
function plainTitle(raw: string): string {
  return raw.trim().replace(/^《(.*)》$/, '$1').replace(/\s+/g, ' ').trim()
}

/**
 * Build the canvas tools for the MAIN session (M3's second entrance): the
 * target canvas resolves per call
 * from the canvas the session is bound to (genre work), else its focused
 * canvas — the one the right-sidebar canvas tab last reported open. No open canvas is a plain answer, never an error.
 * @param board - the board service the tools delegate to.
 * @returns the tagged definitions for the profile-root tools registry.
 */
export function canvasMainSessionToolDefinitions(board: CanvasBoardService): ToolDefinition[] {
  type Target = { canvasId: string; session: Session }

  /** Resolve the call's target: the bound canvas, else the focused one, plus the fencing session. */
  const target = async (exec: { agent?: Agent }): Promise<{ canvasId: string; session: Session } | { message: string }> => {
    const session = exec.agent?.session
    if (session === undefined) return { message: NO_CANVAS_MESSAGE }
    const canvasId = await board.targetCanvasId(session)
    if (canvasId === undefined) return { message: NO_CANVAS_MESSAGE }
    return { canvasId, session }
  }

  /** The canvas's genre when it hooks into the tools (a registered genre with `agent`). */
  const agentOf = (read: CanvasBoard): { genre: CanvasGenreDefinition; agent: CanvasGenreAgent } | undefined => {
    const genre = read.genre === undefined ? undefined : board.genre(read.genre.id)
    return genre?.agent === undefined ? undefined : { genre, agent: genre.agent }
  }

  /** A card id from the model's handle: the genre reads its own refs (`c3`, `#12`), anything else is taken as the id. */
  const resolveCardId = async (resolved: Target, token: string): Promise<string> => {
    const read = await board.readBoard({ canvasId: resolved.canvasId })
    const hooked = read.ok ? agentOf(read.board) : undefined
    const cardId = hooked === undefined ? undefined : await hooked.agent.resolveCard({ canvasId: resolved.canvasId, token }, resolved.session)
    return cardId ?? token
  }

  /** The card listing: a genre lists its own categories its way, the rest of the board lists generically. */
  const listCards = async (read: CanvasBoard, kind: string | undefined, includeArchived: boolean, session: Session): Promise<string> => {
    const hooked = agentOf(read)
    if (hooked === undefined) return renderCards(read, { ...(kind === undefined ? {} : { kind }), includeArchived })
    const owned = genreKinds(read)
    const parts: string[] = []
    if (kind === undefined || owned.has(kind)) {
      const lines = await hooked.agent.cardLines({ canvasId: read.id, ...(kind === undefined ? {} : { kind }), includeArchived }, session)
      parts.push(lines.length === 0 ? `${hooked.genre.label}卡片：（还没有）` : [`${hooked.genre.label}卡片（${lines.length} 张）：`, ...lines].join('\n'))
    }
    const others = read.cards.some(card => !owned.has(card.kind) && (kind === undefined || card.kind === kind))
    if (others) parts.push(renderCards(read, { ...(kind === undefined ? {} : { kind }), includeArchived, skip: owned }))
    return parts.join('\n')
  }

  /** The 成稿 listing: a genre that owns them lists its own (the novel's chapters, in order). */
  const listManuscripts = async (read: CanvasBoard): Promise<string> => {
    const hooked = agentOf(read)
    if (hooked?.genre.ownsManuscripts === true && hooked.agent.manuscripts !== undefined) {
      return hooked.agent.manuscripts({ canvasId: read.id })
    }
    return read.manuscripts.length === 0
      ? '成稿：（还没有）'
      : ['成稿：', ...read.manuscripts.map(manuscript =>
        `- ${manuscript.id}　${manuscript.title}　v${manuscript.version}　${manuscript.status === 'final' ? '定稿' : '写作中'}`)].join('\n')
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
      + 'kind: that category\'s type (brief, fields, samples) and its cards. cardId: that card in full. '
      + 'manuscriptId: that manuscript\'s full text and version.',
    parameters: {
      kind: { type: 'string', description: 'Category id (or its name as the board shows it).' },
      cardId: { type: 'string', description: 'Card id (or the genre\'s ref, e.g. c3 / #12).' },
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
      args: { kind?: string; cardId?: string; manuscriptId?: string; includeArchived?: boolean },
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
      if (args.cardId !== undefined) {
        const hooked = agentOf(current)
        const detail = hooked === undefined ? undefined : await hooked.agent.cardDetail({ canvasId: current.id, cardId: args.cardId }, resolved.session)
        return { text: detail ?? renderCard(current, args.cardId), images: [] }
      }
      const includeArchived = args.includeArchived === true
      if (args.kind !== undefined) {
        // The id, else the name the board shows (a genre's skill says kind=人物).
        const category = current.categories.find(candidate => candidate.id === args.kind)
          ?? current.categories.find(candidate => categoryNameOf(candidate) === args.kind)
        if (category === undefined) {
          return { text: `失败：这块画布没有 id 为「${args.kind}」的分类。可用的：${current.categories.map(row => `${row.id}（${categoryNameOf(row)}）`).join('、')}。`, images: [] }
        }
        const type = await renderType(current, category, exec)
        return { text: `${type.text}\n\n${await listCards(current, category.id, includeArchived, resolved.session)}`, images: type.images }
      }
      const cards = await listCards(current, undefined, includeArchived, resolved.session)
      return { text: [renderCatalog(current), cards, await listManuscripts(current)].join('\n'), images: [] }
    },
  })

  const write = defineTool({
    name: 'canvas_write',
    description:
      'Write to the open canvas. op=card proposes a card (the user keeps or rejects it; on a genre canvas such as 长篇小说 '
      + 'its cards land at once), and with cardId patches that genre card\'s fields; op=comment comments on cardId; '
      + 'op=archive archives cardId; op=manuscript creates a manuscript, or revises manuscriptId from baseVersion. '
      + 'Load the canvas skill first.',
    parameters: {
      op: { type: 'string', enum: ['card', 'comment', 'archive', 'manuscript'], required: true, description: 'What to write.' },
      text: { type: 'string', description: 'Card text, comment text, or the whole manuscript (Markdown). A card may also be written in text alone: a 分类：… line, then 字段名：值 lines, then the body.' },
      kind: {
        type: 'string',
        // Open on purpose: this definition is registered once at boot, before
        // any canvas is open, so an enum could only ever advertise the five
        // built-ins — and a closed one refuses a custom category the model
        // just read off the board. The store checks the id against the focused
        // board, and a miss answers with that board's valid ids.
        description: 'card: category id.',
      },
      fields: {
        type: 'object', additionalProperties: true,
        description: 'card: field values by key. If nested arguments fail to arrive, write them as 字段名：值 lines in text instead.',
      },
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
      cardId: { type: 'string', description: 'card: the genre card to patch; comment/archive: the card. An id or the genre\'s ref (c3, #12).' },
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
      if (args.op === 'archive') return archiveCard(args, resolved)
      if (args.op === 'manuscript') return writeManuscript(args, resolved)
      if (args.op === 'card') return writeCard(args, resolved)
      return '失败：op 只能是 card、comment、archive 或 manuscript。'
    },
  })

  const writeCard = async (raw: WriteArgs, resolved: Target): Promise<string> => {
    const read = await board.readBoard({ canvasId: resolved.canvasId })
    if (!read.ok) return renderOutcome({ ok: false, error: read.error })
    // Which card is patched: cardId, else a 编号 line in text, else a title
    // that names an existing card (a provider that drops cardId leaves only
    // these — the K3 session wrote 编号：w7 and title=w7).
    const idLine = cardIdLineOf(raw.text)
    let token = raw.cardId ?? idLine.token
    if (token === undefined && raw.title !== undefined && raw.title.trim() !== '') {
      const named = await resolveCardId(resolved, raw.title.trim())
      if (read.board.cards.some(card => card.id === named)) token = raw.title.trim()
    }
    const patchId = token === undefined ? undefined : await resolveCardId(resolved, token)
    const source = { ...raw, text: idLine.text, ...(patchId === undefined ? {} : { cardId: patchId }) }
    if (token !== undefined && raw.cardId === undefined) delete (source as { title?: string }).title
    const whole = cardArgsOf(source, read.board)
    if (token === undefined && whole.kind === undefined && whole.text === '' && whole.fields === undefined) return EMPTY_CARD_MESSAGE
    const { fields: _arrived, ...others } = raw
    const args: Omit<WriteArgs, 'fields'> & { fields?: Record<string, unknown> } = {
      ...others,
      ...(token === undefined ? {} : { cardId: token }),
      ...(raw.text === undefined && whole.text === '' ? {} : { text: whole.text }),
      ...(whole.kind === undefined ? {} : { kind: whole.kind }),
      ...(whole.fields === undefined ? {} : { fields: whole.fields }),
    }
    const hooked = agentOf(read.board)
    if (hooked !== undefined) {
      const answer = await hooked.agent.writeCard({
        canvasId: resolved.canvasId,
        ...(args.kind === undefined ? {} : { kind: args.kind }),
        ...(args.cardId === undefined ? {} : { cardId: args.cardId }),
        ...(args.fields === undefined ? {} : { fields: args.fields }),
        ...(args.text === undefined ? {} : { text: args.text }),
        ...(args.comment === undefined ? {} : { comment: args.comment }),
      }, resolved.session)
      if (answer !== undefined) return answer
    }
    if (args.cardId !== undefined) return '失败：这张卡由用户来改；要补充就 op=comment 在这张卡上留言，或 op=card 另提一张。'
    if (args.kind === undefined || args.kind.trim() === '') {
      return `失败：op=card 要给 kind（分类 id 或名称，canvas_read 可查）。参数没到达的话，在 text 第一行写「分类：…」。可用的：${enabledKinds(read.board)}。`
    }
    const kind = whole.categoryId ?? args.kind
    const text = args.text ?? ''
    let fields: Record<string, FieldValue> | undefined
    if (args.fields !== undefined && Object.keys(args.fields).length > 0) {
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
      const category = read.board.categories.find(candidate => candidate.id === kind)
      const why = category === undefined
        ? `这块画布没有 id 为「${kind}」的分类`
        : `分类「${categoryNameOf(category)}」已停用`
      return `失败：${why}。可用的 kind：${enabledKinds(read.board)}。`
        + (isBoardCardKind(kind) || category !== undefined ? '' : '用户说的是分类名的话，从这里挑对应的 id。')
    }
    if (!outcome.ok) return renderOutcome({ ok: false, error: outcome.error })
    const card = outcome.board.cards[outcome.board.cards.length - 1]
    return renderOutcome({ ok: true, cardId: card?.id })
  }

  /** A comment or archive call's card: cardId, else a 编号 line opening the text (the text-only form). */
  const withCardFromText = (args: WriteArgs): WriteArgs => {
    if (args.cardId !== undefined) return args
    const line = cardIdLineOf(args.text)
    return line.token === undefined ? args : { ...args, cardId: line.token, text: line.text.trim() }
  }

  const writeComment = async (arrived: WriteArgs, resolved: Target): Promise<string> => {
    const args = withCardFromText(arrived)
    if (args.cardId === undefined || (args.text ?? '').trim() === '') return '失败：op=comment 要给 cardId 和 text（cardId 到不了就在 text 第一行写「编号：…」）。'
    const outcome = await board.addComment({
      canvasId: resolved.canvasId, cardId: await resolveCardId(resolved, args.cardId), text: args.text ?? '', author: 'agent',
    }, resolved.session)
    if (!outcome.ok && outcome.error === 'missing') return `失败：没有卡片「${args.cardId}」。`
    return renderOutcome({ ok: outcome.ok, ...(outcome.ok ? {} : { error: outcome.error }) })
  }

  const archiveCard = async (arrived: WriteArgs, resolved: Target): Promise<string> => {
    const args = withCardFromText(arrived)
    if (args.cardId === undefined) return '失败：op=archive 要给 cardId（cardId 到不了就在 text 写「编号：…」）。'
    const outcome = await board.patchCard({
      canvasId: resolved.canvasId, cardId: await resolveCardId(resolved, args.cardId), status: 'archived',
    }, resolved.session)
    if (!outcome.ok && outcome.error === 'missing') return `失败：没有卡片「${args.cardId}」。`
    if (!outcome.ok) return renderOutcome({ ok: false, error: outcome.error })
    return `已归档：${args.cardId}（用户在画布的「已归档」里能找回）。`
  }

  const writeManuscript = async (args: WriteArgs, resolved: Target): Promise<string> => {
    const read = await board.readBoard({ canvasId: resolved.canvasId })
    const hooked = read.ok ? agentOf(read.board) : undefined
    if (hooked?.genre.ownsManuscripts === true && hooked.agent.manuscriptGuide !== undefined) return hooked.agent.manuscriptGuide
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

  /** The canvas list as the model reads it, with this session's current target marked. */
  const renderCanvasList = async (session: Session | undefined): Promise<string> => {
    const { items } = await board.listCanvases()
    const current = session === undefined ? undefined : await board.targetCanvasId(session)
    const genres = new Map(board.listGenres().map(genre => [genre.id, genre.label]))
    const lines = items.length === 0 ? ['还没有画布。'] : [`画布（${items.length} 块，最近活动在前）：`]
    for (const item of items.slice(0, MAX_OPEN_LIST)) {
      const tags = [
        `${item.cardCount} 张卡`,
        ...(item.genre === undefined ? [] : [`体裁：${genres.get(item.genre) ?? item.genre}`]),
        ...(item.archivedAt === null ? [] : ['已归档']),
        ...(item.id === current ? ['← 本会话当前'] : []),
      ]
      lines.push(`- ${item.id}　《${item.title}》　${tags.join('　')}`)
    }
    if (items.length > MAX_OPEN_LIST) lines.push(`……还有 ${items.length - MAX_OPEN_LIST} 块未列出。`)
    if (current === undefined) lines.push('本会话还没有目标画布。')
    if (genres.size > 0) lines.push(`新建时可选体裁：${[...genres].map(([id, label]) => `${id}（${label}）`).join('、')}`)
    return lines.join('\n')
  }

  /**
   * Make one canvas this session's target. A genre canvas binds (binding is
   * how a genre's own tools reach the session); a plain one takes the focus —
   * and since a binding outranks the focus, a session bound elsewhere is
   * unbound first, or the switch would not take.
   */
  const switchTo = async (canvasId: string, session: Session): Promise<{ ok: true; note: string } | { ok: false; error: string }> => {
    const loaded = await board.readBoard({ canvasId })
    if (!loaded.ok) return { ok: false, error: loaded.error }
    if (loaded.board.genre !== undefined) {
      const bound = await board.bindSession({ canvasId }, session)
      if (!bound.ok) return { ok: false, error: bound.error }
      await board.focusCanvas({ canvasId }, session)
      return { ok: true, note: `已绑定（体裁：${board.genre(loaded.board.genre.id)?.label ?? loaded.board.genre.id}）。` }
    }
    const previous = await board.boundCanvasId(String(session.id))
    let note = ''
    if (previous !== undefined && previous !== canvasId) {
      const unbound = await board.bindSession({ canvasId: null }, session)
      if (!unbound.ok) return { ok: false, error: unbound.error }
      const was = await board.readBoard({ canvasId: previous })
      note = `已解除与《${was.ok ? was.board.title : previous}》的绑定。`
    }
    const focused = await board.focusCanvas({ canvasId }, session)
    if (!focused.ok) return { ok: false, error: focused.error }
    return { ok: true, note }
  }

  const open = defineTool({
    name: 'canvas_open',
    description:
      'Choose this session\'s canvas. No arguments: list the canvases. canvas: switch to that one (title or id). '
      + 'create: make a new canvas with that title (genre: optional, e.g. 长篇小说) and switch to it — only when the '
      + 'user wants one. The other canvas_* tools then act on it, and the user\'s right sidebar follows.',
    parameters: {
      canvas: { type: 'string', description: 'Canvas title or id to switch to.' },
      create: { type: 'string', description: 'Title of a new canvas.' },
      genre: { type: 'string', description: 'create: genre id or name; omit for a plain canvas.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: async (args: { canvas?: string; create?: string; genre?: string }, exec: { agent?: Agent }): Promise<string> => {
      const session = exec.agent?.session
      const wanted = plainTitle(args.create ?? args.canvas ?? '')
      if (wanted === '') return renderCanvasList(session)
      if (session === undefined) return '失败：这次调用没有会话，切不了画布。'
      const { items } = await board.listCanvases()
      const live = items.filter(item => item.archivedAt === null)

      if (args.create !== undefined && plainTitle(args.create) !== '') {
        // A namesake is the canvas the user meant far more often than a twin:
        // switch to it, and say how to get a second one on purpose.
        const namesake = live.find(item => item.title === wanted)
        if (namesake !== undefined) {
          const switched = await switchTo(namesake.id, session)
          if (!switched.ok) return renderOutcome({ ok: false, error: switched.error })
          return `完成：已切到画布《${namesake.title}》（${namesake.id}）——已有同名画布，没有新建；确要另建一块就换个标题。${switched.note}`
        }
        let genreId: string | null = null
        if (args.genre !== undefined && args.genre.trim() !== '') {
          const name = args.genre.trim()
          const genres = board.listGenres()
          const genre = genres.find(row => row.id === name) ?? genres.find(row => row.label === name)
          if (genre === undefined) {
            return `失败：没有体裁「${name}」。${genres.length === 0 ? '这里没有安装任何体裁，不带 genre 建普通画布。' : `可选：${genres.map(row => `${row.id}（${row.label}）`).join('、')}。`}`
          }
          genreId = genre.id
        }
        // The session's own workspace comes along: a novel's chapters and a
        // manuscript's export need one, and a canvas made here had none (the
        // first chapter then had nowhere to land, 2026-10-09).
        const cwd = session.header?.cwd
        const created = await board.createCanvas({ title: wanted, genreId, ...(cwd === undefined ? {} : { attachedWorkspaces: [cwd] }) }, session)
        if (!created.ok) return renderOutcome({ ok: false, error: created.error })
        const switched = await switchTo(created.board.id, session)
        if (!switched.ok) return renderOutcome({ ok: false, error: switched.error })
        const where = cwd === undefined ? '' : `挂上了工作区 ${cwd}。`
        return `完成：已新建画布《${created.board.title}》（${created.board.id}）并切过去。${switched.note}${where}接下来用 canvas_write 落卡。`
      }

      const byId = items.find(item => item.id === wanted)
      const exact = byId === undefined ? items.filter(item => item.title === wanted) : [byId]
      const matches = exact.length > 0 ? exact : items.filter(item => item.title.includes(wanted))
      // A live canvas outranks an archived namesake.
      const pool = matches.some(item => item.archivedAt === null) ? matches.filter(item => item.archivedAt === null) : matches
      if (pool.length === 0) return `失败：没有叫「${wanted}」的画布。\n${await renderCanvasList(session)}`
      if (pool.length > 1) {
        return `「${wanted}」对应多块画布，请问用户是哪一块（或用 id）：${pool.map(item => `${item.id}《${item.title}》`).join('、')}`
      }
      const target = pool[0]!
      if (target.archivedAt !== null) return `失败：《${target.title}》已归档（只读）。请用户先在画布里恢复它，或另建一块。`
      const switched = await switchTo(target.id, session)
      if (!switched.ok) return renderOutcome({ ok: false, error: switched.error })
      return `完成：已切到画布《${target.title}》（${target.id}）。${switched.note}`
    },
  })

  return [tagOrigin(read), tagOrigin(write), tagOrigin(proposeType), tagOrigin(open)]
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
