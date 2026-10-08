/**
 * The `canvas_open` tool row, as data: which canvas one call switched the
 * session to, read from the call's OWN settled answer — so a row from days ago
 * still opens the canvas it chose, whatever the tab shows by then.
 *
 * The answer is the tool's success sentence (`tools.ts`): `完成：已新建画布《…》（canvas_…）`
 * or `完成：已切到画布《…》（canvas_…）`. A listing, a question back or a
 * failure names no switch, and reads as `listed` (no door).
 *
 * @module @khorsheed/dsh-canvas/client
 */
import type { ProposeToolBlock } from '../type/propose-row.ts'

/** What the row shows. */
export interface OpenRowModel {
  /** `running` — no answer yet; `failed` — the tool answered an error; `listed` — an answer that switched nothing. */
  state: 'running' | 'failed' | 'listed' | 'created' | 'switched'
  canvasId: string | null
  title: string | null
  /** The answer's text, for the failed and listed states. */
  text: string
}

const ANSWER = /^完成：已(新建|切到)画布《(.*?)》（(canvas_[a-z0-9]+)）/

/**
 * Read one block.
 * @param block - the slot's `block` prop.
 * @param phase - the slot's `phase` prop (0.1.7 lines); absent on 0.1.5.
 */
export function openRowModel(block: ProposeToolBlock | null | undefined, phase?: string): OpenRowModel {
  const settled = block?.kind === 'tool-result' || (phase === 'result' && block !== null && block !== undefined)
  const empty = { canvasId: null, title: null }
  if (!settled) return { state: 'running', ...empty, text: '' }
  const text = (block?.content ?? [])
    .map(part => (part.type === 'text' ? part.text ?? '' : ''))
    .join('')
    .trim()
  if (block?.isError === true || text.startsWith('失败：')) return { state: 'failed', ...empty, text }
  const match = ANSWER.exec(text)
  if (match === null) return { state: 'listed', ...empty, text }
  return { state: match[1] === '新建' ? 'created' : 'switched', title: match[2] ?? null, canvasId: match[3] ?? null, text }
}
