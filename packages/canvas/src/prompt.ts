/**
 * The canvas agent's system-prompt segment and the lens / compose prompt
 * templates — pure renderers, so the whole prompt contract is unit-tested
 * without an agent. The segment is handed to side-chat at every `openWith` (its
 * per-turn freshness contract re-reads the latest call), so it always
 * reflects the board as of the last ask: topic and goal, the board summary,
 * the tool contract, the lens semantics, the grounding guardrail, and the
 * stats feedback section (§4's visible rules, never a black box).
 *
 * @module @khorsheed/dsh-canvas
 */
import { cardTitleOf, detectCardFormat, plainTitleOf } from './card-format.ts'
import {
  DRAW_BOX, defaultCategories, enabledCategories, isBoardCardKind,
  type BoardCard, type BoardCategory, type BoardCardKind, type CanvasBoard, type CanvasLensId,
  type CardCategoryId, type CanvasStroke,
} from './types.ts'

/** The built-in categories' names as the model sees them (a label overrules one). */
export const BUILTIN_CATEGORY_NAMES: Record<BoardCardKind, string> = {
  fragment: '灵感',
  question: '问题',
  grounding: '共识',
  reference: '来源',
  document: '文档',
}

/** One category's model-facing name: what the user named it, else the built-in's. */
export function categoryNameOf(category: BoardCategory): string {
  if (category.label !== '') return category.label
  return isBoardCardKind(category.id) ? BUILTIN_CATEGORY_NAMES[category.id] : category.id
}

/**
 * The rows a board offers the model: the enabled catalog, or the built-in five
 * when the operator retired everything. A canvas with no category left still
 * has cards, and the tool's `kind` must stay a wire-legal enum — so the menu
 * and the enum floor are decided in ONE place (`kindEnum` calls this too),
 * which is what keeps the spelled menu from ever disagreeing with the enum.
 * @param categories - the board's catalog.
 * @returns the enabled rows, or the untouched defaults.
 */
export function menuCategoriesOf(categories: readonly BoardCategory[]): readonly BoardCategory[] {
  const enabled = enabledCategories(categories)
  return enabled.length === 0 ? defaultCategories() : enabled
}

/**
 * The enabled catalog spelled for the model: `id（名称）` pairs. This is the
 * dynamic half of the tool's `kind` enum — stage ⑤ moved the category set from
 * a compile-time five to a per-canvas list, so the menu is read off the board
 * the tools were built for.
 * @param categories - the board's catalog, any order.
 * @returns the comma-joined menu (never empty: see {@link menuCategoriesOf}).
 */
export function categoryMenuOf(categories: readonly BoardCategory[]): string {
  return menuCategoriesOf(categories).map(category => `${category.id}（${categoryNameOf(category)}）`).join('、')
}

/** Cap the kept-card title list in the board summary (a summary, not a dump). */
const MAX_SUMMARY_CARDS = 20
/** Cap one card's text as it appears inside the summary or a ref. */
const SUMMARY_TEXT_LENGTH = 60

/**
 * The tag on a card line the model reads: the enum word the model must pass
 * back, with the user's own name appended whenever the id alone would not say
 * it (a `cat_…` id is meaningless, and a renamed built-in would still read as
 * its old name). An untouched built-in is the bare id, so the default prompt is
 * byte for byte what it was before the catalog existed.
 */
export function categoryTagOf(category: BoardCategory | undefined, kind: CardCategoryId): string {
  if (category === undefined) return kind
  return category.label === '' && isBoardCardKind(category.id)
    ? category.id
    : `${category.id}（${categoryNameOf(category)}）`
}

/**
 * The board's catalog keyed by id, retired rows included: an archived card can
 * still be selected into a ref, and its line must name what it is filed under.
 * @param board - the canvas as of the render.
 * @returns id → row.
 */
export function categoryMapOf(board: CanvasBoard): Map<string, BoardCategory> {
  return new Map(board.categories.map(category => [category.id, category]))
}

/** A card's one-line summary for the prompt and for refs (kind-tagged, capped). */
function summaryOf(card: BoardCard, tag: string): string {
  // An HTML card's summary is its display title — never the markup's opener.
  const firstLine = detectCardFormat(card.text) === 'html'
    ? cardTitleOf(card.text)
    : (card.text.split('\n').find(line => line.trim().length > 0) ?? '')
  const capped = firstLine.length > SUMMARY_TEXT_LENGTH ? `${firstLine.slice(0, SUMMARY_TEXT_LENGTH)}…` : firstLine
  // A drawing-only card still has content — say what it holds, in words.
  const shown = capped.length > 0 || card.draw === undefined
    ? capped
    : `${card.draw.length}-stroke drawing`
  return `[${tag}] ${shown}`
}

/** Longest markdown card text handed to the model in one ref (the model-facing cap). */
export const MAX_PROMPT_CARD_CHARS = 4000

/**
 * Most comments of one card's thread handed to the model (the other half of the
 * card's model-facing budget). A thread is an argument, not an archive: eight
 * rows carry a normal card's whole exchange — one comment per lens pass, a few
 * rounds deep — while a 50-comment card cannot dump the board into the context.
 * Line length needs no matching cap: the store's read already clamps every
 * comment at MAX_COMMENT_TEXT_LENGTH, so counting rows is the whole job.
 */
export const MAX_PROMPT_COMMENTS = 8

/** One decimal place is plenty for a coordinate; the tail is payload. */
function tenths(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1)
}

/**
 * The drawing's model-facing form: the points themselves, in the logical box
 * (§11.4's "the drawing still rides the prompt"). A drawing is card CONTENT, so
 * the agent that reads a card reads its ink too — as coordinates it can reason
 * about, never as a raster it would have to be given separately.
 * @param draw - the card's strokes.
 * @returns the `<board>` block, or '' when there is nothing inked.
 */
export function drawPromptOf(draw: readonly CanvasStroke[]): string {
  if (draw.length === 0) return ''
  const points = draw
    .map(stroke => stroke.pts.map(p => `${tenths(p.x)},${tenths(p.y)},${tenths(p.w)}`).join(' '))
    .join('\n')
  return `\n<board width="${DRAW_BOX.width}" height="${DRAW_BOX.height}" strokes="${draw.length}">\n${points}\n</board>`
}

/**
 * The card's 批注 in the model-facing form: one `- author: text` row per
 * comment, in the thread's stored (chronological) order. The comment is the
 * part the model would otherwise never see — and 「生成文章」 tells it to
 * absorb the comments and drop the claim they overturn, so a thread that stayed
 * on the UI side would make that instruction a lie. When the thread is over
 * {@link MAX_PROMPT_COMMENTS} the OLDEST rows are dropped and the drop is
 * stated inside the block: an explicit truncation note is this file's voice, a
 * silent drop is not.
 * @param card - the card whose thread is rendered.
 * @returns the `<comments>` block, or '' when nobody has annotated it.
 */
export function commentPromptOf(card: BoardCard): string {
  const comments = card.comments
  if (comments.length === 0) return ''
  const shown = comments.length > MAX_PROMPT_COMMENTS ? comments.slice(-MAX_PROMPT_COMMENTS) : comments
  const lines = shown.map(comment => `- ${comment.author}: ${comment.text}`)
  if (shown.length < comments.length) {
    lines.unshift(`- …(truncated, ${comments.length} comments on card ${card.id}; newest ${shown.length} shown)`)
  }
  return `\n<comments>\n${lines.join('\n')}\n</comments>`
}

/**
 * The card's model-facing form: HTML cards are pointers, never the document
 * (the proposal §8 boundary — an HTML card's content never enters the model
 * context in full: the agent sees the title and a handle, and asks the user
 * for an excerpt when it needs one); markdown cards carry their text capped
 * with an explicit truncation note. A drawing is appended in either case —
 * it is never the part being pointed out. The comment thread is appended after
 * it, in every branch: the 批注 are the user's own words, not the document, so
 * an HTML pointer still carries them (else 「生成文章」 over an HTML card would
 * be silent).
 * @param card - the card to render for the model.
 * @returns the model-facing text (English frame, the card's own words inside).
 */
export function promptFormOf(card: BoardCard): string {
  const draw = card.draw === undefined ? '' : drawPromptOf(card.draw)
  const comments = commentPromptOf(card)
  const format = detectCardFormat(card.text)
  if (format === 'html') {
    const title = cardTitleOf(card.text)
    return `[html] ${title} — HTML document, ${card.text.length} chars, on canvas card ${card.id}; `
      + 'ask the user to paste an excerpt when its content is needed' + draw + comments
  }
  if (card.text.length > MAX_PROMPT_CARD_CHARS) {
    return `${card.text.slice(0, MAX_PROMPT_CARD_CHARS)}\n…(truncated, full text ${card.text.length} chars on card ${card.id})${draw}${comments}`
  }
  return `${card.text}${draw}${comments}`
}

/**
 * The ref one selected card becomes: an opaque `{ label, text }` chunk — the
 * chat context knows nothing about cards (§3's 选区即上下文 protocol). The
 * text rides {@link promptFormOf}: an HTML card is a pointer, a long markdown
 * card is capped with its truncation noted.
 * @param card - the selected card.
 * @param tag - the card's category tag, from {@link categoryTagOf}.
 * @returns the ref handed to the chat context.
 */
export function cardToRef(card: BoardCard, tag?: string): { label: string; text: string } {
  const format = detectCardFormat(card.text)
  const label = format === 'html'
    ? cardTitleOf(card.text)
    : (plainTitleOf(card.text) || card.kind)
  const cappedLabel = label.length > 36 ? `${label.slice(0, 36)}…` : label
  return { label: cappedLabel, text: `[${tag ?? card.kind}] ${promptFormOf(card)}` }
}

/** The stats feedback section (§4): visible only when the samples say so. */
function statsFeedback(board: CanvasBoard): string | undefined {
  const { accepted, rejected } = board.stats.proposed
  const total = accepted + rejected
  if (total < 5) return undefined
  if (accepted / total >= 0.3) return undefined
  return `近期 ${total} 次提议里用户只收下 ${accepted} 次。收紧提议：先给一句话摘要，确有价值再提议；评论优先于提议。`
}

/**
 * Render the canvas agent's system-prompt segment for one `openWith` call.
 * @param board - the canvas as of the ask.
 * @param lens - the lens the user came through, when one is active.
 * @returns the segment text (side-chat prepends its own orientation section).
 */
export function renderCanvasPrompt(board: CanvasBoard, lens?: CanvasLensId): string {
  const sections: string[] = []
  sections.push(
    `你是画布「${board.title}」的主题 Agent。用户围绕这个主题积累灵感、问题、共识与来源，`
    + '你的工作是把思考一步步推深：指出假设与张力、追问、找证据，最终帮助用户成稿。',
  )

  const visible = board.cards.filter(card => card.status !== 'archived')
  const kept = visible.filter(card => card.status === 'kept')
  const proposedCount = visible.length - kept.length
  const categories = categoryMapOf(board)
  const tagOf = (card: BoardCard): string => categoryTagOf(categories.get(card.kind), card.kind)
  // The catalog owns the menu, so it owns the count line too: a custom category
  // is counted under its own name, and a retired one shows nothing (no chips,
  // and its cards have left the visible set). It rides the SAME tag as the card
  // lines below — the count counts those lines, so the two must spell the
  // category with one token (and an untouched built-in stays the bare id).
  const counts = enabledCategories(board.categories)
    .flatMap(category => {
      const count = board.stats.kindCounts[category.id] ?? 0
      return count === 0 ? [] : [`${categoryTagOf(category, category.id)} ${count}`]
    })
    .join('、')
  const openQuestions = kept.flatMap(card =>
    card.kind === 'question' && card.question !== undefined && card.question.state !== 'answered'
      ? [`- （${card.question.state === 'exploring' ? '探索中' : '待探索'}）${summaryOf(card, tagOf(card))}`]
      : [])
  const summaryLines = [
    `板上现有 ${visible.length} 张可见卡（${counts === '' ? '尚无内容' : counts}）${proposedCount === 0 ? '' : `，其中 ${proposedCount} 张是你提议待确认的`}。`,
    ...kept.slice(0, MAX_SUMMARY_CARDS).map(card => `- ${summaryOf(card, tagOf(card))}`),
    ...openQuestions.length === 0 ? [] : ['未决问题：', ...openQuestions],
  ]
  sections.push(`当前卡片板：\n${summaryLines.join('\n')}`)

  const grounding = kept.filter(card => card.kind === 'grounding')
  if (grounding.length > 0) {
    // The guardrail names the category as the user named it — renaming 「共识」
    // must not silently unname the rule that protects it.
    const row = categories.get('grounding')
    sections.push(
      `以下「${row === undefined ? '共识' : categoryNameOf(row)}」是用户确认过的既定立场，不可违背；质疑它时必须先与用户确认：\n`
      + grounding.map(card => `- ${promptFormOf(card)}`).join('\n'),
    )
  }

  sections.push(
    '工具契约：提议新卡一律调用 canvas_propose_card（它以 proposed 落板，用户 ✓/✗ 决定去留），'
    + '评论一律调用 canvas_comment——评论指出一个隐含假设或张力，并以一个尖锐问题收尾。'
    + '绝不在回复正文里贴卡片全文冒充落板。'
    + (board.cards.some(card => card.kind === 'question' && card.status !== 'archived')
      ? '对问题卡的评论会把它从「待探索」推进到「探索中」；「已有初步回答」永远由用户沉淀，你不能自封答案。'
      : ''),
  )

  sections.push(
    '透镜语义（用户选中卡后的一组动作，产物都经工具落回板上）：挑战假设 / 找反例 / 找证据 / 追问原因 / '
    + '换个视角 / 升一层（抽象）/ 降一层（举例）/ 就此提问。'
    + (lens === undefined || lens === 'ask' ? '' : `本次用户正通过「${CANVAS_LENS_LABELS[lens]}」透镜提问。`),
  )

  const feedback = statsFeedback(board)
  if (feedback !== undefined) sections.push(feedback)
  return sections.join('\n\n')
}

/** The lens labels (the lens bar's own words; the dictionaries own the UI copy). */
export const CANVAS_LENS_LABELS: Record<CanvasLensId, string> = {
  challenge: '挑战假设',
  counterexample: '找反例',
  evidence: '找证据',
  why: '追问原因',
  perspective: '换个视角',
  abstract: '升一层',
  exemplify: '降一层',
  ask: '就此提问',
}

/**
 * The message one lens auto-sends (its 预置 prompt 模板), or undefined for
 * `ask` — that lens primes the context and lets the user type the question.
 * @param lens - the lens the user picked.
 * @returns the text to send, or undefined.
 */
export function lensSendText(lens: CanvasLensId | undefined): string | undefined {
  switch (lens) {
    case 'challenge':
      return '【挑战假设】针对上下文里的卡片：指出其中最脆弱的隐含假设，逐条用 canvas_comment 挂到对应卡上，每条以一个尖锐问题收尾。'
    case 'counterexample':
      return '【找反例】针对上下文里的卡片：寻找与它们相矛盾的反例或边界情形，用 canvas_propose_card 落成提议卡（注明是反例），并用 canvas_comment 在相关卡上说明它威胁了哪条论断。'
    case 'evidence':
      return '【找证据】针对上下文里的卡片：为它们的论点寻找支撑证据（研究、数据、案例），用 canvas_propose_card 落成 reference 提议卡并写明出处；先给一句话摘要再逐条提议。'
    case 'why':
      return '【追问原因】针对上下文里的卡片：往深追问一层「为什么会是这样」，把值得回答的新问题用 canvas_propose_card 落成 question 提议卡，并用 canvas_comment 说明它与原卡的关系。'
    case 'perspective':
      return '【换个视角】针对上下文里的卡片：换一个利益相关者或学科视角重述同一件事，用 canvas_propose_card 落成灵感提议卡，并用 canvas_comment 指出新视角改变了什么。'
    case 'abstract':
      return '【升一层】针对上下文里的卡片：把具体观察抽象成更一般的论断或机制，用 canvas_propose_card 落成提议卡；若涉及共同认识（grounding），只能提议，由用户复述确认后才算数。'
    case 'exemplify':
      return '【降一层】针对上下文里的卡片：给出具体、可感的例子或场景，用 canvas_propose_card 落成灵感提议卡。'
    default:
      return undefined
  }
}

/**
 * 「生成文章」's send-text (the compose gesture on the batch bar and a card's
 * detail page). Like {@link lensSendText} this is the model's instruction, not
 * UI copy — the dictionaries own the button label — and the caller sends it as
 * the `text` of an ordinary ask. Its promise about 批注 is kept by
 * {@link promptFormOf}, which hangs the comment thread on the card.
 */
export const COMPOSE_SEND_TEXT = '【生成文章】以这些卡片为材料写一篇成稿：保留卡片里的判断，把批注当作修改意见吸收进正文，被批注推翻的那条不要再写；结构自己定；末尾列出哪些卡片没有用到。'

/**
 * 「就这一组提问」's send-text (the link view's bottom bar, over the cards one
 * link cluster joins). Model-facing instruction, not UI copy — same reasoning as
 * {@link COMPOSE_SEND_TEXT}, and the same ask-style send.
 */
export const GROUP_ASK_SEND_TEXT = '【就这一组提问】这几张卡已被连线连成一簇：把它们当作同一论证的几段，指出这条链断在哪一步，并提议一张能把它们接起来的卡。'
