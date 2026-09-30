/**
 * The canvas's main-session tools, registered by the `./agent` composition
 * entry: the board read (`canvas_read_board`), the card pair
 * (`canvas_propose_card` / `canvas_comment`), the type pair
 * (`canvas_read_type` / `canvas_propose_type`) and the manuscript pair
 * (`canvas_read_manuscript` / `canvas_write_manuscript`). They act on the
 * canvas the session's right-Sidebar tab has open.
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

/** Most card lines one `canvas_read_board` answer lists. */
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
 * The reference resolver `canvas_propose_card` checks `ref` fields with: a
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

/** Most sample cards one `canvas_read_type` answer shows. */
const MAX_TYPE_SAMPLES = 3

/** Most images one `canvas_read_type` answer carries. */
const MAX_TYPE_IMAGES = 8

/** What each card status reads as to the model. */
const STATUS_NAMES: Readonly<Record<string, string>> = { proposed: '待确认', kept: '已收下', archived: '已归档' }

/**
 * The board as the model reads it: the category catalog (the valid `kind`
 * ids, with names and counts) and one line per card. Archived cards are
 * counted, not listed, unless asked for.
 */
function renderBoard(board: CanvasBoard, options: { kind?: string; includeArchived: boolean }): string {
  const lines = [`画布：${board.title}（${board.id}）`, '分类（落卡时 kind 填 id）：']
  for (const category of board.categories) {
    const count = board.cards.filter(card => card.kind === category.id && card.status !== 'archived').length
    const retired = category.draft === true ? '　草拟中（等用户采用）' : category.enabled ? '' : '　已停用（不能再落新卡）'
    lines.push(`- ${category.id}　${categoryNameOf(category)}　${count} 张${retired}`)
    if (category.definition !== undefined) {
      lines.push(`  字段（落卡时 fields 按这些 key 填）：${category.definition.fields.map(fieldSignature).join('；')}`)
    }
    if (category.proposal !== undefined) lines.push('  有一版类型提议等用户确认（canvas_read_type 查看）')
  }
  const names = new Map(board.categories.map(category => [category.id, categoryNameOf(category)]))
  const definitions = new Map(board.categories.map(category => [category.id, category.definition]))
  const cards = board.cards.filter(card =>
    (options.includeArchived || card.status !== 'archived')
    && (options.kind === undefined || card.kind === options.kind))
  const archived = options.includeArchived
    ? 0
    : board.cards.filter(card => card.status === 'archived' && (options.kind === undefined || card.kind === options.kind)).length
  lines.push(`卡片（${cards.length} 张${archived > 0 ? `，另有 ${archived} 张已归档未列出` : ''}）：`)
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

  const readBoard = defineTool({
    name: 'canvas_read_board',
    description:
      'Read the open canvas: its category catalog (each category\'s id, name, card count, retired or not) and its card list (id, category, status, title). '
      + 'Categories belong to each canvas — the user may have renamed them or made their own ("Character", "World"), so read once before filing a card or whenever the user names a category, to get its id. '
      + 'kind narrows the list to one category; archived cards are counted, not listed, by default. When a title is not enough to go on, ask the user to quote the card. '
      + 'Acts on the canvas open in the right sidebar\'s Canvas tab; with none open it says so — never guess one.',
    parameters: {
      kind: { type: 'string', description: 'List only this category id\'s cards; omit for all.' },
      includeArchived: { type: 'boolean', description: 'Also list archived cards; default false.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: async (args: { kind?: string; includeArchived?: boolean }, exec: { agent?: Agent }): Promise<string> => {
      const resolved = target(exec)
      if ('message' in resolved) return resolved.message
      const read = await board.readBoard({ canvasId: resolved.canvasId })
      if (!read.ok) return renderOutcome({ ok: false, error: read.error })
      return renderBoard(read.board, {
        ...(args.kind === undefined ? {} : { kind: args.kind }),
        includeArchived: args.includeArchived === true,
      })
    },
  })

  const propose = defineTool({
    name: 'canvas_propose_card',
    description:
      'Propose a new card on the open canvas: it lands as proposed, and only the user\'s ✓ keeps it (✗ archives it). '
      + 'Sources, questions, shared understandings, counter-examples and examples all go here — never paste a card\'s text into the reply as if it were on the board. '
      + 'Built-in kinds: fragment, question, grounding (proposal only; it counts once the user restates it), reference (always with source), document. '
      + 'Canvases often carry renamed or user-made categories (ids like cat_…): when the user names a category that is not one of the five, read its id with canvas_read_board first instead of filing it under fragment. '
      + 'For a category with a field definition (canvas_read_board lists it), put structured values in fields by key and the prose in text; a ref field takes card ids or a card\'s exact name. A value that breaks the definition is reported field by field. '
      + 'comment is one line on why, attached to the card as your comment. '
      + 'Acts on the canvas open in the right sidebar\'s Canvas tab; with none open it says so — never guess one.',
    parameters: {
      kind: {
        type: 'string',
        // Open on purpose: this definition is registered once at boot, before
        // any canvas is open, so an enum could only ever advertise the five
        // built-ins — and a closed one refuses a custom category the model
        // just read off the board. The store checks the id against the focused
        // board, and a miss answers with that board's valid ids.
        required: true,
        description: 'Category id: one of the five built-ins, or a user-made id (cat_…) read with canvas_read_board.',
      },
      text: { type: 'string', description: 'Card text (small and concrete); may be omitted when fields are given.' },
      fields: {
        type: 'object',
        additionalProperties: true,
        description: 'Structured values (key → value), only for a category with a field definition; keys and types are in canvas_read_board.',
      },
      source: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['url', 'file', 'paste'], required: true, description: 'Source type.' },
          ref: { type: 'string', required: true, description: 'Source reference (url, absolute path, or a note on the paste).' },
          title: { type: 'string', description: 'Source title (page title, file name).' },
        },
        additionalProperties: false,
        description: 'Where the card comes from; required for reference cards.',
      },
      comment: { type: 'string', description: 'Why you propose it (attached to the card as your comment).' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: async (
      args: { kind: string; text?: string; fields?: Record<string, unknown>; source?: BoardCardSource; comment?: string },
      exec: { agent?: Agent },
    ): Promise<string> => {
      const resolved = target(exec)
      if ('message' in resolved) return resolved.message
      const text = args.text ?? ''
      let fields: Record<string, FieldValue> | undefined
      if (args.fields !== undefined && Object.keys(args.fields).length > 0) {
        const read = await board.readBoard({ canvasId: resolved.canvasId })
        if (!read.ok) return renderOutcome({ ok: false, error: read.error })
        const category = read.board.categories.find(candidate => candidate.id === args.kind)
        if (category?.definition === undefined) {
          return `失败：分类「${category === undefined ? args.kind : categoryNameOf(category)}」没有字段定义，不能填 fields——把内容写进 text。`
        }
        const check = checkFieldValues(category.definition, args.fields, refResolverOf(read.board))
        if (!check.ok) return `失败：字段不合「${categoryNameOf(category)}」的定义——\n${check.problems.map(problem => `- ${problem}`).join('\n')}`
        fields = check.values
      }
      if (text.trim().length === 0 && fields === undefined) return '失败：text 和 fields 至少要有一样。'
      const outcome = await board.proposeCard({
        canvasId: resolved.canvasId,
        kind: args.kind as CardCategoryId,
        text,
        ...(fields === undefined ? {} : { fields }),
        ...(args.source === undefined ? {} : { source: args.source }),
        ...(args.comment === undefined ? {} : { comment: args.comment }),
      }, resolved.session)
      if (!outcome.ok && outcome.error === 'invalid-name') {
        const read = await board.readBoard({ canvasId: resolved.canvasId })
        if (read.ok) {
          const category = read.board.categories.find(candidate => candidate.id === args.kind)
          const why = category === undefined
            ? `这块画布没有 id 为「${args.kind}」的分类`
            : `分类「${categoryNameOf(category)}」已停用`
          return `失败：${why}。可用的 kind：${enabledKinds(read.board)}。`
            + (isBoardCardKind(args.kind) || category !== undefined ? '' : '用户说的是分类名的话，从这里挑对应的 id。')
        }
      }
      if (!outcome.ok) return renderOutcome({ ok: false, error: outcome.error })
      const card = outcome.board.cards[outcome.board.cards.length - 1]
      return renderOutcome({ ok: true, cardId: card?.id })
    },
  })

  const comment = defineTool({
    name: 'canvas_comment',
    description:
      'Attach your comment to one card on the open canvas: name a hidden assumption or tension and end on one pointed question. '
      + 'It shows on the board and in the card page; commenting on a question card moves it from open to exploring. '
      + 'cardId comes from the board or from canvas_propose_card\'s answer. '
      + 'Acts on the canvas open in the right sidebar\'s Canvas tab; with none open it says so — never guess one.',
    parameters: {
      cardId: { type: 'string', required: true, description: 'The card\'s id.' },
      text: { type: 'string', required: true, description: 'Comment text (an assumption or tension, ending on a question).' },
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

  const readType = defineTool({
    name: 'canvas_read_type',
    description:
      'Read one category\'s type on the open canvas: the user\'s brief (words, plus sketches and pasted images — attached when the model can see images), the adopted field definition, any proposal awaiting the user, and a few sample cards. '
      + 'When the user asks you to design or adjust a kind of card ("what fields should a character card have"), read this first, then submit a definition with canvas_propose_type.',
    parameters: {
      kind: { type: 'string', required: true, description: 'Category id (from canvas_read_board).' },
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
      args: { kind: string },
      exec: { agent?: Agent; signal?: AbortSignal },
    ): Promise<{ text: string; images: CanvasImageRef[] }> => {
      const resolved = target(exec)
      if ('message' in resolved) return { text: resolved.message, images: [] }
      const read = await board.readBoard({ canvasId: resolved.canvasId })
      if (!read.ok) return { text: renderOutcome({ ok: false, error: read.error }), images: [] }
      const category = read.board.categories.find(candidate => candidate.id === args.kind)
      if (category === undefined) {
        return { text: `失败：这块画布没有 id 为「${args.kind}」的分类。可用的：${read.board.categories.map(row => `${row.id}（${categoryNameOf(row)}）`).join('、')}。`, images: [] }
      }
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
      const samples = read.board.cards.filter(card => card.kind === category.id && card.status !== 'archived').slice(0, MAX_TYPE_SAMPLES)
      lines.push('', `样例卡（${samples.length} 张）：`)
      const definitions = new Map(read.board.categories.map(row => [row.id, row.definition]))
      const nameOf = (id: string): string => {
        const card = read.board.cards.find(candidate => candidate.id === id)
        return card === undefined ? id : cardNameOf(card, definitions.get(card.kind)) || id
      }
      for (const card of samples) {
        lines.push(`- ${card.id}　${cardNameOf(card, category.definition) || '（无文字）'}`)
        for (const [key, value] of Object.entries(card.fields ?? {})) lines.push(`    ${key}: ${fieldValueText(value, nameOf)}`)
      }
      return { text: lines.join('\n'), images }
    },
  })

  const proposeType = defineTool({
    name: 'canvas_propose_type',
    description:
      'Submit a type definition for one category on the open canvas: its fields and the face its cards wear. '
      + 'It does not take effect by itself — it waits on the category\'s type page until the user previews it and adopts it; submitting again replaces the one still pending. '
      + 'Read the brief and the existing cards with canvas_read_type first. Give kind to change an existing category; give label (and no kind) to create one. '
      + 'Each definition.fields item: key (starts lowercase, a-z0-9_), label (display name), type (line / text / select with options / tags / ref to other cards, optionally limited by refKind / number), hint (what goes in the field, one sentence, required), '
      + 'required, face (shown on the card face, at most 3). The first required line field is the card\'s name. '
      + 'definition.layout: note (default) / profile (name + face fields) / entry (name + a one-line summary). definition.example holds one sample card\'s values — it is what the user sees in the preview. '
      + 'To rename existing fields use renames (old key → new key); on adoption existing cards\' values move with them. rationale says in a sentence or two why this design. '
      + 'summary says in one sentence what this version changes (for a first version, the layout and fields); request restates in one sentence what the user asked for this round ("per the brief" when nothing was asked) — '
      + 'both are shown to the user first and recorded in the type page\'s revision log on adoption.',
    parameters: {
      kind: { type: 'string', description: 'Category id to change; omit when creating one, and give label instead.' },
      label: { type: 'string', description: 'Name of a new category (e.g. "Character"); ignored when kind is given.' },
      definition: {
        type: 'object',
        required: true,
        additionalProperties: true,
        description: 'Type definition: { fields: [...], layout, guide?, example }.',
      },
      rationale: { type: 'string', required: true, description: 'Why this design (a sentence or two).' },
      renames: { type: 'object', additionalProperties: true, description: 'Field renames: old key → new key.' },
      summary: { type: 'string', description: 'What this version changes, one sentence (e.g. "added danger level, shown on the face").' },
      request: { type: 'string', description: 'What the user asked for this round, restated in one sentence.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: async (
      args: { kind?: string; label?: string; definition: unknown; rationale: string; renames?: unknown; summary?: string; request?: string },
      exec: { agent?: Agent },
    ): Promise<string> => {
      const resolved = target(exec)
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
      if (outcome.error === 'missing') return `失败：这块画布没有 id 为「${args.kind ?? ''}」的分类。先用 canvas_read_board 读出 id。`
      return renderOutcome({ ok: false, error: outcome.error })
    },
  })

  const readManuscript = defineTool({
    name: 'canvas_read_manuscript',
    description:
      'Read the open canvas\'s manuscripts. Without manuscriptId: list them all (id, title, version, status). '
      + 'With manuscriptId: the full body, its current version, and the cards it used / left out. '
      + 'Always read before revising, and pass the version as canvas_write_manuscript\'s baseVersion.',
    parameters: {
      manuscriptId: { type: 'string', description: 'Manuscript id (ms_…); omit to list them all.' },
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
      'Put a manuscript on the open canvas (its Manuscripts face: the user reads, edits and exports it there) instead of pasting it into the reply. '
      + 'New: omit manuscriptId and give body (Markdown; the first heading becomes the title, or give title). '
      + 'Revise: give manuscriptId and baseVersion (the version canvas_read_manuscript returned); body is the whole revised text. '
      + 'A version mismatch means the user or someone else just edited it — do not force it; re-read and revise again. '
      + 'sources marks the card ids this version used and deliberately left unused; on a revision, given replaces them whole, omitted keeps them. '
      + 'Acts on the canvas open in the right sidebar\'s Canvas tab; with none open it says so — never guess one.',
    parameters: {
      manuscriptId: { type: 'string', description: 'Manuscript id to revise; omit for a new one.' },
      title: { type: 'string', description: 'Title; defaults to the body\'s first heading.' },
      body: { type: 'string', required: true, description: 'The whole manuscript (Markdown).' },
      baseVersion: { type: 'number', description: 'The version this revision is based on (from canvas_read_manuscript); required when revising.' },
      sources: {
        type: 'object',
        properties: {
          used: { type: 'array', items: { type: 'string' }, description: 'Card ids this version used.' },
          unused: { type: 'array', items: { type: 'string' }, description: 'Card ids read but deliberately left out.' },
        },
        additionalProperties: false,
        description: 'Which cards were used and which left out.',
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

  return [
    tagOrigin(readBoard), tagOrigin(propose), tagOrigin(comment),
    tagOrigin(readType), tagOrigin(proposeType),
    tagOrigin(readManuscript), tagOrigin(writeManuscript),
  ]
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
