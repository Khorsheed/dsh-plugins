/**
 * The cache section's break line and change list. Each card names the host
 * fact behind it (replacement, compaction, prune, or a bare id-level
 * remove/add), shows its producer verbatim, and expands into the exact
 * difference; the card where the prefix first differs carries the break mark
 * and opens by default. Jumps go to the module that owns the detail (the
 * composition filter, the compaction request, the pre-prune request).
 */
import { useState, type ReactNode } from 'react'
import type { CapturedRequest, ChangeRow, PrefixTextChange, RequestChange, RequestLink, SegmentCategory, ToolChange } from '../types.ts'
import { fmt, fmtSpan, requestNumberText } from './aggregate.ts'
import type { InspectorTabProps } from './contract.ts'
import { categoryLabelKey } from './SegmentBlocks.tsx'
import css from './ChangeList.module.css'
type T = InspectorTabProps['t']
type Prefix = NonNullable<CapturedRequest['prefix']>

export interface ChangeListProps {
  readonly request: CapturedRequest
  readonly prefix: Prefix
  readonly onOpenRequest?: ((link: RequestLink) => void) | undefined
  readonly onShowCategory?: ((category: SegmentCategory) => void) | undefined
  readonly t: T
}

const pad = (index: number) => String(index).padStart(3, '0')
function range(rows: readonly ChangeRow[]): string {
  if (rows.length === 0) return ''
  const indexes = rows.map(row => row.index)
  const lo = Math.min(...indexes), hi = Math.max(...indexes)
  return lo === hi ? pad(lo) : `${pad(lo)}–${pad(hi)}`
}
const sum = (rows: readonly ChangeRow[]) => rows.reduce((n, row) => n + row.chars, 0)

/** One-line character diff: shared context, then what left and what arrived. */
export function InlineDiff({ text, t }: { readonly text: PrefixTextChange; readonly t: T }): ReactNode {
  const leading = `${text.leadingOmitted ? '…' : ''}${text.leading}`
  const trailing = `${text.trailing}${text.trailingOmitted ? '…' : ''}`
  return <>
    <pre className={css.diff}>{leading}{text.removedChars > 0 && <del>{text.removed}{text.removedChars > 160 ? '…' : ''}</del>}{text.addedChars > 0 && <ins>{text.added}{text.addedChars > 160 ? '…' : ''}</ins>}{trailing}{!leading && !trailing && text.removedChars === 0 && text.addedChars === 0 && t('lens.diffEmpty')}</pre>
    {(text.removedChars > 160 || text.addedChars > 160) && <span className={css.meta}>{t('lens.diffTruncated')}</span>}
  </>
}

function Size({ minus, plus }: { readonly minus: number; readonly plus: number }): ReactNode {
  return <span className={css.size}>{minus > 0 && <span className={css.minus}>−{fmt(minus)}</span>}{minus > 0 && plus > 0 && ' '}{plus > 0 && <span className={css.plus}>+{fmt(plus)}</span>}</span>
}

function Rows({ label, rows, gone, t }: { readonly label: string; readonly rows: readonly ChangeRow[]; readonly gone?: boolean; readonly t: T }): ReactNode {
  if (rows.length === 0) return null
  return <div className={css.rowsBlock}>
    <span className={css.rowsLabel}>{label}</span>
    <div className={css.rows}>
      {rows.map(row => <div key={`${row.index}-${row.messageId ?? ''}`} className={gone ? css.rowGone : css.row}>
        <span className={css.rowIdx}>{pad(row.index)} {t(categoryLabelKey(row.category))}</span>
        <span className={css.rowText} title={row.preview}>{row.preview || t('lens.diffEmpty')}</span>
        <span className={css.rowChars}>{fmt(row.chars)}</span>
      </div>)}
    </div>
  </div>
}

function titleOf(change: RequestChange, t: T): string {
  if (change.system) return change.section === undefined ? t('chg.system') : `${t('chg.system')} · ${t('chg.section', { section: change.section })}`
  const from = change.removed.length, to = change.added.length
  switch (change.kind) {
    case 'compaction': return t('chg.compacted', { from: String(from) })
    case 'prune': return t('chg.pruned', { source: change.added[0]?.source ?? change.removed[0]?.source ?? '' })
    case 'remove': return t('chg.n', { count: String(from) })
    case 'add': return t('chg.n', { count: String(to) })
    default: return to === 0 ? t('chg.toEmpty', { from: String(from) }) : t('chg.nToM', { from: String(from), to: String(to) })
  }
}

function whereOf(change: RequestChange, t: T): string {
  const rows = change.added.length > 0 ? change.added : change.removed
  const parts = [t('chg.messages', { range: range(rows) })]
  if (change.eventSeq !== undefined && change.replacedSeqs !== undefined) parts.push(t('chg.seq', { seq: String(change.eventSeq), replaced: change.replacedSeqs.join('、') }))
  return parts.join(' · ')
}

function sourceOf(change: RequestChange): string | undefined {
  if (change.source !== undefined) return change.source.op === undefined ? change.source.kind : `${change.source.kind} · ${change.source.op}`
  const sources = [...new Set([...change.removed, ...change.added].map(row => row.source))]
  return sources.length === 0 ? undefined : sources.join(' · ')
}

function Card({ chip, kind, title, where, source, size, isBreak, children, t }: {
  readonly chip: string; readonly kind: string; readonly title: string; readonly where: string; readonly source?: string | undefined
  readonly size: ReactNode; readonly isBreak: boolean; readonly children: ReactNode; readonly t: T
}): ReactNode {
  const [open, setOpen] = useState(isBreak)
  return <div className={isBreak ? css.cardBreak : css.card}>
    <button type="button" className={css.head} aria-expanded={open} onClick={() => setOpen(v => !v)}>
      <span className={css.kind} data-kind={kind}>{chip}</span>
      <span className={css.where}>
        <b>{title}{isBreak && <span className={css.flag}>{t('chg.break')}</span>}</b>
        <span>{where}{source !== undefined && <> · <code className={css.src}>{source}</code></>}</span>
      </span>
      {size}
      <span className={css.chev} aria-hidden="true">›</span>
    </button>
    {open && <div className={css.body}>{children}</div>}
  </div>
}

function MessageCard({ change, prefix, onOpenRequest, onShowCategory, t }: { readonly change: RequestChange; readonly prefix: Prefix } & Omit<ChangeListProps, 'request' | 'prefix'>): ReactNode {
  const minus = change.text ? change.text.removedChars : sum(change.removed)
  const plus = change.text ? change.text.addedChars : sum(change.added)
  const previous = requestNumberText({ requestNumber: prefix.previousRequestNumber })
  return <Card chip={t(`chg.kind.${change.kind}`)} kind={change.kind} title={titleOf(change, t)} where={whereOf(change, t)} source={sourceOf(change)} size={<Size minus={minus} plus={plus} />} isBreak={change.isBreak === true} t={t}>
    {change.text && <InlineDiff text={change.text} t={t} />}
    {change.system && change.parts && <div className={css.parts}>
      {change.parts.map((part, i) => <div key={i}>
        <span className={css.rowIdx}>{part.eventSeq === undefined ? t(`chg.kind.${part.kind}`) : `seq ${part.eventSeq}`}</span>
        <span>{part.replacedSeqs === undefined
          ? t(part.added.length > 0 ? 'chg.partAdd' : 'chg.partRemove', { range: range(part.added.length > 0 ? part.added : part.removed) })
          : part.added.length === 0
            ? t('chg.partEmptied', { replaced: part.replacedSeqs.join('、'), range: range(part.removed) })
            : t('chg.partReplaced', { replaced: part.replacedSeqs.join('、'), range: range(part.added) })}</span>
      </div>)}
    </div>}
    {!change.system && !change.text && <>
      <Rows label={t('chg.out')} rows={change.removed} gone t={t} />
      <Rows label={t('chg.in')} rows={change.added} t={t} />
    </>}
    {change.sameAs && <div className={css.fact}>{t('chg.sameAs', { seq: previous, index: pad(change.sameAs.index) })}</div>}
    <div className={css.links}>
      {change.system && onShowCategory && <button type="button" onClick={() => onShowCategory('system')}>{t('chg.viewSystem')}</button>}
      {change.compactionRequest && onOpenRequest && <button type="button" onClick={() => onOpenRequest(change.compactionRequest!)}>{t('chg.openCompaction')} ↗</button>}
      {change.pruneBefore && onOpenRequest && <button type="button" onClick={() => onOpenRequest(change.pruneBefore!)}>{t('chg.openPruned', { seq: requestNumberText(change.pruneBefore) })} ↗</button>}
    </div>
  </Card>
}

function ToolCard({ change, onShowCategory, t }: { readonly change: ToolChange; readonly onShowCategory?: ChangeListProps['onShowCategory']; readonly t: T }): ReactNode {
  const what = change.change !== 'modified' ? t(`chg.tool.${change.change}`)
    : t('chg.tool.changed', { parts: [change.description && t('chg.tool.desc'), change.parameters && t('chg.tool.params')].filter(Boolean).join(t('chg.tool.and')) })
  const plus = (change.description?.addedChars ?? 0) + (change.parameters?.addedChars ?? 0)
  const minus = (change.description?.removedChars ?? 0) + (change.parameters?.removedChars ?? 0)
  return <Card chip={t('chg.kind.tool')} kind="tool" title={`${change.name} · ${what}`} where={t('chg.toolWhere')} source={change.owner} size={<Size minus={minus} plus={plus} />} isBreak={change.isBreak === true} t={t}>
    {change.description && <><span className={css.meta}>{t('chg.tool.desc')}</span><InlineDiff text={change.description} t={t} /></>}
    {change.parameters && <><span className={css.meta}>{t('chg.tool.params')}</span><InlineDiff text={change.parameters} t={t} /></>}
    {onShowCategory && <div className={css.links}><button type="button" onClick={() => onShowCategory('tool-definition')}>{t('chg.viewTools')}</button></div>}
  </Card>
}

/** The one-line break marker: where the prefix first differs, or that it does not. */
function BreakLine({ request, prefix, t }: { readonly request: CapturedRequest; readonly prefix: Prefix; readonly t: T }): ReactNode {
  const broken = prefix.changes?.find(change => change.isBreak)
  const tool = prefix.toolChanges?.find(change => change.isBreak)
  const previous = requestNumberText({ requestNumber: prefix.previousRequestNumber })
  if (prefix.configChanged !== undefined) {
    return <div className={css.breakLine}><i /><b>{t('chg.breakConfig')}</b><span className={css.mono}>{prefix.configChanged.from} → {prefix.configChanged.to}</span><span>{t('chg.configNote')}</span></div>
  }
  if (broken === undefined && tool === undefined && prefix.changed === undefined) {
    return <div className={css.breakOk}><i /><b>{t('chg.noBreak')}</b><span>{t('lens.prefixSame', { seq: previous, gap: fmtSpan(prefix.gapMs) })}</span></div>
  }
  if (broken === undefined && tool !== undefined) {
    return <div className={css.breakLine}><i /><b>{t('chg.breakTool', { name: tool.name })}</b><span>{t('chg.toolOrder')}</span></div>
  }
  const index = prefix.changed?.index ?? broken?.added[0]?.index ?? broken?.removed[0]?.index ?? 0
  const category = prefix.changed?.afterCategory ?? prefix.changed?.beforeCategory ?? broken?.added[0]?.category ?? broken?.removed[0]?.category
  const offset = broken?.system ? broken.text?.offset : prefix.changed?.text?.offset
  const rows = [...request.segments.system, ...request.segments.history, ...request.segments.added]
  const sameBefore = rows.filter(row => row.index >= 0 && row.index < index).reduce((n, row) => n + row.chars, 0) + (offset ?? 0)
  return <div className={css.breakLine}><i />
    <b>{t('chg.breakAt', { index: pad(index), category: category === undefined ? '' : t(categoryLabelKey(category)) })}</b>
    {offset !== undefined && <span className={css.mono}>{t('chg.breakChar', { offset: fmt(offset + 1) })}</span>}
    <span>{t('chg.breakReuse', { seq: previous, count: fmt(sameBefore) })}</span>
  </div>
}

export function ChangeList({ request, prefix, onOpenRequest, onShowCategory, t }: ChangeListProps): ReactNode {
  const changes = prefix.changes ?? []
  const tools = prefix.toolChanges ?? []
  const count = changes.length + tools.length
  return <>
    <BreakLine request={request} prefix={prefix} t={t} />
    {count > 0 && <div className={css.listHead}><h4>{t('chg.title')}</h4><span>{t('chg.count', { count: String(count) })}</span></div>}
    <div className={css.list}>
      {changes.map((change, i) => <MessageCard key={`m${i}`} change={change} prefix={prefix} onOpenRequest={onOpenRequest} onShowCategory={onShowCategory} t={t} />)}
      {tools.map(change => <ToolCard key={`t${change.name}`} change={change} onShowCategory={onShowCategory} t={t} />)}
    </div>
    {prefix.tail && <div className={css.tail}>{t('chg.tail', { count: String(prefix.tail.count), sources: prefix.tail.sources.join('、') })}</div>}
  </>
}
