/**
 * The floating side-chat dock (`shell.overlay`, root scope): a draggable
 * floating frame hosting the shared panel, so a conversation can continue
 * over a custom main panel (a canvas space, say) without yielding the detail
 * tab. The overlay layer itself is click-through; the frame opts back into
 * pointer events.
 *
 * The dock is ROOT-scoped while sends ride the CURRENTLY SELECTED session
 * (`useSessions(s => s.current)`, the canvas space's fence pattern): with no
 * session selected the composer is read-only. The tab that opened the dock
 * and this frame meet through the slot store — the tab's `openDock` wrote
 * the context here; the header's close hands the context back to the tab
 * (`closeToTab`, which also reveals it through the official navigation face).
 *
 * @module @khorsheed/dsh-sidechat/client
 */
import { useCallback, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { IconCloseOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SideChatDockProps } from './contract.ts'
import { SideChatPanel } from './SideChatPanel.tsx'
import { useOpenWithSurfacer } from './use-open-with-surfacer.ts'
import css from './SideChatDock.module.css'

/** The frame's size and the viewport margin its position clamps to. */
const FRAME_WIDTH = 400
const FRAME_HEIGHT = 520
const VIEWPORT_MARGIN = 8

/** The floating dock. */
export function SideChatDock({
  useStore, actions, useSessions, usePanelInfo, t, getState, listContexts, send, surfaceHints, openTab, closeToTab,
}: SideChatDockProps): ReactNode {
  const open = useStore(s => s.open)
  const contextKey = useStore(s => s.contextKey)
  const x = useStore(s => s.x)
  const y = useStore(s => s.y)
  const current = useSessions(sessions => sessions.current)
  const currentLabel = useSessions(sessions =>
    current === undefined ? undefined : sessions.byId[current]?.displayTitle)
  const activePanelId = usePanelInfo(info => info.activePanelId)

  // The surfacer's primary home: this entry mounts at shell boot, so a
  // consumer's openWith surfaces whether or not any side-chat surface is
  // open — tab on the conversation panel, dock anywhere else, tab as the
  // fallback tier. (The tab runs its own surfacer only when the overlay
  // seat is absent, so the two never double-fire.)
  useOpenWithSurfacer({
    surfaceHints,
    activePanelId,
    openTab,
    openDock: (key) => { actions.open(key) },
    enabled: true,
  })

  // The drag: pointer deltas translate the frame, clamped to the viewport.
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)
  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - x, offsetY: event.clientY - y }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }, [x, y])
  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag === null || event.pointerId !== drag.pointerId) return
    const nextX = Math.min(Math.max(VIEWPORT_MARGIN, event.clientX - drag.offsetX), Math.max(VIEWPORT_MARGIN, window.innerWidth - FRAME_WIDTH - VIEWPORT_MARGIN))
    const nextY = Math.min(Math.max(VIEWPORT_MARGIN, event.clientY - drag.offsetY), Math.max(VIEWPORT_MARGIN, window.innerHeight - FRAME_HEIGHT - VIEWPORT_MARGIN))
    actions.move(nextX, nextY)
  }, [actions])
  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
  }, [])

  if (!open || contextKey === null) return null
  const fallbackLabel = currentLabel ?? contextKey
  return (
    <div className={css.frame} style={{ left: x, top: y, width: FRAME_WIDTH, height: FRAME_HEIGHT }}>
      <div
        className={css.handle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span className={css.handleTitle}>{t('tab.label')}</span>
        <Tooltip label={t('dock.backToTab')} side="bottom">
          <button
            type="button"
            className={css.close}
            aria-label={t('dock.backToTab')}
            onPointerDown={event => { event.stopPropagation() }}
            onClick={() => { closeToTab(contextKey) }}
          >
            <IconCloseOutline16 />
          </button>
        </Tooltip>
      </div>
      <div className={css.body}>
        <SideChatPanel
          sessionId={current}
          contextKey={contextKey}
          onContextChange={(key) => { actions.setContext(key) }}
          fallbackLabel={fallbackLabel}
          t={t}
          remote={{ getState, listContexts, send }}
        />
      </div>
    </div>
  )
}
