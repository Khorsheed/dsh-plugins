/**
 * Message timeline panel, browser half. One entry in the official
 * conversation.session.header.utilities seat anchors the plugin into the
 * session scope and renders, through a body portal, the flat floating
 * timeline over the left edge of the chat scrollport: one row per loaded
 * user message — a tick plus an ellipsized one-line preview, no frame and no
 * visible scrollbar. At rest only the dimmed ticks show, the reading
 * position's tick in blue (the latest message until the tracker answers);
 * hovering or keyboard-focusing the panel reveals the row texts with the
 * blue row on top, and clicking a row jumps the transcript to that message.
 * The panel is always on while the chat view shows; the `enabled` config is
 * the off switch.
 */
import { memo, useEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import { createPortal } from 'react-dom'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { PANEL_WIDTH_MIN } from './config.ts'
import type { TimelineItem, TimelineRailProps } from './slots.ts'
import { previewText } from './preview.ts'
import css from './TimelineRail.module.css'

/** Extract the preview blocks of one user/steering node (kind-checked by the caller). */
function nodeContent(node: { data: unknown }): readonly ContentBlock[] {
  return (node.data as { content?: readonly ContentBlock[] }).content ?? []
}

/** Breathing gap between the panel's right edge and the message flow (px). */
const PANEL_GAP = 8
/** Degraded width cap (fraction of the scrollport) while the flow probe is unanswered. */
const DEGRADED_WIDTH_RATIO = 0.4

/**
 * The header-utilities entry: the portal timeline panel.
 * @param props - composed props (see {@link TimelineRailProps}).
 * @returns nothing visible in the seat; the floating panel while the chat view shows.
 */
export function TimelineRail({
  useSession, sessionId,
  includeSteering, panelWidth, initialPages,
  loadOlder, jumpTo, useRail, t,
}: TimelineRailProps) {
  const rail = useRail(s => s)
  const order = useSession(s => s.chat.order)
  const nodes = useSession(s => s.chat.nodes)
  const hasMore = useSession(s => s.hasMore)
  const loadingOlder = useSession(s => s.loadingOlder)

  const items = useMemo<TimelineItem[]>(() => {
    const result: TimelineItem[] = []
    for (const key of order) {
      const node = nodes.get(key)
      if (node === undefined) continue
      const kind = node.kind
      if (kind !== 'user' && !(includeSteering && kind === 'steering')) continue
      result.push({ key, node })
    }
    return result
  }, [order, nodes, includeSteering])

  // The lit row: the hover/arrow preselection while it moves, otherwise the
  // live reading position the tracker publishes, defaulting to the latest
  // message before the tracker answers. ArrowUp/Down or hovering moves a
  // bold preselection; Enter or a click confirms it and jumps.
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const current = focusKey ?? rail.activeKey ?? items.at(-1)?.key ?? null
  const panelRef = useRef<HTMLDivElement | null>(null)

  // The panel is a chat-view affordance: hide it while the session shows
  // another tab (trajectory etc.), detected through ChatView's data-chat-flow
  // marker. `active` splits from `visible` so history paging can bootstrap: a
  // session whose loaded event window holds no user message yet (a huge
  // assistant turn pushed it past the first page) renders no rows but must
  // still pull pages until one materializes.
  const active = rail.chatView && rail.ready && rail.sessionId === sessionId
  const visible = active && items.length > 0

  // The panel must never cover the message flow: its width is the configured
  // preferred width capped by the scrollport's left gutter — the message
  // flow's left edge minus the panel's left edge, less a breathing gap. A
  // gutter too small for the minimum usable width hides the panel entirely
  // (the timeline is an overlay affordance; squeezed into nothing it only
  // intercepts the transcript). When the flow probe is unanswered (official
  // structure change), the width degrades to a fraction of the scrollport
  // instead — never throws, never covers more than the fallback.
  const gutter = rail.flowLeft === null ? null : rail.flowLeft - rail.left - PANEL_GAP
  const width = gutter === null
    ? Math.min(panelWidth, Math.max(PANEL_WIDTH_MIN, rail.scrollportWidth * DEGRADED_WIDTH_RATIO))
    : Math.min(panelWidth, Math.max(0, gutter))
  const tooNarrow = gutter !== null && width < PANEL_WIDTH_MIN

  // Keep the lit row in view: the panel follows the reading position (a new
  // message scrolls its row in), and mouse browsing is never yanked because
  // the hovered row is the current one and always visible under the pointer.
  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>(`[data-item-key=${JSON.stringify(current)}]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [current])

  // Prefetch history while the panel is on a chat view: keep pulling pages
  // until the first user message materializes (bootstrap), then until
  // initialPages pages arrived, so the list starts near-complete. Older
  // pages load on demand when the panel scrolls to its top.
  const prefetchedPagesRef = useRef(0)
  useEffect(() => {
    if (!active) {
      prefetchedPagesRef.current = 0
      return
    }
    if (!hasMore || loadingOlder) return
    if (items.length > 0 && prefetchedPagesRef.current >= initialPages) return
    prefetchedPagesRef.current += 1
    void loadOlder()
  }, [active, hasMore, loadingOlder, items.length, initialPages, loadOlder])

  // Older history loads by scrolling the panel to its top; the official chat
  // view owns the load-older button, so the panel stays chromeless.
  const onPanelScroll = (event: UIEvent<HTMLDivElement>): void => {
    if (!hasMore || loadingOlder) return
    if (event.currentTarget.scrollTop <= 8) void loadOlder()
  }

  const confirm = (key: string): void => {
    setFocusKey(null)
    jumpTo(key)
  }

  if (!visible || tooNarrow) return null
  return createPortal(
    <div
      ref={panelRef}
      className={css.panel}
      role="navigation"
      aria-label={t('rail.panel')}
      tabIndex={0}
      data-timeline-panel=""
      style={{ left: rail.left, top: rail.top, height: rail.height, width }}
      onScroll={onPanelScroll}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const anchor = items.findIndex(item => item.key === current)
          const next = event.key === 'ArrowDown'
            ? items[Math.min(anchor + 1, items.length - 1)]
            : items[Math.max(anchor - 1, 0)]
          /* v8 ignore next -- a non-empty item list keeps the clamped index inside bounds */
          if (next !== undefined) setFocusKey(next.key)
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          /* v8 ignore next -- the panel only renders with at least one item, so a current key always exists */
          if (current !== null) confirm(current)
        }
      }}
      onBlur={() => { setFocusKey(null) }}
    >
      {items.map((item) => {
        const isCurrent = item.key === current
        const isFocused = item.key === focusKey
        const className = isFocused
          ? `${css.item} ${css.itemFocused}`
          : isCurrent ? `${css.item} ${css.itemCurrent}` : css.item
        return (
          <button
            key={item.key}
            type="button"
            data-item-key={item.key}
            aria-current={isCurrent || undefined}
            className={className}
            onClick={() => { confirm(item.key) }}
            onMouseEnter={() => { setFocusKey(item.key) }}
            onMouseLeave={() => { setFocusKey(key => key === item.key ? null : key) }}
          >
            <span className={isCurrent ? `${css.tick} ${css.tickCurrent}` : css.tick} aria-hidden="true" />
            <span className={css.itemText}>{previewText(nodeContent(item.node)) ?? t('rail.empty')}</span>
          </button>
        )
      })}
    </div>,
    document.body,
  )
}

/** Memoized export for the slot machinery (stable component identity). */
export const TimelineRailEntry = memo(TimelineRail)
