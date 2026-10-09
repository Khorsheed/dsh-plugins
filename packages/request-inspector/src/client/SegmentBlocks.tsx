/**
 * The token tab's four-segment detail: 系统提示词 / 工具定义 / 历史上下文 /
 * 新增上下文 as four isomorphic collapsible blocks. Every message row shares
 * one format — 序号 · 类型 · 来源 · [工具 chip] · 预览 · 耗时 · 字符数 — and
 * expands to the verbatim `full` text (assistant rows unfold their
 * `{reasoning, text, calls}` JSON into labeled sections; system rows expand
 * to raw text only). The tools block expands to the compact two-column grid.
 *
 * Native `<details>` is driven through controlled state (summary's click is
 * pre-empted): jsdom never fires the toggle gesture, and a re-render must
 * never snap a user's fold back.
 *
 * @module @khorsheed/dsh-request-inspector/client
 */
import { useState, type ReactNode } from 'react'
import type { CapturedRequest, SegmentCategory, SegmentItem, ToolDefItem } from '../types.ts'
import { fmt, fmtDur } from './aggregate.ts'
import type { InspectorTabProps } from './contract.ts'
import css from './SegmentBlocks.module.css'

/** The panel's translate face. */
type T = InspectorTabProps['t']

/** The locale key of one category's label. */
export function categoryLabelKey(category: SegmentCategory): `cat.${SegmentCategory}` {
  return `cat.${category}`
}

/** One expandable row's chrome: summary line + lazily rendered body. */
function ExpandRow({ summary, body, defaultOpen = false, className }: {
  readonly summary: ReactNode
  readonly body: () => ReactNode
  readonly defaultOpen?: boolean | undefined
  readonly className?: string | undefined
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <details className={className ?? css.seg} open={open}>
      <summary
        className={css.summary}
        onClick={event => {
          // jsdom never performs the native toggle; the state is the truth.
          event.preventDefault()
          setOpen(value => !value)
        }}
      >
        {summary}
      </summary>
      {open && <div className={css.segBody}>{body()}</div>}
    </details>
  )
}

/** The index cell: padded wire position; `—` for the one-shot system slot (-1). */
function IndexCell({ index }: { readonly index: number }) {
  return <span className={css.idx}>{index < 0 ? '—' : String(index).padStart(3, '0')}</span>
}

/** The verbatim body of an assistant row: the `{reasoning?, text?, calls?}` JSON unfolded into labeled sections. */
interface AssistantPayload {
  readonly reasoning?: string
  readonly text?: string
  readonly calls?: readonly { id: string; name: string; arguments: string }[]
}

/** One assistant row's unfolded body: reasoning / text / tool_call sections. */
function AssistantFull({ full }: { readonly full: string }) {
  let parsed: AssistantPayload | null = null
  try {
    const value: unknown = JSON.parse(full)
    if (typeof value === 'object' && value !== null) parsed = value as AssistantPayload
  } catch {
    parsed = null
  }
  if (parsed === null) return <pre className={css.pre}>{full}</pre>
  return (
    <>
      {parsed.reasoning !== undefined && parsed.reasoning.length > 0 && (
        <>
          <div className={css.fullLabel}>reasoning</div>
          <pre className={css.pre}>{parsed.reasoning}</pre>
        </>
      )}
      {parsed.text !== undefined && parsed.text.length > 0 && (
        <>
          <div className={css.fullLabel}>text</div>
          <pre className={css.pre}>{parsed.text}</pre>
        </>
      )}
      {(parsed.calls ?? []).map((call, index) => {
        let args = call.arguments
        try {
          args = JSON.stringify(JSON.parse(call.arguments), null, 1)
        } catch { /* keep the raw argument JSON */ }
        return (
          <div key={`${call.id}-${index}`}>
            <div className={css.fullLabel}>tool_call · {call.name}</div>
            <pre className={css.pre}>{args}</pre>
          </div>
        )
      })}
      {parsed.reasoning === undefined && parsed.text === undefined && (parsed.calls ?? []).length === 0 && (
        <pre className={css.pre}>{full}</pre>
      )}
    </>
  )
}

/** A row's verbatim body, shaped by role: assistant unfolds, everything else is raw. */
function ItemFull({ item }: { readonly item: SegmentItem }) {
  if (item.category === 'assistant') return <AssistantFull full={item.full} />
  return <pre className={css.pre}>{item.full}</pre>
}

/** One message row (序号 · 类型 · 来源 · [工具chip] · 预览 · 耗时 · 字符数). */
export function SegmentItemRow({ item, t }: { readonly item: SegmentItem; readonly t: T }) {
  return (
    <ExpandRow
      summary={(
        <>
          <IndexCell index={item.index} />
          <span className={css.dot} data-cat={item.category} />
          <span className={css.sn}>{t(categoryLabelKey(item.category))}</span>
          {item.source.length > 0 && <span className={css.from}>{item.source}</span>}
          {(item.toolCalls ?? []).map(name => <span key={name} className={css.toolchip}>{name}</span>)}
          <span className={css.pv}>{item.preview}</span>
          {item.durationMs !== undefined && <span className={css.stime}>{fmtDur(item.durationMs)}</span>}
          <span className={css.st}>{item.chars > 0 ? fmt(item.chars) : '—'}</span>
        </>
      )}
      body={() => <ItemFull item={item} />}
    />
  )
}

/** One tool definition's cell in the two-column grid. */
function ToolCell({ tool }: { readonly tool: ToolDefItem }) {
  const [open, setOpen] = useState(false)
  let definition: string
  try {
    definition = JSON.stringify({ name: tool.name, description: tool.description, parameters: JSON.parse(tool.parameters) as unknown }, null, 1)
  } catch {
    definition = `${tool.name}\n\n${tool.description}\n\n${tool.parameters}`
  }
  return (
    <details className={css.toolCell} open={open}>
      <summary
        className={css.toolSummary}
        onClick={event => {
          event.preventDefault()
          setOpen(value => !value)
        }}
      >
        <span className={css.toolName}>{tool.name}</span>
        <span className={css.tc}>{fmt(tool.chars)}</span>
      </summary>
      {open && <pre className={css.pre}>{definition}</pre>}
    </details>
  )
}

/** A block header's aggregate row (the design's segment summary line). */
function BlockSummary({ index, name, from, preview, chars, dot }: {
  readonly index: string
  readonly name: string
  readonly from: string
  readonly preview?: ReactNode
  readonly chars: number
  /** The header dot: a category color, or the block markers (grey history / accent added). */
  readonly dot?: SegmentCategory | 'muted' | 'accent' | undefined
}) {
  const dotProps = dot === undefined ? {}
    : dot === 'muted' || dot === 'accent' ? { 'data-dot': dot } : { 'data-cat': dot }
  return (
    <>
      <span className={css.idx}>{index}</span>
      <span className={css.dot} {...dotProps} />
      <span className={css.sn}>{name}</span>
      <span className={css.from}>{from}</span>
      <span className={css.pv}>{preview}</span>
      <span className={css.st}>{chars > 0 ? fmt(chars) : '—'}</span>
    </>
  )
}

/** The history block's top-3 category chips (the collapsed summary's content hints). */
function HistoryChips({ items, t }: { readonly items: readonly SegmentItem[]; readonly t: T }) {
  const byCategory = new Map<SegmentCategory, number>()
  for (const item of items) byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + item.chars)
  const top = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  return (
    <>
      {top.map(([category, chars], index) => (
        <span key={category} className={css.histChip}>
          {index > 0 && <span className={css.histSep}>·</span>}
          <span className={css.dot} data-cat={category} />
          {t(categoryLabelKey(category))} {fmt(chars)}
        </span>
      ))}
    </>
  )
}

export interface SegmentBlocksProps {
  readonly request: CapturedRequest
  /** The legend's category filter; applies to the history/added rows. */
  readonly filterCat: SegmentCategory | null
  readonly t: T
}

/** The four blocks, in wire order: system, tools, history (collapsed), added (open). */
export function SegmentBlocks({ request, filterCat, t }: SegmentBlocksProps) {
  const { system, tools, history, added } = request.segments
  const systemChars = system.reduce((n, item) => n + item.chars, 0)
  const toolsChars = tools.reduce((n, tool) => n + tool.chars, 0)
  const historyChars = history.reduce((n, item) => n + item.chars, 0)
  const addedChars = added.reduce((n, item) => n + item.chars, 0)
  const historyRows = filterCat === null ? history : history.filter(item => item.category === filterCat)
  const addedRows = filterCat === null ? added : added.filter(item => item.category === filterCat)
  return (
    <>
      <ExpandRow
        summary={(
          <BlockSummary
            index={system.length > 0 && system[0] !== undefined && system[0].index >= 0 ? String(system[0].index).padStart(3, '0') : '—'}
            name={t('seg.system')}
            from={t('seg.systemFrom', { count: String(system.length) })}
            chars={systemChars}
            dot="system"
          />
        )}
        body={() => system.length === 0
          ? <div className={css.emptyNote}>{t('seg.systemEmpty')}</div>
          : system.map((item, row) => <SegmentItemRow key={`${item.index}-${row}`} item={item} t={t} />)}
      />
      <ExpandRow
        summary={(
          <BlockSummary
            index="—"
            name={t('seg.tools')}
            from={t('seg.toolsFrom', { count: String(tools.length) })}
            preview={tools.map(tool => tool.name).join(', ')}
            chars={toolsChars}
            dot="tool-definition"
          />
        )}
        body={() => tools.length === 0
          ? <div className={css.emptyNote}>{t('seg.toolsEmpty')}</div>
          : (
            <div className={css.toolGrid}>
              {tools.map(tool => <ToolCell key={tool.name} tool={tool} />)}
            </div>
          )}
      />
      <ExpandRow
        summary={(
          <BlockSummary
            index="···"
            name={t('seg.history')}
            from={t('seg.historyFrom', { count: String(history.length) })}
            preview={<HistoryChips items={history} t={t} />}
            chars={historyChars}
            dot="muted"
          />
        )}
        body={() => historyRows.length === 0
          ? <div className={css.emptyNote}>{t('seg.empty')}</div>
          : historyRows.map((item, row) => <SegmentItemRow key={`${item.index}-${row}`} item={item} t={t} />)}
      />
      <ExpandRow
        defaultOpen
        summary={(
          <BlockSummary
            index="···"
            name={t('seg.added')}
            from={t('seg.addedFrom', { count: String(added.length) })}
            chars={addedChars}
            dot="accent"
          />
        )}
        body={() => addedRows.length === 0
          ? <div className={css.emptyNote}>{t('seg.empty')}</div>
          : addedRows.map((item, row) => <SegmentItemRow key={`${item.index}-${row}`} item={item} t={t} />)}
      />
    </>
  )
}
