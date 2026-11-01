/**
 * The row that replaces the generic `reader_note` / `reader_translate` tool row
 * in the conversation: what was written into the reader, and one door —
 * 查看 → — to the article, on its notes or its text.
 *
 * Doors only: the reader never moves the sidebar by itself (user decision
 * 2026-10-30, proposal agent-sidebar-navigation). The place is the answer's
 * destination line, read through the shared reader of
 * `@khorsheed/dsh-client-ui-agent-nav`; an answer from before the line (or a
 * failure) has no door.
 *
 * @module @khorsheed/dsh-reader/client
 */
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { readDestinations, stripDestinations } from '@khorsheed/dsh-client-ui-agent-nav/src/client/index.ts'
import { READER_KIND } from './definition.tsx'
import type { ReaderNavParams } from '../nav-line.ts'
import type {} from './locales.ts'
import css from './WriteToolRow.module.css'

/** The settled tool block the keyed `tool.call.toolview` slot hands a row (structural). */
export interface ReaderToolBlock {
  /** Settled form only. */
  readonly kind?: string
  readonly content?: ReadonlyArray<{ readonly type: string; readonly text?: string }>
  readonly isError?: boolean
}

/** What the row reaches outside its own block. */
export interface ReaderWriteRowFace {
  /** Open the reader tab at one place. */
  readonly go: (params: ReaderNavParams) => void
}

/** The props the keyed tool slot composes for this row. */
export interface ReaderWriteRowProps extends ReaderWriteRowFace {
  readonly block: ReaderToolBlock | null | undefined
  readonly phase?: string
  readonly t: TranslateNS<'reader'>
}

/** What one block says: running, failed, or the answer and its place. */
export function writeRowModel(block: ReaderToolBlock | null | undefined, phase?: string): {
  readonly state: 'running' | 'failed' | 'done'
  readonly text: string
  readonly place?: ReaderNavParams
} {
  const settled = block?.kind === 'tool-result' || (phase === 'result' && block !== null && block !== undefined)
  if (!settled) return { state: 'running', text: '' }
  const content = block?.content ?? []
  const text = stripDestinations(content.map(part => (part.type === 'text' ? part.text ?? '' : '')).join('\n')).trim()
  if (block?.isError === true || text.startsWith('失败：')) return { state: 'failed', text }
  const destination = readDestinations(content).find(row => row.kind === READER_KIND)
  const entryId = destination?.params['entryId']
  if (typeof entryId !== 'string') return { state: 'done', text }
  const tab = destination!.params['tab']
  return { state: 'done', text, place: { entryId, ...(tab === 'article' || tab === 'notes' ? { tab } : {}) } }
}

/**
 * Render one `reader_note` / `reader_translate` call.
 * @param props - the tool block, the face, the copy.
 */
export function ReaderWriteRow({ block, phase, t, go }: ReaderWriteRowProps): ReactNode {
  const row = writeRowModel(block, phase)
  const first = (row.text.split('\n')[0] ?? '').replace(/^(完成|失败)：/, '')
  return (
    <div className={css.row} data-tool="reader" data-state={row.state}>
      <span className={css.kind}>{t('toolrow.kind')}</span>
      {row.state === 'running' && <span className={css.note}>{t('toolrow.running')}</span>}
      {row.state === 'failed' && <span className={css.warn} title={row.text}>{first || t('toolrow.failed')}</span>}
      {row.state === 'done' && <span className={css.name} title={row.text}>{first}</span>}
      {row.place !== undefined && (
        <button type="button" className={css.open} onClick={() => { go(row.place!) }}>
          {t('toolrow.view')}
        </button>
      )}
    </div>
  )
}
