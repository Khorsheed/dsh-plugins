/**
 * Message timeline panel, browser half. One entry in the official
 * conversation.session.header.utilities seat anchors the plugin into the
 * session scope and renders, through a body portal, the flat floating
 * timeline over the left edge of the chat scrollport: one row per user
 * message — a tick plus an ellipsized one-line preview, no frame and no
 * visible scrollbar. At rest only the dimmed ticks show, the reading
 * position's tick in blue (the latest message until the tracker answers);
 * hovering or keyboard-focusing the panel reveals the row texts with the
 * blue row on top, and clicking a row jumps the transcript to that message.
 * The panel is always on while the chat view shows; the `enabled` config is
 * the off switch.
 *
 * The row list is whole-session from the moment the session opens: the host
 * `turnOutline` projection names every started turn, and the loaded chat
 * window overlays richer previews (plus steering rows and message-tools
 * bubbles) for the turns it covers. A turn outside the window renders as a
 * dimmed outline row; confirming it pages history back through the turn's
 * `turn/start` seq (the session jump loader) and lands on the freshly loaded
 * row. When the host serves no turnOutline value the panel degrades to the
 * loaded window alone, paged by prefetch and panel-top scrolls.
 */
import { memo, useEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import { createPortal } from 'react-dom'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { PANEL_WIDTH_MIN } from './config.ts'
import { chatHookOf } from './chat-hook.ts'
import { outlineEntries } from './outline.ts'
import { mergeRows, type LoadedRailRow, type OutlineRailRow, type RailRow } from './rows.ts'
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
 * One row's display text: the loaded row's joined text blocks, or the outline
 * entry's bounded first-prompt preview. `null` means the message carries no
 * text (an image, attachment, or command-only input) — such rows are filtered
 * out of the list entirely rather than rendered as empty placeholders.
 */
function rowPreview(row: RailRow): string | null {
  return row.kind === 'loaded'
    ? previewText(nodeContent(row.node))
    : (row.prompt !== '' ? row.prompt : null)
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
 * Frames an outline jump retries the DOM scroll after its row materializes in
 * the chat store: the transcript renders the new page in the same commit or a
 * near frame, and a half-second budget covers the skew without hanging.
 */
const JUMP_RETRY_FRAMES = 30

/**
 * One in-flight outline jump: the turn being paged in before the scroll.
 * Owned by the component; the session's jump loader runs the shared paging
 * loop and never rejects into here (a failed or stalled loop resolves, and
 * the settle path below decides whether to re-request or fall back).
 */
interface PendingJump {
  /** The session the jump started on — a jump never crosses sessions. */
  readonly sessionId: string
  readonly turn: number
  /** The turn's `turn/start` seq (the loadThrough target). */
  readonly seq: OutlineRailRow['seq']
  /** A loadThrough request has fired for this jump at least once. */
  readonly requested: boolean
  /** A loadThrough request is in flight right now. */
  readonly awaiting: boolean
  /** The window head the last request started from (the no-progress guard). */
  readonly fromHead: number | null
}

/**
 * The header-utilities entry: the portal timeline panel.
 * @param props - composed props (see {@link TimelineRailProps}).
 * @returns nothing visible in the seat; the floating panel while the chat view shows.
 */
export function TimelineRail({
  sessionId,
  includeSteering, panelWidth, initialPages,
  loadOlder, loadThrough, jumpTo, useRail, t,
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
  // The host projection seat exists on every supported host; the VALUE is
  // present only where the assembly mounts the turn-outline unit. Both reads
  // degrade to undefined, which keeps the window-paging list.
  const outline = outlineEntries(standard.useProjection?.('turnOutline'))

  const items = useMemo<readonly RailRow[]>(() => {
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
    const loaded: TimelineItem[] = []
    const seen = new Set<string>()
    for (const key of order) {
      const node = nodes.get(key)
      if (node === undefined) continue
      if (!isTimelineRowKind(node.kind, includeSteering)) continue
      if (hidden(node)) continue
      loaded.push({ key, node })
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
      loaded.push({ key: node.key, node })
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
    loaded.sort((left, right) => left.node.anchorSeq - right.node.anchorSeq)
    // Textless messages (image/attachment/command-only inputs) are dropped:
    // a row without a preview is a dead placeholder, and a command-only turn
    // may have no transcript row to jump to at all. An all-textless session
    // ends up with no rows, which hides the panel.
    return mergeRows(loaded, outline).filter(row => rowPreview(row) !== null)
  }, [order, nodes, includeSteering, outline])

  // The lit row: the hover/arrow preselection while it moves, otherwise the
  // live reading position the tracker publishes, defaulting to the latest
  // message before the tracker answers. ArrowUp/Down or hovering moves a
  // bold preselection; Enter or a click confirms it and jumps. Loaded rows
  // identify by their node key (the tracker's active marker speaks the same
  // key); outline rows identify as `turn:<n>`.
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const current = focusKey ?? rail.activeKey ?? items.at(-1)?.id ?? null
  const panelRef = useRef<HTMLDivElement | null>(null)

  const [pendingJump, setPendingJump] = useState<PendingJump | null>(null)
  // A jump never crosses sessions; the entry's session identity switches
  // without a remount when the main view moves.
  useEffect(() => { setPendingJump(null) }, [sessionId])

  // The window head: the first visible node's anchorSeq (ChatView's firstSeq
  // derivation), the coverage line for the outline jump's re-request guard.
  const firstSeq = useMemo(() => {
    const firstKey = order[0]
    if (firstKey === undefined) return null
    return nodes.get(firstKey)?.anchorSeq ?? null
  }, [order, nodes])

  // The outline-jump state machine. Fire (click) only arms the jump; this
  // effect owns every loadThrough request, the landing scroll, and the give-
  // up fallback, re-running as the window, the paging flags, or the jump
  // itself change. The loop converges because loadThrough pages until the
  // window covers the target seq (or history runs out), and a settle that
  // moved nothing falls through to the fallback instead of re-requesting.
  useEffect(() => {
    if (pendingJump === null || pendingJump.sessionId !== sessionId) return
    const landed = items.find((row): row is LoadedRailRow => row.kind === 'loaded' && row.turn === pendingJump.turn)
    if (landed !== undefined) {
      // The store shows the turn's row; the transcript DOM renders it in the
      // same commit or a near frame, so retry briefly before giving up.
      let cancelled = false
      let frames = 0
      const attempt = (): void => {
        if (cancelled) return
        frames += 1
        if (jumpTo(landed.key) || frames >= JUMP_RETRY_FRAMES) {
          setPendingJump(null)
          return
        }
        (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : setTimeout)(attempt)
      }
      attempt()
      return () => { cancelled = true }
    }
    if (pendingJump.awaiting || loadingOlder) return
    // Settled (or freshly armed) without the row: page again while the window
    // head still moves and history remains. A covered window with the row
    // still missing — the turn's prompt is withdraw-hidden — and a stalled
    // head both land on the nearest loaded row at/after the turn instead.
    const uncovered = firstSeq === null || firstSeq > pendingJump.seq
    if (uncovered && hasMore && (!pendingJump.requested || pendingJump.fromHead !== firstSeq)) {
      const jump = pendingJump
      setPendingJump({ ...jump, requested: true, awaiting: true, fromHead: firstSeq })
      void loadThrough(jump.seq).then(() => {
        setPendingJump(current =>
          current !== null && current.sessionId === jump.sessionId && current.turn === jump.turn
            ? { ...current, awaiting: false }
            : current)
      })
      return
    }
    const fallback = items.find((row): row is LoadedRailRow => row.kind === 'loaded' && row.anchorSeq >= pendingJump.seq)
    if (fallback !== undefined) jumpTo(fallback.key)
    setPendingJump(null)
  }, [items, pendingJump, sessionId, loadingOlder, hasMore, firstSeq, jumpTo, loadThrough])

  // The panel is a chat-view affordance: hide it while the session shows
  // another tab (trajectory etc.), detected through ChatView's data-chat-flow
  // marker. With the outline the list starts whole; without it a session
  // whose loaded event window holds no user message yet (a huge assistant
  // turn pushed it past the first page) renders no rows but must still pull
  // pages until one materializes — hence `active` splits from `visible`.
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

  // Fallback mode (no outline) prefetches history while the panel is on a
  // chat view: keep pulling pages until the first user message materializes
  // (bootstrap), then until initialPages pages arrived, so the list starts
  // near-complete. Older pages load on demand when the panel scrolls to its
  // top. The outline mode skips this entirely — the projection already names
  // every turn, so no page has to arrive for the list to be complete.
  const prefetchedPagesRef = useRef(0)
  useEffect(() => {
    if (!active) {
      prefetchedPagesRef.current = 0
      return
    }
    if (outline !== undefined) return
    if (!hasMore || loadingOlder) return
    if (items.length > 0 && prefetchedPagesRef.current >= initialPages) return
    prefetchedPagesRef.current += 1
    void loadOlder()
  }, [active, hasMore, loadingOlder, items.length, initialPages, loadOlder, outline])

  // Fallback mode loads older history by scrolling the panel to its top; the
  // official chat view owns the load-older button, so the panel stays
  // chromeless. The outline mode's list is already complete.
  const onPanelScroll = (event: UIEvent<HTMLDivElement>): void => {
    if (outline !== undefined) return
    if (!hasMore || loadingOlder) return
    if (event.currentTarget.scrollTop <= 8) void loadOlder()
  }

  const confirm = (row: RailRow): void => {
    setFocusKey(null)
    if (row.kind === 'loaded') {
      // A direct jump supersedes any armed outline jump (its landing would
      // otherwise yank the transcript later).
      setPendingJump(null)
      jumpTo(row.key)
      return
    }
    // An outline row arms the jump; the effect above runs the paging and the
    // landing scroll. Re-clicking another outline row retargets the jump.
    setPendingJump({ sessionId, turn: row.turn, seq: row.seq, requested: false, awaiting: false, fromHead: null })
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
          const anchor = items.findIndex(item => item.id === current)
          const next = event.key === 'ArrowDown'
            ? items[Math.min(anchor + 1, items.length - 1)]
            : items[Math.max(anchor - 1, 0)]
          /* v8 ignore next -- a non-empty item list keeps the clamped index inside bounds */
          if (next !== undefined) setFocusKey(next.id)
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          const row = items.find(item => item.id === current)
          if (row !== undefined) confirm(row)
        }
      }}
      onBlur={() => { setFocusKey(null) }}
    >
      {items.map((row) => {
        const isCurrent = row.id === current
        const isFocused = row.id === focusKey
        const isPending = row.kind === 'outline' && pendingJump !== null && pendingJump.turn === row.turn
        const className = isFocused
          ? `${css.item} ${css.itemFocused}`
          : isCurrent ? `${css.item} ${css.itemCurrent}` : css.item
        // Outline rows share the plain styling; the pending pulse is the only
        // transient cue that a row pages history in before landing.
        const classNames = isPending ? `${className} ${css.itemPending}` : className
        return (
          <button
            key={row.id}
            type="button"
            data-item-key={row.id}
            aria-current={isCurrent || undefined}
            aria-busy={isPending || undefined}
            className={classNames}
            onClick={() => { confirm(row) }}
            onMouseEnter={() => { setFocusKey(row.id) }}
            onMouseLeave={() => { setFocusKey(key => key === row.id ? null : key) }}
          >
            <span className={isCurrent ? `${css.tick} ${css.tickCurrent}` : css.tick} aria-hidden="true" />
            <span className={css.itemText}>
              {rowPreview(row)}
            </span>
          </button>
        )
      })}
    </div>,
    document.body,
  )
}

/** Memoized export for the slot machinery (stable component identity). */
export const TimelineRailEntry = memo(TimelineRail)
