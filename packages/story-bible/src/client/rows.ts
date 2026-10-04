/**
 * The toolview row models: what one settled story_write / story_extract
 * answer says, read from the call's OWN settled text (the canvas
 * propose-row precedent — a row for a call made days ago still parses).
 * The host's keyed `tool.call.toolview` slot is declared by
 * `@deepseek-ai/dsh-client-ui-tool`, which this package does not depend on,
 * so the block's shape is read structurally.
 *
 * @module @khorsheed/dsh-story-bible/client
 */

/** The owner props of the host's keyed tool slot this row reads, structurally. */
export interface StoryToolBlock {
  /** Settled form only. */
  kind?: string
  content?: ReadonlyArray<{ type: string; text?: string }>
  isError?: boolean
}

/** The story_write row's model. */
export interface StoryWriteRowModel {
  /** `chapter-plan` — a chapter with plan awaits confirmation; `plain` — anything else. */
  state: 'running' | 'failed' | 'chapter-plan' | 'plain'
  n: number | null
  title: string | null
  text: string
}

/** The story_extract row's model. */
export interface StoryExtractRowModel {
  state: 'running' | 'failed' | 'refused' | 'prepared' | 'imported'
  n: number | null
  verified: number
  missed: number
  auto: number
  pending: number
  text: string
}

/** The settled text of one block ('' while running). */
function settledTextOf(block: StoryToolBlock | null | undefined, phase?: string): { settled: boolean; error: boolean; text: string } {
  const settled = block?.kind === 'tool-result' || (phase === 'result' && block !== null && block !== undefined)
  if (!settled) return { settled: false, error: false, text: '' }
  const text = (block?.content ?? [])
    .map(part => (part.type === 'text' ? part.text ?? '' : ''))
    .join('')
    .trim()
  return { settled: true, error: block?.isError === true, text }
}

/** `已登记第 7 章《回响》plan：…` / `已建第 7 章《回响》（…` — the chapter answers' stable heads (tools.ts). */
const CHAPTER_ANSWER = /^已(?:登记|建)第 (\d+) 章《([^》]+)》(plan)?/

/**
 * Read one story_write block. The plan card is earned only by the chapter
 * answer that carries a plan; every other answer renders as its first line.
 * @param block - the slot's `block` prop.
 * @param phase - the slot's `phase` prop (absent on some host lines).
 */
export function storyWriteRowModel(block: StoryToolBlock | null | undefined, phase?: string): StoryWriteRowModel {
  const { settled, error, text } = settledTextOf(block, phase)
  if (!settled) return { state: 'running', n: null, title: null, text: '' }
  const line = text.split('\n')[0] ?? ''
  if (error || line.startsWith('失败')) return { state: 'failed', n: null, title: null, text: line }
  const match = CHAPTER_ANSWER.exec(line)
  if (match !== null) {
    const n = Number(match[1])
    return {
      state: match[3] === 'plan' ? 'chapter-plan' : 'plain',
      n: Number.isFinite(n) ? n : null,
      title: match[2] ?? null,
      text: line,
    }
  }
  return { state: 'plain', n: null, title: null, text: line }
}

const IMPORT_ANSWER = /^计划命中 ✓×(\d+) \/ 计划落空 ×(\d+) \/ 自动入库 ×(\d+) \/ 待你确认 ×(\d+)/
const PREPARE_ANSWER = /^你是长篇小说的记忆对账员。输入是第(\d+)章正文/

/**
 * Read one story_extract block: the prepare pack (materials ready), the
 * import's reconciliation summary, or the review gate's refusal.
 * @param block - the slot's `block` prop.
 * @param phase - the slot's `phase` prop (absent on some host lines).
 */
export function storyExtractRowModel(block: StoryToolBlock | null | undefined, phase?: string): StoryExtractRowModel {
  const empty = { n: null, verified: 0, missed: 0, auto: 0, pending: 0 }
  const { settled, error, text } = settledTextOf(block, phase)
  if (!settled) return { state: 'running', ...empty, text: '' }
  const line = text.split('\n')[0] ?? ''
  if (error) return { state: 'failed', ...empty, text: line }
  if (line.startsWith('这章还没有被用户') || line.startsWith('失败')) return { state: 'refused', ...empty, text: line }
  const prepared = PREPARE_ANSWER.exec(line)
  if (prepared !== null) {
    const n = Number(prepared[1])
    return { state: 'prepared', ...empty, n: Number.isFinite(n) ? n : null, text: line }
  }
  const imported = IMPORT_ANSWER.exec(line)
  if (imported !== null) {
    return {
      state: 'imported',
      ...empty,
      verified: Number(imported[1]),
      missed: Number(imported[2]),
      auto: Number(imported[3]),
      pending: Number(imported[4]),
      text: line,
    }
  }
  return { state: 'failed', ...empty, text: line }
}
