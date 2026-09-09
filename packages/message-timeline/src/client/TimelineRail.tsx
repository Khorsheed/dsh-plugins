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
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { PANEL_WIDTH_MIN } from './config.ts'
import { chatHookOf } from './chat-hook.ts'
import type { TimelineItem, TimelineRailProps } from './slots.ts'
import { previewText } from './preview.ts'
import { foldHiddenSpans, isSeqHidden } from './hidden-spans.ts'
import { isTimelineRowKind, EDIT_KIND, RESTORED_KIND } from './timeline-kinds.ts'
import css from './TimelineRail.module.css'

/** Extract the preview blocks of one user/steering node (kind-checked by the caller). */
function nodeContent(node: { data: unknown }): readonly ContentBlock[] {
  return (node.data as { content?: readonly ContentBlock[] }).content ?? []
}

/**
 * Horizontal panel padding, matching `.panel`'s `padding: 4px 8px`: the text
 * band sits this far inside the box, so the width budget must give it back
 * for {@link PANEL_GAP} to be the visible gap to the message flow.
 */
const PANEL_PADDING_X = 8
/** Visible breathing gap between the timeline text and the message flow (px). */
const PANEL_GAP = 16
/** Degraded width cap (fraction of the scrollport) while the flow probe is unanswered. */
const DEGRADED_WIDTH_RATIO = 0.4

/**
 * The header-utilities entry: the portal timeline panel.
 * @param props - composed props (see {@link TimelineRailProps}).
 * @returns nothing visible in the seat; the floating panel while the chat view shows.
 */
export function TimelineRail({
  sessionId,
  includeSteering, panelWidth, initialPages,
  loadOlder, jumpTo, useRail, t,
  ...standard
}: TimelineRailProps) {
  const rail = useRail(s => s)
  // Chat data lives in the `useChat` standard prop on 0.1.2 (the rc-line
  // session-snapshot seat is gone); the helper degrades to an empty slice
  // when the seat is absent.
  const useChatSlice = chatHookOf(standard)
  const useSession = standard.useSession
  const order = useChatSlice(c => c.order)
  const nodes = useChatSlice(c => c.nodes)
  const hasMore = useSession(s => s.hasMore)
  const loadingOlder = useSession(s => s.loadingOlder)

  const items = useMemo<TimelineItem[]>(() => {
    // The node store is an in-memory snapshot; take it once so the span fold
    // and the message-tools append read the same snapshot.
    let store: readonly ChatConversationViewNode[] = []
    let spans: number[] = []
    try {
      store = nodes.values()
      spans = foldHiddenSpans(store)
    } catch {
      // Degrade, don't explode: a failed store read leaves no spans and no
      // appended bubbles, so the baseline order rows still render (a withdraw
      // span reappears, and bubbles re-appear, after the store recovers).
    }
    // A message-tools withdraw (or an in-place edit) leaves the withdrawn
    // originals in the store with a sibling `message-tools-withdrawn` /
    // `message-tools-edited` node carrying the span they cover as
    // `{ hiddenStartSeq, seq }`. Those originals can still surface in the
    // host's `order`, but the DOM hider hides their transcript rows — a rail
    // row for one is a dead row (clicking cannot scroll to it). Drop any such
    // row whose anchorSeq sits inside a span, from either loop below. An
    // ordinary session carries no span node, so the fold is empty and every
    // order row still renders: this filter never alters the baseline.
    const hidden = (node: { anchorSeq: number }): boolean => isSeqHidden(spans, node.anchorSeq)
    const result: TimelineItem[] = []
    const seen = new Set<string>()
    for (const key of order) {
      const node = nodes.get(key)
      if (node === undefined) continue
      if (!isTimelineRowKind(node.kind, includeSteering)) continue
      if (hidden(node)) continue
      result.push({ key, node })
      seen.add(key)
    }
    // After a message-tools in-place edit the replacement materializes as a
    // `message-tools-edited` bubble (a restore as `message-tools-restored`)
    // that the host's visible `order` does not always surface, even though it
    // renders in the flow — an edit of the first message would drain the rail
    // to zero rows. Append any such visible bubble the order omitted, provided
    // it is not itself a withdrawn original (inside a span). Only these two
    // bubble kinds are appended — a plain user/steering node not in `order`
    // must never be resurrected as an orphan row. Normal sessions carry no
    // such nodes, so this never alters the baseline.
    for (const node of store) {
      if (node.kind !== EDIT_KIND && node.kind !== RESTORED_KIND) continue
      if (node.visibility === 'hidden') continue
      if (seen.has(node.key)) continue
      if (hidden(node)) continue
      result.push({ key: node.key, node })
      seen.add(node.key)
    }
    // The order loop is seq-sorted, but the appended bubbles walked the store
    // (whose iteration order is not seq-ordered), so a bubble for an OLDER
    // message would otherwise land at the very end, past the newest row.
    // Sort the combined rows by anchorSeq so every row — original or appended
    // — sits at its true transcript position. JS sort is stable, and an
    // ordinary session has no appended bubbles, so this never reorders the
    // baseline (which is already seq-sorted). Dropped rows are gone before the
    // sort, so a withdrawn original never resurfaces.
    result.sort((left, right) => left.node.anchorSeq - right.node.anchorSeq)
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
  // flow's left edge minus the panel's left edge, less the panel's right
  // padding and the visible breathing gap. A gutter too small for the minimum
  // usable width hides the panel entirely (the timeline is an overlay
  // affordance; squeezed into nothing it only intercepts the transcript).
  // When the flow probe is unanswered (official structure change), the width
  // degrades to a fraction of the scrollport instead — never throws, never
  // covers more than the fallback.
  const gutter = rail.flowLeft === null ? null : rail.flowLeft - rail.left - PANEL_PADDING_X - PANEL_GAP
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
