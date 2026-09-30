/**
 * The `canvas_propose_type` tool row, as data: what one tool block says about
 * the proposal it placed, read from the call's OWN settled answer — so a row
 * for a proposal made days ago still opens the canvas that proposal went to,
 * whatever canvas the tab has open by then.
 *
 * The answer is the tool's success sentence (`tools.ts`), which names the
 * kind, the category and — since 0.6.0 — the canvas. An answer from before
 * that (no canvas in it) reads as `unreadable`: the row still says what
 * happened, it only offers no door.
 *
 * @module @khorsheed/dsh-canvas/client
 */

/**
 * The owner props of the host's keyed `tool.call.toolview` slot this row
 * reads, structurally (the slot is declared by `@deepseek-ai/dsh-client-ui-tool`,
 * which this package does not depend on). The two host lines differ in the
 * running form only; the settled `ToolResultNode` is the same on both.
 */
export interface ProposeToolBlock {
  /** Settled form only. */
  kind?: string
  content?: ReadonlyArray<{ type: string; text?: string }>
  isError?: boolean
}

/** What the row shows. */
export interface ProposeRowModel {
  /** `running` — no answer yet; `failed` — the tool answered an error; `unreadable` — an answer naming no canvas. */
  state: 'running' | 'failed' | 'unreadable' | 'ready'
  canvasId: string | null
  kind: string | null
  /** The category's name as the answer gave it; null when blank. */
  label: string | null
  /** The answer's text, for the failed and unreadable states. */
  text: string
}

const ANSWER = /^完成：(\S+?)（([^）]*)）的类型提议已放到类型页（画布 (canvas_[a-z0-9]+)）/

/**
 * Read one block.
 * @param block - the slot's `block` prop.
 * @param phase - the slot's `phase` prop (0.1.7 lines); absent on 0.1.5.
 */
export function proposeRowModel(block: ProposeToolBlock | null | undefined, phase?: string): ProposeRowModel {
  const settled = block?.kind === 'tool-result' || (phase === 'result' && block !== null && block !== undefined)
  const empty = { canvasId: null, kind: null, label: null }
  if (!settled) return { state: 'running', ...empty, text: '' }
  const text = (block?.content ?? [])
    .map(part => (part.type === 'text' ? part.text ?? '' : ''))
    .join('')
    .trim()
  if (block?.isError === true) return { state: 'failed', ...empty, text }
  const match = ANSWER.exec(text)
  if (match === null) return { state: 'unreadable', ...empty, text }
  return { state: 'ready', kind: match[1] ?? null, label: match[2]?.trim() || null, canvasId: match[3] ?? null, text }
}
