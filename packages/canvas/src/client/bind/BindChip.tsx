/**
 * The session header's binding chip (创作体裁): which canvas this writing
 * session works on. A bound session's canvas tools — and its genre's tools —
 * act on that canvas whatever the sidebar shows; unbound, they follow the
 * sidebar as they always did.
 *
 * The chip lists only canvases with a genre (a plain canvas cannot be bound)
 * and renders nothing in a session the gate does not offer it to, so a
 * deployment without a genre never sees it.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { BoardBindResult, BoardListResult, CanvasSummary } from '../../types.ts'
import type {} from '../locales.ts'
import { IconChevronDownOutlineMedium } from '../icons.tsx'
import css from './BindChip.module.css'

/** One session's binding face (the header slot injects it per session). */
export interface CanvasBindInjected {
  /** Whether this session gets the chip (gate.ts). */
  offered: () => boolean
  subscribe: (listener: () => void) => () => void
  boundCanvas: () => Promise<RemoteResult<string | null>>
  bindCanvas: (canvasId: string | null) => Promise<RemoteResult<BoardBindResult>>
  listCanvases: () => Promise<RemoteResult<BoardListResult>>
  /** Show the canvas tab on this canvas. */
  openCanvas: (canvasId: string) => void
}

export interface CanvasBindChipProps extends CanvasBindInjected {
  readonly t: TranslateNS<'canvas'>
}

/** Rows the chip offers: live canvases with a genre. */
function bindable(items: readonly CanvasSummary[]): CanvasSummary[] {
  return items.filter(row => row.genre !== undefined && row.archivedAt === null)
}

/** How often the chip re-reads a binding the model may have moved (the board poll's pace). */
const BIND_POLL_MS = 4000

export function CanvasBindChip(props: CanvasBindChipProps): ReactNode {
  const shown = useSyncExternalStore(props.subscribe, props.offered)
  return shown ? <BindMenu {...props} /> : null
}

function BindMenu({ t, boundCanvas, bindCanvas, listCanvases, openCanvas }: CanvasBindChipProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [bound, setBound] = useState<string | null>(null)
  const [rows, setRows] = useState<readonly CanvasSummary[]>([])
  const [failed, setFailed] = useState(false)

  const reload = useCallback(async () => {
    const [current, list] = await Promise.all([boundCanvas(), listCanvases()])
    if (current.ok) setBound(current.value)
    if (list.ok) setRows(bindable(list.value.items))
  }, [boundCanvas, listCanvases])

  // Read on mount (the label names the bound canvas) and again on every open:
  // a canvas may have gained a genre, or been deleted, since.
  useEffect(() => { void reload().catch(() => {}) }, [reload])

  // The model binds too (a genre's bind tool), and nothing announces that to
  // this surface — so while the page is in view, re-read the binding every
  // few seconds, and the list once when it names a canvas the chip has not
  // seen (a canvas created since).
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void boundCanvas().then((current) => { if (current.ok) setBound(current.value) }).catch(() => {})
    }, BIND_POLL_MS)
    return () => { clearInterval(timer) }
  }, [boundCanvas])
  const unseen = bound !== null && !rows.some(row => row.id === bound)
  useEffect(() => {
    if (!unseen) return
    void listCanvases().then((list) => { if (list.ok) setRows(bindable(list.value.items)) }).catch(() => {})
  }, [unseen, listCanvases])

  const pick = async (canvasId: string | null): Promise<void> => {
    const result = await bindCanvas(canvasId)
    if (result.ok && result.value.ok) {
      setBound(result.value.canvasId)
      setFailed(false)
    } else {
      setFailed(true)
    }
  }

  const title = bound === null ? undefined : rows.find(row => row.id === bound)?.title
  const items: MenuEntry[] = [
    { type: 'label', id: 'heading', text: t('bind.heading') },
    ...rows.length === 0
      ? [{ id: 'empty', label: t('bind.empty'), disabled: true }]
      : rows.map(row => ({ id: `canvas:${row.id}`, label: row.title })),
    ...bound === null ? [] : [
      { type: 'separator' as const, id: 'sep' },
      { id: 'open', label: t('bind.open') },
      { id: 'unbind', label: t('bind.unbind') },
    ],
  ]

  return (
    <Menu
      open={open}
      portal
      dense
      items={items}
      {...bound === null ? {} : { selectedId: `canvas:${bound}` }}
      onSelect={id => {
        setOpen(false)
        if (id === 'open' && bound !== null) openCanvas(bound)
        else if (id === 'unbind') void pick(null)
        else if (id.startsWith('canvas:')) void pick(id.slice('canvas:'.length))
      }}
      onClose={() => { setOpen(false) }}
      anchor={(
        <button
          type="button"
          className={css.trigger}
          data-bound={bound !== null}
          aria-label={t('bind.aria')}
          aria-haspopup="menu"
          aria-expanded={open}
          title={failed ? t('bind.failed') : undefined}
          onClick={() => {
            if (!open) void reload().catch(() => {})
            setOpen(value => !value)
          }}
        >
          <span className={css.label}>
            {failed ? t('bind.failed') : title === undefined ? t('bind.unbound') : t('bind.bound', { title })}
          </span>
          <IconChevronDownOutlineMedium size={12} />
        </button>
      )}
    />
  )
}
