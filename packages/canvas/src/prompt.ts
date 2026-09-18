/**
 * The canvas agent's system-prompt segment and the lens prompt templates —
 * pure renderers, so the whole prompt contract is unit-tested without an
 * agent. The segment is handed to side-chat at every `openWith` (its
 * per-turn freshness contract re-reads the latest call), so it always
 * reflects the board as of the last ask: topic and goal, the board summary,
 * the tool contract, the lens semantics, the grounding guardrail, and the
 * stats feedback section (§4's visible rules, never a black box).
 *
 * @module @khorsheed/dsh-canvas
 */
import { detectCardFormat, htmlTitleOf } from './card-format.ts'
import {
  BOARD_CARD_KINDS, type BoardCard, type CanvasBoard, type CanvasLensId,
} from './types.ts'

/** Cap the kept-card title list in the board summary (a summary, not a dump). */
const MAX_SUMMARY_CARDS = 20
/** Cap one card's text as it appears inside the summary or a ref. */
const SUMMARY_TEXT_LENGTH = 60

/** A card's one-line summary for the prompt and for refs (kind-tagged, capped). */
function summaryOf(card: BoardCard): string {
  // An HTML card's summary is its display title — never the markup's opener.
  const firstLine = detectCardFormat(card.text) === 'html'
    ? displayTitleOf(card)
    : (card.text.split('\n').find(line => line.trim().length > 0) ?? '')
  const capped = firstLine.length > SUMMARY_TEXT_LENGTH ? `${firstLine.slice(0, SUMMARY_TEXT_LENGTH)}…` : firstLine
  return `[${card.kind}] ${capped}`
}

/** Strip tags from a first line (the HTML fallback title's plain text). */
function plainFirstLine(text: string): string {
  const firstLine = text.split('\n').find(line => line.trim().length > 0) ?? ''
  const stripped = firstLine.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
  return stripped === '' ? firstLine : stripped
}

/**
 * A card's display title for the prompt: the HTML `<title>`, else the first
 * line with any tags stripped (a one-line HTML document's first line IS the
 * markup — truncating markup would still leak markup).
 */
function displayTitleOf(card: BoardCard): string {
  return htmlTitleOf(card.text) ?? plainFirstLine(card.text).slice(0, 36)
}

/** Longest markdown card text handed to the model in one ref (the model-facing cap). */
export const MAX_PROMPT_CARD_CHARS = 4000

/**
 * The card's model-facing form: HTML cards are pointers, never the document
 * (the proposal §8 boundary — an HTML card's content never enters the model
 * context in full: the agent sees the title and a handle, and asks the user
 * for an excerpt when it needs one); markdown cards carry their text capped
 * with an explicit truncation note.
 * @param card - the card to render for the model.
 * @returns the model-facing text (English, the model's own language).
 */
export function promptFormOf(card: BoardCard): string {
  const format = detectCardFormat(card.text)
  if (format === 'html') {
    const title = displayTitleOf(card)
    return `[html] ${title} — HTML document, ${card.text.length} chars, on canvas card ${card.id}; `
      + 'ask the user to paste an excerpt when its content is needed'
  }
  if (card.text.length > MAX_PROMPT_CARD_CHARS) {
    return `${card.text.slice(0, MAX_PROMPT_CARD_CHARS)}\n…(truncated, full text ${card.text.length} chars on card ${card.id})`
  }
  return card.text
}

/**
 * The ref one selected card becomes: an opaque `{ label, text }` chunk — the
 * chat context knows nothing about cards (§3's 选区即上下文 protocol). The
 * text rides {@link promptFormOf}: an HTML card is a pointer, a long markdown
 * card is capped with its truncation noted.
 * @param card - the selected card.
 * @returns the ref handed to the chat context.
 */
export function cardToRef(card: BoardCard): { label: string; text: string } {
  const format = detectCardFormat(card.text)
  const label = format === 'html'
    ? displayTitleOf(card)
    : (plainFirstLine(card.text) || card.kind)
  const cappedLabel = label.length > 36 ? `${label.slice(0, 36)}…` : label
  return { label: cappedLabel, text: `[${card.kind}] ${promptFormOf(card)}` }
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
    `你是画布「${board.title}」的主题 Agent。用户围绕这个主题积累碎片、问题、依据（共同认识）与资料，`
    + '你的工作是把思考一步步推深：指出假设与张力、追问、找证据，最终帮助用户成稿。',
  )

  const visible = board.cards.filter(card => card.status !== 'archived')
  const kept = visible.filter(card => card.status === 'kept')
  const proposedCount = visible.length - kept.length
  const counts = BOARD_CARD_KINDS
    .flatMap(kind => {
      const count = board.stats.kindCounts[kind] ?? 0
      return count === 0 ? [] : [`${kind} ${count}`]
    })
    .join('、')
  const openQuestions = kept.flatMap(card =>
    card.kind === 'question' && card.question !== undefined && card.question.state !== 'answered'
      ? [`- （${card.question.state === 'exploring' ? '探索中' : '待探索'}）${summaryOf(card)}`]
      : [])
  const summaryLines = [
    `板上现有 ${visible.length} 张可见卡（${counts === '' ? '尚无内容' : counts}）${proposedCount === 0 ? '' : `，其中 ${proposedCount} 张是你提议待确认的`}。`,
    ...kept.slice(0, MAX_SUMMARY_CARDS).map(card => `- ${summaryOf(card)}`),
    ...openQuestions.length === 0 ? [] : ['未决问题：', ...openQuestions],
  ]
  sections.push(`当前卡片板：\n${summaryLines.join('\n')}`)

  const grounding = kept.filter(card => card.kind === 'grounding')
  if (grounding.length > 0) {
    sections.push(
      '以下「依据」是用户确认过的共同认识，不可违背；质疑它时必须先与用户确认：\n'
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
      return '【换个视角】针对上下文里的卡片：换一个利益相关者或学科视角重述同一件事，用 canvas_propose_card 落成碎片提议卡，并用 canvas_comment 指出新视角改变了什么。'
    case 'abstract':
      return '【升一层】针对上下文里的卡片：把具体观察抽象成更一般的论断或机制，用 canvas_propose_card 落成提议卡；若涉及共同认识（grounding），只能提议，由用户复述确认后才算数。'
    case 'exemplify':
      return '【降一层】针对上下文里的卡片：给出具体、可感的例子或场景，用 canvas_propose_card 落成碎片提议卡。'
    default:
      return undefined
  }
}
