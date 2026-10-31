/**
 * A CLI member's context occupancy and the tools other plugins register
 * beside it. `meter` draws the host composer's ring + percentage (the same
 * geometry and tones as ui-conversation's ContextMeter); clicking it opens a
 * small panel with the figures and the `panel` tools. Other placements render
 * only the registered tools for that placement — the ring is never a button
 * of its own, and local-agent draws no compact button (context-guard owns it).
 * @module @khorsheed/dsh-local-agent/client — member tools view
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import { formatTokens } from './member-dock.ts'
import { contextRatio, type MemberContextStore, type MemberToolFace, type MemberToolPlacement, type MemberToolRegistry } from './member-tools.ts'
import css from './MemberTools.module.css'

/** Ring geometry: 14px viewBox, 2px stroke (the host meter's). */
const RADIUS = 5.5
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export interface MemberToolsProps extends PropsLocale<typeof NS> {
  readonly childSessionId: string
  readonly placement: MemberToolPlacement | 'meter'
  readonly memberName?: string | undefined
  readonly store: MemberContextStore
  readonly registry: MemberToolRegistry
  readonly compact: (childSessionId: string) => Promise<void>
}

/** The occupancy ring (with its click-open panel) or one placement's tools. */
export function MemberTools({ childSessionId, placement, memberName, store, registry, compact, t }: MemberToolsProps): ReactNode {
  const context = useSyncExternalStore(
    listener => store.subscribe(childSessionId, listener),
    () => store.get(childSessionId),
  )
  useSyncExternalStore(registry.subscribe, registry.snapshotVersion)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  // The panel is portalled and fixed above the ring: a ring inside a scrolling
  // or transformed popup (the room's members table) would clip it otherwise.
  const [position, setPosition] = useState<CSSProperties | null>(null)
  useLayoutEffect(() => {
    if (!open) { setPosition(null); return }
    const rect = rootRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    const width = Math.min(264, window.innerWidth - 24)
    setPosition({ left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)), bottom: window.innerHeight - rect.top + 8, width })
  }, [open])
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      if (rootRef.current?.contains(event.target as Node) === true) return
      if (panelRef.current?.contains(event.target as Node) === true) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (context === undefined || context === null) return null
  const ratio = contextRatio(context)
  const faceFor = (at: MemberToolPlacement): MemberToolFace => ({
    childSessionId,
    ...memberName === undefined ? {} : { memberName },
    provider: context.provider,
    ...context.harness === undefined ? {} : { harness: context.harness },
    ...context.harnessDisplayName === undefined ? {} : { harnessDisplayName: context.harnessDisplayName },
    ...context.usedTokens === undefined ? {} : { usedTokens: context.usedTokens },
    ...context.contextWindow === undefined ? {} : { contextWindow: context.contextWindow },
    ...ratio === undefined ? {} : { ratio },
    state: context.state,
    placement: at,
    compact: async () => {
      await compact(childSessionId)
      store.refresh(childSessionId)
    },
  })
  const tools = (at: MemberToolPlacement): ReactNode[] => registry.tools()
    .map(tool => <span key={tool.id} className={css.tool}>{tool.render(faceFor(at))}</span>)
  if (placement !== 'meter') {
    const rendered = tools(placement)
    return rendered.length === 0 ? null : <>{rendered}</>
  }

  const percent = ratio === undefined ? undefined : Math.round(ratio * 100)
  const reading = percent === undefined ? '—' : `${percent}%`
  const label = context.state === 'compacting'
    ? t('member.context.compacting')
    : percent === undefined ? t('member.context.unknown') : t('member.context.aria', { percent: reading })
  return (
    <span ref={rootRef} className={css.root} data-member-context>
      <button
        type="button"
        className={css.trigger}
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen(!open) }}
      >
        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden className={context.state === 'compacting' ? css.spinning : undefined}>
          <circle className={css.track} cx="7" cy="7" r={RADIUS} />
          <circle
            className={css.fill}
            cx="7"
            cy="7"
            r={RADIUS}
            strokeDasharray={`${CIRCUMFERENCE * (percent ?? 0) / 100} ${CIRCUMFERENCE}`}
            transform="rotate(-90 7 7)"
          />
        </svg>
        <span>{reading}</span>
      </button>
      {open && createPortal(
        <div ref={panelRef} className={css.panel} role="dialog" aria-label={label} style={position ?? { visibility: 'hidden', left: 0, bottom: 0 }}>
          <div className={css.header}>
            <span className={css.headline}>{label}</span>
            {context.usedTokens !== undefined && context.contextWindow !== undefined && (
              <span className={css.figures}>
                {t('member.context.figures', { used: formatTokens(context.usedTokens), window: formatTokens(context.contextWindow) })}
              </span>
            )}
          </div>
          {percent !== undefined && (
            <div className={css.bar}><div className={css.segment} style={{ width: `${percent}%` }} /></div>
          )}
          {tools('panel')}
        </div>,
        document.body,
      )}
    </span>
  )
}
