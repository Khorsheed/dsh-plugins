/**
 * The `novel_write` tool row, as data: what one tool block says, read from
 * the call's OWN settled answer — so a card for a chapter planned days ago
 * still opens the canvas that chapter lives in, whatever canvas the tab shows
 * by then.
 *
 * A chapter answer (`tools.ts`) names the chapter and the canvas:
 * `已登记第 7 章《回响》（画布 canvas_x）plan：走向 4 拍 / 伏笔 2 条 / 出场 3 人。…`
 * or, without a plan, `已建第 7 章《回响》（画布 canvas_x · 规划中 · …）。`.
 * An outline proposal names its canvas: `已提交大纲提议（画布 canvas_x），…`.
 * Every other answer (a review) is a plain line. A note may come first (the
 * workspace a body attached), so the chapter line is looked for on any line.
 *
 * @module @khorsheed/dsh-canvas-novel/client
 */

/**
 * The owner props of the host's keyed `tool.call.toolview` slot this row
 * reads, structurally (the slot is declared by `@deepseek-ai/dsh-client-ui-tool`,
 * which this package does not depend on). The settled `ToolResultNode` is the
 * same on both host lines; only the running form differs.
 */
export interface NovelToolBlock {
  /** Settled form only. */
  kind?: string
  content?: ReadonlyArray<{ type: string; text?: string }>
  isError?: boolean
}

/** The chapter a chapter answer names. */
export interface WriteRowChapter {
  readonly canvasId: string
  readonly n: number
  readonly title: string
  /** The counts the answer gave; null for a chapter created without a plan. */
  readonly counts: { readonly beats: number; readonly ops: number; readonly cast: number } | null
}

/** What the row shows. */
export interface WriteRowModel {
  /** `running` — no answer yet; `failed` — an error answer; `line` — a plain answer; `chapter` — a chapter answer; `outline` — an outline proposal. */
  readonly state: 'running' | 'failed' | 'line' | 'chapter' | 'outline'
  readonly chapter: WriteRowChapter | null
  /** The canvas an outline proposal went to (`outline` only). */
  readonly canvasId?: string
  /** The answer's text. */
  readonly text: string
}

const CHAPTER = /^已(登记|建)第 (\d+) 章《(.*?)》（画布 ([^\s）·]+)/m
const OUTLINE = /^已提交大纲提议（画布 (canvas_[a-z0-9]+)）/m
const COUNTS = /走向 (\d+) 拍 \/ 伏笔 (\d+) 条 \/ 出场 (\d+) 人/

/**
 * Read one block.
 * @param block - the slot's `block` prop.
 * @param phase - the slot's `phase` prop (0.1.7 lines); absent on 0.1.5.
 */
export function writeRowModel(block: NovelToolBlock | null | undefined, phase?: string): WriteRowModel {
  const settled = block?.kind === 'tool-result' || (phase === 'result' && block !== null && block !== undefined)
  if (!settled) return { state: 'running', chapter: null, text: '' }
  const text = (block?.content ?? [])
    .map(part => (part.type === 'text' ? part.text ?? '' : ''))
    .join('')
    .trim()
  if (block?.isError === true || text.startsWith('失败：')) return { state: 'failed', chapter: null, text }
  const outline = OUTLINE.exec(text)
  if (outline !== null) return { state: 'outline', chapter: null, canvasId: outline[1]!, text }
  const match = CHAPTER.exec(text)
  if (match === null) return { state: 'line', chapter: null, text }
  const counts = match[1] === '登记' ? COUNTS.exec(text) : null
  return {
    state: 'chapter',
    chapter: {
      canvasId: match[4]!,
      n: Number(match[2]),
      title: match[3]!,
      counts: counts === null ? null : { beats: Number(counts[1]), ops: Number(counts[2]), cast: Number(counts[3]) },
    },
    text,
  }
}
