/**
 * The panel header: optional back, a title with an optional meta note, and a
 * row of icon actions whose overflow folds into one ⋯ menu.
 *
 * Actions arrive in priority order (most used first). The header shows as
 * many as the panel's width allows — {@link HEADER_VISIBLE_COMPACT} in a
 * compact panel, {@link HEADER_VISIBLE_WIDE} otherwise — and puts the rest in
 * the host's own `Menu`, so the rows, Escape / outside-click and focus return
 * are the host's rather than a hand-rolled popover. A `pinned` action always
 * stays visible (it still counts against the limit, so pin sparingly); a
 * `menuOnly` action never takes an inline slot (an informational row such as
 * the full path, or a rarely used gesture). When everything fits, there is no
 * ⋯ at all — and a ⋯ that would hold exactly one ordinary action is skipped
 * too, that action taking the trigger's own slot: a menu holding one row is a
 * detour costing the same width as the icon itself.
 *
 * @module @khorsheed/dsh-client-ui-panel-kit/client
 */
import { useRef, useState, type ReactNode, type Ref } from 'react'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconChevronLeftOutlineMedium, IconEllipsisOutlineMedium } from './icons.tsx'
import { usePanelCompact, usePanelCompactContext } from './PanelRoot.tsx'
import css from './PanelHeader.module.css'

/** Icons shown inline in a compact panel (the spec's "at most 2"). */
export const HEADER_VISIBLE_COMPACT = 2
/**
 * Icons shown inline in a wide panel. Four keeps a 360px desktop sidebar's
 * title readable next to the icons; a header needing more than four common
 * actions is a header that should be split, not widened.
 */
export const HEADER_VISIBLE_WIDE = 4

/** One header action. */
export interface PanelAction {
  /** Stable id (the menu row id). */
  readonly id: string
  /** Accessible name, tooltip, and the menu row's text. */
  readonly label: string
  /** The inline glyph (and the menu row's leading icon). */
  readonly icon: ReactNode
  /** Activation, from the inline button or the menu row. */
  readonly onSelect: () => void
  /** Keep inline even when it would otherwise overflow. */
  readonly pinned?: boolean | undefined
  /** Always in the ⋯ menu, never inline. */
  readonly menuOnly?: boolean | undefined
  /** A toggle's on state (inline: `aria-pressed` and the active tint). */
  readonly pressed?: boolean | undefined
  readonly disabled?: boolean | undefined
  /** Destructive: error-coloured in the menu. */
  readonly danger?: boolean | undefined
}

/**
 * Split actions into inline and overflow. `menuOnly` actions always overflow.
 * Of the rest, pinned actions go first, then the others in their given order;
 * everything fits when the count is within the limit, otherwise the first
 * `limit` stay inline. A lone overflowing ordinary action (no `menuOnly`
 * rows, inline still within the limit) is shown inline instead: it takes the
 * slot the ⋯ trigger would have taken.
 * @param actions - priority-ordered actions.
 * @param limit - inline icon budget.
 * @returns the inline and overflow lists, each in display order.
 */
export function splitActions(actions: readonly PanelAction[], limit: number): { inline: PanelAction[]; overflow: PanelAction[] } {
  const candidates = actions.filter(a => !a.menuOnly)
  const menuOnly = actions.filter(a => a.menuOnly)
  if (candidates.length <= limit && menuOnly.length === 0) return { inline: [...actions], overflow: [] }
  const ordered = [...candidates.filter(a => a.pinned), ...candidates.filter(a => !a.pinned)]
  const keep = new Set(ordered.slice(0, Math.max(limit, candidates.filter(a => a.pinned).length)))
  if (menuOnly.length === 0 && keep.size <= limit && candidates.length === keep.size + 1) return { inline: [...actions], overflow: [] }
  return { inline: candidates.filter(a => keep.has(a)), overflow: actions.filter(a => !keep.has(a)) }
}

export interface PanelHeaderProps {
  /** The title (a name, not a sentence). */
  readonly title: ReactNode
  /** A short note beside the title: a count, a parent folder. */
  readonly meta?: ReactNode
  /** Show a back button calling this. */
  readonly onBack?: (() => void) | undefined
  /** Back button's accessible name (required with `onBack`). */
  readonly backLabel?: string | undefined
  /** Ref to the back button (a split moving focus to it, say). */
  readonly backRef?: Ref<HTMLButtonElement> | undefined
  /** Priority-ordered icon actions. */
  readonly actions?: readonly PanelAction[] | undefined
  /** The ⋯ trigger's accessible name. */
  readonly moreLabel: string
  /** Force the compact budget; defaults to the enclosing panel's state. */
  readonly compact?: boolean | undefined
  readonly className?: string | undefined
}

/** A panel's one title row. */
export function PanelHeader({ title, meta, onBack, backLabel, backRef, actions = [], moreLabel, compact, className }: PanelHeaderProps) {
  const ref = useRef<HTMLDivElement>(null)
  const own = usePanelCompact(ref)
  const fromRoot = usePanelCompactContext()
  const isCompact = compact ?? fromRoot ?? own
  const [open, setOpen] = useState(false)
  const { inline, overflow } = splitActions(actions, isCompact ? HEADER_VISIBLE_COMPACT : HEADER_VISIBLE_WIDE)
  return <div ref={ref} className={className ? `${css.header} ${className}` : css.header} data-compact={isCompact ? 'true' : 'false'} data-back={onBack ? 'true' : 'false'}>
    {onBack && <button ref={backRef} type="button" className={css.icon} aria-label={backLabel} title={backLabel} onClick={onBack}>
      <IconChevronLeftOutlineMedium size={18} />
    </button>}
    <div className={onBack ? `${css.title} ${css.titleAfterBack}` : css.title}>
      <strong>{title}</strong>
      {meta !== undefined && <span className={css.meta}>{meta}</span>}
    </div>
    {inline.map(action => <button key={action.id} type="button" className={css.icon} aria-label={action.label} title={action.label}
      aria-pressed={action.pressed} disabled={action.disabled} onClick={action.onSelect}>{action.icon}</button>)}
    {overflow.length > 0 && <Menu
      open={open}
      portal
      align="end"
      items={overflow.map(action => ({ id: action.id, label: action.label, icon: action.icon, disabled: action.disabled === true, danger: action.danger === true }))}
      onSelect={id => {
        setOpen(false)
        overflow.find(action => action.id === id)?.onSelect()
      }}
      onClose={() => { setOpen(false) }}
      anchor={(
        <button type="button" className={css.icon} aria-label={moreLabel} title={moreLabel}
          aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
          <IconEllipsisOutlineMedium size={16} />
        </button>
      )}
    />}
  </div>
}
